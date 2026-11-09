# Adding a remote server

The stdio server works only on the machine where it is installed. A remote server listens on HTTPS, so claude.ai in a browser and the mobile apps can connect to it. Each user signs in with their own Yazio account. This document tells you how to add the remote server to this repository. It does not exist yet ([#25](https://github.com/fliptheweb/yazio-mcp/issues/25)).

## How the code is split

| File | Role |
|---|---|
| `src/api/` | The Yazio API client (`YazioApi`): login, token renewal, endpoints, schemas |
| `src/server.ts` | `createServer(client: YazioApi): McpServer`: all tools, resources and prompts. It reads no environment variables and starts nothing. |
| `src/index.ts` | The stdio entry point: it reads `YAZIO_USERNAME` and `YAZIO_PASSWORD`, creates one `YazioApi`, and calls `serveStdio(() => createServer(client))` |

The remote server is one more entry point next to `src/index.ts`. It calls the same `createServer`, with a different `YazioApi` for each user. Do not copy tools into the remote entry point. Add a new tool to `src/server.ts`, and both servers get it.

## Design rules

- The remote server is one Web-standard `fetch` handler: `export default { fetch(request: Request): Promise<Response> }`. It routes by path: `/mcp`, the OAuth endpoints and `/.well-known/*`.
- The handler keeps no state in memory between requests. A serverless platform can start a new instance for any request, and it stops idle instances. All sessions and tokens live in Redis.
- No Docker image is necessary.

## Hosting requirements

The code must run without changes on these hosts:

| Host | What the code must give |
|---|---|
| Vercel | `api/index.ts` and `vercel.json`. Each request must finish within 300 seconds, and the code must not write files. |
| Railway, Render, a VPS | `node dist/remote.js`, which listens on `PORT` |

On every host:

- All configuration comes from environment variables (see the table below). A deploy template can then fill every value, and the user edits no files.
- The only storage is Redis. The code does not write to the local filesystem.
- The code needs no build step other than `npm ci` and `npm run build`.

## Steps

1. Add `src/remote.ts` that exports the `fetch` handler. Use `createMcpHandler` from `@modelcontextprotocol/server`. The handler calls the factory once for each HTTP request, and `ctx.authInfo` identifies the user:

   ```ts
   import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server';
   import { createServer } from './server.js';

   const mcp = createMcpHandler(async (ctx) => createServer(await clientFor(ctx.authInfo!)));
   const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] });

   export default {
     async fetch(request: Request): Promise<Response> {
       const { pathname } = new URL(request.url);
       if (pathname !== '/mcp') return oauth(request);
       const auth = await gate(request);
       if (auth instanceof Response) return auth;
       return mcp.fetch(request, { authInfo: auth });
     },
   };
   ```

   `clientFor` loads the user's Yazio token from Redis and creates a `YazioApi` with it. It must not log in to Yazio again on each request.

   You do not need the `mcp-handler` package from the Vercel docs. SDK v2 already gives `createMcpHandler`, `requireBearerAuth` and `oauthMetadataResponse`.

2. Add the OAuth 2.1 authorization server: dynamic client registration (`/register`), the authorization page with the Yazio login form (`/authorize`), the token endpoint (`/token`), and the metadata documents under `/.well-known/`. The Yazio login is the identity provider. Do not store the Yazio password: exchange it for a Yazio token at login, and keep only that token. Vercel does not supply an authorization server, so this code is part of the remote server.

3. Let `YazioHttp` (`src/api/http.ts`) start from a saved `Token` and report a renewed token through a callback, so that the server can write it back to Redis. Today `Credentials` requires `username` and `password`, and the client keeps the token in memory only.

4. Store the sessions in Redis: the OAuth clients, the authorization codes, the MCP access and refresh tokens, and the Yazio token for each user. Read the connection from `REDIS_URL` (`redis://` or `rediss://`) with a TCP client such as `redis`. This works on Railway, on a VPS and with any hosted Redis. Encrypt the Yazio tokens with `SESSION_SECRET`.

   Before you write the storage code, run `vercel install upstash` on a test project and look at the variables it adds. Third-party guides say that it adds only REST variables (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN`). If Vercel gives no TCP URL, use the Upstash REST client (`@upstash/redis`) on every host instead, with Upstash as the only supported Redis. Do not support both clients.

5. Add the Vercel entry file `api/index.ts`, which only re-exports `src/remote.ts`, and a `vercel.json` that sends every path to it:

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
   }
   ```

   Test on a preview deployment that `request.url` in the function still shows the original path (`/mcp`, `/token`). The Vercel docs do not say that for a rewrite. If it does not, give each path its own rewrite with a query parameter.

6. Build `dist/remote.js` as a second esbuild entry point for Node hosts. It starts an HTTP server on `PORT` with the same `fetch` handler, through a small adapter such as `srvx` or `@hono/node-server`. Keep it out of `dist/index.js`, so the stdio package that users install with `npx` does not get bigger.

7. Take `PUBLIC_URL` from the configuration when it is set. When it is not set, use the origin of the request (`new URL(request.url).origin`). Then Vercel and most VPS setups need no value.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `REDIS_URL` | Yes | The Redis connection URL for sessions and tokens. |
| `SESSION_SECRET` | Yes | A random string that encrypts the stored Yazio tokens. It must stay the same between deploys. |
| `PUBLIC_URL` | No | The HTTPS URL that clients use. The OAuth metadata and redirects use it. The default is the origin of the request. |
| `PORT` | No | `dist/remote.js` only. The default is `3000`. |
| `YAZIO_CLIENT_ID`, `YAZIO_CLIENT_SECRET` | No | The same optional overrides as the stdio server. |

The server does not need a Yazio username or password in its configuration. Each user types their own Yazio login on the sign-in page.

## Dependencies

`yazio-mcp` has no runtime `dependencies`, because esbuild bundles everything into `dist/index.js`. Keep that rule for the remote server too: add its libraries to `devDependencies`. esbuild bundles them into `dist/remote.js`, and Vercel bundles them into its function.

If the remote server needs a library that esbuild cannot bundle, move to npm workspaces at that time, in the same way as [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp):

- `packages/core` (private): `src/api/` and `src/server.ts`
- `packages/yazio-mcp` (published): the stdio entry point, bundled with no runtime dependencies
- `packages/remote` (private): the remote entry point and its dependencies

## Publishing

The remote server is a service that people deploy from the repository. It does not need an npm package, a Docker image or an MCP Registry entry. Publish it to npm only if self-hosters ask for an `npx` command, for example as a second `bin` in `yazio-mcp`.
