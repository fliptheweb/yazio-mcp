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

- The remote server is one Web-standard `fetch` handler: `export default { fetch(request: Request): Promise<Response> }`. It routes by path: `/mcp`, the OAuth endpoints and `/.well-known/*`. The same handler runs as a Vercel Function and as a Node process.
- The handler keeps no state in memory between requests. A serverless platform can start a new instance for any request, and it stops idle instances. All sessions and tokens live in Redis.
- No Docker image is necessary. Vercel builds the function from the repository, and Railway or a VPS runs `node dist/remote.js`.

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

8. Add the deploy buttons (see [Deploy buttons](#deploy-buttons)).

## Running it on your own infrastructure

This is the target setup for a person who hosts the server for themselves, or for their family or team. The remote server must support it with no code changes. Write this section into the README when the server is released.

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `PUBLIC_URL` | No | The HTTPS URL that clients use, for example `https://yazio.example.com`. The OAuth metadata and redirects use it. The default is the origin of the request. Set it if a proxy changes the host name. |
| `REDIS_URL` | Yes | The Redis connection URL for sessions and tokens. |
| `SESSION_SECRET` | Yes | A random string that encrypts the stored Yazio tokens. Make one with `openssl rand -hex 32`. Keep it the same between deploys. |
| `PORT` | No | Node hosts only. The default is `3000`. |
| `YAZIO_CLIENT_ID`, `YAZIO_CLIENT_SECRET` | No | The same optional overrides as the stdio server. |

The server does not need a Yazio username or password in its configuration. Each user types their own Yazio login on the sign-in page.

### On Railway

1. Click **Deploy on Railway** in the README.
2. Wait for the deploy to finish. The template creates the server and a Redis service, generates `SESSION_SECRET`, and sets `PUBLIC_URL` to the Railway domain.
3. Copy the domain of the server service. You need it to connect a client.

The Hobby plan is sufficient for one person. The server runs all the time, so the first request is fast.

### On Vercel

1. Click **Deploy with Vercel** in the README. Vercel forks the repository into your account and creates the project.
2. Accept the Redis store that the button adds.
3. Type a value for `SESSION_SECRET`. Make one with `openssl rand -hex 32`. Vercel cannot generate it for you.
4. Deploy, then copy the production domain (`https://<project>.vercel.app`, or your own domain).

The Hobby plan is free, but only for non-commercial use. Each tool call is one short request, far below the 300-second function limit.

Vercel Deployment Protection blocks clients that are not signed in to Vercel. Keep the production domain public, or claude.ai cannot connect.

### On a VPS or a home server

1. Install Node.js 20 or later and Redis, or use a hosted Redis.
2. Clone the repository, then run `npm ci` and `npm run build`.
3. Set the variables and run `node dist/remote.js` under a process manager, for example a systemd service with `Restart=always`.
4. Put a reverse proxy with TLS in front of the server. For example, a Caddy configuration of two lines gets a certificate automatically:

   ```
   yazio.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

### Connect a client

1. In claude.ai, open **Settings**, then **Connectors**, and add a custom connector with the URL `<PUBLIC_URL>/mcp`.
2. Click **Connect**. The server shows its sign-in page.
3. Type your Yazio email and password. The server exchanges them for a Yazio token and does not store the password.

The connector then works in claude.ai, in Claude Desktop and in the mobile apps. Other MCP clients that support OAuth connect to the same URL.

### Updates and data

- To update on Railway, open the service and accept the template update, or redeploy from the latest commit. To update on Vercel, sync the fork, and Vercel deploys it. On a VPS, pull, build and restart. Users stay signed in when `REDIS_URL` and `SESSION_SECRET` stay the same.
- To sign out all users, clear the Redis database.
- Anyone who can reach the URL can sign in with a Yazio account. The server stores only the tokens of the users who sign in, and each user sees only their own data.

## Deploy buttons

Each button goes in the README when the remote server is released. A button is useful only when it creates the server, the Redis, the secret and the URL with as little user input as possible.

### Railway template

The maintainer creates the template once in the Railway dashboard, from this repository, and publishes it. The template has two services:

- `redis`: the Railway Redis service.
- `yazio-mcp`: this repository, with the start command `node dist/remote.js`, a generated domain, and these variables:

  ```
  REDIS_URL=${{redis.REDIS_URL}}
  SESSION_SECRET=${{secret(64, "0123456789abcdef")}}
  PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
  ```

Railway runs `secret()` once for each deploy of the template, so each user gets a different secret. The README button links to `https://railway.com/deploy/<template-code>`.

### Vercel button

The repository needs only `api/index.ts` and `vercel.json`. The button is a link to `https://vercel.com/new/clone` with these URL-encoded parameters:

- `repository-url`: `https://github.com/fliptheweb/yazio-mcp`
- `env`: `SESSION_SECRET`
- `envDescription`: a short text that tells the user to run `openssl rand -hex 32`
- `envLink`: a link to this document
- `stores`: a JSON array that adds the Upstash Redis store, for example `[{"type":"integration","integrationSlug":"upstash","productSlug":"upstash-kv","protocol":"storage"}]`. Read the current slugs from the Upstash page in the Vercel Marketplace.

The Vercel docs do not allow secret values in the URL, so the user must type `SESSION_SECRET`.

### Options that we do not support now

- **Render** (`render.yaml` and `render.com/deploy?repo=…`): a Blueprint can create Redis (`type: keyvalue`) and generate the secret (`generateValue: true`). But a free web service stops after 15 minutes without traffic, and the free Key Value store has persistence off, so a restart signs users out. Add it if users ask for it.
- **Cloudflare Workers** (`deploy.workers.cloudflare.com/?url=…`): it has a good free plan and creates KV namespaces automatically. But it gives KV, not Redis, so it needs a second storage implementation.
- **One shared instance run by the maintainer**: this is the easiest for users. But the maintainer then holds the Yazio tokens of every user for an unofficial API and pays for the hosting. Self-hosting with buttons avoids both problems.

## Dependencies

`yazio-mcp` has no runtime `dependencies`, because esbuild bundles everything into `dist/index.js`. Keep that rule for the remote server too: add its libraries to `devDependencies`. esbuild bundles them into `dist/remote.js`, and Vercel bundles them into its function.

If the remote server needs a library that esbuild cannot bundle, move to npm workspaces at that time, in the same way as [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp):

- `packages/core` (private): `src/api/` and `src/server.ts`
- `packages/yazio-mcp` (published): the stdio entry point, bundled with no runtime dependencies
- `packages/remote` (private): the remote entry point and its dependencies

## Publishing

The remote server is a service that people deploy from the repository. It does not need an npm package, a Docker image or an MCP Registry entry. Publish it to npm only if self-hosters ask for an `npx` command, for example as a second `bin` in `yazio-mcp`.
