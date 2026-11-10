import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClient } from '@redis/client';
import { createRemoteApp, type RemoteApp, type RemoteConfig } from '../src/remote/app.js';
import { yazioSignIn } from '../src/remote/oauth.js';
import { FileStore } from '../src/remote/store-file.js';
import { RedisStore } from '../src/remote/store-redis.js';
import type { Store } from '../src/remote/store.js';

export const ORIGIN = 'https://mcp.example.com';
export const RESOURCE = `${ORIGIN}/mcp`;
export const REDIRECT = 'https://client.example/callback';
export const USERNAME = 'user@example.com';
/** Distinctive, so the store and the log can be searched for it */
export const PASSWORD = 'pw-SENTINEL-7f3a';
export const SECRET = 'test-session-secret-0123456789-abcdefghij';
export const SCOPE = 'mcp';

/**
 * With TEST_REDIS_URL the same tests run on a Redis server. Its database is emptied for
 * each test, so use a server that holds nothing else, and run the files one at a time:
 * `tsx --test --test-concurrency=1 test/*.test.ts`.
 */
export const REDIS_URL = process.env.TEST_REDIS_URL || undefined;
/** Redis counts the life of a key on its own clock, which a test cannot move */
export const STORE_CLOCK = REDIS_URL ? 'needs a store that follows the test clock' : false;

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** A complete answer of `GET /user`, so the client does not report an unexpected shape */
const USER = {
  diet: null,
  email: USERNAME,
  premium_type: null,
  sex: 'other',
  first_name: 'Test',
  last_name: null,
  city: '',
  country: 'DE',
  weight_change_per_week: 0,
  body_height: 170,
  goal: 'maintain',
  date_of_birth: '1990-01-01',
  registration_date: '2020-01-01 00:00:00',
  timezone_offset: 0,
  unit_length: 'cm',
  unit_mass: 'kg',
  unit_glucose: 'mgdl',
  unit_serving: 'g',
  unit_energy: 'kcal',
  food_database_country: 'DE',
  profile_image: null,
  user_token: 'user-token',
  start_weight: 70,
  email_confirmation_status: 'confirmed',
  newsletter_opt_in: false,
  login_type: 'email',
  siwa_user_id: null,
  uuid: '00000000-0000-4000-8000-000000000000',
  reset_date: null,
  activity_degree: 'low',
  stripe_customer_id: null,
};

/** Yazio, answering locally */
export function fakeYazio() {
  const state = {
    /** expires_in of every Yazio token issued; 0 makes each one due for renewal at once */
    expiresIn: 3600,
    /** How a refresh grant goes */
    refresh: 'ok' as 'ok' | 'refuse' | 'offline',
    /** Answer API calls with 401, as when Yazio revokes a token before it expires */
    userUnauthorized: false,
    /** Runs before a refresh grant is answered, to hold it in flight */
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    /** Runs before `GET /user` is answered, to hold a tool call in flight */
    beforeUser: undefined as (() => Promise<void>) | undefined,
    issued: 0,
    calls: [] as { url: string; authorization?: string; grant?: string }[],
  };
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const authorization = new Headers(init.headers).get('authorization') ?? undefined;
    state.calls.push({ url, authorization, grant: body?.grant_type });
    if (url.endsWith('/oauth/token')) {
      if (body.grant_type === 'refresh_token') await state.beforeRefresh?.();
      if (
        body.grant_type === 'password' &&
        (body.username !== USERNAME || body.password !== PASSWORD)
      ) {
        return jsonResponse({ error: 'invalid_grant' }, 400);
      }
      if (body.grant_type === 'refresh_token' && state.refresh === 'refuse') {
        return jsonResponse({ error: 'invalid_grant' }, 400);
      }
      if (body.grant_type === 'refresh_token' && state.refresh === 'offline') {
        throw new TypeError('fetch failed');
      }
      const n = ++state.issued;
      return jsonResponse({
        token_type: 'bearer',
        access_token: `yazio-access-${n}`,
        refresh_token: `yazio-refresh-${n}`,
        expires_in: state.expiresIn,
      });
    }
    const isUser = url.includes('/user?') || url.endsWith('/user');
    if (isUser) await state.beforeUser?.();
    if (isUser && state.userUnauthorized) return jsonResponse({ error: 'revoked' }, 401);
    if (isUser) return jsonResponse(USER);
    return jsonResponse({});
  }) as typeof globalThis.fetch;
  return { state, fetch: fakeFetch };
}

export interface CallOptions {
  headers?: Record<string, string>;
  form?: Record<string, string>;
  /** A form body as written, for parameters that repeat */
  rawForm?: string;
  json?: unknown;
  /** The address the host reports. `null`: the host reports none. */
  ip?: string | null;
  /** The origin the request is sent to, when not the public one */
  origin?: string;
}

/** A gate that holds something until `open` is called */
export function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Collects what the code writes with `console.error` until `restore` is called */
export function captureErrors() {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  return { lines, restore: () => void (console.error = original) };
}

export type Overrides = Partial<Omit<RemoteConfig, 'store'>>;

export async function harness(overrides: Overrides = {}) {
  // Starts at the real time: the SDK's bearer check reads the real clock for expiry
  let clock = Date.now();
  const yazio = fakeYazio();
  const dir = mkdtempSync(join(tmpdir(), 'yazio-remote-'));
  const file = join(dir, 'yazio-mcp.json');
  const logs: string[] = [];

  const admin = REDIS_URL ? createClient({ url: REDIS_URL }) : undefined;
  if (admin) {
    await admin.connect();
    await admin.flushDb();
  }

  const newStore = (): Store =>
    REDIS_URL ? new RedisStore(REDIS_URL) : new FileStore(dir, () => clock);

  let current: Overrides = { ...overrides };
  const build = (store: Store): RemoteApp =>
    createRemoteApp({
      store,
      sessionSecret: SECRET,
      publicUrl: new URL(ORIGIN),
      signIn: yazioSignIn({}, yazio.fetch),
      fetch: yazio.fetch,
      now: () => clock,
      log: (line) => void logs.push(line),
      // The real wait between two looks at a lock is 200 ms
      sleep: () => new Promise((resolve) => setTimeout(resolve, 2)),
      ...current,
    });

  const entries = async (): Promise<[string, string][]> => {
    if (admin) {
      const found = await admin.keys('yazio-mcp:*');
      const pairs: [string, string][] = [];
      for (const key of found) {
        const value = await admin.get(key);
        if (value !== null) pairs.push([key.slice('yazio-mcp:'.length), value]);
      }
      return pairs;
    }
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const data = JSON.parse(text) as Record<string, { v: string; e?: number }>;
    return Object.entries(data)
      .filter(([, entry]) => entry.e === undefined || entry.e > clock)
      .map(([key, entry]) => [key, entry.v]);
  };

  const store = newStore();
  const h = {
    store,
    app: build(store),
    yazio,
    dir,
    logs,
    now: () => clock,
    tick: (ms: number) => void (clock += ms),
    /** A new process on the same storage */
    restart: async (changes: Overrides = {}) => {
      await h.app.close();
      current = { ...current, ...changes };
      h.store = newStore();
      h.app = build(h.store);
    },
    /** The same process and the same store, with other settings */
    rebuild: (changes: Overrides) => {
      current = { ...current, ...changes };
      h.app = build(h.store);
    },
    call: (method: string, path: string, options: CallOptions = {}) => {
      const headers = new Headers(options.headers);
      let body: string | undefined;
      if (options.rawForm !== undefined || options.form) {
        headers.set('Content-Type', 'application/x-www-form-urlencoded');
        body = options.rawForm ?? new URLSearchParams(options.form).toString();
      } else if (options.json !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(options.json);
      }
      const request = new Request(`${options.origin ?? ORIGIN}${path}`, {
        method,
        headers,
        body,
        redirect: 'manual',
      });
      const ip = options.ip === undefined ? '203.0.113.7' : options.ip;
      return h.app.fetch(request, ip === null ? {} : { clientAddress: ip });
    },
    /** The keys in the store that start with `prefix` and have not expired */
    keys: async (prefix = '') =>
      (await entries()).map(([key]) => key).filter((key) => key.startsWith(prefix)),
    /** Everything in the store as one text, to search it for something that must not be there */
    dump: async () => JSON.stringify(await entries()),
    cleanup: async () => {
      await h.app.close();
      if (admin) {
        await admin.flushDb();
        await admin.close();
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}
export type Harness = Awaited<ReturnType<typeof harness>>;

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export type Client = Record<string, string> & { client_secret_expires_at?: number };

export async function register(h: Harness, metadata: Record<string, unknown> = {}) {
  const response = await h.call('POST', '/register', {
    json: {
      client_name: 'Test client',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...metadata,
    },
  });
  return { response, client: (await response.json()) as Client };
}

export function authorizeQuery(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {}
) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    scope: SCOPE,
    resource: RESOURCE,
    ...extra,
  }).toString();
}

export const pendingIdIn = (page: string) => /name="pending" value="([^"]+)"/.exec(page)?.[1] ?? '';

export interface Tokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

/** Register, sign in and get a code: what a connector does when it is added */
export async function connect(h: Harness, password = PASSWORD, ip?: string) {
  const { client } = await register(h);
  const { verifier, challenge } = pkce();
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, challenge)}`, { ip })
  ).text();
  const login = await h.call('POST', '/login', {
    form: { pending: pendingIdIn(page), username: USERNAME, password },
    ip,
  });
  const location = new URL(login.headers.get('location') ?? 'about:blank');
  const code = location.searchParams.get('code') ?? '';
  const exchange = (overrides: Record<string, string> = {}) =>
    h.call('POST', '/token', {
      form: {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        client_secret: client.client_secret,
        resource: RESOURCE,
        ...overrides,
      },
    });
  return { client, verifier, login, location, code, exchange };
}

export async function signedIn(h: Harness) {
  const flow = await connect(h);
  const response = await flow.exchange();
  assert.equal(response.status, 200);
  const tokens = (await response.json()) as Tokens;
  return { ...flow, tokens };
}

const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-06-18',
};

/** One JSON-RPC message, or a batch of them, to `/mcp` */
export function post(h: Harness, accessToken: string | undefined, body: unknown) {
  const headers: Record<string, string> = { ...MCP_HEADERS };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return h.call('POST', '/mcp', { headers, json: body });
}

export async function rpc(
  h: Harness,
  accessToken: string | undefined,
  method: string,
  params: unknown = {}
) {
  const response = await post(h, accessToken, { jsonrpc: '2.0', id: 1, method, params });
  const text = await response.text();
  const line = text.split('\n').find((part) => part.startsWith('data: '));
  const data = line ? JSON.parse(line.slice(6)) : parseJson(text);
  return { response, data, text };
}

function parseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export const getUser = (h: Harness, accessToken: string) =>
  rpc(h, accessToken, 'tools/call', { name: 'get_user', arguments: {} });

export const refresh = (
  h: Harness,
  client: Client,
  refreshToken: string,
  extra: Record<string, string> = {}
) =>
  h.call('POST', '/token', {
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.client_id,
      client_secret: client.client_secret,
      ...extra,
    },
  });

export const revoke = (h: Harness, client: Client, token: string) =>
  h.call('POST', '/revoke', {
    form: { token, client_id: client.client_id, client_secret: client.client_secret },
  });

/** A test with its own server, storage and fake Yazio */
export function scenario(
  name: string,
  run: (h: Harness) => Promise<void>,
  options: { skip?: string | false; config?: Overrides } = {}
) {
  test(name, { skip: options.skip || undefined }, async () => {
    const h = await harness(options.config);
    try {
      await run(h);
    } finally {
      await h.cleanup();
    }
  });
}
