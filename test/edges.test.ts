import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { test } from 'node:test';
import { yazioSignIn } from '../src/remote/oauth.js';
import { serve } from '../src/remote/serve.js';
import {
  PASSWORD,
  REDIRECT,
  RESOURCE,
  USERNAME,
  authorizeQuery,
  captureErrors,
  connect,
  gate,
  getUser,
  jsonResponse,
  pendingIdIn,
  pkce,
  refresh,
  register,
  revoke,
  rpc,
  scenario,
  signedIn,
  type Harness,
} from './harness.js';

const passwordGrants = (h: Harness) =>
  h.yazio.state.calls.filter((call) => call.grant === 'password').length;
const refreshGrants = (h: Harness) =>
  h.yazio.state.calls.filter((call) => call.grant === 'refresh_token').length;

/** The sign-in page of a new sign-in, and the client that started it */
async function signInPage(h: Harness, challenge = pkce().challenge, origin?: string) {
  const { client } = await register(h);
  const query = authorizeQuery(client.client_id, challenge);
  const page = await (await h.call('GET', `/authorize?${query}`, { origin })).text();
  return { client, pending: pendingIdIn(page) };
}

// --- PKCE, resource and sign-in ---

scenario(
  'a code_verifier that RFC 7636 does not allow fails, even with a matching challenge',
  async (h) => {
    const verifier = 'short';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { client, pending } = await signInPage(h, challenge);
    const login = await h.call('POST', '/login', {
      form: { pending, username: USERNAME, password: PASSWORD },
    });
    const code = new URL(login.headers.get('location') ?? 'about:blank').searchParams.get('code');
    assert.ok(code);
    const exchange = await h.call('POST', '/token', {
      form: {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        client_secret: client.client_secret,
        resource: RESOURCE,
      },
    });
    assert.equal(exchange.status, 400);
    assert.equal((await exchange.json()).error, 'invalid_grant');
  }
);

scenario('a resource indicator with a fragment is refused', async (h) => {
  const { client } = await register(h);
  const query = authorizeQuery(client.client_id, pkce().challenge, { resource: `${RESOURCE}#x` });
  const response = await h.call('GET', `/authorize?${query}`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? 'about:blank');
  assert.ok(location.searchParams.get('error'));
  assert.deepEqual(await h.keys('pending:'), []);
});

scenario('a sign-in started on one address cannot be completed on another', async (h) => {
  h.rebuild({ publicUrl: undefined });
  const { pending } = await signInPage(h);
  const form = { pending, username: USERNAME, password: PASSWORD };
  const elsewhere = await h.call('POST', '/login', { origin: 'https://other.example', form });
  assert.equal(elsewhere.status, 400);
  assert.equal(passwordGrants(h), 0, 'the password was not sent to Yazio');
  // And it still works where it started
  const here = await h.call('POST', '/login', { form });
  assert.equal(here.status, 302);
});

scenario('a sign-in form without a live sign-in does not reach Yazio', async (h) => {
  const response = await h.call('POST', '/login', {
    form: { pending: 'not-a-sign-in', username: USERNAME, password: PASSWORD },
  });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Sign-in expired/);
  assert.equal(passwordGrants(h), 0);
});

scenario('a sign-in form sent twice at once sends the password to Yazio once', async (h) => {
  const held = gate();
  let signIns = 0;
  const realSignIn = yazioSignIn({}, h.yazio.fetch);
  h.rebuild({
    signIn: async (username, password) => {
      signIns++;
      await held.opened;
      return realSignIn(username, password);
    },
  });
  const { pending } = await signInPage(h);
  const form = { pending, username: USERNAME, password: PASSWORD };
  const first = h.call('POST', '/login', { form });
  while (signIns === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = await h.call('POST', '/login', { form });
  assert.equal(second.status, 401);
  assert.match(await second.text(), /already being checked/);
  held.open();
  assert.equal((await first).status, 302);
  assert.equal(signIns, 1);
});

scenario('a code whose session is gone gives no tokens', async (h) => {
  const flow = await connect(h);
  for (const key of await h.keys('sess:')) await h.store.delete(key);
  const exchange = await flow.exchange();
  assert.equal(exchange.status, 400);
  assert.equal((await exchange.json()).error, 'invalid_grant');
  assert.deepEqual(await h.keys('at:'), []);
});

// --- Yazio calls ---

scenario('every call to Yazio has a deadline', async (h) => {
  const signals: boolean[] = [];
  const recorded = (async (input: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal instanceof AbortSignal);
    return h.yazio.fetch(input, init);
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, recorded), fetch: recorded });
  h.yazio.state.expiresIn = 0; // so that a tool call renews first
  const { tokens } = await signedIn(h);
  h.yazio.state.expiresIn = 3600;
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
  assert.ok(passwordGrants(h) === 1 && refreshGrants(h) >= 1, 'sign-in, renewal and call ran');
  assert.ok(signals.length >= 3);
  assert.ok(signals.every(Boolean), 'a call without a deadline');
});

scenario('a renewal that fails is logged without the message of the error', async (h) => {
  const failing = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (body?.grant_type === 'refresh_token') throw new Error('marker-renew-91');
    return h.yazio.fetch(input, init);
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, failing), fetch: failing });
  h.yazio.state.expiresIn = 0;
  const { tokens } = await signedIn(h);
  const capture = captureErrors();
  try {
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 503);
  } finally {
    capture.restore();
  }
  const log = capture.lines.join('\n');
  assert.match(log, /Could not renew a Yazio session/);
  assert.doesNotMatch(log, /marker-renew-91/);
});

scenario('a Yazio error is logged without the status text that Yazio sent', async (h) => {
  const failing = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (body?.grant_type === 'refresh_token') {
      return new Response('', { status: 503, statusText: 'marker-status-55' });
    }
    return h.yazio.fetch(input, init);
  }) as typeof fetch;
  h.rebuild({ signIn: yazioSignIn({}, failing), fetch: failing });
  h.yazio.state.expiresIn = 0;
  const { tokens } = await signedIn(h);
  const capture = captureErrors();
  try {
    await rpc(h, tokens.access_token, 'tools/list');
  } finally {
    capture.restore();
  }
  const log = capture.lines.join('\n');
  assert.match(log, /YazioApiError POST \/oauth\/token 503/);
  assert.doesNotMatch(log, /marker-status-55/);
});

scenario('the client of a tool call never renews the Yazio token by itself', async (h) => {
  // The clock of the server runs 10 minutes behind the real one. The server still sees the
  // Yazio token as good; the API client, on the real clock, would see it as expired.
  let behind = 0;
  h.rebuild({ now: () => h.now() - behind });
  behind = 600_000;
  h.yazio.state.expiresIn = 400;
  const { tokens } = await signedIn(h);
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
  assert.equal(refreshGrants(h), 0);
});

scenario('a second rejection by Yazio fails the tool call with its status', async (h) => {
  const { tokens } = await signedIn(h);
  h.yazio.state.userUnauthorized = true;
  const { response, data } = await getUser(h, tokens.access_token);
  assert.equal(response.status, 200);
  assert.equal(data.result.isError, true);
  assert.match(data.result.content[0].text, /failed: 401 Unauthorized/);
  // Yazio renewed the token without a complaint, so the session stays
  assert.equal((await h.keys('sess:')).length, 1);
});

scenario('a renewal waits for the lock of another request, and then gives up', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { tokens } = await signedIn(h);
  const [key] = await h.keys('sess:');
  await h.store.set(`sess-lock:${key.slice('sess:'.length)}`, 'another-request', {
    ttlMs: 60_000,
  });
  const before = refreshGrants(h);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 503);
  assert.equal(refreshGrants(h), before);
});

scenario('a lock that passed to another request is not freed by the old owner', async (h) => {
  const { client, tokens } = await signedIn(h);
  const entered = gate();
  const resume = gate();
  const deleteIf = h.store.deleteIf.bind(h.store);
  let lock = '';
  h.store.deleteIf = async (key, expected) => {
    if (key.startsWith('rt-lock:') && !lock) {
      lock = key;
      entered.open();
      await resume.opened;
    }
    return deleteIf(key, expected);
  };
  const exchange = refresh(h, client, tokens.refresh_token);
  await entered.opened;
  // The lock expired, and another request holds it now
  await h.store.delete(lock);
  await h.store.set(lock, 'another-request', { if: 'absent', ttlMs: 120_000 });
  resume.open();
  assert.equal((await exchange).status, 200);
  assert.equal(await h.store.get(lock), 'another-request');
});

// --- revocation ---

scenario('revoking a refresh token that was already rotated ends the session', async (h) => {
  const { client, tokens } = await signedIn(h);
  const rotated = await refresh(h, client, tokens.refresh_token);
  const next = await rotated.json();
  assert.equal((await revoke(h, client, tokens.refresh_token)).status, 200);
  assert.equal((await rpc(h, next.access_token, 'tools/list')).response.status, 401);
});

// --- errors that come from inside ---

scenario(
  'an unexpected error shows neither its message to the client nor in the log',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const get = h.store.get.bind(h.store);
    h.store.get = async (key) => {
      if (key.startsWith('client:')) throw new Error('marker-store-31');
      return get(key);
    };
    const capture = captureErrors();
    let body: string;
    try {
      const response = await refresh(h, client, tokens.refresh_token);
      assert.equal(response.status, 500);
      body = await response.text();
    } finally {
      capture.restore();
      h.store.get = get;
    }
    assert.doesNotMatch(body, /marker-store-31/);
    assert.match(capture.lines.join('\n'), /Unexpected error/);
    assert.doesNotMatch(capture.lines.join('\n'), /marker-store-31/);
  }
);

scenario('a client id longer than any issued one is not looked up', async (h) => {
  const keys: string[] = [];
  const get = h.store.get.bind(h.store);
  h.store.get = async (key) => {
    keys.push(key);
    return get(key);
  };
  const query = authorizeQuery('x'.repeat(65), pkce().challenge);
  assert.equal((await h.call('GET', `/authorize?${query}`)).status, 400);
  assert.ok(!keys.some((key) => key.startsWith('client:')));
});

/** A request with a body that is right, sent with another Content-Type */
const mislabeled = (h: Harness, path: string, body: string) =>
  h.app.fetch(
    new Request(`https://mcp.example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    }),
    { clientAddress: '203.0.113.7' }
  );

scenario('a correct body with the wrong Content-Type is refused', async (h) => {
  const { client, tokens } = await signedIn(h);
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    client_secret: client.client_secret,
  }).toString();
  const token = await mislabeled(h, '/token', form);
  assert.equal(token.status, 400);
  assert.equal((await token.json()).error, 'invalid_request');
  const metadata = JSON.stringify({ client_name: 'x', redirect_uris: [REDIRECT] });
  const registration = await mislabeled(h, '/register', metadata);
  assert.equal(registration.status, 400);
  assert.equal((await registration.json()).error, 'invalid_client_metadata');
});

scenario('a resource indicator with a fragment is refused at the token endpoint too', async (h) => {
  const flow = await connect(h);
  const exchange = await flow.exchange({ resource: `${RESOURCE}#x` });
  assert.equal(exchange.status, 400);
});

scenario(
  'a replay of a rotated refresh token on another address does not end the session',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const next = await (await refresh(h, client, tokens.refresh_token)).json();
    const elsewhere = await h.call('POST', '/token', {
      origin: 'https://other.example',
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      },
    });
    assert.equal(elsewhere.status, 400);
    assert.equal((await rpc(h, next.access_token, 'tools/list')).response.status, 200);
  },
  { config: { publicUrl: undefined } }
);

scenario(
  'a sign-in whose token answer has another shape is logged in the short form',
  async (h) => {
    const odd = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await h.yazio.fetch(input, init);
      if (!String(input).endsWith('/oauth/token') || !response.ok) return response;
      return jsonResponse({ ...(await response.json()), token_type: 42 });
    }) as typeof fetch;
    h.rebuild({ signIn: yazioSignIn({}, odd), fetch: odd });
    const capture = captureErrors();
    try {
      await signedIn(h);
    } finally {
      capture.restore();
    }
    const log = capture.lines.join('\n');
    assert.match(log, /Yazio POST \/oauth\/token returned an unexpected shape: 1 differences/);
    assert.doesNotMatch(log, /token_type/);
  }
);

scenario('a body that is not JSON is logged without its text', async (h) => {
  const { tokens } = await signedIn(h);
  const capture = captureErrors();
  let status: number;
  try {
    const response = await h.app.fetch(
      new Request('https://mcp.example.com/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: '{"marker-mcp-77": not json',
      }),
      { clientAddress: '203.0.113.7' }
    );
    status = response.status;
  } finally {
    capture.restore();
  }
  assert.equal(status, 400);
  assert.doesNotMatch(capture.lines.join('\n'), /marker-mcp-77/);
});

// --- the HTTP layer ---

scenario('the OAuth endpoints refuse a body of the wrong type', async (h) => {
  const token = await h.call('POST', '/token', {
    json: { grant_type: 'refresh_token', refresh_token: 'x' },
  });
  assert.equal(token.status, 400);
  assert.equal((await token.json()).error, 'invalid_request');
  const registration = await h.call('POST', '/register', {
    form: { client_name: 'x', redirect_uris: REDIRECT },
  });
  assert.equal(registration.status, 400);
  assert.equal((await registration.json()).error, 'invalid_client_metadata');
});

scenario('a redirect is not cached and does not pass on the address of the page', async (h) => {
  const { pending } = await signInPage(h);
  const login = await h.call('POST', '/login', {
    form: { pending, username: USERNAME, password: PASSWORD },
  });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
});

scenario(
  'a forwarded scheme other than http or https is ignored',
  async (h) => {
    const response = await h.call('GET', '/.well-known/oauth-authorization-server', {
      origin: 'http://localhost:3000',
      headers: { 'X-Forwarded-Proto': 'ftp' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).issuer, 'http://localhost:3000/');
  },
  { config: { publicUrl: undefined, trustProxy: true } }
);

scenario(
  'the registration limit counts before the address of the server is checked',
  async (h) => {
    const origin = 'http://not-loopback.example';
    for (let i = 0; i < 20; i++) {
      assert.equal((await h.call('POST', '/register', { origin, json: {} })).status, 500);
    }
    assert.equal((await h.call('POST', '/register', { origin, json: {} })).status, 429);
  },
  { config: { publicUrl: undefined } }
);

async function rawRequest(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1');
    let answer = '';
    socket.on('data', (chunk) => (answer += chunk));
    socket.on('end', () => resolve(answer));
    socket.on('error', reject);
    socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  });
}

test('adapter: a target that names another host in any spelling is refused', async () => {
  const seen: string[] = [];
  const server = serve({
    fetch: async (request) => (seen.push(request.url), new Response('ok')),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as { port: number };
    for (const target of ['//evil.example/x', '/\\evil.example/x', '\\\\evil.example/x']) {
      assert.match(await rawRequest(port, target), /^HTTP\/1\.1 400/, target);
    }
    assert.deepEqual(seen, []);
  } finally {
    server.close();
  }
});
