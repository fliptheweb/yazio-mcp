import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/core';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthClientInformationFull,
  type OAuthMetadata,
} from '@modelcontextprotocol/server';
import {
  YazioApi,
  YazioApiError,
  YazioHttp,
  type Token,
  type YazioHttpOptions,
} from '../api/index.js';
import type { Sealer } from './crypto.js';
import { windowKey, type Store } from './store.js';

export const SCOPE = 'mcp';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ACCESS_TOKEN_TTL_S = 60 * 60;
/** Renewed on every refresh, so only a connector unused for this long has to sign in again */
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_MS = MINUTE;
/** A used code is remembered this long, so a late replay still revokes what it issued */
const USED_CODE_RETENTION_MS = HOUR;
const PENDING_TTL_MS = 10 * MINUTE;
const MAX_PENDING = 1000;
const MAX_REGISTRATIONS_PER_DAY = 1000;
const MAX_CREDENTIAL_LENGTH = 512;
/** Registration metadata is stored for every client, so it is kept small */
const MAX_CLIENT_METADATA_BYTES = 4096;
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_CLIENT_ID_LENGTH = 64;
/** The state of a client is stored with the sign-in and goes back in a URL, so it is kept small */
const MAX_STATE_LENGTH = 2048;

/** A registration nobody signs in with is dropped after a day */
const UNUSED_CLIENT_TTL_MS = DAY;
/** A client lives at least this long after an authorization request, so the sign-in can finish */
const AUTHORIZING_CLIENT_TTL_MS = HOUR;
/** A client that holds tokens is kept for a year after its last token */
const USED_CLIENT_TTL_MS = 365 * DAY;

/** A session without tokens: the time between the sign-in and the exchange of the code */
const SESSION_GRACE_MS = 15 * MINUTE;
/** A session outlives its last refresh token by a short time only */
const SESSION_TTL_MS = REFRESH_TOKEN_TTL_S * SECOND + HOUR;

/** The Yazio token is renewed this long before it expires */
const RENEW_MARGIN_MS = 5 * MINUTE;
/** Longer than one request to Yazio can take, so a crashed renewal frees its lock by itself */
const RENEW_LOCK_MS = 45 * SECOND;
const RENEW_POLL_MS = 200;
const RENEW_POLLS = 175;
const LOGIN_LOCK_MS = MINUTE;
const REFRESH_LOCK_MS = 2 * MINUTE;
const UPSTREAM_TIMEOUT_MS = 30 * SECOND;

const CLIENT_AUTH_METHODS = ['client_secret_post', 'client_secret_basic', 'none'] as const;
const GRANT_TYPES = ['authorization_code', 'refresh_token'];
/** PKCE (RFC 7636): a verifier is 43 to 128 unreserved characters, an S256 challenge is 43 base64url characters */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

const EXPIRED_SIGN_IN =
  'This sign-in request has expired. Start the connection again from your app.';

/** Signs in to Yazio and returns the token. The password goes no further than this call. */
export type SignIn = (username: string, password: string) => Promise<Token>;

/** Yazio's OAuth client, when not the default one */
export interface YazioClientId {
  clientId?: string;
  clientSecret?: string;
}

/** The public addresses of this server for one request */
export interface Site {
  /** The origin, which is also the OAuth issuer */
  issuer: URL;
  /** The MCP endpoint, which is the resource the tokens are issued for */
  resource: URL;
}

export interface AuthorizationServerOptions {
  store: Store;
  sealer: Sealer;
  signIn: SignIn;
  yazioClient?: YazioClientId;
  fetch?: typeof fetch;
  now?: () => number;
  /** Waits between two looks at a renewal that another request runs */
  sleep?: (ms: number) => Promise<unknown>;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type AuthorizeResult =
  | {
      kind: 'login';
      pendingId: string;
      clientName: string;
      redirectTarget: string;
      redirectUri: string;
    }
  | { kind: 'error'; status: number; error: OAuthError }
  | { kind: 'redirect'; location: string };

/** What a failed renewal of the Yazio token did to the request that needed it */
export interface RenewalOutcome {
  /** Yazio refused the renewal: the session is over */
  refused: boolean;
  /** Yazio did not answer: the session is kept */
  unavailable: boolean;
}

/** A registered client. The secret is stored as a hash only. */
export interface ClientRecord {
  client: OAuthClientInformationFull;
  secretHash?: string;
  /** Epoch milliseconds */
  expiresAt: number;
}

interface Pending {
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectUriSent: boolean;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  /** Epoch milliseconds */
  expiresAt: number;
  resource: string;
}

interface Code {
  clientId: string;
  redirectUri: string;
  redirectUriSent: boolean;
  codeChallenge: string;
  scopes: string[];
  sessionId: string;
  /** Epoch milliseconds */
  expiresAt: number;
  resource: string;
}

/** What an access token or a refresh token stands for */
interface Grant {
  clientId: string;
  scopes: string[];
  sessionId: string;
  /** Epoch seconds */
  expiresAt: number;
  resource: string;
}

/** What stays of a refresh token after its exchange, so that a second use is seen */
interface UsedRefreshToken {
  clientId: string;
  sessionId: string;
  resource: string;
}

/** Why a session cannot give a Yazio token */
export class SessionError extends Error {
  constructor(readonly kind: 'gone' | 'refused' | 'unavailable') {
    super(
      kind === 'unavailable'
        ? 'Yazio could not be reached, try again shortly'
        : kind === 'refused'
          ? 'Yazio ended the session, please sign in again'
          : 'Session expired, please sign in again'
    );
    this.name = 'SessionError';
  }
}

/** The fixed words of the Yazio paths that the API client uses. Every other segment is an id. */
const PATH_WORDS = new Set([
  'bodyvalues',
  'consumed-items',
  'daily-summary',
  'dietary-preferences',
  'exercises',
  'feeling',
  'goals',
  'last',
  'meals',
  'oauth',
  'products',
  'recipes',
  'search',
  'settings',
  'suggested',
  'token',
  'trainings',
  'unmodified',
  'user',
  'water-intake',
  'weight',
  'widgets',
]);

/**
 * A Yazio path without its ids: an id says which product, recipe or meal a person looked at.
 * Only the known words stay, so an id that looks like a word is hidden too.
 */
export const maskPath = (path: string): string =>
  path
    .split('?')[0]
    .split('/')
    .map((segment) => (segment === '' || PATH_WORDS.has(segment) ? segment : ':id'))
    .join('/');

/**
 * Logs that a Yazio response has another shape than expected, without the response:
 * its keys and values can be personal data.
 */
const quietShapeLog: NonNullable<YazioHttpOptions['onUnexpectedShape']> = (method, path, error) => {
  const kinds = [...new Set(error.issues.map((issue) => issue.code))].join(',');
  console.error(
    `Yazio ${method} ${maskPath(path)} returned an unexpected shape: ` +
      `${error.issues.length} differences (${kinds})`
  );
};

export const yazioSignIn =
  (client: YazioClientId = {}, fetchImpl?: typeof fetch): SignIn =>
  (username, password) =>
    new YazioHttp(
      { username, password, ...client },
      { fetch: guarded(fetchImpl), onUnexpectedShape: quietShapeLog }
    ).authenticate();

/**
 * Every request to Yazio gets a deadline, so one that never answers cannot hold a
 * lock forever. A failed response loses its body and status text:
 * both come from upstream, and errors built from them reach logs and clients.
 */
function guarded(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
    const response = await fetchImpl(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return response.ok ? response : new Response(null, { status: response.status });
  }) as typeof fetch;
}

/** Yazio answers a dead refresh token with one of these; anything else is an outage */
const isRefusal = (error: unknown) =>
  error instanceof YazioApiError && [400, 401, 403].includes(error.status);

const fail = (code: OAuthErrorCode, message: string) => new OAuthError(code, message);

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

const s256 = (verifier: string) =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url');

const pathOf = (input: string | URL | Request): string => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(href).pathname;
  } catch {
    return '';
  }
};

/** What the sign-in page names as the place the browser returns to: a host, or an app's scheme */
export function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'https:' || url.protocol === 'http:'
    ? url.host
    : url.protocol.replace(/:$/, '');
}

/** Tokens and codes are stored as hashes: a copy of the storage cannot be used to sign in */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');

/**
 * OAuth 2.1 authorization server whose identity provider is Yazio.
 *
 * The user signs in on our page with their Yazio credentials. The password is
 * exchanged once for a Yazio token and dropped. Only the token is kept, encrypted,
 * in the store. The access and refresh tokens issued here are opaque handles to
 * that session. The server keeps nothing in memory between two requests.
 */
export class AuthorizationServer {
  private readonly store: Store;
  private readonly sealer: Sealer;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<unknown>;

  constructor(private readonly options: AuthorizationServerOptions) {
    this.store = options.store;
    this.sealer = options.sealer;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => delay(ms));
  }

  metadata(site: Site): OAuthMetadata {
    const at = (path: string) => new URL(path, site.issuer).href;
    return {
      issuer: site.issuer.href,
      authorization_endpoint: at('/authorize'),
      token_endpoint: at('/token'),
      registration_endpoint: at('/register'),
      revocation_endpoint: at('/revoke'),
      response_types_supported: ['code'],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [...CLIENT_AUTH_METHODS],
      revocation_endpoint_auth_methods_supported: [...CLIENT_AUTH_METHODS],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    };
  }

  // --- registration (RFC 7591) ---

  async register(body: unknown): Promise<OAuthClientInformationFull> {
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) throw fail(OAuthErrorCode.InvalidClientMetadata, parsed.error.message);
    const metadata = parsed.data;

    if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_CLIENT_METADATA_BYTES) {
      throw fail(
        OAuthErrorCode.InvalidClientMetadata,
        `Client metadata is limited to ${MAX_CLIENT_METADATA_BYTES} bytes`
      );
    }
    if ((metadata.client_name?.length ?? 0) > MAX_CLIENT_NAME_LENGTH) {
      throw fail(
        OAuthErrorCode.InvalidClientMetadata,
        `client_name is limited to ${MAX_CLIENT_NAME_LENGTH} characters`
      );
    }
    if (metadata.redirect_uris.length === 0 || metadata.redirect_uris.length > MAX_REDIRECT_URIS) {
      throw fail(
        OAuthErrorCode.InvalidRedirectUri,
        `Between 1 and ${MAX_REDIRECT_URIS} redirect_uris are required`
      );
    }
    for (const uri of metadata.redirect_uris) checkRedirectUri(String(uri));

    // RFC 7591 defaults to client_secret_basic; anything else we can't verify is refused
    const method = metadata.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!(CLIENT_AUTH_METHODS as readonly string[]).includes(method)) {
      throw fail(
        OAuthErrorCode.InvalidClientMetadata,
        `token_endpoint_auth_method ${method} is not supported`
      );
    }
    for (const grant of metadata.grant_types ?? []) {
      if (!GRANT_TYPES.includes(grant)) {
        throw fail(OAuthErrorCode.InvalidClientMetadata, `grant type ${grant} is not supported`);
      }
    }
    for (const type of metadata.response_types ?? []) {
      if (type !== 'code') {
        throw fail(OAuthErrorCode.InvalidClientMetadata, `response type ${type} is not supported`);
      }
    }

    // Anyone can register, so the number of new clients in one day has a limit
    if (
      (await this.store.increment(windowKey('count:register', DAY, this.now()), DAY)) >
      MAX_REGISTRATIONS_PER_DAY
    ) {
      throw fail(OAuthErrorCode.TemporarilyUnavailable, 'Too many registrations, try again later');
    }

    const client: OAuthClientInformationFull = {
      ...metadata,
      redirect_uris: metadata.redirect_uris.map(String),
      token_endpoint_auth_method: method,
      client_id: randomUUID(),
      client_id_issued_at: this.seconds(),
    };
    const record: ClientRecord = { client, expiresAt: this.now() + UNUSED_CLIENT_TTL_MS };
    let secret: string | undefined;
    if (method !== 'none') {
      secret = randomBytes(32).toString('base64url');
      record.secretHash = hashToken(secret);
      // Never expires (RFC 7591). An expiring secret ends every connector a month after it was added
      client.client_secret_expires_at = 0;
    }
    await this.store.set(`client:${client.client_id}`, JSON.stringify(record), {
      ttlMs: UNUSED_CLIENT_TTL_MS,
    });
    // The secret leaves the server in this answer only
    return secret === undefined ? client : { ...client, client_secret: secret };
  }

  // --- authorization ---

  /**
   * Validate an authorization request. Errors before the redirect URI is known are
   * answered directly; later ones go back to the client, as OAuth requires.
   */
  async authorize(site: Site, params: URLSearchParams): Promise<AuthorizeResult> {
    let record: ClientRecord;
    let redirectUri: string;
    let redirectUriSent: boolean;
    try {
      const clientId = single(params, 'client_id');
      if (!clientId) throw fail(OAuthErrorCode.InvalidRequest, 'client_id is required');
      const found = await this.getClient(clientId);
      if (!found) throw fail(OAuthErrorCode.InvalidClient, 'Unknown client_id');
      record = found;
      const registered = record.client.redirect_uris;
      const sent = single(params, 'redirect_uri');
      if (sent !== undefined) {
        if (!registered.includes(sent)) {
          throw fail(OAuthErrorCode.InvalidRequest, 'redirect_uri is not registered');
        }
        redirectUri = sent;
        redirectUriSent = true;
      } else if (registered.length === 1) {
        redirectUri = registered[0];
        redirectUriSent = false;
      } else {
        throw fail(
          OAuthErrorCode.InvalidRequest,
          'redirect_uri is required when several are registered'
        );
      }
    } catch (error) {
      return { kind: 'error', status: 400, error: asOAuthError(error) };
    }

    const { client } = record;
    let state: string | undefined;
    try {
      const sentState = single(params, 'state');
      // A state that is too long does not go back to the client either
      if (sentState !== undefined && sentState.length > MAX_STATE_LENGTH) {
        throw fail(
          OAuthErrorCode.InvalidRequest,
          `state is limited to ${MAX_STATE_LENGTH} characters`
        );
      }
      state = sentState;
      if (single(params, 'response_type') !== 'code') {
        throw fail(OAuthErrorCode.UnsupportedResponseType, 'response_type must be code');
      }
      if (single(params, 'code_challenge_method') !== 'S256') {
        throw fail(
          OAuthErrorCode.InvalidRequest,
          'PKCE with code_challenge_method S256 is required'
        );
      }
      const codeChallenge = single(params, 'code_challenge');
      if (!codeChallenge || !S256_CHALLENGE.test(codeChallenge)) {
        throw fail(
          OAuthErrorCode.InvalidRequest,
          'code_challenge must be a base64url S256 challenge'
        );
      }
      checkResource(site, single(params, 'resource'));
      // There is one scope only, so every grant has it, whatever the client asked for
      single(params, 'scope');
      const scopes = [SCOPE];

      // A sign-in is open for one window at most from its admission time, so every open one
      // was admitted in this window or in the one before. The sum of both counters is never
      // less than the number of open sign-ins. One time for all of it: the counters and the
      // expiry of the sign-in must agree on the window, also when the store is slow.
      const admitted = this.now();
      const started = await this.store.increment(
        windowKey('count:pending', PENDING_TTL_MS, admitted),
        2 * PENDING_TTL_MS
      );
      const before = await this.store.get(
        windowKey('count:pending', PENDING_TTL_MS, admitted - PENDING_TTL_MS)
      );
      if (started + (Number(before) || 0) > MAX_PENDING) {
        throw fail(
          OAuthErrorCode.TemporarilyUnavailable,
          'Too many sign-ins in progress, try again shortly'
        );
      }
      await this.touchClient(record, AUTHORIZING_CLIENT_TTL_MS, 30 * MINUTE);

      const pendingId = randomBytes(24).toString('base64url');
      const clientName = client.client_name ?? client.client_id;
      const pending: Pending = {
        clientId: client.client_id,
        clientName,
        redirectUri,
        redirectUriSent,
        codeChallenge,
        state,
        scopes,
        expiresAt: admitted + PENDING_TTL_MS,
        resource: site.resource.href,
      };
      const left = pending.expiresAt - this.now();
      if (left <= 0) {
        throw fail(OAuthErrorCode.TemporarilyUnavailable, 'The server is slow, try again shortly');
      }
      await this.store.set(`pending:${hashToken(pendingId)}`, JSON.stringify(pending), {
        ttlMs: left,
      });
      return {
        kind: 'login',
        pendingId,
        clientName,
        redirectTarget: redirectTarget(redirectUri),
        redirectUri,
      };
    } catch (error) {
      return {
        kind: 'redirect',
        location: errorRedirect(site, redirectUri, asOAuthError(error), state),
      };
    }
  }

  /** The pending sign-in a form belongs to, for re-rendering it after a failed attempt */
  async pendingLogin(
    site: Site,
    pendingId: string
  ): Promise<{ clientName: string; redirectTarget: string; redirectUri: string } | undefined> {
    const pending = await this.livePending(site, hashToken(pendingId));
    if (!pending) return undefined;
    return {
      clientName: pending.clientName,
      redirectTarget: redirectTarget(pending.redirectUri),
      redirectUri: pending.redirectUri,
    };
  }

  /** Sign in to Yazio and, on success, return the redirect carrying a fresh authorization code */
  async completeLogin(
    site: Site,
    pendingId: string,
    username: string,
    password: string
  ): Promise<{ location: string } | { error: string }> {
    const hash = hashToken(pendingId);
    if (!(await this.livePending(site, hash))) return { error: EXPIRED_SIGN_IN };
    if (!username || !password) return { error: 'Enter your Yazio email and password.' };
    if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) {
      return { error: 'Yazio rejected those credentials.' };
    }

    // One attempt at a time for one sign-in, so that it gives one code only
    const lockKey = `pending-lock:${hash}`;
    const owner = randomUUID();
    if (!(await this.store.set(lockKey, owner, { if: 'absent', ttlMs: LOGIN_LOCK_MS }))) {
      return { error: 'This sign-in is already being checked. Wait a moment.' };
    }
    try {
      let token: Token;
      try {
        token = this.stamp(await this.options.signIn(username, password));
      } catch (error) {
        // Deliberately vague about why: it must not reveal whether an account exists
        if (error instanceof YazioApiError && error.status >= 400 && error.status < 500) {
          return { error: 'Yazio rejected those credentials.' };
        }
        // Never the error's message: an upstream body could repeat the password
        console.error('Yazio sign-in failed:', describeError(error));
        return { error: 'Yazio could not be reached. Try again in a moment.' };
      }

      // Take the request out of the store: nobody can complete it a second time
      const taken = await this.store.take(`pending:${hash}`);
      const pending = taken === null ? undefined : parse<Pending>(taken);
      if (!this.isLivePending(site, pending)) return { error: EXPIRED_SIGN_IN };

      const sessionId = randomUUID();
      await this.saveSession(sessionId, token, SESSION_GRACE_MS);
      const code = randomBytes(32).toString('base64url');
      const record: Code = {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        redirectUriSent: pending.redirectUriSent,
        codeChallenge: pending.codeChallenge,
        scopes: pending.scopes,
        sessionId,
        expiresAt: this.now() + CODE_TTL_MS,
        resource: pending.resource,
      };
      await this.store.set(`code:${hashToken(code)}`, JSON.stringify(record), {
        ttlMs: USED_CODE_RETENTION_MS,
      });

      const location = new URL(pending.redirectUri);
      location.searchParams.set('code', code);
      if (pending.state !== undefined) location.searchParams.set('state', pending.state);
      location.searchParams.set('iss', site.issuer.href);
      return { location: location.href };
    } finally {
      await this.release(lockKey, owner);
    }
  }

  // --- token endpoint ---

  /**
   * Identify the client. One that holds a secret must present it, in the body or
   * with HTTP Basic; a public client has none and relies on PKCE.
   */
  async authenticateClient(
    params: URLSearchParams,
    authorization: string | null
  ): Promise<ClientRecord> {
    let clientId = single(params, 'client_id');
    let secret = single(params, 'client_secret');
    let basic = false;

    if (authorization?.toLowerCase().startsWith('basic ')) {
      const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator < 0) throw new ClientAuthError('Malformed Basic credentials', true);
      let basicId: string;
      let basicSecret: string;
      try {
        // RFC 6749 section 2.3.1: both halves are form-urlencoded
        basicId = decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' '));
        basicSecret = decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' '));
      } catch {
        throw new ClientAuthError('Malformed Basic credentials', true);
      }
      if (clientId !== undefined && clientId !== basicId) {
        throw fail(OAuthErrorCode.InvalidRequest, 'Conflicting client_id');
      }
      if (secret !== undefined) {
        throw fail(OAuthErrorCode.InvalidRequest, 'Use one client authentication method');
      }
      clientId = basicId;
      secret = basicSecret;
      basic = true;
    }

    if (!clientId) throw fail(OAuthErrorCode.InvalidRequest, 'client_id is required');
    const record = await this.getClient(clientId);
    if (!record) throw new ClientAuthError('Unknown client', basic);
    if (record.secretHash) {
      if (!secret || !sameSecret(hashToken(secret), record.secretHash)) {
        throw new ClientAuthError('Client authentication failed', basic);
      }
    }
    return record;
  }

  async token(site: Site, client: ClientRecord, params: URLSearchParams): Promise<TokenResponse> {
    const grantType = single(params, 'grant_type');
    if (grantType === 'authorization_code') return this.exchangeCode(site, client, params);
    if (grantType === 'refresh_token') return this.exchangeRefreshToken(site, client, params);
    if (!grantType) throw fail(OAuthErrorCode.InvalidRequest, 'grant_type is required');
    throw fail(OAuthErrorCode.UnsupportedGrantType, `grant_type ${grantType} is not supported`);
  }

  private async exchangeCode(
    site: Site,
    client: ClientRecord,
    params: URLSearchParams
  ): Promise<TokenResponse> {
    const code = single(params, 'code');
    const verifier = single(params, 'code_verifier');
    const redirectUri = single(params, 'redirect_uri');
    if (!code || !verifier) {
      throw fail(OAuthErrorCode.InvalidRequest, 'code and code_verifier are required');
    }

    const hash = hashToken(code);
    const invalid = () =>
      fail(OAuthErrorCode.InvalidGrant, 'Invalid or expired authorization code');
    const record = await this.read<Code>(`code:${hash}`);
    // First, whose code it is: another client, or a request to another address of the server,
    // can neither use the code up nor end the session that it issued
    if (
      !record ||
      record.clientId !== client.client.client_id ||
      record.resource !== site.resource.href
    ) {
      throw invalid();
    }
    const replayed = async () => {
      // A code that comes a second time was stolen or leaked: what it issued must not stay valid
      await this.endSession(record.sessionId);
      return fail(OAuthErrorCode.InvalidGrant, 'Authorization code was already used');
    };
    if ((await this.store.get(`code-used:${hash}`)) !== null) throw await replayed();
    if (record.expiresAt <= this.now()) throw invalid();

    // The first attempt consumes the code, also when the checks below fail
    const claimed = await this.store.set(`code-used:${hash}`, '1', {
      if: 'absent',
      ttlMs: USED_CODE_RETENTION_MS,
    });
    if (!claimed) throw await replayed();

    if (
      (record.redirectUriSent || redirectUri !== undefined) &&
      redirectUri !== record.redirectUri
    ) {
      throw fail(
        OAuthErrorCode.InvalidGrant,
        'redirect_uri does not match the authorization request'
      );
    }
    if (!VERIFIER.test(verifier) || !sameSecret(s256(verifier), record.codeChallenge)) {
      throw fail(OAuthErrorCode.InvalidGrant, 'code_verifier does not match the code_challenge');
    }
    checkResource(site, single(params, 'resource'));

    return this.issueTokens(site, client, record.scopes, record.sessionId);
  }

  private async exchangeRefreshToken(
    site: Site,
    client: ClientRecord,
    params: URLSearchParams
  ): Promise<TokenResponse> {
    const refreshToken = single(params, 'refresh_token');
    if (!refreshToken) throw fail(OAuthErrorCode.InvalidRequest, 'refresh_token is required');
    const hash = hashToken(refreshToken);
    const clientId = client.client.client_id;

    /**
     * `admitted`: this request saw the token live before, so a rotation that finished since
     * then is a concurrent request of the client that won, not a replay.
     */
    const live = async (admitted: boolean): Promise<Grant> => {
      const used = await this.read<UsedRefreshToken>(`rt-used:${hash}`);
      if (used?.clientId === clientId && used.resource === site.resource.href) {
        if (admitted) {
          throw fail(OAuthErrorCode.InvalidGrant, 'Refresh token is already being exchanged');
        }
        // A rotated token that comes back later was stolen or leaked: the whole session ends
        await this.endSession(used.sessionId);
        throw fail(
          OAuthErrorCode.InvalidGrant,
          'Refresh token was already used; the session is revoked'
        );
      }
      const grant = await this.liveGrant(site, `rt:${hash}`);
      if (!grant || grant.clientId !== clientId) {
        throw fail(OAuthErrorCode.InvalidGrant, 'Invalid refresh token');
      }
      return grant;
    };

    const first = await live(false);
    let scopes = first.scopes;
    const requested = single(params, 'scope');
    if (requested !== undefined) {
      // A refresh may narrow the scope, never widen it
      scopes = requested.split(' ').filter(Boolean);
      if (scopes.length === 0) throw fail(OAuthErrorCode.InvalidScope, 'scope must not be empty');
      if (scopes.some((scope) => !first.scopes.includes(scope))) {
        throw fail(OAuthErrorCode.InvalidScope, 'scope exceeds the original grant');
      }
    }
    checkResource(site, single(params, 'resource'));

    // Two requests with the same token at the same time: one of them waits for nothing and fails,
    // and the session stays. That is a retry of the client, not a theft.
    const lockKey = `rt-lock:${hash}`;
    const owner = randomUUID();
    if (!(await this.store.set(lockKey, owner, { if: 'absent', ttlMs: REFRESH_LOCK_MS }))) {
      throw fail(OAuthErrorCode.InvalidGrant, 'Refresh token is already being exchanged');
    }
    try {
      const grant = await live(true);
      let tokens: TokenResponse;
      try {
        await this.fresh(grant.sessionId);
        tokens = await this.issueTokens(site, client, scopes, grant.sessionId);
      } catch (error) {
        const sessionOver =
          error instanceof SessionError
            ? error.kind !== 'unavailable'
            : error instanceof OAuthError && error.code === OAuthErrorCode.InvalidGrant;
        if (sessionOver) {
          // The session is over: its tokens are of no more use
          await this.endSession(grant.sessionId);
          await this.store.delete(`rt:${hash}`);
          throw fail(OAuthErrorCode.InvalidGrant, (error as Error).message);
        }
        // Yazio did not answer: the refresh token stays valid for the next attempt
        if (error instanceof SessionError) {
          throw fail(OAuthErrorCode.TemporarilyUnavailable, error.message);
        }
        throw error;
      }
      // The new tokens exist before the old one stops: a crash here cannot sign the user out.
      // This write decides which exchange counts. Only one request can make it.
      const used: UsedRefreshToken = {
        sessionId: grant.sessionId,
        clientId,
        resource: grant.resource,
      };
      const committed = await this.store.set(`rt-used:${hash}`, JSON.stringify(used), {
        if: 'absent',
        ttlMs: Math.max(grant.expiresAt * SECOND - this.now(), MINUTE),
      });
      if (!committed) {
        // Another exchange finished first, after this one lost its lock. Its tokens stay,
        // these go. The session stays too: this is a slow request, not a theft.
        await this.store.delete(`at:${hashToken(tokens.access_token)}`);
        await this.store.delete(`rt:${hashToken(tokens.refresh_token)}`);
        throw fail(OAuthErrorCode.InvalidGrant, 'Refresh token is already being exchanged');
      }
      await this.store.delete(`rt:${hash}`);
      return tokens;
    } finally {
      await this.release(lockKey, owner);
    }
  }

  private async issueTokens(
    site: Site,
    client: ClientRecord,
    scopes: string[],
    sessionId: string
  ): Promise<TokenResponse> {
    // The session lives as long as its newest refresh token
    if (!(await this.store.expire(`sess:${sessionId}`, SESSION_TTL_MS))) {
      throw fail(OAuthErrorCode.InvalidGrant, 'Session expired, please sign in again');
    }
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const grant = (lifeSeconds: number): Grant => ({
      clientId: client.client.client_id,
      scopes,
      sessionId,
      expiresAt: this.seconds() + lifeSeconds,
      resource: site.resource.href,
    });
    await this.store.set(
      `at:${hashToken(accessToken)}`,
      JSON.stringify(grant(ACCESS_TOKEN_TTL_S)),
      { ttlMs: ACCESS_TOKEN_TTL_S * SECOND }
    );
    await this.store.set(
      `rt:${hashToken(refreshToken)}`,
      JSON.stringify(grant(REFRESH_TOKEN_TTL_S)),
      { ttlMs: REFRESH_TOKEN_TTL_S * SECOND }
    );
    await this.touchClient(client, USED_CLIENT_TTL_MS, DAY);
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  // --- revocation (RFC 7009) ---

  /**
   * Revoking a refresh token signs the user out; revoking an access token drops that token only.
   * A token of another client, or one issued for another address of the server, is left alone.
   */
  async revoke(site: Site, client: ClientRecord, params: URLSearchParams): Promise<void> {
    const token = single(params, 'token');
    if (!token) throw fail(OAuthErrorCode.InvalidRequest, 'token is required');
    const hash = hashToken(token);
    const clientId = client.client.client_id;
    const mine = <T extends { clientId: string; resource: string }>(
      record: T | undefined
    ): record is T => record?.clientId === clientId && record.resource === site.resource.href;

    const refresh = await this.read<Grant>(`rt:${hash}`);
    if (mine(refresh)) {
      await this.endSession(refresh.sessionId);
      await this.store.delete(`rt:${hash}`);
      return;
    }
    const used = await this.read<UsedRefreshToken>(`rt-used:${hash}`);
    if (mine(used)) {
      await this.endSession(used.sessionId);
      return;
    }
    const access = await this.read<Grant>(`at:${hash}`);
    if (mine(access)) await this.store.delete(`at:${hash}`);
    // RFC 7009: an unknown token is not an error
  }

  // --- resource server ---

  /**
   * Checks an access token and prepares the Yazio client of its session.
   * The client and the outcome of a renewal travel to the MCP handler in `extra`.
   */
  async verifyAccessToken(site: Site, token: string): Promise<AuthInfo> {
    const grant = await this.liveGrant(site, `at:${hashToken(token)}`);
    if (!grant) throw fail(OAuthErrorCode.InvalidToken, 'Invalid or expired access token');
    let yazioToken: Token;
    try {
      yazioToken = await this.fresh(grant.sessionId);
    } catch (error) {
      if (!(error instanceof SessionError)) throw error;
      throw error.kind === 'unavailable'
        ? fail(OAuthErrorCode.TemporarilyUnavailable, error.message)
        : fail(OAuthErrorCode.InvalidToken, error.message);
    }
    const outcome: RenewalOutcome = { refused: false, unavailable: false };
    return {
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: grant.expiresAt,
      resource: new URL(grant.resource),
      extra: {
        sessionId: grant.sessionId,
        yazio: this.yazioFor(grant.sessionId, yazioToken, outcome),
        outcome,
      },
    };
  }

  /**
   * A Yazio client for one request. It never signs in and never refreshes by itself:
   * when Yazio rejects the token, the renewal goes through the store, where all
   * instances of the server share it.
   */
  private yazioFor(sessionId: string, initial: Token, outcome: RenewalOutcome): YazioApi {
    let current = initial;
    const send = guarded(this.options.fetch);
    const withToken = (
      input: string | URL | Request,
      init: Parameters<typeof fetch>[1],
      token: Token
    ) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token.access_token}`);
      return send(input, { ...init, headers });
    };
    const fetchWithRenewal = (async (
      input: string | URL | Request,
      init?: Parameters<typeof fetch>[1]
    ) => {
      const used = current;
      const response = await withToken(input, init, used);
      if (response.status !== 401) return response;
      try {
        current = await this.renewRejected(sessionId, used.access_token);
      } catch (error) {
        if (error instanceof SessionError) {
          if (error.kind === 'unavailable') outcome.unavailable = true;
          else outcome.refused = true;
        }
        throw error;
      }
      const second = await withToken(input, init, current);
      // The new token is rejected too. That is not a reason to end the session: this call fails.
      if (second.status === 401) {
        throw new YazioApiError(init?.method ?? 'GET', pathOf(input), 401, 'Unauthorized', '');
      }
      return second;
    }) as typeof fetch;

    return new YazioApi(
      { username: '', ...this.options.yazioClient },
      {
        // No refresh token and no expiry: this client must not renew on its own
        token: { ...current, refresh_token: '', expires_at: Infinity },
        fetch: fetchWithRenewal,
        onUnexpectedShape: quietShapeLog,
      }
    );
  }

  // --- sessions ---

  /** The Yazio token of a session, renewed first when it is about to expire */
  private async fresh(sessionId: string): Promise<Token> {
    const token = await this.loadSession(sessionId);
    if (!token) throw new SessionError('gone');
    const isGood = (candidate: Token) => candidate.expires_at - RENEW_MARGIN_MS > this.now();
    return isGood(token) ? token : this.renew(sessionId, isGood);
  }

  /** A new Yazio token after Yazio rejected `rejected`, unless another request got one already */
  private renewRejected(sessionId: string, rejected: string): Promise<Token> {
    return this.renew(sessionId, (stored) => stored.access_token !== rejected, true);
  }

  /**
   * Renews the Yazio token of a session. Yazio rotates its refresh token, so two renewals
   * at the same time would lose the session. A lock in the store lets one request renew;
   * the others wait for its result.
   */
  private async renew(
    sessionId: string,
    isGood: (token: Token) => boolean,
    rejectedByYazio = false
  ): Promise<Token> {
    const lockKey = `sess-lock:${sessionId}`;
    const owner = randomUUID();
    for (let attempt = 0; ; attempt++) {
      if (await this.store.set(lockKey, owner, { if: 'absent', ttlMs: RENEW_LOCK_MS })) break;
      if (attempt >= RENEW_POLLS) throw new SessionError('unavailable');
      await this.sleep(RENEW_POLL_MS);
      const token = await this.loadSession(sessionId);
      if (!token) throw new SessionError('gone');
      if (isGood(token)) return token;
    }
    try {
      const key = `sess:${sessionId}`;
      const stored = await this.readSession(sessionId);
      if (!stored) throw new SessionError('gone');
      if (isGood(stored.token)) return stored.token;
      // What the session holds after this request lost a race against another renewal
      const current = async (): Promise<Token> => {
        const token = await this.loadSession(sessionId);
        if (!token) throw new SessionError('gone');
        return token;
      };
      // The session ends only if it still holds the token that this request read. If it
      // holds another one by now, a slower renewal lost a race: the session lives on.
      const end = async (): Promise<Token> => {
        if (await this.store.deleteIf(key, stored.raw)) throw new SessionError('refused');
        return await current();
      };
      if (!stored.token.refresh_token) {
        // Nothing to renew with. A token that Yazio did not reject is used until it expires.
        if (!rejectedByYazio && stored.token.expires_at > this.now()) return stored.token;
        return await end();
      }
      let renewed: Token;
      try {
        renewed = this.stamp(
          await new YazioHttp(
            { username: '', ...this.options.yazioClient },
            {
              token: { ...stored.token, expires_at: 0 },
              fetch: guarded(this.options.fetch),
              onUnexpectedShape: quietShapeLog,
            }
          ).authenticate()
        );
      } catch (error) {
        // Yazio refused the refresh token that this request read
        if (isRefusal(error)) return await end();
        console.error('Could not renew a Yazio session:', describeError(error));
        throw new SessionError('unavailable');
      }
      // The token goes in only where the session still holds what this request read. A sign-out
      // during the renewal stays a sign-out, and a renewal that lost its lock does not
      // overwrite a newer token.
      if (await this.store.replaceIf(key, stored.raw, this.sealSession(key, renewed))) {
        return renewed;
      }
      return await current();
    } finally {
      await this.release(lockKey, owner);
    }
  }

  /**
   * The Yazio token as the session keeps it: the known fields only, with the expiry on the
   * clock of this server. Anything else that Yazio sends with a token is dropped here.
   */
  private stamp(token: Token): Token {
    const { token_type, access_token, refresh_token, expires_in } = token as Partial<Token>;
    if (typeof access_token !== 'string' || access_token === '') {
      throw new TypeError('Yazio sent no access token');
    }
    const life = Number(expires_in);
    // Without a usable lifetime the token counts as expired, so the next request renews it
    const seconds = Number.isFinite(life) && life > 0 ? life : 0;
    return {
      token_type: typeof token_type === 'string' ? token_type : 'Bearer',
      access_token,
      refresh_token: typeof refresh_token === 'string' ? refresh_token : '',
      expires_in: seconds,
      expires_at: this.now() + seconds * SECOND,
    };
  }

  /** The session holds the Yazio token only, encrypted. It does not hold who the user is. */
  private sealSession(key: string, token: Token): string {
    return this.sealer.seal(JSON.stringify({ token }), key);
  }

  private async saveSession(sessionId: string, token: Token, ttlMs: number): Promise<void> {
    const key = `sess:${sessionId}`;
    await this.store.set(key, this.sealSession(key, token), { ttlMs });
  }

  /** The token of a session and the stored value it came from, for a write that depends on it */
  private async readSession(sessionId: string): Promise<{ raw: string; token: Token } | undefined> {
    const key = `sess:${sessionId}`;
    const raw = await this.store.get(key);
    if (raw === null) return undefined;
    const opened = this.sealer.open(raw, key);
    if (opened === null) return undefined;
    const token = parse<{ token?: Token }>(opened)?.token;
    return token ? { raw, token } : undefined;
  }

  private async loadSession(sessionId: string): Promise<Token | undefined> {
    return (await this.readSession(sessionId))?.token;
  }

  /** Ends a session. Its access and refresh tokens stay in the store but open nothing. */
  private async endSession(sessionId: string): Promise<void> {
    await this.store.delete(`sess:${sessionId}`);
  }

  // --- helpers ---

  private async getClient(clientId: string): Promise<ClientRecord | undefined> {
    if (clientId.length > MAX_CLIENT_ID_LENGTH) return undefined;
    const record = await this.read<ClientRecord>(`client:${clientId}`);
    return record && record.expiresAt > this.now() ? record : undefined;
  }

  /** Makes a client live at least `lifeMs` from now. It writes only when that adds more than `slackMs`. */
  private async touchClient(record: ClientRecord, lifeMs: number, slackMs: number): Promise<void> {
    const wanted = this.now() + lifeMs;
    if (record.expiresAt > wanted - slackMs) return;
    record.expiresAt = wanted;
    await this.store.set(`client:${record.client.client_id}`, JSON.stringify(record), {
      ttlMs: lifeMs,
    });
  }

  private async livePending(site: Site, hash: string): Promise<Pending | undefined> {
    const pending = await this.read<Pending>(`pending:${hash}`);
    return this.isLivePending(site, pending) ? pending : undefined;
  }

  /** A sign-in request that is still open and that started on this address of the server */
  private isLivePending(site: Site, pending: Pending | undefined): pending is Pending {
    return (
      pending !== undefined &&
      pending.expiresAt > this.now() &&
      pending.resource === site.resource.href
    );
  }

  /** A token record that is not expired and that was issued for this address of the server */
  private async liveGrant(site: Site, key: string): Promise<Grant | undefined> {
    const grant = await this.read<Grant>(key);
    if (!grant || grant.expiresAt <= this.seconds() || grant.resource !== site.resource.href) {
      return undefined;
    }
    return grant;
  }

  private async read<T>(key: string): Promise<T | undefined> {
    const value = await this.store.get(key);
    return value === null ? undefined : parse<T>(value);
  }

  /** Frees a lock, but only the lock that this request holds */
  private async release(key: string, owner: string): Promise<void> {
    try {
      // One step: between a read and a delete, the lock could pass to another request
      await this.store.deleteIf(key, owner);
    } catch {
      // The lock expires by itself
    }
  }

  private seconds(): number {
    return Math.floor(this.now() / SECOND);
  }
}

function parse<T>(text: string): T | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

/** RFC 8707: a token is only ever issued for this server */
function checkResource(site: Site, resource: string | undefined): void {
  if (resource === undefined) return;
  const normalize = (value: string) => value.replace(/\/+$/, '');
  let requested: URL;
  try {
    requested = new URL(resource);
  } catch {
    throw fail(OAuthErrorCode.InvalidTarget, 'resource must be an absolute URL');
  }
  if (requested.hash || normalize(requested.href) !== normalize(site.resource.href)) {
    throw fail(
      OAuthErrorCode.InvalidTarget,
      `This server only issues tokens for ${site.resource.href}`
    );
  }
}

function errorRedirect(
  site: Site,
  redirectUri: string,
  error: OAuthError,
  state: string | undefined
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error.code);
  url.searchParams.set('error_description', error.message);
  if (state !== undefined) url.searchParams.set('state', state);
  url.searchParams.set('iss', site.issuer.href);
  return url.href;
}

/** invalid_client, which RFC 6749 answers with 401 when the client used HTTP Basic */
export class ClientAuthError extends OAuthError {
  constructor(
    message: string,
    readonly basic: boolean
  ) {
    super(OAuthErrorCode.InvalidClient, message);
  }
}

/** The value of a parameter that must not repeat (RFC 6749 section 3.1) */
export function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw fail(OAuthErrorCode.InvalidRequest, `${name} must not be repeated`);
  return values[0];
}

function checkRedirectUri(uri: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw fail(OAuthErrorCode.InvalidRedirectUri, `Not an absolute URL: ${uri}`);
  }
  if (url.hash) {
    throw fail(OAuthErrorCode.InvalidRedirectUri, 'redirect_uri must not contain a fragment');
  }
  if (UNSAFE_SCHEMES.has(url.protocol)) {
    throw fail(OAuthErrorCode.InvalidRedirectUri, `${url.protocol} is not allowed`);
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw fail(OAuthErrorCode.InvalidRedirectUri, 'http redirect URIs must point to localhost');
  }
}

export function asOAuthError(error: unknown): OAuthError {
  if (error instanceof OAuthError) return error;
  console.error('Unexpected error in the authorization server:', describeError(error));
  return fail(OAuthErrorCode.ServerError, 'Internal server error');
}

/** What an error is, without its message: a message can carry what upstream sent back */
export function describeError(error: unknown): string {
  if (error instanceof YazioApiError) {
    return `${error.name} ${error.method} ${maskPath(error.path)} ${error.status}`;
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} ${code}` : error.name;
  }
  return typeof error;
}
