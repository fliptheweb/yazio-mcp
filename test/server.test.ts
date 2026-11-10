// How the server meets its host: the Node adapter, the Vercel entry, the proxy
// headers, the public address, the rate limits and a storage that fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect as netConnect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteApp } from '../src/remote/app.js';
import { hashToken } from '../src/remote/oauth.js';
import { serve, type FetchHandler, type ServeOptions } from '../src/remote/serve.js';
import type { Store } from '../src/remote/store.js';
import {
  ORIGIN,
  RESOURCE,
  SECRET,
  captureErrors,
  getUser,
  refresh,
  rpc,
  scenario,
  signedIn,
  type Harness,
} from './harness.js';

const MIB = 1024 * 1024;

// --- the Node adapter ---

interface Seen {
  url: string;
  method: string;
  host: string | null;
  address?: string;
  bytes: number;
}

/** An app that reports what it was given */
function echoApp() {
  const seen: Seen[] = [];
  const app: FetchHandler = {
    async fetch(request, info) {
      const body = request.body ? await request.arrayBuffer() : new ArrayBuffer(0);
      const item: Seen = {
        url: request.url,
        method: request.method,
        host: request.headers.get('host'),
        address: info?.clientAddress,
        bytes: body.byteLength,
      };
      seen.push(item);
      return new Response(JSON.stringify(item), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Echo': 'yes' },
      });
    },
  };
  return { app, seen };
}

async function listening(app: FetchHandler, options: ServeOptions = {}) {
  const server = serve(app, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  /** The connection broke before an answer came */
  failed?: string;
}

/** One request with `node:http`, which sends the path and the Host header as given */
function send(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    /** Sent in pieces, without a Content-Length */
    chunks?: Buffer[];
  } = {}
): Promise<Answer> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(parts).toString('utf8'),
          })
        );
      }
    );
    req.on('error', (error: NodeJS.ErrnoException) =>
      resolve({ status: 0, headers: {}, text: '', failed: error.code ?? error.name })
    );
    if (options.chunks) {
      for (const chunk of options.chunks) req.write(chunk);
      req.end();
    } else {
      req.end(options.body);
    }
  });
}

/** A request written by hand, for request lines that an HTTP client will not send */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (data += chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(data));
    socket.on('connect', () => socket.write(text));
  });
}

const statusLine = (response: string) => response.split('\r\n')[0];

test('adapter: the app sees the public address, whatever Host the client names', async () => {
  const { app, seen } = echoApp();
  const server = await listening(app, { publicUrl: new URL('https://mcp.example.com') });
  try {
    const answer = await send(server.port, {
      path: '/mcp?x=1',
      headers: { Host: 'attacker.example' },
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['x-echo'], 'yes');
    assert.equal(seen[0].url, 'https://mcp.example.com/mcp?x=1');
    assert.equal(seen[0].address, '127.0.0.1');
  } finally {
    await server.close();
  }
});

test('adapter: without a public address the app sees the host that the client named', async () => {
  const { app, seen } = echoApp();
  const server = await listening(app);
  try {
    const good = await send(server.port, { path: '/authorize?a=b' });
    assert.equal(good.status, 200);
    assert.equal(seen[0].url, `http://127.0.0.1:${server.port}/authorize?a=b`);
    for (const host of ['user@attacker.example', 'attacker.example/path', 'a?b', 'a#b']) {
      const bad = await send(server.port, { headers: { Host: host } });
      assert.equal(bad.status, 400, `Host "${host}"`);
    }
    for (const line of ['Host: \r\n', '']) {
      const response = await raw(server.port, `GET / HTTP/1.1\r\n${line}Connection: close\r\n\r\n`);
      assert.match(statusLine(response), /^HTTP\/1\.1 400 /, `host line "${line.trim()}"`);
    }
    assert.equal(seen.length, 1, 'a request with a bad Host reached the app');
  } finally {
    await server.close();
  }
});

for (const withPublicUrl of [true, false]) {
  test(`adapter: a request target cannot name another host (${withPublicUrl ? 'with' : 'without'} a public address)`, async () => {
    const { app, seen } = echoApp();
    const server = await listening(
      app,
      withPublicUrl ? { publicUrl: new URL('https://mcp.example.com') } : {}
    );
    try {
      for (const target of [
        '//attacker.example/mcp',
        'https://attacker.example/mcp',
        'http://attacker.example/mcp',
        '/\\attacker.example/mcp',
        '\\\\attacker.example/mcp',
        'attacker.example/mcp',
        '*',
      ]) {
        const response = await raw(
          server.port,
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`
        );
        assert.match(statusLine(response), /^HTTP\/1\.1 400 /, target);
      }
      assert.equal(seen.length, 0, 'a refused request reached the app');
      // The same server still answers a good request
      assert.equal((await send(server.port, { path: '/mcp' })).status, 200);
    } finally {
      await server.close();
    }
  });
}

test('adapter: a GET or HEAD with a body is refused', async () => {
  const { app, seen } = echoApp();
  const server = await listening(app);
  try {
    const host = `Host: 127.0.0.1:${server.port}\r\n`;
    const withLength = await raw(
      server.port,
      `GET /mcp HTTP/1.1\r\n${host}Content-Length: 5\r\nConnection: close\r\n\r\nhello`
    );
    assert.match(statusLine(withLength), /^HTTP\/1\.1 400 /);
    assert.match(withLength, /carry no body/);
    const chunked = await raw(
      server.port,
      `GET /mcp HTTP/1.1\r\n${host}Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n0\r\n\r\n`
    );
    assert.match(statusLine(chunked), /^HTTP\/1\.1 400 /);
    assert.match(chunked, /carry no body/);
    const head = await raw(
      server.port,
      `HEAD /mcp HTTP/1.1\r\n${host}Content-Length: 5\r\nConnection: close\r\n\r\nhello`
    );
    assert.match(statusLine(head), /^HTTP\/1\.1 400 /);
    assert.equal(seen.length, 0);
    // A length of zero is not a body
    const empty = await send(server.port, { path: '/mcp', headers: { 'Content-Length': '0' } });
    assert.equal(empty.status, 200);
    const plain = await send(server.port, { method: 'HEAD', path: '/mcp' });
    assert.equal(plain.status, 200);
    assert.equal(plain.text, '');
  } finally {
    await server.close();
  }
});

test('adapter: a body of more than 1 MiB is refused, by its declared and by its real size', async () => {
  const { app, seen } = echoApp();
  const server = await listening(app);
  try {
    const exact = await send(server.port, { method: 'POST', body: Buffer.alloc(MIB, 'a') });
    assert.equal(exact.status, 200);
    assert.equal(seen[0].bytes, MIB);

    // The declared size is enough to refuse: the body itself is not sent here
    const declared = await raw(
      server.port,
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Length: ${MIB + 1}\r\nConnection: close\r\n\r\n`
    );
    assert.match(statusLine(declared), /^HTTP\/1\.1 413 /);

    const chunks = Array.from({ length: 17 }, () => Buffer.alloc(64 * 1024, 'a'));
    const streamed = await send(server.port, { method: 'POST', chunks });
    assert.equal(streamed.status, 413, `the client got: ${streamed.failed ?? streamed.status}`);
    assert.match(streamed.text, /too large/);
    assert.equal(seen.length, 1, 'a body that was too large reached the app');

    // A client that does not stop is cut off: the server answers and closes the connection
    const endless = await new Promise<{ data: string; closedByServer: boolean }>((resolve) => {
      const socket = netConnect(server.port, '127.0.0.1');
      let data = '';
      let done = false;
      const piece = Buffer.alloc(64 * 1024, 'a');
      const finish = (closedByServer: boolean) => {
        if (done) return;
        done = true;
        clearInterval(feed);
        clearTimeout(limit);
        socket.destroy();
        resolve({ data, closedByServer });
      };
      const feed = setInterval(() => {
        if (socket.writable) socket.write(`10000\r\n${piece.toString('latin1')}\r\n`);
      }, 5);
      const limit = setTimeout(() => finish(false), 5000);
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (data += chunk));
      socket.on('error', () => undefined);
      socket.on('close', () => finish(true));
      socket.on('connect', () =>
        socket.write(
          `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nTransfer-Encoding: chunked\r\n\r\n`
        )
      );
    });
    assert.match(statusLine(endless.data), /^HTTP\/1\.1 413 /);
    assert.ok(endless.closedByServer, 'the server kept reading a body that it had refused');
    assert.equal(seen.length, 1);

    // The server still works after it refused
    assert.equal((await send(server.port, { method: 'POST', body: 'ok' })).status, 200);
  } finally {
    await server.close();
  }
});

test('adapter: an app that throws gives a plain 500, and only the kind of the error is logged', async () => {
  const app: FetchHandler = {
    fetch: async () => {
      throw new TypeError('THROWN-SENTINEL with a secret');
    },
  };
  const server = await listening(app);
  const errors = captureErrors();
  try {
    const answer = await send(server.port, { path: '/mcp' });
    assert.equal(answer.status, 500);
    assert.equal(answer.text, 'Internal server error');
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.ok(errors.lines.some((line) => line.includes('TypeError')));
    assert.ok(!errors.lines.join('\n').includes('THROWN-SENTINEL'));
  } finally {
    errors.restore();
    await server.close();
  }
});

scenario('adapter: the real server answers over HTTP on this machine', async (h) => {
  const server = await listening(h.app, { publicUrl: new URL(ORIGIN) });
  try {
    const health = await send(server.port, { path: '/healthz' });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { status: 'ok' });

    const metadata = await send(server.port, { path: '/.well-known/oauth-protected-resource/mcp' });
    assert.equal(metadata.status, 200);
    assert.equal(JSON.parse(metadata.text).resource, RESOURCE);

    const refused = await send(server.port, {
      method: 'POST',
      path: '/mcp',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(refused.status, 401);
    assert.match(String(refused.headers['www-authenticate']), /resource_metadata=/);

    const { tokens } = await signedIn(h);
    const listed = await send(server.port, {
      method: 'POST',
      path: '/mcp',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(listed.status, 200);
    assert.match(listed.text, /get_user/);
  } finally {
    await server.close();
  }
});

// --- the Vercel entry ---

test('the function entry answers 500 until it is configured, then serves', async () => {
  const names = ['REDIS_URL', 'DATA_DIR', 'SESSION_SECRET', 'PUBLIC_URL', 'TRUST_PROXY'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const dir = mkdtempSync(join(tmpdir(), 'yazio-entry-'));
  const errors = captureErrors();
  const log = console.log;
  console.log = () => undefined;
  try {
    const entry = (await import('../api/index.js')).default;
    const remote = await import('../src/remote.js');
    assert.equal(entry, remote.default, 'api/index.ts must export the handler of src/remote.ts');

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await entry.fetch(new Request('https://app.example/healthz'));
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        error: 'server_error',
        error_description: 'The server is not configured. See its log.',
      });
    }
    const reports = errors.lines.filter((line) => line.startsWith('❌'));
    assert.equal(reports.length, 1, 'the missing setting is reported once, not for each request');
    assert.match(reports[0], /Storage is required/);

    // The host sets the variables: the next request works, without a new import
    process.env.DATA_DIR = dir;
    process.env.SESSION_SECRET = SECRET;
    const health = await entry.fetch(new Request('https://app.example/healthz'));
    assert.equal(health.status, 200);

    // Without PUBLIC_URL the address is the one the request came to
    const metadata = await entry.fetch(
      new Request('https://app.example/.well-known/oauth-authorization-server')
    );
    assert.equal(metadata.status, 200);
    const as = await metadata.json();
    assert.equal(as.issuer, 'https://app.example/');
    assert.equal(as.token_endpoint, 'https://app.example/token');

    // A host that passes no client address still gets a working, limited server
    const registered = await entry.fetch(
      new Request('https://app.example/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://client.example/callback'] }),
      })
    );
    assert.equal(registered.status, 201);
    assert.deepEqual(readdirSync(dir), ['yazio-mcp.json']);
    await remote.remoteApp().close();
  } finally {
    console.log = log;
    errors.restore();
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the address of the client ---

/** A sign-in attempt that costs nothing: the form it names does not exist */
const attempt = (h: Harness, options: { ip?: string | null; headers?: Record<string, string> }) =>
  h.call('POST', '/login', { form: { pending: 'none', username: 'u', password: 'p' }, ...options });

scenario('without TRUST_PROXY a forwarding header does not change who is counted', async (h) => {
  for (let i = 0; i < 10; i++) {
    const response = await attempt(h, { headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    assert.equal(response.status, 400);
  }
  // A new header value does not give a new allowance
  const limited = await attempt(h, { headers: { 'x-forwarded-for': '198.51.100.200' } });
  assert.equal(limited.status, 429);
  // Another address is not held back by the header of the first one
  const other = await attempt(h, {
    ip: '203.0.113.99',
    headers: { 'x-forwarded-for': '198.51.100.0' },
  });
  assert.equal(other.status, 400);
});

scenario(
  'with TRUST_PROXY the last forwarded address is counted, not one the client wrote',
  async (h) => {
    h.rebuild({ trustProxy: true });
    for (let i = 0; i < 10; i++) {
      // The client writes the first entries itself. The proxy adds the last one.
      const response = await attempt(h, {
        ip: '10.0.0.1',
        headers: { 'x-forwarded-for': `198.51.100.${i}, 192.0.2.${i},203.0.113.8` },
      });
      assert.equal(response.status, 400);
    }
    const limited = await attempt(h, {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.200, 203.0.113.8' },
    });
    assert.equal(limited.status, 429);
    // Another user behind the same proxy has their own allowance
    const other = await attempt(h, {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.8, 203.0.113.9' },
    });
    assert.equal(other.status, 400);
    // No header: the address the host reports counts
    const direct = await attempt(h, { ip: '203.0.113.50' });
    assert.equal(direct.status, 400);
  }
);

scenario('clients without an address share one allowance, they are not unlimited', async (h) => {
  for (let i = 0; i < 10; i++) assert.equal((await attempt(h, { ip: null })).status, 400);
  assert.equal((await attempt(h, { ip: null })).status, 429);
  assert.equal((await attempt(h, { ip: '' })).status, 429);
  assert.equal((await attempt(h, { ip: '203.0.113.9' })).status, 400);
});

scenario('the store holds no client address', async (h) => {
  await attempt(h, { ip: '203.0.113.77' });
  await h.call('POST', '/token', { form: {}, ip: '203.0.113.77' });
  const keys = await h.keys('rate:');
  assert.equal(keys.length, 2);
  assert.ok(!(await h.dump()).includes('203.0.113.77'));
});

// --- the rate limits ---

const LIMITS: {
  name: string;
  max: number;
  minutes: number;
  request: (h: Harness, ip?: string) => Promise<Response>;
}[] = [
  {
    name: 'authorize',
    max: 100,
    minutes: 15,
    request: (h, ip) => h.call('GET', '/authorize?client_id=none', { ip }),
  },
  {
    name: 'token',
    max: 50,
    minutes: 15,
    request: (h, ip) => h.call('POST', '/token', { form: {}, ip }),
  },
  {
    name: 'revoke',
    max: 50,
    minutes: 15,
    request: (h, ip) => h.call('POST', '/revoke', { form: {}, ip }),
  },
  {
    name: 'register',
    max: 20,
    minutes: 60,
    request: (h, ip) => h.call('POST', '/register', { json: {}, ip }),
  },
  { name: 'login', max: 10, minutes: 15, request: (h, ip) => attempt(h, { ip }) },
];

for (const limit of LIMITS) {
  scenario(
    `${limit.name}: ${limit.max} requests in ${limit.minutes} minutes per address, then 429 until the window ends`,
    async (h) => {
      for (let i = 0; i < limit.max; i++) {
        const response = await limit.request(h);
        assert.notEqual(response.status, 429, `request ${i + 1}`);
        assert.ok(response.status < 500, `request ${i + 1} answered ${response.status}`);
      }
      const windowMs = limit.minutes * 60_000;
      const windowEnd = (Math.floor(h.now() / windowMs) + 1) * windowMs;
      const refused = await limit.request(h);
      assert.equal(refused.status, 429);
      if (limit.name === 'login') {
        assert.match(await refused.text(), /Too many attempts/);
      } else {
        assert.equal((await refused.json()).error, 'too_many_requests');
        const wait = Number(refused.headers.get('retry-after'));
        assert.equal(wait, Math.max(1, Math.ceil((windowEnd - h.now()) / 1000)));
        assert.ok(wait >= 1 && wait <= limit.minutes * 60);
      }
      // Another address is not held back
      assert.notEqual((await limit.request(h, '203.0.113.200')).status, 429);
      // The limit ends with the window
      h.tick(windowEnd - h.now() - 1);
      assert.equal((await limit.request(h)).status, 429);
      h.tick(1);
      assert.notEqual((await limit.request(h)).status, 429);
    }
  );
}

scenario(
  'a request over the limit does not reach the sign-in or the storage of clients',
  async (h) => {
    for (let i = 0; i < 20; i++) await h.call('POST', '/register', { json: {} });
    const before = await h.keys('client:');
    const refused = await h.call('POST', '/register', {
      json: { redirect_uris: ['https://client.example/callback'] },
    });
    assert.equal(refused.status, 429);
    assert.deepEqual(await h.keys('client:'), before);
    assert.equal(h.yazio.state.calls.length, 0);
  }
);

// --- the public address ---

const AS_METADATA = '/.well-known/oauth-authorization-server';

scenario('without PUBLIC_URL plain HTTP is refused, except on this machine', async (h) => {
  h.rebuild({ publicUrl: undefined });
  for (const path of [AS_METADATA, '/', '/authorize?client_id=x', '/mcp']) {
    const response = await h.call('GET', path, { origin: 'http://mcp.example.com' });
    assert.equal(response.status, 500, path);
    const body = await response.json();
    assert.equal(body.error, 'server_error');
    assert.match(body.error_description, /must be reached over HTTPS/);
    assert.match(body.error_description, /PUBLIC_URL/);
    assert.match(body.error_description, /TRUST_PROXY/);
    assert.equal(response.headers.get('strict-transport-security'), null);
  }
  // No sign-in over plain text: the form is refused before Yazio is asked
  const login = await h.call('POST', '/login', {
    form: { pending: 'x', username: 'u', password: 'p' },
    origin: 'http://mcp.example.com',
  });
  assert.equal(login.status, 500);
  const token = await h.call('POST', '/token', { form: {}, origin: 'http://192.168.1.10:3000' });
  assert.equal(token.status, 500);
  assert.equal(h.yazio.state.calls.length, 0);
  // The health check needs no address
  assert.equal((await h.call('GET', '/healthz', { origin: 'http://mcp.example.com' })).status, 200);

  for (const local of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    const response = await h.call('GET', AS_METADATA, { origin: local });
    assert.equal(response.status, 200, local);
    assert.equal((await response.json()).issuer, `${local}/`);
    assert.equal(response.headers.get('strict-transport-security'), null, local);
  }
  const secure = await h.call('GET', AS_METADATA, { origin: 'https://other.example' });
  assert.equal(secure.status, 200);
  assert.equal((await secure.json()).issuer, 'https://other.example/');
  assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000');
});

scenario(
  'a forwarded scheme counts only with TRUST_PROXY, and a forwarded host never',
  async (h) => {
    h.rebuild({ publicUrl: undefined });
    const forwarded = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'attacker.example' };
    const untrusted = await h.call('GET', AS_METADATA, {
      origin: 'http://mcp.example.com',
      headers: forwarded,
    });
    assert.equal(untrusted.status, 500);

    h.rebuild({ trustProxy: true });
    const trusted = await h.call('GET', AS_METADATA, {
      origin: 'http://mcp.example.com',
      headers: forwarded,
    });
    assert.equal(trusted.status, 200);
    const metadata = await trusted.json();
    assert.equal(metadata.issuer, 'https://mcp.example.com/');
    assert.ok(!JSON.stringify(metadata).includes('attacker.example'));
    assert.equal(trusted.headers.get('strict-transport-security'), 'max-age=31536000');

    // The last entry is the one the nearest proxy wrote
    const last = (value: string) =>
      h.call('GET', AS_METADATA, {
        origin: 'http://mcp.example.com',
        headers: { 'x-forwarded-proto': value },
      });
    assert.equal((await last('http, https')).status, 200);
    assert.equal((await last('https, http')).status, 500);
    assert.equal((await last('HTTPS')).status, 200);
    assert.equal((await last('javascript')).status, 500);
    assert.equal(
      (await h.call('GET', AS_METADATA, { origin: 'http://mcp.example.com' })).status,
      500
    );
  }
);

scenario('PUBLIC_URL wins over the address and the headers of the request', async (h) => {
  h.rebuild({ trustProxy: true });
  const response = await h.call('GET', AS_METADATA, {
    origin: 'http://internal.example:8080',
    headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'attacker.example' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).issuer, `${ORIGIN}/`);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
});

scenario('without PUBLIC_URL a token works only on the address it was issued for', async (h) => {
  h.rebuild({ publicUrl: undefined });
  const { client, tokens } = await signedIn(h);
  assert.equal((await getUser(h, tokens.access_token)).response.status, 200);

  const elsewhere = await h.call('POST', '/mcp', {
    origin: 'https://other.example',
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tokens.access_token}`,
    },
    json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  assert.equal(elsewhere.status, 401);
  assert.match(String(elsewhere.headers.get('www-authenticate')), /other\.example/);

  const renewed = await h.call('POST', '/token', {
    origin: 'https://other.example',
    form: {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      client_secret: client.client_secret,
    },
  });
  assert.equal(renewed.status, 400);
  // The attempt on the wrong address does not use the token up
  assert.equal((await refresh(h, client, tokens.refresh_token)).status, 200);
});

// --- a new secret ---

scenario('a new SESSION_SECRET signs everyone out', async (h) => {
  const { client, tokens } = await signedIn(h);
  await h.restart({ sessionSecret: 'another-session-secret-0123456789-abcdef' });
  const call = await getUser(h, tokens.access_token);
  assert.equal(call.response.status, 401);
  assert.match(String(call.response.headers.get('www-authenticate')), /invalid_token/);
  const renewed = await refresh(h, client, tokens.refresh_token);
  assert.equal(renewed.status, 400);
  assert.equal((await renewed.json()).error, 'invalid_grant');
  assert.equal(await h.store.get(`rt:${hashToken(tokens.refresh_token)}`), null);
  assert.equal(h.yazio.state.calls.filter((call) => call.grant === 'refresh_token').length, 0);
});

// --- a storage that fails ---

function brokenStore(): Store {
  const fail = async (): Promise<never> => {
    throw new Error('STORE-SENTINEL redis://:password@db.example:6379');
  };
  return {
    get: fail,
    set: fail,
    take: fail,
    delete: fail,
    expire: fail,
    increment: fail,
    close: async () => undefined,
  };
}

test('when the storage fails the server refuses, and does not show why', async () => {
  const errors = captureErrors();
  const app = createRemoteApp({
    store: brokenStore(),
    sessionSecret: SECRET,
    publicUrl: new URL(ORIGIN),
    log: () => undefined,
    signIn: async () => {
      throw new Error('the sign-in must not be reached');
    },
  });
  const call = (method: string, path: string, init: RequestInit = {}) =>
    app.fetch(new Request(`${ORIGIN}${path}`, { method, ...init }), {
      clientAddress: '203.0.113.7',
    });
  const form = {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'pending=x&username=u&password=p',
  };
  try {
    // The health check says that the process runs. It does not need the storage.
    assert.equal((await call('GET', '/healthz')).status, 200);
    assert.equal((await call('GET', AS_METADATA)).status, 200);

    const answers = [
      await call('POST', '/login', form),
      await call('POST', '/token', form),
      await call('POST', '/revoke', form),
      await call('GET', '/authorize?client_id=x'),
      await call('POST', '/register', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://client.example/callback'] }),
      }),
    ];
    for (const answer of answers) {
      assert.equal(answer.status, 500);
      assert.ok(!(await answer.text()).includes('SENTINEL'));
    }

    const mcp = await call('POST', '/mcp', {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer some-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.ok(mcp.status >= 500, `a token was not refused: ${mcp.status}`);
    assert.ok(!(await mcp.text()).includes('SENTINEL'));

    assert.ok(errors.lines.length > 0, 'the failure is not logged');
    const logged = errors.lines.join('\n');
    assert.ok(!logged.includes('SENTINEL'), logged);
    assert.ok(!logged.includes('password'), logged);
  } finally {
    errors.restore();
    await app.close();
  }
});

// --- small rules of HTTP ---

scenario('a browser may ask first: preflight requests are answered without a token', async (h) => {
  for (const path of ['/mcp', '/token', '/register', '/revoke', AS_METADATA]) {
    const response = await h.call('OPTIONS', path, {
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(String(response.headers.get('access-control-allow-headers')), /Authorization/);
    assert.match(String(response.headers.get('access-control-allow-methods')), /POST/);
  }
  // The pages for a person are not open to scripts of other sites
  for (const path of ['/login', '/authorize']) {
    const response = await h.call('OPTIONS', path);
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.get('access-control-allow-methods'), null);
  }
});

scenario('each path answers only its own methods', async (h) => {
  const cases: [string, string, string][] = [
    ['POST', '/', 'GET'],
    ['GET', '/register', 'POST'],
    ['GET', '/token', 'POST'],
    ['GET', '/revoke', 'POST'],
    ['GET', '/login', 'POST'],
    ['DELETE', '/authorize', 'GET, POST'],
  ];
  for (const [method, path, allow] of cases) {
    const response = await h.call(method, path);
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(response.headers.get('allow'), allow);
  }
  const home = await h.call('GET', '/');
  assert.equal(home.status, 200);
  const page = await home.text();
  assert.ok(page.includes(RESOURCE));
  assert.match(String(home.headers.get('content-security-policy')), /frame-ancestors 'none'/);
});

scenario(
  'OAuth answers are not cached and the MCP endpoint shows its challenge to browsers',
  async (h) => {
    const { tokens, client } = await signedIn(h);
    const renewed = await refresh(h, client, tokens.refresh_token);
    assert.equal(renewed.headers.get('cache-control'), 'no-store');
    assert.equal(renewed.headers.get('pragma'), 'no-cache');
    const refused = await rpc(h, undefined, 'tools/list');
    assert.equal(refused.response.status, 401);
    assert.equal(refused.response.headers.get('access-control-allow-origin'), '*');
    assert.match(
      String(refused.response.headers.get('access-control-expose-headers')),
      /WWW-Authenticate/
    );
  }
);
