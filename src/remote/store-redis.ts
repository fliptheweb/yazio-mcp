import { createClient } from '@redis/client';
import { wholeMilliseconds, type SetOptions, type Store } from './store.js';

const KEY_PREFIX = 'yazio-mcp:';
const CONNECT_TIMEOUT_MS = 5000;
const RECONNECT_ATTEMPTS = 5;

// A script runs as one step, so no other command comes between the comparison and the write
const DELETE_IF = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const REPLACE_IF = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') return 1 end return 0`;

const newClient = (url: string) =>
  createClient({
    url,
    // Without a connection a command fails at once: a request must not wait for Redis to return
    disableOfflineQueue: true,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        retries >= RECONNECT_ATTEMPTS
          ? new Error('Redis is not reachable')
          : Math.min(100 * 2 ** retries, 2000),
    },
  });

type RedisClient = ReturnType<typeof newClient>;

/** The name and the code of an error only: its message can carry the address of the server */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

/** A store in Redis, for hosts without a disk and for servers with more than one instance */
export class RedisStore implements Store {
  private connection: Promise<RedisClient> | undefined;

  /** `url` is `redis://` or `rediss://` and can hold a password: it must never be logged */
  constructor(private readonly url: string) {}

  get(key: string): Promise<string | null> {
    return this.command((client) => client.get(KEY_PREFIX + key));
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<boolean> {
    // Checked before the connection, so a wrong value is always a RangeError
    const ttl = options.ttlMs === undefined ? undefined : wholeMilliseconds(options.ttlMs);
    const reply = await this.command((client) =>
      client.set(KEY_PREFIX + key, value, {
        expiration: ttl === undefined ? 'KEEPTTL' : { type: 'PX', value: ttl },
        condition: options.if === 'absent' ? 'NX' : options.if === 'present' ? 'XX' : undefined,
      })
    );
    return reply !== null;
  }

  take(key: string): Promise<string | null> {
    return this.command((client) => client.getDel(KEY_PREFIX + key));
  }

  async delete(key: string): Promise<void> {
    await this.command((client) => client.del(KEY_PREFIX + key));
  }

  async deleteIf(key: string, expected: string): Promise<boolean> {
    const reply = await this.command((client) =>
      client.eval(DELETE_IF, { keys: [KEY_PREFIX + key], arguments: [expected] })
    );
    return Number(reply) === 1;
  }

  async replaceIf(key: string, expected: string, value: string): Promise<boolean> {
    const reply = await this.command((client) =>
      client.eval(REPLACE_IF, { keys: [KEY_PREFIX + key], arguments: [expected, value] })
    );
    return Number(reply) === 1;
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const ttl = wholeMilliseconds(ttlMs);
    const reply = await this.command((client) => client.pExpire(KEY_PREFIX + key, ttl));
    return Number(reply) === 1;
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    const ttl = wholeMilliseconds(ttlMs);
    // One transaction: a counter can never exist without its expiry
    const replies = await this.command((client) =>
      client
        .multi()
        .set(KEY_PREFIX + key, '0', {
          expiration: { type: 'PX', value: ttl },
          condition: 'NX',
        })
        .incr(KEY_PREFIX + key)
        .exec()
    );
    return Number(replies[1]);
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    const client = await connection.catch(() => undefined);
    if (client?.isOpen) await client.close();
  }

  private async command<T>(run: (client: RedisClient) => Promise<T>): Promise<T> {
    let client = await this.connect();
    if (!client.isOpen) {
      // The client gave up after too many reconnects: start a new one
      this.connection = undefined;
      client = await this.connect();
    }
    return run(client);
  }

  /** One connection for the life of the instance, opened by the first command */
  private connect(): Promise<RedisClient> {
    this.connection ??= this.open().catch((error: unknown) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  private async open(): Promise<RedisClient> {
    const client = newClient(this.url);
    client.on('error', (error: unknown) => console.error('Redis error:', describe(error)));
    await client.connect();
    return client;
  }
}
