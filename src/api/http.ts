// HTTP transport and OAuth for the Yazio API (unofficial).
// Client id/secret are the public ones of the Yazio apps, same as in the `yazio` npm package.

export const YAZIO_API_BASE_URL = 'https://yzapi.yazio.com/v15';

const CLIENT_ID = '1_4hiybetvfksgw40o0sog4s884kwc840wwso8go4k8c04goo4c';
const CLIENT_SECRET = '6rok2m65xuskgkgogw40wkkk8sw0osg84s8cggsc4woos4s8o';

// Renew the token a bit before it expires, so a request doesn't race the expiry
const EXPIRY_MARGIN_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 1000;

export interface Credentials {
  username: string;
  password: string;
}

export interface Token {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Epoch ms, computed locally from expires_in */
  expires_at: number;
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface YazioHttpOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
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
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private token: Token | null = null;
  // Concurrent tool calls share one login/refresh instead of starting several
  private pendingToken: Promise<Token> | null = null;
  private readonly credentials: Credentials;

  constructor(credentials: Credentials, options: YazioHttpOptions = {}) {
    this.credentials = credentials;
    this.baseUrl = options.baseUrl ?? YAZIO_API_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
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

    // Writes answer with 204 or an empty body
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
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
    if (this.token?.refresh_token) {
      try {
        this.token = await this.requestToken({ grant_type: 'refresh_token', refresh_token: this.token.refresh_token });
        return this.token;
      } catch {
        // Refresh token expired or revoked: log in with the password below
      }
    }
    this.token = await this.requestToken({
      grant_type: 'password',
      username: this.credentials.username,
      password: this.credentials.password,
    });
    return this.token;
  }

  private async requestToken(grant: Record<string, string>): Promise<Token> {
    const response = await this.fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...grant }),
    });
    if (!response.ok) {
      // Don't echo the body: it can repeat the submitted credentials
      throw new YazioApiError('POST', '/oauth/token', response.status, response.statusText, '');
    }
    const token = (await response.json()) as Omit<Token, 'expires_at'>;
    return { ...token, expires_at: Date.now() + token.expires_in * 1000 };
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
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}
