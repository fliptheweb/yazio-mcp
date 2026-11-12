// Based on https://github.com/juriadams/yazio by Juri Adams and its contributors.
import * as z from 'zod';
import { TokenResponseSchema } from './schemas.js';

export const API_BASE_URL = 'https://yzapi.yazio.com/v15';

// From https://github.com/juriadams/yazio/blob/main/src/utils/constants.ts
export const DEFAULT_CLIENT_ID = '1_4hiybetvfksgw40o0sog4s884kwc840wwso8go4k8c04goo4c';
export const DEFAULT_CLIENT_SECRET = '6rok2m65xuskgkgogw40wkkk8sw0osg84s8cggsc4woos4s8o';

const EXPIRY_MARGIN_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 1000;

export interface Credentials {
  username: string;
  /** Not needed when the client starts from a saved token, see YazioHttpOptions.token */
  password?: string;
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
}

export interface YazioHttpOptions {
  fetch?: typeof fetch;
  /** A token saved earlier. The client starts from it, so it does not have to log in. */
  token?: Token;
  /** Called with every token the client gets from Yazio, so that the caller can save it */
  onToken?: (token: Token) => void | Promise<void>;
  /**
   * Called when a response does not have the expected shape. The default writes the
   * difference to the error log. A server that must not log response keys replaces it.
   */
  onUnexpectedShape?: (method: string, path: string, error: z.ZodError) => void;
}

function logUnexpectedShape(method: string, path: string, error: z.ZodError): void {
  console.error(`⚠️ ${method} ${path} returned an unexpected response shape:\n${z.prettifyError(error)}`);
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
  private readonly onToken?: (token: Token) => void | Promise<void>;
  private readonly onUnexpectedShape: (method: string, path: string, error: z.ZodError) => void;

  constructor(credentials: Credentials, options: YazioHttpOptions = {}) {
    this.credentials = credentials;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.token = options.token ?? null;
    this.onToken = options.onToken;
    this.onUnexpectedShape = options.onUnexpectedShape ?? logUnexpectedShape;
  }

  async request<T = void>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    let token = await this.authenticate();
    let response = await this.send(method, url, token, options.body);

    // The server can revoke a token before expires_at; renew it once and retry
    if (response.status === 401) {
      this.invalidate(token);
      token = await this.authenticate();
      response = await this.send(method, url, token, options.body);
    }

    if (!response.ok) {
      throw new YazioApiError(method, path, response.status, response.statusText, await response.text());
    }

    if (!options.schema) return undefined as T;

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // Don't echo the body: it is not what the API promised, so its content is unknown
      throw new YazioApiError(method, path, response.status, 'Response is not JSON', '');
    }
    const result = options.schema.safeParse(data);
    if (result.success) return result.data;

    this.onUnexpectedShape(method, path, result.error);
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
    let refreshError: unknown = new Error('No Yazio token to renew and no password to log in with');
    if (refreshToken) {
      try {
        return await this.keep(await this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken }));
      } catch (error) {
        refreshError = error;
      }
    }
    const { username, password } = this.credentials;
    // Without a password the refresh token was the only way: its error tells the caller why it failed
    if (password === undefined) throw refreshError;
    return this.keep(await this.requestToken({ grant_type: 'password', username, password }));
  }

  private async keep(token: Token): Promise<Token> {
    this.token = token;
    try {
      await this.onToken?.(token);
    } catch (error) {
      // The token itself is good, so the request goes on. Only the name: a message could quote the token.
      console.error(`⚠️ Could not save the renewed Yazio token: ${error instanceof Error ? error.name : typeof error}`);
    }
    return token;
  }

  private async requestToken(grant: Record<string, string>): Promise<Token> {
    const response = await this.fetch(`${API_BASE_URL}/oauth/token`, {
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
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // Not the parser's message: it can quote the body
      throw new Error('POST /oauth/token returned a response that is not JSON');
    }
    const result = TokenResponseSchema.safeParse(data);
    if (!result.success) this.onUnexpectedShape('POST', '/oauth/token', result.error);
    const token = (result.success ? result.data : data) as Omit<Token, 'expires_at'>;
    // Without a numeric expires_in the token counts as expired, so the next call logs in again
    return { ...token, expires_at: Date.now() + Number(token.expires_in) * 1000 };
  }

  private send(method: string, url: string, token: Token, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token.access_token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
