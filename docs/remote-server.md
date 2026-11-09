# Adding a remote server

The stdio server works only on the machine where it is installed. A remote server listens on HTTPS, so claude.ai in a browser and the mobile apps can connect to it. Each user signs in with their own Yazio account. This document tells you how to add the remote server to this repository. It does not exist yet ([#25](https://github.com/fliptheweb/yazio-mcp/issues/25)).

## How the code is split

| File | Role |
|---|---|
| `src/api/` | The Yazio API client (`YazioApi`): login, token renewal, endpoints, schemas |
| `src/server.ts` | `createServer(client: YazioApi): McpServer`: all tools, resources and prompts. It reads no environment variables and starts nothing. |
| `src/index.ts` | The stdio entry point: it reads `YAZIO_USERNAME` and `YAZIO_PASSWORD`, creates one `YazioApi`, and calls `serveStdio(() => createServer(client))` |

The remote server is one more entry point next to `src/index.ts`. It calls the same `createServer`, with a different `YazioApi` for each user. Do not copy tools into the remote entry point. Add a new tool to `src/server.ts`, and both servers get it.

## Steps

1. Add `src/remote.ts`. Use `createMcpHandler` from `@modelcontextprotocol/server`. The handler calls the factory once for each HTTP request, and `ctx.authInfo` identifies the user:

   ```ts
   import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server';
   import { createServer } from './server.js';

   const handler = createMcpHandler((ctx) => createServer(clientFor(ctx.authInfo!)));
   const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] });

   async function fetch(request: Request): Promise<Response> {
     const auth = await gate(request);
     if (auth instanceof Response) return auth;
     return handler.fetch(request, { authInfo: auth });
   }
   ```

   `clientFor` must return the same `YazioApi` for the same user on each request. A new `YazioApi` for each request logs in to Yazio again on each tool call.

2. Add the OAuth 2.1 authorization server: dynamic client registration, the authorization page with the Yazio login form, the token endpoint, and the metadata documents (`oauthMetadataResponse` and `getOAuthProtectedResourceMetadataUrl` in the SDK help with these). The Yazio login is the identity provider. Do not store the Yazio password: exchange it for a Yazio token at login, and keep only that token.

3. Let `YazioHttp` (`src/api/http.ts`) start from a saved `Token` and report a renewed token, so that the server can store it. Today `Credentials` requires `username` and `password`, and the client keeps the token in memory only.

4. Store the sessions (the MCP access tokens and the Yazio tokens for each user) on disk or in a database, so that a deploy or a restart does not sign users out.

5. Build the remote server as a second esbuild entry point, for example `dist/remote.js`. Keep it out of `dist/index.js`, so the stdio package that users install with `npx` does not get bigger.

6. Add a `Dockerfile` that runs `node dist/remote.js`, and a section in the README about deployment: the public URL, the port, the storage path and the environment variables. Put a reverse proxy with TLS in front of the server.

## Dependencies

`yazio-mcp` has no runtime `dependencies`, because esbuild bundles everything into `dist/index.js`. Keep that rule for the remote server too: add its libraries to `devDependencies`, and esbuild bundles them into `dist/remote.js`.

If the remote server needs a library that esbuild cannot bundle (for example a native SQLite driver), move to npm workspaces at that time, in the same way as [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp):

- `packages/core` (private): `src/api/` and `src/server.ts`
- `packages/yazio-mcp` (published): the stdio entry point, bundled with no runtime dependencies
- `packages/remote` (private): the remote entry point and its dependencies

## Publishing

The remote server is a service that you deploy. Users connect to its URL, and they do not install it. So it does not need an npm package or an MCP Registry entry. Publish it only if self-hosters ask for an `npx` command, for example as a second `bin` in `yazio-mcp`.
