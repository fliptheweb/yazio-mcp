// Based on https://github.com/juriadams/yazio by Juri Adams and its contributors.
import * as z from 'zod';
import { TokenResponseSchema } from './schemas.js';

export const API_URL = 'https://yzapi.yazio.com';
// Each version is the API of one app generation: newer ones add endpoints and fields, some also added to older ones
export const DEFAULT_API_VERSION = 'v15';
// Newer versions answer 403 version_blocked, except on the token exchange, unless the user agent names an app
// build they still support. A wall of 403s on the v22 calls means YAZIO_USER_AGENT and this need a newer build.
export const DEFAULT_USER_AGENT = 'YAZIO/26.41.2 (com.yazio.android; build:610090905; Android 36) Ktor';

// From https://github.com/juriadams/yazio/blob/main/src/utils/constants.ts
export const DEFAULT_CLIENT_ID = '1_4hiybetvfksgw40o0sog4s884kwc840wwso8go4k8c04goo4c';
export const DEFAULT_CLIENT_SECRET = '6rok2m65xuskgkgogw40wkkk8sw0osg84s8cggsc4woos4s8o';

const EXPIRY_MARGIN_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 1000;

export interface Credentials {
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
}

export interface Token {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Epoch ms */
  expires_at: number;
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions<T> {
  query?: Record<string, QueryValue>;
  body?: unknown;
  schema?: z.ZodType<T>;
  /** For an endpoint that the default version lacks or answers with less data, e.g. 'v22'; sends the user agent */
  version?: string;
}

export interface YazioHttpOptions {
  fetch?: typeof fetch;
  userAgent?: string;
}

export class YazioApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    const detail = body ? ` - ${body.slice(0, MAX_ERROR_BODY_LENGTH)}` : '';
    super(`${method} ${path} failed: ${status} ${statusText}${detail}`);
    this.name = 'YazioApiError';
  }
}

export class YazioHttp {
  private readonly fetch: typeof fetch;
  private token: Token | null = null;
  private pendingToken: Promise<Token> | null = null;
  private readonly credentials: Credentials;
  private readonly userAgent: string;

  constructor(credentials: Credentials, options: YazioHttpOptions = {}) {
    this.credentials = credentials;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async request<T = void>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const url = this.buildUrl(options.version ?? DEFAULT_API_VERSION, path, options.query);
    const send = (token: Token) => this.send(method, url, token, options.body, options.version !== undefined);
    let token = await this.authenticate();
    let response = await send(token);

    // The server can revoke a token before expires_at; renew it once and retry
    if (response.status === 401) {
      this.invalidate(token);
      token = await this.authenticate();
      response = await send(token);
    }

    if (!response.ok) {
      throw new YazioApiError(method, path, response.status, response.statusText, await response.text());
    }

    if (!options.schema) return undefined as T;

    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    const result = options.schema.safeParse(data);
    if (result.success) return result.data;

    console.error(`⚠️ ${method} ${path} returned an unexpected response shape:\n${z.prettifyError(result.error)}`);
    return data as T;
  }

  async authenticate(): Promise<Token> {
    if (this.token && this.token.expires_at - EXPIRY_MARGIN_MS > Date.now()) {
      return this.token;
    }
    this.pendingToken ??= this.renewToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private invalidate(token: Token): void {
    if (this.token === token) {
      this.token = { ...token, expires_at: 0 };
    }
  }

  private async renewToken(): Promise<Token> {
    const refreshToken = this.token?.refresh_token;
    const refreshed = refreshToken
      ? await this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken }).catch(() => null)
      : null;
    if (refreshed) {
      this.token = refreshed;
      return refreshed;
    }
    this.token = await this.requestToken({
      grant_type: 'password',
      username: this.credentials.username,
      password: this.credentials.password,
    });
    return this.token;
  }

  private async requestToken(grant: Record<string, string>): Promise<Token> {
    const response = await this.fetch(`${API_URL}/${DEFAULT_API_VERSION}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.credentials.clientId ?? DEFAULT_CLIENT_ID,
        client_secret: this.credentials.clientSecret ?? DEFAULT_CLIENT_SECRET,
        ...grant,
      }),
    });
    if (!response.ok) {
      // Don't echo the body: it can repeat the submitted credentials
      throw new YazioApiError('POST', '/oauth/token', response.status, response.statusText, '');
    }
    const data: unknown = await response.json();
    const result = TokenResponseSchema.safeParse(data);
    if (!result.success) {
      console.error(`⚠️ POST /oauth/token returned an unexpected response shape:\n${z.prettifyError(result.error)}`);
    }
    const token = (result.success ? result.data : data) as Omit<Token, 'expires_at'>;
    // Without a numeric expires_in the token counts as expired, so the next call logs in again
    return { ...token, expires_at: Date.now() + Number(token.expires_in) * 1000 };
  }

  private send(method: string, url: string, token: Token, body: unknown, withUserAgent: boolean): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token.access_token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // v15 does not check the client version, so it must not fail when the app build in the user agent is retired
    if (withUserAgent) headers['User-Agent'] = this.userAgent;
    return this.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private buildUrl(version: string, path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${API_URL}/${version}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
