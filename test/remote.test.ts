import assert from 'node:assert/strict';
import {
  ORIGIN,
  PASSWORD,
  REDIRECT,
  RESOURCE,
  SCOPE,
  USERNAME,
  authorizeQuery,
  connect,
  getUser,
  pendingIdIn,
  pkce,
  refresh,
  register,
  revoke,
  rpc,
  scenario,
  signedIn,
} from './harness.js';

// --- discovery ---

scenario('publishes protected resource and authorization server metadata', async (h) => {
  const resource = await (await h.call('GET', '/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(resource.resource, RESOURCE);
  assert.deepEqual(resource.authorization_servers, [`${ORIGIN}/`]);
  assert.deepEqual(resource.scopes_supported, [SCOPE]);

  const as = await (await h.call('GET', '/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, `${ORIGIN}/`);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/authorize`);
  assert.equal(as.token_endpoint, `${ORIGIN}/token`);
  assert.equal(as.registration_endpoint, `${ORIGIN}/register`);
  assert.equal(as.revocation_endpoint, `${ORIGIN}/revoke`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.response_types_supported, ['code']);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
});

scenario(
  'the MCP endpoint refuses a request without a token and points to the metadata',
  async (h) => {
    const { response } = await rpc(h, undefined, 'tools/list');
    assert.equal(response.status, 401);
    assert.match(
      response.headers.get('www-authenticate') ?? '',
      /resource_metadata="https:\/\/mcp\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/
    );
    const made = await rpc(h, 'not-a-token', 'tools/list');
    assert.equal(made.response.status, 401);
  }
);

// --- the whole flow ---

scenario(
  'a connector registers, signs in, and reaches the Yazio account of the user',
  async (h) => {
    const { location, tokens } = await signedIn(h);
    assert.equal(location.origin + location.pathname, REDIRECT);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.equal(location.searchParams.get('iss'), `${ORIGIN}/`);
    assert.equal(tokens.scope, SCOPE);
    assert.equal(tokens.token_type.toLowerCase(), 'bearer');
    assert.equal(tokens.expires_in, 3600);

    const list = await rpc(h, tokens.access_token, 'tools/list');
    assert.equal(list.response.status, 200);
    // The tools of yazio-mcp, whatever their number: a few that must be there
    const names = list.data.result.tools.map((tool: { name: string }) => tool.name);
    for (const name of ['get_user', 'search_products', 'add_user_consumed_item']) {
      assert.ok(names.includes(name), name);
    }

    const call = await getUser(h, tokens.access_token);
    assert.equal(call.response.status, 200);
    assert.ok(!call.data.result.isError);
    // The tool ran against Yazio with the token from the sign-in, not a fresh login
    const userCall = h.yazio.state.calls.filter((c) => c.url.includes('/user')).at(-1);
    assert.equal(userCall?.authorization, 'Bearer yazio-access-1');
    assert.equal(h.yazio.state.calls.filter((c) => c.grant === 'password').length, 1);
  }
);

scenario('the store holds no password, no usable token and no readable Yazio token', async (h) => {
  const { tokens, client, code } = await signedIn(h);
  await getUser(h, tokens.access_token);
  const stored = await h.dump();
  assert.ok(!stored.includes(PASSWORD));
  assert.ok(!stored.includes(tokens.access_token));
  assert.ok(!stored.includes(tokens.refresh_token));
  assert.ok(!stored.includes(code));
  assert.ok(!stored.includes(client.client_secret));
  // The Yazio token is there, but encrypted
  assert.equal((await h.keys('sess:')).length, 1);
  assert.ok(!stored.includes('yazio-access-1'));
  assert.ok(!stored.includes('yazio-refresh-1'));
  // Nothing says who the user is, and no address of a client is kept
  assert.ok(!stored.includes(USERNAME));
  assert.ok(!stored.includes('203.0.113.7'));
  // What it does hold: the registration
  assert.ok(stored.includes(client.client_id));
});

// --- sign-in ---

scenario('a wrong password shows the form again and issues no code', async (h) => {
  const { login } = await connect(h, 'wrong-password');
  assert.equal(login.status, 401);
  assert.equal(login.headers.get('location'), null);
  const page = await login.text();
  assert.match(page, /Yazio rejected those credentials/);
  assert.ok(!page.includes('wrong-password'));
  assert.deepEqual(await h.keys('sess:'), []);
  assert.deepEqual(await h.keys('code:'), []);
});

scenario('a sign-in that failed can be tried again on the same form', async (h) => {
  const { client } = await register(h);
  const { verifier, challenge } = pkce();
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, challenge)}`)
  ).text();
  const pending = pendingIdIn(page);
  const wrong = await h.call('POST', '/login', {
    form: { pending, username: USERNAME, password: 'wrong-password' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(pendingIdIn(await wrong.text()), pending);
  const right = await h.call('POST', '/login', {
    form: { pending, username: USERNAME, password: PASSWORD },
  });
  assert.equal(right.status, 302);
  const code = new URL(right.headers.get('location')!).searchParams.get('code')!;
  const exchange = await h.call('POST', '/token', {
    form: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      client_secret: client.client_secret,
    },
  });
  assert.equal(exchange.status, 200);
  // The form is used up by the sign-in that worked
  const again = await h.call('POST', '/login', {
    form: { pending, username: USERNAME, password: PASSWORD },
  });
  assert.equal(again.status, 400);
});

scenario(
  'credentials that are missing or too long are refused before Yazio is asked',
  async (h) => {
    const { client } = await register(h);
    const page = await (
      await h.call('GET', `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`)
    ).text();
    const pending = pendingIdIn(page);
    const empty = await h.call('POST', '/login', { form: { pending, username: '', password: '' } });
    assert.equal(empty.status, 401);
    const long = await h.call('POST', '/login', {
      form: { pending, username: USERNAME, password: 'x'.repeat(513) },
    });
    assert.equal(long.status, 401);
    assert.equal(h.yazio.state.calls.length, 0);
  }
);

scenario(
  'the sign-in page escapes the client name, names the return address and cannot be framed',
  async (h) => {
    const { client } = await register(h, { client_name: '<script>alert(1)</script>' });
    const response = await h.call(
      'GET',
      `/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`
    );
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.ok(!page.includes('<script>alert(1)</script>'));
    assert.ok(page.includes('&lt;script&gt;'));
    assert.ok(page.includes('client.example'));
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
);

scenario('sign-in attempts are rate limited per address', async (h) => {
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await h.call('POST', '/login', { form: { pending: 'x' } })).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses.at(-1), 429);
  // Another address is unaffected
  const other = await h.call('POST', '/login', { form: { pending: 'x' }, ip: '198.51.100.1' });
  assert.equal(other.status, 400);
});

// --- authorization request validation ---

scenario('an unregistered redirect_uri is answered directly, never redirected to', async (h) => {
  const { client } = await register(h);
  const query = authorizeQuery(client.client_id, pkce().challenge, {
    redirect_uri: 'https://evil.example/cb',
  });
  const response = await h.call('GET', `/authorize?${query}`);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);

  const unknown = await h.call(
    'GET',
    `/authorize?${authorizeQuery('no-such-client', pkce().challenge)}`
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get('location'), null);
});

scenario(
  'errors after the redirect URI is known go back to the client with state and issuer',
  async (h) => {
    const { client } = await register(h);
    const cases: [Record<string, string>, string][] = [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: 'too-short' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ];
    for (const [extra, error] of cases) {
      const response = await h.call(
        'GET',
        `/authorize?${authorizeQuery(client.client_id, pkce().challenge, extra)}`
      );
      assert.equal(response.status, 302, JSON.stringify(extra));
      const location = new URL(response.headers.get('location')!);
      assert.equal(location.origin + location.pathname, REDIRECT);
      assert.equal(location.searchParams.get('error'), error);
      assert.equal(location.searchParams.get('state'), 'state-123');
      assert.equal(location.searchParams.get('iss'), `${ORIGIN}/`);
      assert.equal(location.searchParams.get('code'), null);
    }
  }
);

scenario('a request without PKCE is refused', async (h) => {
  const { client } = await register(h);
  const query = new URLSearchParams(authorizeQuery(client.client_id, 'x'));
  query.delete('code_challenge');
  query.delete('code_challenge_method');
  const response = await h.call('GET', `/authorize?${query}`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.searchParams.get('error'), 'invalid_request');
  assert.deepEqual(await h.keys('pending:'), []);
});

scenario('a repeated parameter is refused', async (h) => {
  const { client } = await register(h);
  const query = authorizeQuery(client.client_id, pkce().challenge);
  const twice = await h.call('GET', `/authorize?${query}&client_id=${client.client_id}`);
  assert.equal(twice.status, 400);
  // After the redirect URI is known, no sign-in page shows either
  const state = await h.call('GET', `/authorize?${query}&state=other`);
  assert.notEqual(state.status, 200);
  assert.deepEqual(await h.keys('pending:'), []);

  const flow = await connect(h);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: flow.code,
    code_verifier: flow.verifier,
    redirect_uri: REDIRECT,
    client_id: flow.client.client_id,
    client_secret: flow.client.client_secret,
  });
  const repeated = await h.call('POST', '/token', { rawForm: `${form}&code=${flow.code}` });
  assert.equal(repeated.status, 400);
  assert.equal((await repeated.json()).error, 'invalid_request');
});

// --- code exchange ---

scenario('a wrong code_verifier fails, and burns the code for the right one too', async (h) => {
  const flow = await connect(h);
  const wrong = await flow.exchange({ code_verifier: pkce().verifier });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'invalid_grant');
  assert.equal((await flow.exchange()).status, 400);
});

scenario('a replayed code is refused and revokes the tokens it issued', async (h) => {
  const flow = await connect(h);
  const first = (await (await flow.exchange()).json()) as { access_token: string };
  assert.equal((await rpc(h, first.access_token, 'tools/list')).response.status, 200);
  const replay = await flow.exchange();
  assert.equal(replay.status, 400);
  assert.equal((await rpc(h, first.access_token, 'tools/list')).response.status, 401);
});

scenario(
  'the code exchange must repeat the redirect_uri, come from the same client and be on time',
  async (h) => {
    const mismatch = await connect(h);
    const moved = await mismatch.exchange({ redirect_uri: 'https://client.example/other' });
    assert.equal(moved.status, 400);
    assert.equal((await moved.json()).error, 'invalid_grant');

    const missing = await connect(h);
    const form = {
      grant_type: 'authorization_code',
      code: missing.code,
      code_verifier: missing.verifier,
      client_id: missing.client.client_id,
      client_secret: missing.client.client_secret,
    };
    assert.equal((await h.call('POST', '/token', { form })).status, 400);

    const other = await connect(h);
    const { client: stranger } = await register(h);
    const stolen = await other.exchange({
      client_id: stranger.client_id,
      client_secret: stranger.client_secret,
    });
    assert.equal(stolen.status, 400);
    assert.equal((await stolen.json()).error, 'invalid_grant');

    const late = await connect(h);
    h.tick(61_000);
    assert.equal((await late.exchange()).status, 400);
  }
);

scenario('a code is good only for the server address it was made for', async (h) => {
  const flow = await connect(h);
  const foreign = await flow.exchange({ resource: 'https://other.example/mcp' });
  assert.equal(foreign.status, 400);
  assert.equal((await foreign.json()).error, 'invalid_target');
});

// --- client authentication ---

scenario(
  'confidential clients must authenticate; post and Basic both work; public clients need no secret',
  async (h) => {
    const flow = await connect(h);
    const wrong = await flow.exchange({ client_secret: 'not-the-secret' });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, 'invalid_client');
    const none = await flow.exchange({ client_secret: '' });
    assert.equal((await none.json()).error, 'invalid_client');
    // A failed authentication does not use up the code
    assert.equal((await flow.exchange()).status, 200);

    const basic = await connect(h);
    const credentials = Buffer.from(
      `${basic.client.client_id}:${basic.client.client_secret}`
    ).toString('base64');
    const viaBasic = await h.call('POST', '/token', {
      headers: { Authorization: `Basic ${credentials}` },
      form: {
        grant_type: 'authorization_code',
        code: basic.code,
        code_verifier: basic.verifier,
        redirect_uri: REDIRECT,
      },
    });
    assert.equal(viaBasic.status, 200);

    const bad = Buffer.from(`${basic.client.client_id}:nope`).toString('base64');
    const badBasic = await h.call('POST', '/token', {
      headers: { Authorization: `Basic ${bad}` },
      form: { grant_type: 'refresh_token', refresh_token: 'x' },
    });
    assert.equal(badBasic.status, 401);
    assert.match(badBasic.headers.get('www-authenticate') ?? '', /^Basic realm="yazio-mcp"/);
    assert.equal((await badBasic.json()).error, 'invalid_client');

    // Two methods at once, or two client ids that differ, are refused
    const both = await h.call('POST', '/token', {
      headers: { Authorization: `Basic ${credentials}` },
      form: {
        grant_type: 'refresh_token',
        refresh_token: 'x',
        client_secret: basic.client.client_secret,
      },
    });
    assert.equal((await both.json()).error, 'invalid_request');
    const conflict = await h.call('POST', '/token', {
      headers: { Authorization: `Basic ${credentials}` },
      form: { grant_type: 'refresh_token', refresh_token: 'x', client_id: 'someone-else' },
    });
    assert.equal((await conflict.json()).error, 'invalid_request');

    const { client: publicClient } = await register(h, { token_endpoint_auth_method: 'none' });
    assert.equal(publicClient.client_secret, undefined);
  }
);

scenario('a public client signs in with PKCE and no secret', async (h) => {
  const { client } = await register(h, { token_endpoint_auth_method: 'none' });
  const { verifier, challenge } = pkce();
  const page = await (
    await h.call('GET', `/authorize?${authorizeQuery(client.client_id, challenge)}`)
  ).text();
  const login = await h.call('POST', '/login', {
    form: { pending: pendingIdIn(page), username: USERNAME, password: PASSWORD },
  });
  const code = new URL(login.headers.get('location')!).searchParams.get('code')!;
  const form = {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
  };
  const response = await h.call('POST', '/token', { form });
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
});

scenario('Basic credentials are form-decoded, as RFC 6749 says', async (h) => {
  const flow = await connect(h);
  // "+" stands for a space and "%2B" for a plus: a server that does not decode refuses these
  const encode = (value: string) =>
    [...value].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const credentials = Buffer.from(
    `${encode(flow.client.client_id)}:${encode(flow.client.client_secret)}`
  ).toString('base64');
  const response = await h.call('POST', '/token', {
    headers: { Authorization: `Basic ${credentials}` },
    form: {
      grant_type: 'authorization_code',
      code: flow.code,
      code_verifier: flow.verifier,
      redirect_uri: REDIRECT,
    },
  });
  assert.equal(response.status, 200);
});

scenario(
  'registration refuses unsafe redirect URIs and issues secrets that never expire',
  async (h) => {
    const unsafe = [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
      'blob:https://a.example/x',
      'about:blank',
      'http://evil.example/cb',
      'https://client.example/cb#fragment',
      '/relative',
    ];
    for (const uri of unsafe) {
      const { response } = await register(h, { redirect_uris: [uri] });
      assert.equal(response.status, 400, uri);
    }
    assert.equal((await register(h, { redirect_uris: [] })).response.status, 400);
    // Loopback http and an app's own scheme are legitimate (RFC 8252)
    for (const uri of [
      'http://localhost:33418/callback',
      'http://127.0.0.1:33418/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
    ]) {
      assert.equal((await register(h, { redirect_uris: [uri] })).response.status, 201, uri);
    }
    const refused: Record<string, unknown>[] = [
      { token_endpoint_auth_method: 'private_key_jwt' },
      { grant_types: ['authorization_code', 'implicit'] },
      { grant_types: ['client_credentials'] },
      { response_types: ['token'] },
    ];
    for (const metadata of refused) {
      const { response } = await register(h, metadata);
      assert.equal(response.status, 400, JSON.stringify(metadata));
    }
    const { client } = await register(h);
    assert.equal(client.client_secret_expires_at, 0);
    assert.ok(client.client_secret.length >= 32);
    // Without a method the client gets the default of RFC 7591, which needs a secret
    const { client: plain } = await register(h, { token_endpoint_auth_method: undefined });
    assert.equal(plain.token_endpoint_auth_method, 'client_secret_basic');
    assert.ok(plain.client_secret);

    const text = await h.call('POST', '/register', {
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(text.status, 400);
  }
);

// --- refresh and revocation ---

scenario(
  'a refresh rotates the refresh token and may narrow but never widen the scope',
  async (h) => {
    const { client, tokens } = await signedIn(h);
    const next = await refresh(h, client, tokens.refresh_token);
    assert.equal(next.status, 200);
    const rotated = (await next.json()) as { access_token: string; refresh_token: string };
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.notEqual(rotated.access_token, tokens.access_token);
    assert.equal((await rpc(h, rotated.access_token, 'tools/list')).response.status, 200);

    const wider = await refresh(h, client, rotated.refresh_token, { scope: `${SCOPE} admin` });
    assert.equal(wider.status, 400);
    assert.equal((await wider.json()).error, 'invalid_scope');
    // The refused request did not use up the token
    const same = await refresh(h, client, rotated.refresh_token, { scope: SCOPE });
    assert.equal(same.status, 200);
  }
);

scenario('an access token expires after an hour; the refresh token still works', async (h) => {
  const { client, tokens } = await signedIn(h);
  h.tick(60 * 60 * 1000 - 5000);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
  h.tick(6000);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

scenario('a refresh token expires after 30 days', async (h) => {
  const { client, tokens } = await signedIn(h);
  h.tick(30 * 24 * 60 * 60 * 1000 + 1000);
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
});

scenario('revoking the refresh token signs the session out', async (h) => {
  const { client, tokens } = await signedIn(h);
  const revoked = await revoke(h, client, tokens.refresh_token);
  assert.equal(revoked.status, 200);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 400);
  assert.deepEqual(await h.keys('sess:'), []);
});

scenario('revoking an access token ends that token only', async (h) => {
  const { client, tokens } = await signedIn(h);
  assert.equal((await revoke(h, client, tokens.access_token)).status, 200);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

scenario('revocation needs the client that owns the token', async (h) => {
  const { client, tokens } = await signedIn(h);
  const { client: stranger } = await register(h);
  // RFC 7009: a token that is not this client's is answered like an unknown one
  assert.equal((await revoke(h, stranger, tokens.refresh_token)).status, 200);
  assert.equal((await revoke(h, stranger, tokens.access_token)).status, 200);
  assert.equal((await revoke(h, stranger, 'no-such-token')).status, 200);
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
  const wrong = await revoke(h, { ...client, client_secret: 'nope' }, tokens.refresh_token);
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'invalid_client');
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

// --- sessions across restarts and Yazio failures ---

scenario('a restart keeps the user signed in', async (h) => {
  const { client, tokens } = await signedIn(h);
  await h.restart();
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
  assert.equal(h.yazio.state.calls.filter((c) => c.grant === 'password').length, 1);
});

scenario(
  'a Yazio refresh token that Yazio refuses ends the session with invalid_token',
  async (h) => {
    h.yazio.state.expiresIn = 0; // every Yazio token is already due for renewal
    const { client, tokens } = await signedIn(h);
    h.yazio.state.refresh = 'refuse';
    const { response } = await rpc(h, tokens.access_token, 'tools/list');
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /invalid_token/);
    // And it stays ended when Yazio recovers
    h.yazio.state.refresh = 'ok';
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 401);
    const again = await refresh(h, client, tokens.refresh_token);
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'invalid_grant');
  }
);

scenario('Yazio being unreachable answers 503 and keeps the session', async (h) => {
  h.yazio.state.expiresIn = 0;
  const { tokens } = await signedIn(h);
  h.yazio.state.refresh = 'offline';
  const down = await rpc(h, tokens.access_token, 'tools/list');
  assert.equal(down.response.status, 503);
  assert.equal(down.response.headers.get('retry-after'), '30');
  h.yazio.state.refresh = 'ok';
  assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
});

scenario(
  'a rotated Yazio refresh token is stored, so a restart after renewal still works',
  async (h) => {
    h.yazio.state.expiresIn = 0;
    const { tokens } = await signedIn(h);
    // Renews: yazio-refresh-2 replaces yazio-refresh-1
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
    await h.restart();
    h.yazio.state.calls.length = 0;
    h.yazio.state.refresh = 'ok';
    assert.equal((await rpc(h, tokens.access_token, 'tools/list')).response.status, 200);
    const used = h.yazio.state.calls.filter((c) => c.grant === 'refresh_token');
    assert.equal(used.length, 1, 'the restored session renewed its token');
    assert.equal(h.yazio.state.calls.filter((c) => c.grant === 'password').length, 0);
  }
);

// --- odds and ends ---

scenario('the wrong path is told where the endpoint is', async (h) => {
  const response = await h.call('POST', '/', { json: {} });
  assert.equal(response.status, 405);
  const wrong = await h.call('POST', '/sse', { json: {} });
  assert.equal(wrong.status, 404);
  assert.match((await wrong.json()).error.message, /https:\/\/mcp\.example\.com\/mcp/);
  const home = await h.call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /https:\/\/mcp\.example\.com\/mcp/);
});
