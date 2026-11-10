import assert from 'node:assert/strict';
import { connect as netConnect } from 'node:net';
import { test } from 'node:test';
import { Sealer } from '../src/remote/crypto.js';
import { maskPath, yazioSignIn } from '../src/remote/oauth.js';
import { serve } from '../src/remote/serve.js';
import { FileStore } from '../src/remote/store-file.js';
import { RedisStore } from '../src/remote/store-redis.js';
import { MAX_TTL_MS, type Store } from '../src/remote/store.js';
import {
  PASSWORD,
  REDIRECT,
  REDIS_URL,
  SECRET,
  STORE_CLOCK,
  USERNAME,
  authorizeQuery,
  captureErrors,
  connect,
  gate,
  pendingIdIn,
  getUser,
  jsonResponse,
  pkce,
  refresh,
  register,
  rpc,
  scenario,
  signedIn,
  type Harness,
} from './harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The Yazio token that the session holds, opened with the test secret */
async function sessionToken(h: Harness): Promise<Record<string, unknown>> {
  const keys = await h.keys('sess:');
  assert.equal(keys.length, 1, 'one session');
  const sealed = await h.store.get(keys[0]);
  assert.ok(sealed);
  const opened = new Sealer(SECRET).open(sealed, keys[0]);
  assert.ok(opened);
  return JSON.parse(opened).token;
}

// --- who may use a code or a token ---

scenario('another client cannot use up a code, and cannot end the session it issued', async (h) => {
  const flow = await signedIn(h);
  const { client: other } = await register(h);
  const replay = await flow.exchange({
    client_id: other.client_id,
    client_secret: other.client_secret,
  });
  assert.equal(replay.status, 400);
  assert.equal((await rpc(h, flow.tokens.access_token, 'tools/list')).response.status, 200);
  // The owner's own replay still ends the session
  assert.equal((await flow.exchange()).status, 400);
  assert.equal((await rpc(h, flow.tokens.access_token, 'tools/list')).response.status, 401);
});

scenario('a code sent to another address of the server is refused and stays usable', async (h) => {
  h.rebuild({ publicUrl: undefined });
  const flow = await connect2(h);
  const elsewhere = await h.call('POST', '/token', {
    origin: 'https://other.example',
    form: flow.form,
  });
  assert.equal(elsewhere.status, 400);
  assert.equal((await h.call('POST', '/token', { form: flow.form })).status, 200);
});

/** A code from a sign-in on the default address, and the form that exchanges it */
async function connect2(h: Harness) {
  const flow = await connect(h);
  const form = {
    grant_type: 'authorization_code',
    code: flow.code,
    code_verifier: flow.verifier,
    redirect_uri: REDIRECT,
    client_id: flow.client.client_id,
    client_secret: flow.client.client_secret,
  };
  return { ...flow, form };
}

scenario('a revocation sent to another address of the server changes nothing', async (h) => {
  h.rebuild({ publicUrl: undefined });
  const { client, tokens } = await signedIn(h);
  const form = {
    client_id: client.client_id,
    client_secret: client.client_secret,
    token: tokens.refresh_token,
  };
  const elsewhere = await h.call('POST', '/revoke', { origin: 'https://other.example', form });
  // RFC 7009: a token that the server does not know here is not an error
  assert.equal(elsewhere.status, 200);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
  assert.equal((await h.call('POST', '/revoke', { form })).status, 200);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
});

// --- races after a lock expired ---

scenario(
  'a refresh that lost its lock does not issue a second set of tokens',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const entered = gate();
    const release = gate();
    const set = h.store.set.bind(h.store);
    let held = false;
    h.store.set = async (key, value, options) => {
      if (key.startsWith('rt-used:') && !held) {
        held = true;
        entered.open();
        await release.opened;
      }
      return set(key, value, options);
    };
    const first = refresh(h, client, tokens.refresh_token);
    await entered.opened;
    h.tick(121_000); // the lock of the first request is gone
    const second = await refresh(h, client, tokens.refresh_token);
    release.open();
    const late = await first;

    assert.equal(second.status, 200);
    assert.equal(late.status, 400);
    assert.equal((await late.json()).error, 'invalid_grant');
    const winner = await second.json();
    assert.equal((await rpc(h, winner.access_token, 'tools/list')).response.status, 200);
    // The slow request did not end the session
    assert.equal((await refresh(h, client, winner.refresh_token)).status, 200);
    // Only the tokens of the winner exist
    assert.equal((await h.keys('rt:')).length, 1);
  },
  { skip: STORE_CLOCK }
);

scenario(
  'a renewal that lost its lock does not overwrite the newer Yazio token',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { tokens } = await signedIn(h);
    h.yazio.state.expiresIn = 3600;
    const entered = gate();
    const release = gate();
    const replaceIf = h.store.replaceIf.bind(h.store);
    let held = false;
    h.store.replaceIf = async (key, expected, value) => {
      if (key.startsWith('sess:') && !held) {
        held = true;
        entered.open();
        await release.opened;
      }
      return replaceIf(key, expected, value);
    };
    const before = h.yazio.state.issued;
    const first = rpc(h, tokens.access_token, 'tools/list');
    await entered.opened;
    h.tick(46_000); // the renewal lock is gone
    const second = await rpc(h, tokens.access_token, 'tools/list');
    release.open();
    assert.equal((await first).response.status, 200);
    assert.equal(second.response.status, 200);
    // Known limit: both renewals reached Yazio. The newer token is the one that stays.
    assert.equal(h.yazio.state.issued - before, 2);
    assert.equal((await sessionToken(h)).access_token, `yazio-access-${before + 2}`);
  },
  { skip: STORE_CLOCK }
);

scenario(
  'a refusal for an old Yazio token does not end a session that holds a newer one',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { tokens } = await signedIn(h);
    h.yazio.state.expiresIn = 3600;
    const entered = gate();
    const release = gate();
    let refreshes = 0;
    h.yazio.state.beforeRefresh = async () => {
      if (++refreshes === 1) {
        entered.open();
        await release.opened;
      }
    };
    const first = rpc(h, tokens.access_token, 'tools/list');
    await entered.opened;
    h.tick(46_000);
    const second = await rpc(h, tokens.access_token, 'tools/list');
    assert.equal(second.response.status, 200);
    h.yazio.state.refresh = 'refuse'; // the slow renewal now gets a refusal
    release.open();
    assert.equal((await first).response.status, 200);
    assert.equal((await h.keys('sess:')).length, 1);
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
  },
  { skip: STORE_CLOCK }
);

// --- what is stored and what is logged ---

scenario('the session keeps only the known fields of a Yazio token', async (h) => {
  const echo = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await h.yazio.fetch(input, init);
    if (!String(input).endsWith('/oauth/token') || !response.ok) return response;
    const sent = JSON.parse(String(init?.body));
    return jsonResponse({ ...(await response.json()), echoed: sent.password ?? 'x' });
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, echo), fetch: echo });
  const capture = captureErrors();
  try {
    await signedIn(h);
  } finally {
    capture.restore();
  }
  assert.deepEqual(Object.keys(await sessionToken(h)).sort(), [
    'access_token',
    'expires_at',
    'expires_in',
    'refresh_token',
    'token_type',
  ]);
});

scenario('a sign-in whose Yazio answer has no access token fails as an outage', async (h) => {
  const empty = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).endsWith('/oauth/token')
      ? jsonResponse({ token_type: 'bearer' })
      : h.yazio.fetch(input, init)) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, empty), fetch: empty });
  const capture = captureErrors();
  let page: string;
  try {
    const { client } = await register(h);
    const view = await h.call(
      'GET',
      `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`
    );
    const pending = pendingIdIn(await view.text());
    const login = await h.call('POST', '/login', {
      form: { pending, username: USERNAME, password: PASSWORD },
    });
    assert.equal(login.status, 401);
    page = await login.text();
  } finally {
    capture.restore();
  }
  assert.match(page, /could not be reached/);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario('a Yazio answer with another shape is logged without its keys and ids', async (h) => {
  const { tokens } = await signedIn(h);
  const odd = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).includes('/user')
      ? jsonResponse({ 'person@example.invalid': 'not-a-user' })
      : h.yazio.fetch(input, init)) as typeof fetch;
  h.rebuild({ fetch: odd });
  const capture = captureErrors();
  try {
    await getUser(h, tokens.access_token);
  } finally {
    capture.restore();
  }
  const log = capture.lines.join('\n');
  assert.match(log, /unexpected shape/);
  assert.doesNotMatch(log, /person@example\.invalid|not-a-user/);
});

test('a Yazio path in the log has no ids', () => {
  assert.equal(
    maskPath('/user/consumed-items/2b1c5c1e-0000-4000-8000-000000000000'),
    '/user/consumed-items/:id'
  );
  assert.equal(maskPath('/products/abc123'), '/products/:id');
  assert.equal(maskPath('/user/goals'), '/user/goals');
  assert.equal(maskPath('/user/bodyvalues/2026-01-02'), '/user/bodyvalues/:id');
  // An id that looks like a word is hidden too
  assert.equal(maskPath('/recipes/private-recipe'), '/recipes/:id');
  assert.equal(maskPath('/user/meals/breakfast_at_home'), '/user/meals/:id');
  assert.equal(maskPath('/products/search?query=x'), '/products/search');
});

scenario('a recipe id from Yazio does not reach the log of the remote server', async (h) => {
  const { tokens } = await signedIn(h);
  const ids = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).endsWith('/user/recipes')
      ? jsonResponse(['private-recipe'])
      : h.yazio.fetch(input, init)) as typeof fetch;
  h.rebuild({ fetch: ids });
  const capture = captureErrors();
  try {
    await rpc(h, tokens.access_token, 'tools/call', { name: 'get_user_recipes', arguments: {} });
  } finally {
    capture.restore();
  }
  const log = capture.lines.join('\n');
  assert.match(log, /\/recipes\/:id returned an unexpected shape/);
  assert.doesNotMatch(log, /private-recipe/);
});

scenario(
  'a refresh that was admitted before a concurrent one finished does not end the session',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const entered = gate();
    const resume = gate();
    const set = h.store.set.bind(h.store);
    let held = false;
    // Hold the first request just after it took the lock
    h.store.set = async (key, value, options) => {
      const result = await set(key, value, options);
      if (key.startsWith('rt-lock:') && !held) {
        held = true;
        entered.open();
        await resume.opened;
      }
      return result;
    };
    const slow = refresh(h, client, tokens.refresh_token);
    await entered.opened;
    h.tick(121_000);
    const win = await refresh(h, client, tokens.refresh_token);
    assert.equal(win.status, 200);
    const winner = await win.json();
    resume.open();
    const late = await slow;
    assert.equal(late.status, 400);
    assert.equal((await late.json()).error, 'invalid_grant');
    assert.equal((await rpc(h, winner.access_token, 'tools/list')).response.status, 200);
    // A replay that comes later, as a new request, still ends the session
    assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
    assert.equal((await rpc(h, winner.access_token, 'tools/list')).response.status, 401);
  },
  { skip: STORE_CLOCK }
);

scenario('a Yazio token without a refresh token is used until it expires', async (h) => {
  const noRefresh = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await h.yazio.fetch(input, init);
    if (!String(input).endsWith('/oauth/token') || !response.ok) return response;
    const { refresh_token: _dropped, ...token } = await response.json();
    return jsonResponse({ ...token, expires_in: 240 });
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, noRefresh), fetch: noRefresh });
  const { tokens } = await signedIn(h);
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
  assert.equal(h.yazio.state.issued, 1, 'no renewal was tried');
  h.tick(241_000); // now it is expired, and there is nothing to renew it with
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario('a Yazio token without a refresh token that Yazio rejects ends the session', async (h) => {
  const noRefresh = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await h.yazio.fetch(input, init);
    if (!String(input).endsWith('/oauth/token') || !response.ok) return response;
    const { refresh_token: _dropped, ...token } = await response.json();
    return jsonResponse(token);
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, noRefresh), fetch: noRefresh });
  const { tokens } = await signedIn(h);
  h.yazio.state.userUnauthorized = true;
  assert.equal((await getUser(h, tokens.access_token)).response.status, 401);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario(
  'a sign-in admitted at the end of a window is counted in that window',
  async (h) => {
    const { client } = await register(h);
    const window = 600_000;
    h.tick(window - (h.now() % window) - 1000);
    const get = h.store.get.bind(h.store);
    const entered = gate();
    const resume = gate();
    let held = false;
    // The store is slow: the admission ends in the next window
    h.store.get = async (key) => {
      const value = await get(key);
      if (key.startsWith('count:pending:') && !held) {
        held = true;
        entered.open();
        await resume.opened;
      }
      return value;
    };
    const query = authorizeQuery(client.client_id, pkce().challenge);
    const delayed = h.call('GET', `/authorize?${query}`);
    await entered.opened;
    h.tick(1001);
    resume.open();
    assert.equal((await delayed).status, 200);
    // Ten minutes after its admission it is closed, before the counter of its window is dropped
    h.tick(window - 1);
    assert.deepEqual(await h.keys('pending:'), []);
  },
  { skip: STORE_CLOCK }
);

scenario('a host name longer than DNS allows is refused and not stored', async (h) => {
  h.rebuild({ publicUrl: undefined });
  const { client } = await register(h);
  // Five labels of 60 characters: 312 characters, more than the 253 of a DNS name
  const origin = `https://${Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.')}.invalid`;
  const query = authorizeQuery(client.client_id, pkce().challenge, { resource: `${origin}/mcp` });
  const response = await h.call('GET', `/authorize?${query}`, { origin });
  assert.equal(response.status, 500);
  assert.deepEqual(await h.keys('pending:'), []);
});

test('Redis store: a wrong time to live is a RangeError, also without a connection', async () => {
  const store = new RedisStore('redis://127.0.0.1:1');
  try {
    await assert.rejects(store.set('k', 'v', { ttlMs: 0 }), RangeError);
    await assert.rejects(store.set('k', 'v', { if: 'absent', ttlMs: Number.NaN }), RangeError);
    await assert.rejects(store.increment('k', -1), RangeError);
    await assert.rejects(store.expire('k', MAX_TTL_MS + 1), RangeError);
  } finally {
    await store.close();
  }
});

scenario(
  'the request log shows a route of the server, never a path a client made up',
  async (h) => {
    await h.call('GET', '/person@example.invalid/private-marker');
    await h.call('GET', '/.well-known/oauth-protected-resource/mcp');
    await h.call('PROPFIND', '/mcp');
    const log = h.logs.join('\n');
    assert.doesNotMatch(log, /person@example|private-marker/);
    assert.match(log, /^GET \(other\) -> 404/m);
    assert.match(log, /^GET \/\.well-known\/oauth-protected-resource -> 200/m);
    assert.match(log, /^OTHER \/mcp -> /m);
  }
);

// --- sizes and counts ---

scenario('the state of a client is limited, and a long one is not stored', async (h) => {
  const { client } = await register(h);
  const { challenge } = pkce();
  const long = await h.call(
    'GET',
    `/authorize?${authorizeQuery(client.client_id, challenge, { state: 'x'.repeat(2049) })}`
  );
  assert.equal(long.status, 302);
  const location = new URL(long.headers.get('location') ?? 'about:blank');
  assert.equal(location.searchParams.get('error'), 'invalid_request');
  assert.equal(location.searchParams.get('state'), null);
  assert.deepEqual(await h.keys('pending:'), []);
  const fits = await h.call(
    'GET',
    `/authorize?${authorizeQuery(client.client_id, challenge, { state: 'x'.repeat(2048) })}`
  );
  assert.equal(fits.status, 200);
});

scenario('an OAuth form over 64 KiB is refused with 413 and not stored', async (h) => {
  const { client } = await register(h);
  const form = Object.fromEntries(
    new URLSearchParams(
      authorizeQuery(client.client_id, pkce().challenge, { padding: 'x'.repeat(70_000) })
    )
  );
  const authorize = await h.call('POST', '/authorize', { form });
  assert.equal(authorize.status, 400);
  assert.deepEqual(await h.keys('pending:'), []);
  const token = await h.call('POST', '/token', {
    form: { grant_type: 'refresh_token', refresh_token: 'x'.repeat(70_000) },
  });
  assert.equal(token.status, 413);
});

scenario('the cap on open sign-ins also counts the ones from the window before', async (h) => {
  const { client } = await register(h);
  const window = 600_000;
  h.tick(window - (h.now() % window) - 1); // the last millisecond of a window
  await h.store.set(`count:pending:${Math.floor(h.now() / window)}`, '999', { ttlMs: 2 * window });
  const query = authorizeQuery(client.client_id, pkce().challenge);
  assert.equal((await h.call('GET', `/authorize?${query}`)).status, 200); // the 1000th
  h.tick(2); // a new window: the 1000 can all still be open
  const refused = await h.call('GET', `/authorize?${query}`);
  assert.equal(refused.status, 302);
  const location = new URL(refused.headers.get('location') ?? 'about:blank');
  assert.equal(location.searchParams.get('error'), 'temporarily_unavailable');
});

// --- the Node adapter ---

async function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1');
    let answer = '';
    socket.on('data', (chunk) => (answer += chunk));
    socket.on('end', () => resolve(answer));
    socket.on('error', reject);
    socket.write(text);
  });
}

for (const publicUrl of [undefined, new URL('https://mcp.example.com')]) {
  test(`adapter: a request with two Host headers is refused (${publicUrl ? 'with' : 'without'} a public address)`, async () => {
    let calls = 0;
    const server = serve(
      { fetch: async () => (calls++, new Response('ok')) },
      { publicUrl }
    ).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as { port: number };
      const two = await rawRequest(
        port,
        'GET / HTTP/1.1\r\nHost: localhost\r\nHost: other.example\r\nConnection: close\r\n\r\n'
      );
      assert.match(two, /^HTTP\/1\.1 400/);
      const none = await rawRequest(port, 'GET / HTTP/1.0\r\nConnection: close\r\n\r\n');
      assert.match(none, /^HTTP\/1\.[01] 400/);
      assert.equal(calls, 0);
      const one = await rawRequest(
        port,
        'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'
      );
      assert.match(one, /^HTTP\/1\.1 200/);
      assert.equal(calls, 1);
    } finally {
      server.close();
    }
  });
}

test('adapter: slow clients have fixed time limits', () => {
  const server = serve({ fetch: async () => new Response('ok') });
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.requestTimeout, 60_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.timeout, 0);
});

// --- the store operations, on every store ---

const stores: [string, () => { store: Store; done: () => Promise<void> }][] = [
  [
    'file store',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'yazio-store-'));
      const store = new FileStore(dir);
      return {
        store,
        done: async () => {
          await store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  ],
  [
    'Redis store',
    () => {
      const store = new RedisStore(REDIS_URL ?? 'redis://127.0.0.1:1');
      return { store, done: () => store.close() };
    },
  ],
];

for (const [name, open] of stores) {
  const skip =
    name === 'Redis store' && !REDIS_URL
      ? 'set TEST_REDIS_URL to run the Redis store tests'
      : undefined;
  const key = (part: string) => `test-${part}-${Math.random().toString(36).slice(2)}`;

  test(`${name}: a time to live that is not a positive number is refused`, { skip }, async () => {
    const { store, done } = open();
    try {
      const present = key('present');
      await store.set(present, 'v', { ttlMs: 60_000 });
      for (const ttlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TTL_MS + 1]) {
        await assert.rejects(store.set(key('ttl'), 'v', { ttlMs }), RangeError);
        await assert.rejects(store.increment(key('ttl'), ttlMs), RangeError);
        await assert.rejects(store.expire(key('ttl'), ttlMs), RangeError);
        // Also when the condition of the write does not hold
        await assert.rejects(store.set(present, 'v', { if: 'absent', ttlMs }), RangeError);
        await assert.rejects(store.set(key('ttl'), 'v', { if: 'present', ttlMs }), RangeError);
      }
      await store.delete(present);
      // A part of a millisecond counts as a whole one
      const k = key('fraction');
      assert.equal(await store.set(k, 'v', { ttlMs: 50.5 }), true);
      assert.equal(await store.get(k), 'v');
      await store.delete(k);
    } finally {
      await done();
    }
  });

  test(`${name}: a counter refuses a value that is not a count`, { skip }, async () => {
    const { store, done } = open();
    const k = key('counter');
    try {
      await store.set(k, 'not a number', { ttlMs: 60_000 });
      await assert.rejects(store.increment(k, 60_000));
      assert.equal(await store.get(k), 'not a number');
    } finally {
      await store.delete(k);
      await done();
    }
  });

  test(`${name}: deleteIf and replaceIf act only on the expected value`, { skip }, async () => {
    const { store, done } = open();
    const k = key('cas');
    try {
      assert.equal(await store.deleteIf(k, 'a'), false);
      assert.equal(await store.replaceIf(k, 'a', 'b'), false);
      assert.equal(await store.get(k), null, 'replaceIf does not make a key');
      await store.set(k, 'a', { ttlMs: 60_000 });
      assert.equal(await store.deleteIf(k, 'other'), false);
      assert.equal(await store.replaceIf(k, 'other', 'b'), false);
      assert.equal(await store.get(k), 'a');
      assert.equal(await store.replaceIf(k, 'a', 'b'), true);
      assert.equal(await store.get(k), 'b');
      assert.equal(await store.deleteIf(k, 'a'), false);
      assert.equal(await store.deleteIf(k, 'b'), true);
      assert.equal(await store.get(k), null);
    } finally {
      await store.delete(k);
      await done();
    }
  });
}

test('file store: replaceIf keeps the time to live of the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yazio-store-'));
  let clock = 1_000;
  const store = new FileStore(dir, () => clock);
  try {
    await store.set('k', 'a', { ttlMs: 100 });
    clock += 50;
    assert.equal(await store.replaceIf('k', 'a', 'b'), true);
    clock += 60;
    assert.equal(await store.get('k'), null);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
