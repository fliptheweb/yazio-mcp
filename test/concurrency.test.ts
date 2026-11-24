// Refresh, revocation, sign-in and tool calls that overlap, and what reaches clients and storage.
import assert from 'node:assert/strict';
import { hashToken, yazioSignIn } from '../src/remote/oauth.js';
import {
  PASSWORD,
  REDIRECT,
  STORE_CLOCK,
  USERNAME,
  authorizeQuery,
  connect,
  gate,
  getUser,
  jsonResponse,
  pendingIdIn,
  pkce,
  post,
  refresh,
  register,
  revoke,
  rpc,
  scenario,
  signedIn,
  type Harness,
} from './harness.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Puts another Yazio in front of the usual fake one */
function useYazio(h: Harness, fetcher: typeof fetch) {
  h.rebuild({ signIn: yazioSignIn({}, fetcher), fetch: fetcher });
}

/** Holds the next Yazio renewal until `release` is called */
function holdRenewal(h: Harness) {
  const entered = gate();
  const held = gate();
  h.yazio.state.beforeRefresh = async () => {
    entered.open();
    await held.opened;
  };
  return { entered: entered.opened, release: held.open };
}

// --- a refresh that does not finish ---

scenario('a refresh token in exchange is still stored while Yazio answers', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { client, tokens } = await signedIn(h);
  const renewal = holdRenewal(h);
  const running = refresh(h, client, tokens.refresh_token);
  try {
    await renewal.entered;
    await register(h); // another request writes to the store meanwhile
    // A process that stops here must not lose the user's only refresh token
    assert.ok(await h.store.get(`rt:${hashToken(tokens.refresh_token)}`));
  } finally {
    renewal.release();
  }
  assert.equal((await running).status, 200);
  assert.ok(!(await h.store.get(`rt:${hashToken(tokens.refresh_token)}`)));
});

scenario(
  'a refresh that a stopped process left behind can be repeated after two minutes',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    // What a process leaves when it stops in the middle of a refresh
    await h.store.set(`rt-lock:${hashToken(tokens.refresh_token)}`, '1', { ttlMs: 2 * MINUTE });
    const busy = await refresh(h, client, tokens.refresh_token);
    assert.equal(busy.status, 400);
    assert.match((await busy.json()).error_description, /already being exchanged/);
    h.tick(2 * MINUTE + 1000);
    assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
  },
  { skip: STORE_CLOCK }
);

scenario('a refresh that hit an outage can be retried after a restart', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { client, tokens } = await signedIn(h);
  h.yazio.state.refresh = 'offline';
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 503);
  await h.restart();
  h.yazio.state.refresh = 'ok';
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

scenario('a refresh whose session is gone settles and drops its token', async (h) => {
  const { client, tokens } = await signedIn(h);
  const [session] = await h.keys('sess:');
  await h.store.delete(session);
  const first = await refresh(h, client, tokens.refresh_token);
  assert.equal(first.status, 400);
  assert.equal((await first.json()).error, 'invalid_grant');
  assert.deepEqual(await h.keys('rt:'), [], 'a grant whose session is gone is dropped');
  const again = await refresh(h, client, tokens.refresh_token);
  assert.equal(again.status, 400);
  assert.doesNotMatch((await again.json()).error_description, /already being exchanged/);
  // No reuse alarm either: nothing was issued
  assert.deepEqual(await h.keys('rt-used:'), []);
});

// --- tool calls ---

scenario("one tool call's outage does not replace the result of another call", async (h) => {
  const entered = gate();
  const held = gate();
  let userCalls = 0;
  useYazio(h, (async (input, init) => {
    if (String(input).endsWith('/user') && ++userCalls === 1) {
      entered.open();
      await held.opened;
      return h.yazio.fetch(input, init);
    }
    if (String(input).endsWith('/user')) return jsonResponse({}, 401);
    return h.yazio.fetch(input, init);
  }) as typeof fetch);
  const { tokens } = await signedIn(h);
  const successful = getUser(h, tokens.access_token);
  try {
    await entered.opened;
    h.yazio.state.refresh = 'offline';
    assert.equal((await getUser(h, tokens.access_token)).response.status, 503);
  } finally {
    held.open();
  }
  const result = await successful;
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(!result.data.result.isError, JSON.stringify(result.data));
});

scenario(
  'a Yazio token service that answers 503 during a tool call gives 503, without its text',
  async (h) => {
    useYazio(h, (async (input, init) => {
      const renewal =
        String(input).endsWith('/oauth/token') &&
        JSON.parse(String(init?.body)).grant_type === 'refresh_token';
      if (!renewal) return h.yazio.fetch(input, init);
      return new Response('private upstream body', { status: 503, statusText: 'TOKEN-SENTINEL' });
    }) as typeof fetch);
    const { tokens } = await signedIn(h);
    h.yazio.state.userUnauthorized = true;
    const result = await getUser(h, tokens.access_token);
    assert.equal(result.response.status, 503, result.text);
    assert.ok(!result.text.includes('TOKEN-SENTINEL'));
    assert.ok(!result.text.includes('private upstream body'));
    assert.equal((await h.keys('sess:')).length, 1, 'an outage does not end the session');
  }
);

scenario('the body of a Yazio error does not reach the client', async (h) => {
  useYazio(h, (async (input, init) =>
    String(input).endsWith('/user')
      ? new Response('RAW-UPSTREAM-TOKEN-SENTINEL', { status: 500 })
      : h.yazio.fetch(input, init)) as typeof fetch);
  const { tokens } = await signedIn(h);
  const result = await getUser(h, tokens.access_token);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.result.isError, true);
  assert.ok(!result.text.includes('RAW-UPSTREAM-TOKEN-SENTINEL'), result.text);
});

const BATCH = [
  { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_user', arguments: {} } },
];

for (const [outcome, status] of [
  ['ok', 200],
  ['offline', 503],
  ['refuse', 401],
] as const) {
  scenario(
    `a batch with a tool call gets ${status} when the renewal is "${outcome}"`,
    async (h) => {
      const { tokens } = await signedIn(h);
      if (outcome !== 'ok') h.yazio.state.userUnauthorized = true;
      h.yazio.state.refresh = outcome;
      const response = await post(h, tokens.access_token, BATCH);
      const body = await response.text();
      assert.equal(response.status, status, body);
      if (outcome !== 'ok') return;
      assert.match(response.headers.get('content-type')!, /text\/event-stream/);
      assert.match(body, /"id":1/);
      assert.match(body, /"id":2/);
    }
  );
}

// --- sign-in ---

scenario('a registration in the middle of a sign-in is kept until the sign-in ends', async (h) => {
  const { client } = await register(h);
  h.tick(DAY - MINUTE); // one minute before the unused registration ends
  const { verifier, challenge } = pkce();
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, challenge)}`)
  ).text();
  h.tick(5 * MINUTE); // past the day now
  const login = await h.call('POST', '/login', {
    form: { pending: pendingIdIn(page), username: USERNAME, password: PASSWORD },
  });
  assert.equal(login.status, 302);
  const code = new URL(login.headers.get('location')!).searchParams.get('code')!;
  const exchanged = await h.call('POST', '/token', {
    form: {
      client_id: client.client_id,
      client_secret: client.client_secret,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    },
  });
  assert.equal(exchanged.status, 200, await exchanged.text());
});

scenario('two tabs that sign in at once both get working tokens', async (h) => {
  const { client } = await register(h);
  const flows = await Promise.all(
    [1, 2].map(async () => {
      const { verifier, challenge } = pkce();
      const page = await (
        await h.call('GET', `/authorize?${authorizeQuery(client.client_id, challenge)}`)
      ).text();
      const login = await h.call('POST', '/login', {
        form: { pending: pendingIdIn(page), username: USERNAME, password: PASSWORD },
      });
      return { verifier, code: new URL(login.headers.get('location')!).searchParams.get('code')! };
    })
  );
  for (const flow of flows) {
    const response = await h.call('POST', '/token', {
      form: {
        client_id: client.client_id,
        client_secret: client.client_secret,
        grant_type: 'authorization_code',
        code: flow.code,
        code_verifier: flow.verifier,
        redirect_uri: REDIRECT,
      },
    });
    assert.equal(response.status, 200);
    const tokens = (await response.json()) as { access_token: string };
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
  }
  assert.equal((await h.keys('sess:')).length, 2, 'each sign-in is its own session');
});

scenario(
  'the sign-in form CSP covers app schemes, loopback ports, paths and queries',
  async (h) => {
    for (const uri of [
      'myapp:/oauth/callback?x=1',
      'http://127.0.0.1:54321/oauth?x=1',
      'https://client.example/path/cb?x=1',
    ]) {
      const { client } = await register(h, { redirect_uris: [uri] });
      const page = await h.call(
        'GET',
        `/authorize?${authorizeQuery(client.client_id, pkce().challenge, { redirect_uri: uri })}`
      );
      const url = new URL(uri);
      const source = url.protocol.startsWith('http') ? url.origin : url.protocol;
      const csp = page.headers.get('content-security-policy') ?? '';
      assert.ok(csp.includes(`form-action 'self' ${source}`), csp);
      const login = await h.call('POST', '/login', {
        form: { pending: pendingIdIn(await page.text()), username: USERNAME, password: PASSWORD },
      });
      const destination = new URL(login.headers.get('location')!);
      assert.equal(destination.protocol, url.protocol);
      assert.equal(destination.host, url.host);
      assert.equal(destination.pathname, url.pathname);
      assert.equal(destination.searchParams.get('x'), '1');
      assert.ok(destination.searchParams.get('code'));
    }
  }
);

// --- revocation that overlaps a renewal ---

scenario('a revocation during a renewal leaves no session and no refresh token', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { client, tokens } = await signedIn(h);
  const renewal = holdRenewal(h);
  const running = refresh(h, client, tokens.refresh_token);
  try {
    await renewal.entered;
    assert.equal((await revoke(h, client, tokens.refresh_token)).status, 200);
  } finally {
    renewal.release();
  }
  assert.equal((await running).status, 400);
  assert.deepEqual(await h.keys('sess:'), []);
  assert.deepEqual(await h.keys('rt:'), []);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
});

scenario('a code replayed during a refresh cancels the refresh', async (h) => {
  h.yazio.state.expiresIn = 0;
  const flow = await signedIn(h);
  const renewal = holdRenewal(h);
  const running = refresh(h, flow.client, flow.tokens.refresh_token);
  try {
    await renewal.entered;
    assert.equal((await flow.exchange()).status, 400);
  } finally {
    renewal.release();
  }
  assert.equal((await running).status, 400);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario(
  'a duplicate refresh and a revocation during an outage do not revive the session',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { client, tokens } = await signedIn(h);
    const renewal = holdRenewal(h);
    const running = refresh(h, client, tokens.refresh_token);
    try {
      await renewal.entered;
      assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
      assert.equal((await revoke(h, client, tokens.refresh_token)).status, 200);
      h.yazio.state.refresh = 'offline';
    } finally {
      renewal.release();
    }
    assert.ok([400, 503].includes((await running).status));
    assert.deepEqual(await h.keys('rt:'), []);
    assert.deepEqual(await h.keys('sess:'), []);
    h.yazio.state.refresh = 'ok';
    h.yazio.state.beforeRefresh = undefined;
    assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
  }
);

scenario(
  'a renewal that finishes after a revocation does not store the session again',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { client, tokens } = await signedIn(h);
    const renewal = holdRenewal(h);
    const running = getUser(h, tokens.access_token);
    try {
      await renewal.entered;
      assert.equal((await revoke(h, client, tokens.refresh_token)).status, 200);
    } finally {
      renewal.release();
    }
    await running;
    assert.deepEqual(await h.keys('sess:'), []);
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  }
);

// --- what the store forgets by itself ---

scenario(
  'the record of a used refresh token lasts as long as the grant, not longer',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
    assert.equal((await h.keys('rt-used:')).length, 1);
    h.tick(29 * DAY);
    assert.equal((await h.keys('rt-used:')).length, 1);
    h.tick(DAY + 2 * MINUTE);
    assert.deepEqual(await h.keys('rt-used:'), []);
  },
  { skip: STORE_CLOCK }
);

scenario(
  'a session whose code is never exchanged is dropped after a grace period',
  async (h) => {
    await connect(h); // signed in, the code is never exchanged
    assert.equal((await h.keys('sess:')).length, 1);
    h.tick(14 * MINUTE);
    assert.equal((await h.keys('sess:')).length, 1, 'still within the grace period');
    h.tick(2 * MINUTE);
    assert.deepEqual(await h.keys('sess:'), []);
  },
  { skip: STORE_CLOCK }
);

scenario(
  'a session with tokens lasts as long as its refresh token, then it is dropped',
  async (h) => {
    await signedIn(h);
    h.tick(29 * DAY);
    assert.equal((await h.keys('sess:')).length, 1);
    h.tick(DAY + 2 * 60 * MINUTE);
    assert.deepEqual(await h.keys('sess:'), []);
    assert.deepEqual(await h.keys('rt:'), []);
    assert.deepEqual(await h.keys('at:'), []);
  },
  { skip: STORE_CLOCK }
);
