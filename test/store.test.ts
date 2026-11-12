// The storage, the encryption and the settings: the parts under the OAuth server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { ConfigError, configFromEnv, settingsFromEnv } from '../src/remote/config.js';
import { Sealer } from '../src/remote/crypto.js';
import { FileStore } from '../src/remote/store-file.js';
import { RedisStore } from '../src/remote/store-redis.js';
import { windowKey, type Store } from '../src/remote/store.js';
import { REDIS_URL } from './harness.js';

interface Subject {
  store: Store;
  /** Lets `ms` of the store's time pass */
  advance(ms: number): Promise<void>;
  /** A second connection to the same storage, as another instance of the server has */
  second(): Store;
  cleanup(): Promise<void>;
}

function fileSubject(): Subject {
  let clock = 1_000_000;
  const dir = mkdtempSync(join(tmpdir(), 'yazio-store-'));
  const store = new FileStore(dir, () => clock);
  return {
    store,
    advance: async (ms) => void (clock += ms),
    // A file store serves one process: its second instance is the same object
    second: () => store,
    cleanup: async () => {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function redisSubject(): Subject {
  const store = new RedisStore(REDIS_URL!);
  const others: Store[] = [];
  return {
    store,
    advance: (ms) => wait(ms + 30),
    second: () => {
      const other = new RedisStore(REDIS_URL!);
      others.push(other);
      return other;
    },
    cleanup: async () => {
      await store.close();
      for (const other of others) await other.close();
    },
  };
}

const KINDS = [
  { name: 'file store', make: fileSubject, skip: false as string | false },
  {
    name: 'Redis store',
    make: redisSubject,
    skip: REDIS_URL ? false : 'set TEST_REDIS_URL to run the Redis store tests',
  },
];

for (const kind of KINDS) {
  const contract = (
    name: string,
    run: (subject: Subject, key: (name: string) => string) => Promise<void>
  ) =>
    test(`${kind.name}: ${name}`, { skip: kind.skip || undefined }, async () => {
      const subject = kind.make();
      // Each test has its own keys: a Redis database is shared between tests
      const prefix = `t-${randomBytes(6).toString('hex')}:`;
      try {
        await run(subject, (name) => prefix + name);
      } finally {
        await subject.cleanup();
      }
    });

  contract('reads what it wrote, and null for a key that is not there', async ({ store }, key) => {
    assert.equal(await store.get(key('a')), null);
    assert.equal(await store.set(key('a'), 'one'), true);
    assert.equal(await store.get(key('a')), 'one');
    assert.equal(await store.set(key('a'), 'two'), true);
    assert.equal(await store.get(key('a')), 'two');
    const odd = 'line\nbreak "quote" é中 \\ {"json":true}';
    await store.set(key('odd key é "x"'), odd);
    assert.equal(await store.get(key('odd key é "x"')), odd);
  });

  contract(
    '"absent" writes only a new key and "present" only an existing one',
    async ({ store }, key) => {
      assert.equal(await store.set(key('a'), 'x', { if: 'present' }), false);
      assert.equal(await store.get(key('a')), null);
      assert.equal(await store.set(key('a'), 'first', { if: 'absent' }), true);
      assert.equal(await store.set(key('a'), 'second', { if: 'absent' }), false);
      assert.equal(await store.get(key('a')), 'first');
      assert.equal(await store.set(key('a'), 'third', { if: 'present' }), true);
      assert.equal(await store.get(key('a')), 'third');
    }
  );

  contract('a key expires after its time to live', async ({ store, advance }, key) => {
    await store.set(key('a'), 'x', { ttlMs: 200 });
    await store.set(key('stays'), 'y');
    assert.equal(await store.get(key('a')), 'x');
    await advance(200);
    assert.equal(await store.get(key('a')), null);
    assert.equal(await store.get(key('stays')), 'y');
    // An expired key is absent for every operation
    assert.equal(await store.take(key('a')), null);
    assert.equal(await store.expire(key('a'), 1000), false);
    assert.equal(await store.set(key('a'), 'z', { if: 'present' }), false);
    assert.equal(await store.set(key('a'), 'new', { if: 'absent', ttlMs: 60_000 }), true);
  });

  contract(
    'a write without a time to live keeps the one the key has',
    async ({ store, advance }, key) => {
      await store.set(key('a'), 'x', { ttlMs: 300 });
      assert.equal(await store.set(key('a'), 'changed'), true);
      assert.equal(await store.set(key('a'), 'changed again', { if: 'present' }), true);
      await advance(300);
      assert.equal(await store.get(key('a')), null, 'the write must not make the key permanent');
    }
  );

  contract('a write with a time to live replaces the old one', async ({ store, advance }, key) => {
    await store.set(key('a'), 'x', { ttlMs: 150 });
    await store.set(key('a'), 'y', { ttlMs: 60_000 });
    await advance(150);
    assert.equal(await store.get(key('a')), 'y');
  });

  contract('"expire" gives an existing key a new time to live', async ({ store, advance }, key) => {
    assert.equal(await store.expire(key('none'), 1000), false);
    await store.set(key('a'), 'x', { ttlMs: 150 });
    assert.equal(await store.expire(key('a'), 60_000), true);
    await advance(150);
    assert.equal(await store.get(key('a')), 'x');
    await store.set(key('b'), 'x');
    assert.equal(await store.expire(key('b'), 150), true);
    await advance(150);
    assert.equal(await store.get(key('b')), null);
  });

  contract('"take" gives the value to one caller only', async ({ store, second }, key) => {
    assert.equal(await store.take(key('none')), null);
    await store.set(key('a'), 'x', { ttlMs: 60_000 });
    const other = second();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? store : other).take(key('a')))
    );
    assert.equal(results.filter((value) => value === 'x').length, 1);
    assert.equal(results.filter((value) => value === null).length, 7);
    assert.equal(await store.get(key('a')), null);
  });

  contract('"absent" lets one of many writers at once win', async ({ store, second }, key) => {
    const other = second();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? store : other).set(key('lock'), String(i), { if: 'absent', ttlMs: 60_000 })
      )
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await store.get(key('lock')), String(results.indexOf(true)));
  });

  contract('"delete" removes a key, and a missing key is no error', async ({ store }, key) => {
    await store.set(key('a'), 'x');
    await store.delete(key('a'));
    assert.equal(await store.get(key('a')), null);
    await store.delete(key('a'));
  });

  contract(
    'a counter counts each increment once, also when they come at once',
    async ({ store, second }, key) => {
      assert.equal(await store.increment(key('n'), 60_000), 1);
      assert.equal(await store.increment(key('n'), 60_000), 2);
      const other = second();
      const counts = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? store : other).increment(key('n'), 60_000))
      );
      assert.deepEqual(
        counts.sort((a, b) => a - b),
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      );
    }
  );

  contract(
    'a counter ends a fixed time after its first increment',
    async ({ store, advance }, key) => {
      assert.equal(await store.increment(key('n'), 300), 1);
      await advance(150);
      // A later increment must not move the end: a client could keep a counter alive for ever
      assert.equal(await store.increment(key('n'), 300), 2);
      await advance(150);
      assert.equal(
        await store.increment(key('n'), 300),
        1,
        'a new counter after the first one ended'
      );
    }
  );
}

// --- the file store ---

test('file store: a new process reads what the last one wrote, with the times to live', async () => {
  let clock = 5_000_000;
  const dir = mkdtempSync(join(tmpdir(), 'yazio-store-'));
  try {
    const first = new FileStore(dir, () => clock);
    await first.set('stays', 'a');
    await first.set('short', 'b', { ttlMs: 1000 });
    await first.set('long', 'c', { ttlMs: 60_000 });
    await first.close();
    clock += 2000;
    const next = new FileStore(dir, () => clock);
    assert.equal(await next.get('stays'), 'a');
    assert.equal(await next.get('short'), null);
    assert.equal(await next.get('long'), 'c');
    // An expired entry leaves the file at the next write
    await next.set('other', 'd');
    assert.ok(!readFileSync(join(dir, 'yazio-mcp.json'), 'utf8').includes('short'));
    await next.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file store: makes its directory, and leaves one whole file and no temporary file', async () => {
  const base = mkdtempSync(join(tmpdir(), 'yazio-store-'));
  const dir = join(base, 'deep', 'data');
  try {
    const store = new FileStore(dir);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.set(`key-${i}`, `value-${i}`)));
    await store.close();
    assert.deepEqual(readdirSync(dir), ['yazio-mcp.json']);
    const data = JSON.parse(readFileSync(join(dir, 'yazio-mcp.json'), 'utf8'));
    assert.equal(Object.keys(data).length, 25);
    assert.equal(data['key-24'].v, 'value-24');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('file store: a file that is not JSON is an error, and the file is left as it is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yazio-store-'));
  const file = join(dir, 'yazio-mcp.json');
  try {
    writeFileSync(file, '{ not json');
    const store = new FileStore(dir);
    await assert.rejects(store.get('a'));
    await assert.rejects(store.set('a', 'x'));
    assert.equal(readFileSync(file, 'utf8'), '{ not json', 'the damaged file was overwritten');
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a counter key changes with the time window', () => {
  assert.equal(windowKey('rate', 1000, 0), 'rate:0');
  assert.equal(windowKey('rate', 1000, 999), 'rate:0');
  assert.equal(windowKey('rate', 1000, 1000), 'rate:1');
  assert.notEqual(
    windowKey('rate', 900_000, 1_700_000_000_000),
    windowKey('rate', 900_000, 1_700_000_900_000)
  );
});

// --- the Redis store ---

test('Redis store: a server that is not there fails fast and does not show its address', async () => {
  const store = new RedisStore('redis://:sentinel-password@127.0.0.1:1');
  const lines: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => void lines.push(parts.map(String).join(' '));
  const started = Date.now();
  try {
    await assert.rejects(store.get('a'));
    await assert.rejects(store.increment('n', 1000));
  } finally {
    console.error = original;
    await store.close();
  }
  assert.ok(Date.now() - started < 15_000);
  const logged = lines.join('\n');
  assert.ok(!logged.includes('sentinel-password'), logged);
  assert.ok(!logged.includes('127.0.0.1'), logged);
});

// --- encryption ---

const SECRET = 'a-session-secret-of-at-least-32-characters';

test('a sealed value opens with the same secret and the same context only', () => {
  const sealer = new Sealer(SECRET);
  const sealed = sealer.seal('{"token":"yazio-refresh-1"}', 'sess:abc');
  assert.equal(sealer.open(sealed, 'sess:abc'), '{"token":"yazio-refresh-1"}');
  assert.equal(new Sealer(SECRET).open(sealed, 'sess:abc'), '{"token":"yazio-refresh-1"}');
  // Not under another storage key: a record cannot be copied to another session
  assert.equal(sealer.open(sealed, 'sess:other'), null);
  assert.equal(new Sealer(`${SECRET}x`).open(sealed, 'sess:abc'), null);
});

test('a sealed value does not show its text, and two seals of one text differ', () => {
  const sealer = new Sealer(SECRET);
  const first = sealer.seal('yazio-refresh-1', 'k');
  const second = sealer.seal('yazio-refresh-1', 'k');
  assert.notEqual(first, second);
  assert.ok(!first.includes('yazio-refresh-1'));
  assert.ok(!first.includes(Buffer.from('yazio-refresh-1').toString('base64url')));
  assert.equal(sealer.open(sealer.seal('', 'k'), 'k'), '');
  const long = 'x'.repeat(100_000) + 'é中';
  assert.equal(sealer.open(sealer.seal(long, 'k'), 'k'), long);
});

test('a sealed value that was changed does not open', () => {
  const sealer = new Sealer(SECRET);
  const sealed = sealer.seal('secret text', 'k');
  const [version, iv, body] = sealed.split('.');
  const flip = (text: string, at: number) => {
    const bytes = Buffer.from(text, 'base64url');
    bytes[at < 0 ? bytes.length + at : at] ^= 1;
    return bytes.toString('base64url');
  };
  assert.equal(sealer.open([version, iv, flip(body, 0)].join('.'), 'k'), null, 'text');
  assert.equal(sealer.open([version, iv, flip(body, -1)].join('.'), 'k'), null, 'tag');
  assert.equal(sealer.open([version, flip(iv, 0), body].join('.'), 'k'), null, 'iv');
  assert.equal(sealer.open(['v0', iv, body].join('.'), 'k'), null, 'version');
  assert.equal(sealer.open([version, iv, body.slice(0, 10)].join('.'), 'k'), null, 'cut');
  for (const junk of ['', 'plain text', 'v1', 'v1..', 'v1.a.b', '{"token":"x"}']) {
    assert.equal(sealer.open(junk, 'k'), null, junk);
  }
});

test('the keyed hash is stable for one secret and differs between secrets', () => {
  const sealer = new Sealer(SECRET);
  assert.equal(sealer.mac('203.0.113.7'), new Sealer(SECRET).mac('203.0.113.7'));
  assert.notEqual(sealer.mac('203.0.113.7'), sealer.mac('203.0.113.8'));
  assert.notEqual(sealer.mac('203.0.113.7'), new Sealer(`${SECRET}x`).mac('203.0.113.7'));
  assert.ok(!sealer.mac('203.0.113.7').includes('203'));
});

// --- settings ---

const GOOD = { DATA_DIR: 'data', SESSION_SECRET: SECRET };
const refused = (env: Record<string, string | undefined>, message: RegExp) =>
  assert.throws(
    () => settingsFromEnv(env),
    (error) => error instanceof ConfigError && message.test(error.message)
  );

test('settings: the defaults bind to this machine only', () => {
  const settings = settingsFromEnv(GOOD);
  assert.equal(settings.host, '127.0.0.1');
  assert.equal(settings.port, 3000);
  assert.equal(settings.trustProxy, false);
  assert.equal(settings.publicUrl, undefined);
  assert.equal(settings.redisUrl, undefined);
  assert.equal(settings.dataDir, resolve('data'));
  assert.deepEqual(settings.yazioClient, { clientId: undefined, clientSecret: undefined });
});

test('settings: every value comes from the environment', () => {
  const settings = settingsFromEnv({
    REDIS_URL: 'rediss://default:pw@redis.example:6380',
    SESSION_SECRET: SECRET,
    PUBLIC_URL: 'https://mcp.example.com',
    TRUST_PROXY: '1',
    HOST: '0.0.0.0',
    PORT: '8080',
    YAZIO_CLIENT_ID: 'id',
    YAZIO_CLIENT_SECRET: 'secret',
  });
  assert.equal(settings.redisUrl, 'rediss://default:pw@redis.example:6380');
  assert.equal(settings.dataDir, undefined);
  assert.equal(settings.publicUrl?.href, 'https://mcp.example.com/');
  assert.equal(settings.trustProxy, true);
  assert.equal(settings.host, '0.0.0.0');
  assert.equal(settings.port, 8080);
  assert.deepEqual(settings.yazioClient, { clientId: 'id', clientSecret: 'secret' });
  assert.equal(settingsFromEnv({ ...GOOD, TRUST_PROXY: 'true' }).trustProxy, true);
  for (const value of ['0', 'false', 'yes', '']) {
    assert.equal(settingsFromEnv({ ...GOOD, TRUST_PROXY: value }).trustProxy, false, value);
  }
  assert.equal(settingsFromEnv({ ...GOOD, PORT: '0' }).port, 0);
  assert.equal(
    settingsFromEnv({ ...GOOD, PUBLIC_URL: 'http://localhost:3000' }).publicUrl?.port,
    '3000'
  );
});

test('settings: storage is required, and only one kind', () => {
  refused({ SESSION_SECRET: SECRET }, /Storage is required/);
  refused({ SESSION_SECRET: SECRET, REDIS_URL: '', DATA_DIR: '' }, /Storage is required/);
  refused({ ...GOOD, REDIS_URL: 'redis://localhost' }, /only one of REDIS_URL and DATA_DIR/);
  refused({ SESSION_SECRET: SECRET, REDIS_URL: 'localhost:6379' }, /must start with redis:\/\//);
  refused({ SESSION_SECRET: SECRET, REDIS_URL: 'http://localhost' }, /must start with redis:\/\//);
});

test('settings: a short or missing secret is refused, and the message does not repeat it', () => {
  refused({ DATA_DIR: 'data' }, /SESSION_SECRET is required/);
  refused({ DATA_DIR: 'data', SESSION_SECRET: 'x'.repeat(31) }, /32 characters/);
  assert.equal(
    settingsFromEnv({ DATA_DIR: 'data', SESSION_SECRET: 'x'.repeat(32) }).sessionSecret.length,
    32
  );
  assert.throws(
    () => settingsFromEnv({ DATA_DIR: 'data', SESSION_SECRET: 'short-sentinel-secret' }),
    (error) => error instanceof ConfigError && !error.message.includes('short-sentinel-secret')
  );
});

test('settings: PUBLIC_URL must be an https origin without a path', () => {
  refused({ ...GOOD, PUBLIC_URL: 'not a url' }, /not a valid URL/);
  refused({ ...GOOD, PUBLIC_URL: 'https://mcp.example.com/mcp' }, /origin only/);
  refused({ ...GOOD, PUBLIC_URL: 'https://mcp.example.com/?a=1' }, /origin only/);
  refused({ ...GOOD, PUBLIC_URL: 'https://user:pw@mcp.example.com' }, /origin only/);
  refused({ ...GOOD, PUBLIC_URL: 'http://mcp.example.com' }, /must use https/);
  refused({ ...GOOD, PUBLIC_URL: 'ftp://mcp.example.com' }, /must use https/);
  refused({ ...GOOD, PUBLIC_URL: 'http://192.168.1.10:3000' }, /must use https/);
  for (const local of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    assert.ok(settingsFromEnv({ ...GOOD, PUBLIC_URL: local }).publicUrl, local);
  }
});

test('settings: PORT must be a port number', () => {
  for (const port of ['abc', '-1', '65536', '80.5', '1e9']) {
    refused({ ...GOOD, PORT: port }, /PORT must be a number/);
  }
});

test('settings: the storage follows the environment', async () => {
  const file = configFromEnv(GOOD);
  assert.ok(file.store instanceof FileStore);
  assert.equal(file.sessionSecret, SECRET);
  assert.equal(file.trustProxy, false);
  const redis = configFromEnv({ REDIS_URL: 'redis://127.0.0.1:1', SESSION_SECRET: SECRET });
  assert.ok(redis.store instanceof RedisStore);
  await redis.store.close(); // it never connected: to make a store opens no connection
});
