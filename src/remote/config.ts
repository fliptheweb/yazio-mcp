import { resolve } from 'node:path';
import type { RemoteConfig } from './app.js';
import type { YazioClientId } from './oauth.js';
import { FileStore } from './store-file.js';
import { RedisStore } from './store-redis.js';

/** A setting is missing or wrong. The message never contains the value of a secret. */
export class ConfigError extends Error {}

export interface Settings {
  redisUrl?: string;
  dataDir?: string;
  sessionSecret: string;
  publicUrl?: URL;
  trustProxy: boolean;
  host: string;
  port: number;
  yazioClient: YazioClientId;
}

type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIN_SECRET_LENGTH = 32;

function publicUrlFrom(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('PUBLIC_URL is not a valid URL');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new ConfigError(
      'PUBLIC_URL must be an origin only, without a path: the server answers at /mcp itself'
    );
  }
  const localHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new ConfigError('PUBLIC_URL must use https; plain http only works for localhost');
  }
  return url;
}

/** Reads and checks the settings. All of them come from the environment. */
export function settingsFromEnv(env: Env = process.env): Settings {
  const redisUrl = env.REDIS_URL || undefined;
  const dataDir = env.DATA_DIR || undefined;
  if (redisUrl && dataDir) throw new ConfigError('Set only one of REDIS_URL and DATA_DIR');
  if (!redisUrl && !dataDir) {
    throw new ConfigError(
      'Storage is required: set REDIS_URL (a Redis server) or DATA_DIR (a directory on a disk that stays)'
    );
  }
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    throw new ConfigError('REDIS_URL must start with redis:// or rediss://');
  }

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `SESSION_SECRET is required: a random text of ${MIN_SECRET_LENGTH} characters or more, ` +
        'for example from `openssl rand -base64 32`'
    );
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError('PORT must be a number from 0 to 65535');
  }

  return {
    redisUrl,
    dataDir: dataDir ? resolve(dataDir) : undefined,
    sessionSecret,
    publicUrl: publicUrlFrom(env.PUBLIC_URL),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    host: env.HOST || '127.0.0.1',
    port,
    // No Yazio account here by design: each user signs in through the browser
    yazioClient: {
      clientId: env.YAZIO_CLIENT_ID || undefined,
      clientSecret: env.YAZIO_CLIENT_SECRET || undefined,
    },
  };
}

/** The configuration of the app, with the storage that the environment selects */
export function configFromEnv(env: Env = process.env): RemoteConfig {
  const settings = settingsFromEnv(env);
  return {
    store: settings.redisUrl
      ? new RedisStore(settings.redisUrl)
      : new FileStore(settings.dataDir as string),
    sessionSecret: settings.sessionSecret,
    publicUrl: settings.publicUrl,
    trustProxy: settings.trustProxy,
    yazioClient: settings.yazioClient,
  };
}
