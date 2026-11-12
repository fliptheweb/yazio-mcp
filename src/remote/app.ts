import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  verifyBearerToken,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import type { YazioApi } from '../api/index.js';
import { createServer } from '../server.js';
import { Sealer } from './crypto.js';
import {
  AuthorizationServer,
  ClientAuthError,
  SCOPE,
  asOAuthError,
  describeError,
  yazioSignIn,
  type RenewalOutcome,
  type SignIn,
  type Site,
  type YazioClientId,
} from './oauth.js';
import { infoPage, loginPage, messagePage } from './pages.js';
import { windowKey, type Store } from './store.js';

export interface RemoteConfig {
  store: Store;
  /** The Yazio tokens in the store are encrypted with keys made from this secret */
  sessionSecret: string;
  /** The public origin of this server. Without it, the origin of each request is used. */
  publicUrl?: URL;
  /** Whether a proxy in front of this server sets `X-Forwarded-For` and `X-Forwarded-Proto` */
  trustProxy?: boolean;
  yazioClient?: YazioClientId;
  /** Tests replace these */
  signIn?: SignIn;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<unknown>;
}

/** What the host knows about a request and the request itself does not say */
export interface RequestInfo {
  /** The address of the client, for rate limiting */
  clientAddress?: string;
}

export interface RemoteApp {
  fetch(request: Request, info?: RequestInfo): Promise<Response>;
  close(): Promise<void>;
}

const FORM = 'application/x-www-form-urlencoded';
const MINUTE = 60_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** A DNS name (253 characters), a colon and a port */
const MAX_HOST_LENGTH = 253 + 6;
/** The OAuth routes take a small form or a small JSON document, and nothing larger */
const MAX_BODY_BYTES = 64 * 1024;

/** What the log shows of a request: a route of this server, never a path that a client made up */
const ROUTES = new Set([
  '/',
  '/mcp',
  '/healthz',
  '/register',
  '/authorize',
  '/login',
  '/token',
  '/revoke',
]);
const WELL_KNOWN = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/openid-configuration',
];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function routeLabel(path: string): string {
  if (ROUTES.has(path)) return path;
  // The metadata paths can end with the path of the resource: the log shows the start only
  const known = WELL_KNOWN.find((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return known ?? '(other)';
}

/** Requests per client address in one time window */
const LIMITS = {
  authorize: { max: 100, windowMs: 15 * MINUTE },
  login: { max: 10, windowMs: 15 * MINUTE },
  token: { max: 50, windowMs: 15 * MINUTE },
  register: { max: 20, windowMs: 60 * MINUTE },
  revoke: { max: 50, windowMs: 15 * MINUTE },
};

/** Headers every OAuth response carries: never cached (RFC 6749 5.1), readable from any origin */
const API_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Access-Control-Allow-Origin': '*',
};

const CORS_PREFLIGHT = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

/** The server cannot tell its own public address, or the address is not safe to use */
class SiteError extends Error {}

class BodyTooLarge extends OAuthError {
  constructor() {
    super(OAuthErrorCode.InvalidRequest, 'Request body too large');
  }
}

/**
 * Pages a person sees: not cacheable, not frameable, no outside resources. A form may
 * post here only, and follow the redirect to the client's own address after that.
 */
function htmlHeaders(formTarget?: string): Record<string, string> {
  const formAction = formTarget ? `'self' ${formTarget}` : "'self'";
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/** The CSP source for a redirect URI: its origin, or an app's scheme */
function cspSource(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : url.protocol;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...API_HEADERS, ...headers },
  });

const html = (status: number, body: string, formTarget?: string) =>
  new Response(body, { status, headers: htmlHeaders(formTarget) });

function oauthError(error: unknown): Response {
  const oauth = asOAuthError(error);
  const status =
    oauth instanceof ClientAuthError && oauth.basic
      ? 401
      : oauth instanceof BodyTooLarge
        ? 413
        : oauth.code === OAuthErrorCode.ServerError
          ? 500
          : oauth.code === OAuthErrorCode.TemporarilyUnavailable
            ? 503
            : 400;
  const headers: Record<string, string> =
    status === 401
      ? { 'WWW-Authenticate': 'Basic realm="yazio-mcp"' }
      : status === 503
        ? { 'Retry-After': '30' }
        : {};
  return json(status, oauth.toResponseObject(), headers);
}

const tooMany = (retryAfter: number) =>
  json(
    429,
    {
      error: OAuthErrorCode.TooManyRequests,
      error_description: 'Too many requests, try again later',
    },
    { 'Retry-After': String(retryAfter) }
  );

const unavailable = (message: string) =>
  json(
    503,
    { error: OAuthErrorCode.TemporarilyUnavailable, error_description: message },
    { 'Retry-After': '30' }
  );

const contentType = (request: Request) =>
  request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

/**
 * Reads the body as text and stops at the size limit. The stored records hold parts of
 * these bodies, so a body without a limit would be a way to fill the store.
 */
async function smallBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) return '';
  // The declared length can be absent or wrong, so the bytes are counted too
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function formParams(request: Request): Promise<URLSearchParams> {
  if (contentType(request) !== FORM) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, `Content-Type must be ${FORM}`);
  }
  return new URLSearchParams(await smallBody(request));
}

/** The last entry of a forwarding header: the one that the nearest proxy added */
const lastEntry = (value: string | null): string | undefined =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);

/**
 * The remote server as one `fetch` function. It keeps nothing in memory between two
 * requests: everything it remembers is in the store, so any instance can serve any request.
 */
export function createRemoteApp(config: RemoteConfig): RemoteApp {
  const { store } = config;
  const now = config.now ?? Date.now;
  const log = config.log ?? ((line: string) => console.log(line));
  const sealer = new Sealer(config.sessionSecret);
  const auth = new AuthorizationServer({
    store,
    sealer,
    signIn: config.signIn ?? yazioSignIn(config.yazioClient, config.fetch),
    yazioClient: config.yazioClient,
    fetch: config.fetch,
    now,
    sleep: config.sleep,
  });

  const mcp = createMcpHandler((ctx) => createServer(ctx.authInfo?.extra?.yazio as YazioApi), {
    // The kind of the error only: its message can carry what Yazio sent back
    onerror: (error) => console.error('MCP request failed:', describeError(error)),
  });

  /** The public addresses of this server, as this request reached it */
  function siteOf(request: Request, url: URL): Site {
    let issuer: URL;
    if (config.publicUrl) {
      issuer = new URL('/', config.publicUrl);
    } else {
      issuer = new URL('/', url);
      if (config.trustProxy) {
        // The proxy ends TLS, so the request itself arrives over plain HTTP
        const scheme = lastEntry(request.headers.get('x-forwarded-proto'))?.toLowerCase();
        if (scheme === 'https' || scheme === 'http') issuer.protocol = `${scheme}:`;
      }
    }
    // The address goes into stored records: a name longer than DNS allows is not a host
    if (issuer.host.length > MAX_HOST_LENGTH) {
      throw new SiteError('The host name of this request is too long. Set PUBLIC_URL.');
    }
    // Tokens and the Yazio password must not travel in plain text, except on this machine
    if (issuer.protocol !== 'https:' && !LOOPBACK.has(issuer.hostname)) {
      throw new SiteError(
        'This server must be reached over HTTPS. Set PUBLIC_URL to its public https address, ' +
          'or set TRUST_PROXY=1 when a proxy in front of it ends TLS.'
      );
    }
    return { issuer, resource: new URL('/mcp', issuer) };
  }

  /** The address that the rate limits count for */
  function addressOf(request: Request, info: RequestInfo | undefined): string {
    if (config.trustProxy) {
      const forwarded = lastEntry(request.headers.get('x-forwarded-for'));
      if (forwarded) return forwarded;
    }
    const address = info?.clientAddress;
    // Without an address all clients share one limit: slower for them, never unlimited
    return typeof address === 'string' && address ? address : 'unknown';
  }

  /** Counts the request. Returns the seconds to wait when the address is over its limit. */
  async function limited(name: keyof typeof LIMITS, address: string): Promise<number | undefined> {
    const { max, windowMs } = LIMITS[name];
    const time = now();
    // The address is stored as a keyed hash: the store does not show who used the server
    const key = windowKey(`rate:${name}:${sealer.mac(address)}`, windowMs, time);
    if ((await store.increment(key, windowMs)) <= max) return undefined;
    const windowEnd = (Math.floor(time / windowMs) + 1) * windowMs;
    return Math.max(1, Math.ceil((windowEnd - time) / 1000));
  }

  async function serveMcp(request: Request, site: Site): Promise<Response> {
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(site.resource);
    let authInfo: AuthInfo;
    try {
      authInfo = await verifyBearerToken(request.headers.get('authorization'), {
        verifier: { verifyAccessToken: (token) => auth.verifyAccessToken(site, token) },
        resourceMetadataUrl,
        expectedResource: site.resource,
        requiredScopes: [SCOPE],
      });
    } catch (error) {
      // Yazio unreachable is not the client's fault: ask it to retry, don't make it sign in again
      if (error instanceof OAuthError && error.code === OAuthErrorCode.TemporarilyUnavailable) {
        return unavailable(error.message);
      }
      return bearerAuthChallengeResponse(error, { requiredScopes: [SCOPE], resourceMetadataUrl });
    }

    const response = await mcp.fetch(request, { authInfo });
    if (request.method !== 'POST') return response;

    // A call can renew the Yazio token halfway through. What happened to that renewal
    // decides the HTTP status: a refusal ended the session (401, sign in again), an
    // outage asks for a retry (503). So the answer is held back until the call is over.
    const body = await response.arrayBuffer();
    const outcome = authInfo.extra?.outcome as RenewalOutcome | undefined;
    if (outcome?.refused) {
      return bearerAuthChallengeResponse(
        new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Yazio ended the session, please sign in again'
        ),
        { resourceMetadataUrl }
      );
    }
    if (outcome?.unavailable) return unavailable('Yazio could not be reached, try again shortly');
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async function authorizeRequest(request: Request, url: URL, site: Site): Promise<Response> {
    const params = request.method === 'POST' ? await formParams(request) : url.searchParams;
    const result = await auth.authorize(site, params);
    if (result.kind === 'redirect') return redirect(result.location);
    if (result.kind === 'error') {
      return html(result.status, messagePage('Cannot connect', result.error.message));
    }
    return html(200, loginPage(result), cspSource(result.redirectUri));
  }

  async function login(request: Request, site: Site): Promise<Response> {
    const form = await formParams(request);
    const pendingId = form.get('pending') ?? '';
    const username = (form.get('username') ?? '').trim();
    const password = form.get('password') ?? '';
    const pending = await auth.pendingLogin(site, pendingId);
    if (!pending) {
      return html(400, messagePage('Sign-in expired', 'Start the connection again from your app.'));
    }
    const result = await auth.completeLogin(site, pendingId, username, password);
    if ('location' in result) return redirect(result.location);
    return html(
      401,
      loginPage({ pendingId, username, error: result.error, ...pending }),
      cspSource(pending.redirectUri)
    );
  }

  async function route(
    request: Request,
    url: URL,
    site: () => Site,
    address: () => string
  ): Promise<Response> {
    const { pathname: path } = url;
    const method = request.method;

    if (
      method === 'OPTIONS' &&
      (path === '/mcp' ||
        path.startsWith('/.well-known/') ||
        ['/register', '/token', '/revoke'].includes(path))
    ) {
      return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
    }

    // Answers without the store and without the public address: a host uses it to see that the process runs
    if (path === '/healthz') return json(200, { status: 'ok' });

    if (method === 'GET' && path.startsWith('/.well-known/')) {
      const { issuer, resource } = site();
      const metadata = oauthMetadataResponse(request, {
        oauthMetadata: auth.metadata({ issuer, resource }),
        resourceServerUrl: resource,
        scopesSupported: [SCOPE],
        resourceName: 'Yazio',
        // `siteOf` already allows plain HTTP for this machine only
        dangerouslyAllowInsecureIssuerUrl: issuer.protocol !== 'https:',
      });
      if (metadata) return withHeaders(metadata, API_HEADERS);
      return json(404, { error: 'not_found' });
    }

    switch (path) {
      case '/':
        return method === 'GET' ? html(200, infoPage(site().resource.href)) : notAllowed('GET');
      case '/mcp':
        return withHeaders(await serveMcp(request, site()), {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
        });
      case '/register': {
        if (method !== 'POST') return notAllowed('POST');
        const wait = await limited('register', address());
        if (wait) return tooMany(wait);
        try {
          site();
          if (contentType(request) !== 'application/json') {
            throw new OAuthError(
              OAuthErrorCode.InvalidClientMetadata,
              'Content-Type must be application/json'
            );
          }
          const text = await smallBody(request);
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            throw new OAuthError(OAuthErrorCode.InvalidClientMetadata, 'Body is not valid JSON');
          }
          return json(201, await auth.register(body));
        } catch (error) {
          if (error instanceof SiteError) throw error;
          return oauthError(error);
        }
      }
      case '/authorize': {
        if (method !== 'GET' && method !== 'POST') return notAllowed('GET, POST');
        const wait = await limited('authorize', address());
        if (wait) return tooMany(wait);
        const here = site();
        try {
          return await authorizeRequest(request, url, here);
        } catch (error) {
          return html(400, messagePage('Cannot connect', asOAuthError(error).message));
        }
      }
      case '/login': {
        if (method !== 'POST') return notAllowed('POST');
        if (await limited('login', address())) {
          return html(
            429,
            messagePage('Too many attempts', 'Wait a few minutes before trying again.')
          );
        }
        const here = site();
        try {
          return await login(request, here);
        } catch (error) {
          return html(400, messagePage('Cannot sign in', asOAuthError(error).message));
        }
      }
      case '/token': {
        if (method !== 'POST') return notAllowed('POST');
        const wait = await limited('token', address());
        if (wait) return tooMany(wait);
        const here = site();
        try {
          const params = await formParams(request);
          const client = await auth.authenticateClient(
            params,
            request.headers.get('authorization')
          );
          return json(200, await auth.token(here, client, params));
        } catch (error) {
          return oauthError(error);
        }
      }
      case '/revoke': {
        if (method !== 'POST') return notAllowed('POST');
        const wait = await limited('revoke', address());
        if (wait) return tooMany(wait);
        const here = site();
        try {
          const params = await formParams(request);
          const client = await auth.authenticateClient(
            params,
            request.headers.get('authorization')
          );
          await auth.revoke(here, client, params);
          return json(200, {});
        } catch (error) {
          return oauthError(error);
        }
      }
    }

    // Anything aimed at the wrong path gets told where the endpoint is
    return json(404, {
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `No MCP endpoint at ${path}. This server's endpoint is ${site().resource.href}`,
      },
      id: null,
    });
  }

  return {
    async fetch(request, info) {
      const started = now();
      const url = new URL(request.url);
      let found: Site | undefined;
      const site = () => (found ??= siteOf(request, url));
      let response: Response;
      try {
        response = await route(request, url, site, () => addressOf(request, info));
      } catch (error) {
        if (error instanceof SiteError) {
          response = json(500, {
            error: OAuthErrorCode.ServerError,
            error_description: error.message,
          });
        } else {
          console.error('Request failed:', describeError(error));
          response = json(500, {
            error: OAuthErrorCode.ServerError,
            error_description: 'Internal server error',
          });
        }
      }
      // Browsers that reached this server over HTTPS keep using HTTPS
      if (isHttps(site)) {
        response = withHeaders(response, { 'Strict-Transport-Security': 'max-age=31536000' });
      }
      // The route only. A query string carries authorization parameters, and a path that is
      // not a route of this server can carry anything. No header and no body is logged.
      const flags = request.headers.has('authorization') ? ' auth' : '';
      const method = METHODS.has(request.method) ? request.method : 'OTHER';
      log(
        `${method} ${routeLabel(url.pathname)} -> ${response.status} (${now() - started}ms)${flags}`
      );
      return response;
    },
    async close() {
      await mcp.close();
      await store.close();
    },
  };
}

function isHttps(site: () => Site): boolean {
  try {
    return site().issuer.protocol === 'https:';
  } catch {
    return false;
  }
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

function notAllowed(allow: string): Response {
  return json(405, { error: 'method_not_allowed' }, { Allow: allow });
}

/** Responses from the SDK may have immutable headers, so copy before adding */
function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
