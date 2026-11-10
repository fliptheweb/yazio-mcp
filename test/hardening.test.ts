// Concurrency, replay, logging and resource limits: the cases a one-request-at-a-time
// suite cannot see. Each test asserts the safe behaviour.
import assert from 'node:assert/strict';
import { hashToken, yazioSignIn } from '../src/remote/oauth.js';
import {
  PASSWORD,
  USERNAME,
  authorizeQuery,
  captureErrors,
  connect,
  gate,
  getUser,
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

/** Registers a client and signs in on an app whose Yazio is not the usual fake */
async function tryLogin(h: Harness) {
  const { client } = await register(h);
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`)
  ).text();
  return h.call('POST', '/login', {
    form: { pending: pendingIdIn(page), username: USERNAME, password: PASSWORD },
  });
}

// --- refresh tokens ---

scenario(
  'two refreshes of one token at once: one succeeds, the other is refused, the session survives',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const results = await Promise.all([
      refresh(h, client, tokens.refresh_token),
      refresh(h, client, tokens.refresh_token),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    // A duplicate in flight is not theft: the winner's tokens keep working
    const winner = (await results.find((r) => r.status === 200)!.json()) as {
      access_token: string;
    };
    assert.equal((await rpc(h, winner.access_token, 'tools/list')).response.status, 200);
  }
);

scenario('reusing a refresh token after it was rotated revokes the session', async (h) => {
  const { client, tokens } = await signedIn(h);
  const rotated = (await (await refresh(h, client, tokens.refresh_token)).json()) as {
    access_token: string;
    refresh_token: string;
  };
  const reuse = await refresh(h, client, tokens.refresh_token);
  assert.equal(reuse.status, 400);
  assert.equal((await reuse.json()).error, 'invalid_grant');
  assert.equal((await rpc(h, rotated.access_token, 'tools/list')).response.status, 401);
  assert.equal((await refresh(h, client, rotated.refresh_token)).status, 400);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario(
  'a rotated refresh token that another client presents does not revoke the session',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const rotated = (await (await refresh(h, client, tokens.refresh_token)).json()) as {
      access_token: string;
    };
    const { client: stranger } = await register(h);
    assert.equal((await refresh(h, stranger, tokens.refresh_token)).status, 400);
    assert.equal((await rpc(h, rotated.access_token, 'tools/list')).response.status, 200);
  }
);

scenario(
  'a refresh during a Yazio outage answers 503 and leaves the refresh token usable',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { client, tokens } = await signedIn(h);
    h.yazio.state.refresh = 'offline';
    const down = await refresh(h, client, tokens.refresh_token);
    assert.equal(down.status, 503);
    assert.equal(down.headers.get('retry-after'), '30');
    assert.equal((await down.json()).error, 'temporarily_unavailable');
    h.yazio.state.refresh = 'ok';
    assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
  }
);

scenario(
  'an ordinary refresh after the access token expired keeps the stored session',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    h.tick(3_601_000);
    const next = (await (await refresh(h, client, tokens.refresh_token)).json()) as {
      access_token: string;
    };
    assert.ok(next.access_token);
    await h.restart();
    assert.equal((await getUser(h, next.access_token)).response.status, 200);
  }
);

scenario(
  'a session that has not exchanged its code yet survives another user who signs in',
  async (h) => {
    const waiting = await connect(h); // signed in, code not yet exchanged
    h.tick(30_000); // still within the code's minute
    await signedIn(h); // meanwhile the tokens of someone else are written
    const tokens = (await (await waiting.exchange()).json()) as { access_token: string };
    await h.restart();
    assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
  }
);

scenario(
  'an empty scope is refused on refresh, and a token without the scope cannot call tools',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const empty = await refresh(h, client, tokens.refresh_token, { scope: '' });
    assert.equal((await empty.json()).error, 'invalid_scope');

    // Plant a token without the scope for the same, live session
    const stored = await h.store.get(`at:${hashToken(tokens.access_token)}`);
    const grant = JSON.parse(stored!) as { scopes: string[] };
    assert.deepEqual(grant.scopes, ['mcp']);
    await h.store.set(
      `at:${hashToken('scopeless-access')}`,
      JSON.stringify({ ...grant, scopes: [] }),
      { ttlMs: 600_000 }
    );
    const ok = await rpc(h, tokens.access_token, 'tools/list');
    assert.equal(ok.response.status, 200, 'the session itself is fine');
    const scopeless = await rpc(h, 'scopeless-access', 'tools/list');
    assert.equal(scopeless.response.status, 403);
    assert.match(scopeless.response.headers.get('www-authenticate') ?? '', /insufficient_scope/);
  }
);

scenario('a token for another server address is refused', async (h) => {
  const { tokens } = await signedIn(h);
  const stored = await h.store.get(`at:${hashToken(tokens.access_token)}`);
  await h.store.set(
    `at:${hashToken('foreign-access')}`,
    JSON.stringify({ ...JSON.parse(stored!), resource: 'https://other.example/mcp' }),
    { ttlMs: 600_000 }
  );
  assert.equal((await rpc(h, 'foreign-access', 'tools/list')).response.status, 401);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
});

// --- authorization codes and sign-in ---

scenario('a code replayed after it expired still revokes what it issued', async (h) => {
  const flow = await signedIn(h);
  h.tick(61_000);
  assert.equal((await flow.exchange()).status, 400);
  assert.equal((await rpc(h, flow.tokens.access_token, 'tools/list')).response.status, 401);
});

scenario('two parallel exchanges of one code: one wins, and the replay revokes it', async (h) => {
  const flow = await connect(h);
  const results = await Promise.all([flow.exchange(), flow.exchange()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  const winner = (await results.find((r) => r.status === 200)!.json()) as {
    access_token: string;
  };
  assert.equal((await rpc(h, winner.access_token, 'tools/list')).response.status, 401);
});

scenario('two submissions of one sign-in form issue one code', async (h) => {
  const { client } = await register(h);
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`)
  ).text();
  const form = { pending: pendingIdIn(page), username: USERNAME, password: PASSWORD };
  const results = await Promise.all([
    h.call('POST', '/login', { form }),
    h.call('POST', '/login', { form }),
  ]);
  assert.equal(results.filter((r) => r.status === 302).length, 1);
  assert.equal((await h.keys('code:')).length, 1);
  assert.equal((await h.keys('sess:')).length, 1);
});

// A token endpoint that answers 200 with a body that echoes the password and is not JSON
const echo = (async () => new Response(PASSWORD)) as typeof fetch;

scenario(
  'a malformed Yazio token response cannot put the password in the log',
  async (h) => {
    const errors = captureErrors();
    try {
      const login = await tryLogin(h);
      assert.equal(login.status, 401);
      assert.ok(errors.lines.length > 0, 'the failure was logged');
      const logged = [...errors.lines, ...h.logs].join('\n');
      assert.ok(!logged.includes(PASSWORD), logged);
      assert.ok(!logged.includes(USERNAME), logged);
      assert.ok(!(await login.text()).includes(PASSWORD));
    } finally {
      errors.restore();
    }
  },
  { config: { signIn: yazioSignIn({}, echo), fetch: echo } }
);

scenario(
  'a sign-in failure is logged by kind only, even when its message holds the password',
  async (h) => {
    const errors = captureErrors();
    try {
      const login = await tryLogin(h);
      assert.equal(login.status, 401);
      assert.ok(
        errors.lines.some((line) => line.includes('TypeError')),
        errors.lines.join('\n')
      );
      const logged = [...errors.lines, ...h.logs].join('\n');
      assert.ok(!logged.includes(PASSWORD), logged);
      assert.ok(!(await login.text()).includes(PASSWORD));
    } finally {
      errors.restore();
    }
  },
  {
    config: {
      signIn: async (_username, password) => {
        throw new TypeError(`upstream said: ${password}`);
      },
    },
  }
);

scenario('the request log holds the method, the path and the status only', async (h) => {
  const { tokens, client } = await signedIn(h);
  await getUser(h, tokens.access_token);
  await refresh(h, client, tokens.refresh_token);
  assert.ok(h.logs.length >= 6);
  for (const line of h.logs) {
    assert.match(line, /^[A-Z]+ \/[\w./-]* -> \d{3} \(\d+ms\)( auth)?$/, line);
  }
  const logged = h.logs.join('\n');
  // The query of /authorize holds the state and the challenge; the log must not
  assert.ok(logged.includes('GET /authorize -> 200'));
  assert.ok(!logged.includes('state-123'));
  assert.ok(!logged.includes(tokens.access_token));
  assert.ok(!logged.includes(client.client_id));
  assert.ok(!logged.includes('203.0.113.7'));
  assert.ok(logged.includes('POST /mcp -> 200'));
});

// --- sessions that Yazio ends in the middle of a tool call ---

scenario('a session Yazio ends during a tool call answers 401 at once', async (h) => {
  const { client, tokens } = await signedIn(h);
  h.yazio.state.userUnauthorized = true;
  h.yazio.state.refresh = 'refuse';
  const result = await getUser(h, tokens.access_token);
  assert.equal(result.response.status, 401, JSON.stringify(result.data));
  assert.match(result.response.headers.get('www-authenticate') ?? '', /invalid_token/);
  assert.deepEqual(await h.keys('sess:'), []);
  h.yazio.state.userUnauthorized = false;
  h.yazio.state.refresh = 'ok';
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
});

scenario('Yazio unreachable during a tool call answers 503 and keeps the session', async (h) => {
  const { tokens } = await signedIn(h);
  h.yazio.state.userUnauthorized = true;
  h.yazio.state.refresh = 'offline';
  const result = await getUser(h, tokens.access_token);
  assert.equal(result.response.status, 503, JSON.stringify(result.data));
  assert.equal(result.response.headers.get('retry-after'), '30');
  h.yazio.state.userUnauthorized = false;
  h.yazio.state.refresh = 'ok';
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
});

scenario(
  'a second 401 from Yazio after a good renewal is an error of the tool, not the end of the session',
  async (h) => {
    const { tokens } = await signedIn(h);
    h.yazio.state.userUnauthorized = true; // Yazio renews the token and still answers 401
    const result = await getUser(h, tokens.access_token);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.result.isError, true);
    assert.equal((await h.keys('sess:')).length, 1);
    h.yazio.state.userUnauthorized = false;
    assert.ok(!(await getUser(h, tokens.access_token)).data.result.isError);
  }
);

scenario('revoking during a refresh in flight cannot bring the session back', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { client, tokens } = await signedIn(h);
  const entered = gate();
  const release = gate();
  h.yazio.state.beforeRefresh = async () => {
    entered.open();
    await release.opened;
  };
  const refreshing = refresh(h, client, tokens.refresh_token);
  await entered.opened;
  const revoked = await revoke(h, client, tokens.refresh_token);
  assert.equal(revoked.status, 200);
  release.open();
  const outcome = await refreshing;
  h.yazio.state.beforeRefresh = undefined;
  h.yazio.state.expiresIn = 3600;
  if (outcome.status === 200) {
    const replacement = (await outcome.json()) as { access_token: string };
    await h.restart();
    assert.equal((await rpc(h, replacement.access_token, 'tools/list')).response.status, 401);
  } else {
    assert.equal(outcome.status, 400);
  }
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  // The renewal that finished after the revocation did not write the Yazio token back
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario('simultaneous Yazio renewals in one session share one request to Yazio', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { tokens } = await signedIn(h);
  h.yazio.state.expiresIn = 3600;
  const before = h.yazio.state.issued;
  const results = await Promise.all(
    Array.from({ length: 5 }, () => rpc(h, tokens.access_token, 'tools/list'))
  );
  assert.ok(results.every((r) => r.response.status === 200));
  assert.equal(h.yazio.state.issued - before, 1);
});

scenario('a refresh token is bound to the client it was issued to', async (h) => {
  const { client, tokens } = await signedIn(h);
  const { client: other } = await register(h);
  const response = await refresh(h, other, tokens.refresh_token);
  assert.equal((await response.json()).error, 'invalid_grant');
  // And the attempt of the stranger did not use it up
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

// --- registration growth ---

scenario('registration refuses oversized metadata', async (h) => {
  await register(h); // a normal one, so the store holds something
  // A body over 64 KiB is not read to its end
  const huge = await register(h, { client_name: 'a'.repeat(900_000) });
  assert.equal(huge.response.status, 413);
  assert.equal((huge.client as unknown as { error: string }).error, 'invalid_request');
  // Each limit on its own, so one cannot hide the absence of another
  const name = await register(h, { client_name: 'a'.repeat(101) });
  assert.equal(name.response.status, 400, 'name length');
  const many = Array.from({ length: 11 }, (_, i) => `https://c.example/${i}`);
  assert.equal((await register(h, { redirect_uris: many })).response.status, 400, 'count');
  const size = await register(h, { client_uri: `https://c.example/${'a'.repeat(5000)}` });
  assert.equal(size.response.status, 400, 'total size');
  assert.ok((await h.dump()).length < 10_000);
});

scenario('a registration that never signed anyone in is gone after a day', async (h) => {
  const { client: idle } = await register(h);
  const query = authorizeQuery(idle.client_id, pkce().challenge);
  h.tick(25 * 60 * 60 * 1000);
  assert.equal((await h.call('GET', `/authorize?${query}`)).status, 400);
});

scenario('a registration that signed someone in stays for a year', async (h) => {
  const { client, tokens } = await signedIn(h);
  h.tick(29 * 24 * 60 * 60 * 1000);
  const next = await refresh(h, client, tokens.refresh_token);
  assert.equal(next.status, 200);
  h.tick(300 * 24 * 60 * 60 * 1000);
  const query = authorizeQuery(client.client_id, pkce().challenge);
  assert.equal((await h.call('GET', `/authorize?${query}`)).status, 200);
});

scenario('the number of registrations in a day is capped for the whole server', async (h) => {
  // The limit per address is 20 an hour, so each one comes from its own address
  await h.store.set(`count:register:${Math.floor(h.now() / 86_400_000)}`, '999', {
    ttlMs: 86_400_000,
  });
  assert.equal((await register(h)).response.status, 201);
  const full = await h.call('POST', '/register', {
    json: { redirect_uris: ['https://client.example/callback'] },
    ip: '198.51.100.9',
  });
  assert.equal(full.status, 503);
  assert.equal((await full.json()).error, 'temporarily_unavailable');
});

// --- the sign-in page ---

scenario('the sign-in form may only post to this server and return to the client', async (h) => {
  const { client } = await register(h);
  const page = await h.call(
    'GET',
    `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`
  );
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /form-action 'self' https:\/\/client\.example(;|$)/);
  assert.match(page.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
});
