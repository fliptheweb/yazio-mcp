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

6. Add a `Dockerfile` that runs `node dist/remote.js`, and a GitHub Actions job that publishes the image to `ghcr.io/fliptheweb/yazio-mcp-remote` on each release. The next section describes what a self-hoster must be able to do with that image.

## Running it on your own infrastructure

This is the target setup for a person who hosts the server for themselves, or for their family or team. The remote server must support it with no code changes. Write this section into the README when the server is released.

### Requirements

- A machine that can run Docker: a small VPS, a home server, or a container platform such as Fly.io or Railway.
- A domain name with HTTPS, for example `https://yazio.example.com`. claude.ai connects only to HTTPS URLs that the internet can reach.
- A persistent volume for the session data.

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `PUBLIC_URL` | Yes | The HTTPS URL that clients use, for example `https://yazio.example.com`. The OAuth metadata and redirects use it. |
| `PORT` | No | The port inside the container. The default is `3000`. |
| `DATA_DIR` | No | The directory for sessions and tokens. The default is `/data`. Mount a volume here. |
| `SESSION_SECRET` | Yes | A random string that encrypts the stored Yazio tokens. Make one with `openssl rand -hex 32`. Keep it the same between restarts. |
| `YAZIO_CLIENT_ID`, `YAZIO_CLIENT_SECRET` | No | The same optional overrides as the stdio server. |

The server does not need a Yazio username or password in its configuration. Each user types their own Yazio login on the sign-in page.

### Start the container

```bash
docker run -d --name yazio-mcp \
  -p 127.0.0.1:3000:3000 \
  -v yazio-mcp-data:/data \
  -e PUBLIC_URL=https://yazio.example.com \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  --restart unless-stopped \
  ghcr.io/fliptheweb/yazio-mcp-remote:latest
```

The container listens on `127.0.0.1` only. Put a reverse proxy with TLS in front of it. For example, a Caddy configuration of two lines gets a certificate automatically:

```
yazio.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

On a container platform, set the variables in the platform, attach a volume at `/data`, and use the HTTPS domain that the platform gives you as `PUBLIC_URL`.

### Connect a client

1. In claude.ai, open **Settings**, then **Connectors**, and add a custom connector with the URL `https://yazio.example.com/mcp`.
2. Click **Connect**. The server shows its sign-in page.
3. Type your Yazio email and password. The server exchanges them for a Yazio token and does not store the password.

The connector then works in claude.ai, in Claude Desktop and in the mobile apps. Other MCP clients that support OAuth connect to the same URL.

### Updates and data

- To update, pull the new image and start the container again with the same volume and the same `SESSION_SECRET`. Users stay signed in.
- To sign out all users, delete the volume.
- Anyone who can reach the URL can sign in with a Yazio account. The server stores only the tokens of the users who sign in, and each user sees only their own data.

## Dependencies

`yazio-mcp` has no runtime `dependencies`, because esbuild bundles everything into `dist/index.js`. Keep that rule for the remote server too: add its libraries to `devDependencies`, and esbuild bundles them into `dist/remote.js`.

If the remote server needs a library that esbuild cannot bundle (for example a native SQLite driver), move to npm workspaces at that time, in the same way as [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp):

- `packages/core` (private): `src/api/` and `src/server.ts`
- `packages/yazio-mcp` (published): the stdio entry point, bundled with no runtime dependencies
- `packages/remote` (private): the remote entry point and its dependencies

## Publishing

The remote server is a service that people deploy, so the Docker image is its release artifact. It does not need an npm package or an MCP Registry entry. Publish it to npm only if self-hosters ask for an `npx` command, for example as a second `bin` in `yazio-mcp`.
