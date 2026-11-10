# The remote server

The stdio server works only on the machine where it is installed. The remote server is reachable over HTTPS, so that claude.ai in a browser and the mobile apps can connect to it. Each user signs in with their own Yazio account ([#25](https://github.com/fliptheweb/yazio-mcp/issues/25)).

The remote server is not part of the npm package. You run it from a copy of this repository.

## Run it

### On a Node host (Railway, Render, a VPS, a Raspberry Pi)

```sh
npm ci
npm run build
SESSION_SECRET=<a long random string> DATA_DIR=/var/lib/yazio-mcp node dist/remote.js
```

This command makes a `SESSION_SECRET`:

```sh
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

The process listens on `127.0.0.1:3000` and speaks plain HTTP. Put a TLS proxy or a tunnel in front of it (Caddy, nginx, Cloudflare Tunnel), and set `TRUST_PROXY=1`. On a platform that connects to the process from outside, set `HOST=0.0.0.0`.

`npm run dev:remote` runs the server from the TypeScript source.

### On Vercel

The repository has `api/index.ts` and `vercel.json`. Set `REDIS_URL`, `SESSION_SECRET` and `TRUST_PROXY=1` in the project. A file store does not work on Vercel, because the disk does not persist.

The Vercel entry is not tested on Vercel. See [What is not tested](#what-is-not-tested).

### Connect a client

The address of the server for a client is `https://<your host>/mcp`. Before you add it, open `https://<your host>/healthz` in a browser. It must show `{"status":"ok"}`.

In claude.ai:

1. Open **Settings**, then **Connectors**.
2. Select **Add custom connector**.
3. Type a name, for example `Yazio`, and the address `https://<your host>/mcp`. Leave the advanced OAuth fields empty: the server registers the client by itself.
4. Select **Add**, then **Connect** on the new connector.
5. A sign-in page of your server opens. Type your Yazio email and password. The page shows the address that it returns to after the sign-in.
6. The connector now shows as connected. In a chat, enable it in the tools menu, then ask for example "What did I eat today?".

The mobile apps use the connectors of the account, so the connector also works there after these steps. Add it in the browser first.

On a Team or Enterprise plan, an owner adds the connector for the organization, and every member sees it. Each member then selects **Connect** and signs in with their own Yazio account. Nobody sees the data of another member, because each sign-in has its own Yazio session.

Other MCP clients that support remote servers with OAuth work the same way: give them the address, and sign in on the page that opens.

To stop using it, disconnect or remove the connector in claude.ai. The server keeps a sign-in until its refresh token is revoked or expires, at most 30 days after the last refresh. To sign out every user at once, change `SESSION_SECRET`.

## Configuration

All configuration comes from environment variables.

| Variable | Required | Meaning |
|---|---|---|
| `REDIS_URL` | One of the two | The storage is Redis. The value starts with `redis://` or `rediss://`. Use this when more than one process serves requests, for example on Vercel. |
| `DATA_DIR` | One of the two | The storage is one JSON file in this directory. Use this for one process on a host with a persistent disk. |
| `SESSION_SECRET` | Yes | A random string of 32 characters or more. It encrypts the stored Yazio tokens. It must stay the same between deploys. If you change it, every user must sign in again. |
| `PUBLIC_URL` | No | The HTTPS origin that clients use, for example `https://yazio.example.com`. The default is the origin of the request, which comes from the `Host` header that the client sends. Set it in production, and always when the server is reachable under more than one name. |
| `TRUST_PROXY` | No | `1` or `true`. Set it when a proxy in front of the server ends TLS. See [Behind a proxy](#behind-a-proxy). |
| `HOST` | No | `dist/remote.js` only. The listen address. The default is `127.0.0.1`. |
| `PORT` | No | `dist/remote.js` only. The default is `3000`. |
| `YAZIO_CLIENT_ID`, `YAZIO_CLIENT_SECRET` | No | The same optional overrides as the stdio server. |

Set only one of `REDIS_URL` and `DATA_DIR`. The server does not start with both, and it does not start with none.

The server does not need a Yazio username or password in its configuration.

## How the code is split

| File | Role |
|---|---|
| `src/server.ts` | `createServer(client: YazioApi): McpServer`: all tools, resources and prompts. The stdio server and the remote server call the same function. |
| `src/remote.ts` | The remote server as one Web-standard handler: `export default { fetch(request) }`. To import it starts nothing. |
| `src/remote/app.ts` | The routes, the response headers, the rate limits and the request log |
| `src/remote/oauth.ts` | The OAuth 2.1 authorization server and the Yazio session of each user |
| `src/remote/pages.ts` | The sign-in page and the information page |
| `src/remote/store.ts` | The `Store` interface: a key-value store with expiry |
| `src/remote/store-redis.ts`, `src/remote/store-file.ts` | The two stores |
| `src/remote/crypto.ts` | Encryption of the stored Yazio tokens |
| `src/remote/config.ts` | Reads and checks the environment variables |
| `src/remote/serve.ts`, `src/remote/node.ts` | The Node entry point: a plain HTTP server on `HOST` and `PORT` that calls the same handler. The build writes it to `dist/remote.js`. |
| `api/index.ts`, `vercel.json` | The Vercel entry: it re-exports `src/remote.ts`, and a rewrite sends every path to it |

Do not copy tools into the remote server. Add a new tool to `src/server.ts`, and both servers get it.

Keep the code generic: it must not depend on one host. A setup such as the Raspberry Pi deployment in [dm807cam/yazio-mcp](https://github.com/dm807cam/yazio-mcp) (a systemd unit, Cloudflare Tunnel and automatic updates) must be able to run `dist/remote.js` with only environment variables. Host-specific scripts stay outside this repository.

Everything that the handler must remember between requests goes through the `Store` interface. To add a storage, write one more class with the nine methods of `Store`. `deleteIf`, `replaceIf`, `take`, `increment` and `set` with `if` must each be one atomic step: the sign-in, the refresh and the renewal of a Yazio token depend on that.

The remote libraries are in `devDependencies` only. The build bundles them into `dist/remote.js`. `dependencies` stays empty, and `dist/remote.js` is not in the npm package or in the MCPB bundle.

## Endpoints

| Path | Role |
|---|---|
| `/mcp` | The MCP endpoint. It needs an access token. |
| `/.well-known/oauth-protected-resource/mcp` | Tells a client which authorization server protects `/mcp` (RFC 9728) |
| `/.well-known/oauth-authorization-server` | The metadata of the authorization server (RFC 8414) |
| `/register` | Dynamic client registration (RFC 7591) |
| `/authorize` | Starts a sign-in and shows the sign-in page |
| `/login` | Receives the sign-in form |
| `/token` | Exchanges a code or a refresh token for tokens |
| `/revoke` | Revokes a token (RFC 7009) |
| `/healthz` | Answers `{"status":"ok"}`. It does not use the storage. |

## What the server stores

- The registered clients. A client that nobody uses expires after one day.
- The sign-ins in progress (10 minutes) and the authorization codes (1 minute).
- The access tokens (1 hour) and the refresh tokens (30 days), as SHA-256 hashes only.
- One Yazio token for each sign-in, encrypted with AES-256-GCM. The key comes from `SESSION_SECRET`.
- Counters for the rate limits. The key holds a keyed hash of the client address, not the address.

The server does not store the Yazio password. It sends the password to Yazio one time. From the answer it keeps only the access token, the refresh token and their lifetime. It does not store food, weight or other diary data: each tool call reads them from Yazio and returns them to the client.

The log has one line for each request: the method, the route, the status, and the duration. A path that is not a route of the server shows as `(other)`. The log does not have query strings, tokens, addresses or account data. An error line has only the type of the error. For an error from Yazio it also has the method, the Yazio path with its ids replaced by `:id`, and the status. When a Yazio answer has an unexpected shape, the log has the path and the number of differences, not the answer.

## Security rules

- A client must use PKCE with `S256`. An authorization code works one time. If the same client sends a code a second time within one hour, the server ends that sign-in. A code from another client, or sent to another address of the server, is only refused.
- Each refresh gives a new refresh token. If the client sends an old refresh token, the server ends that sign-in. When two refreshes of one token run at the same time, one of them gets new tokens and the other gets `invalid_grant`.
- A redirect address must be registered. Plain `http` is allowed only for `localhost`. Schemes such as `javascript:` and `data:` are refused.
- Tokens are bound to the address of the server (RFC 8707). A token for one address does not work on another address.
- The sign-in page shows where it sends the user after the sign-in. Another site cannot show the page in a frame.
- When a client revokes its refresh token, or when Yazio refuses to renew the Yazio token, the server ends that sign-in. The user must sign in again. A revocation sent to another address of the server changes nothing.
- On plain HTTP the server refuses to work, except for `localhost`. Only `/healthz` and CORS preflight requests get a normal answer.
- `node dist/remote.js` refuses a request without exactly one `Host` header.

Size limits:

- The `state` of a client: 2048 characters.
- The body of `/register`, `/authorize`, `/login`, `/token` and `/revoke`: 64 KiB. A larger body gets status 413. On `/authorize` and `/login` it gets an error page with status 400.
- The body of `/mcp`: 1 MiB with `node dist/remote.js`. On Vercel the limit of the platform applies.

Rate limits for each client address:

| Path | Limit |
|---|---|
| `/login` | 10 in 15 minutes |
| `/authorize` | 100 in 15 minutes |
| `/token`, `/revoke` | 50 in 15 minutes |
| `/register` | 20 in 60 minutes |

The server also accepts no more than 1000 registrations in one day, and no more than 1000 sign-ins that started in the current or the previous 10 minutes. A sign-in is open for 10 minutes at most, so this also limits the sign-ins in progress to 1000.

## Behind a proxy

When a proxy ends TLS, the process sees plain HTTP and the address of the proxy. `TRUST_PROXY=1` tells the server to read two headers:

- The last entry of `X-Forwarded-For` is the client address for the rate limits. It is the entry that the nearest proxy adds.
- The last entry of `X-Forwarded-Proto` is the scheme, when `PUBLIC_URL` is not set.

The server never reads `X-Forwarded-Host`.

- Without `TRUST_PROXY`, the server ignores these headers. Behind a proxy, all users then share one rate limit, for example 10 sign-ins in 15 minutes for everyone.
- Do not set `TRUST_PROXY` when clients can reach the process directly. A client can then write its own headers.
- With two proxies in a row, the last entry is the address of the first proxy. All users then share one rate limit.

## Limits

- `DATA_DIR` is for one process. Two processes that write the same file lose data. Use `REDIS_URL` for more than one process.
- The file store reads the file once and writes the whole file again after each change. It is for a personal server or a small group.
- Redis must be version 6.2 or later. The tests ran on Redis 7.0.
- With `REDIS_URL`, the server needs Redis for almost every request. If Redis is not reachable, those requests get status 500. `/healthz` does not need Redis.
- An access token is a bearer token: whoever has it can use it until it expires or is revoked.
- If the storage stalls for more than 45 seconds while the server renews a Yazio token, a second request can renew the same token at Yazio. The newer token stays. If Yazio then refuses one of the two renewals, the user can have to sign in again.
- If the process stops in the middle of a refresh, after it marked the old refresh token as used, the client gets no new tokens. Its next refresh with the old token counts as a replay, and the user must sign in again.

## Tests

`npm test` runs the tests of the remote server on the file store. No Yazio account and no network are necessary: the tests use a fake Yazio.

To run the same tests on Redis, start an empty Redis and give its address. The tests delete all keys in that database.

```sh
TEST_REDIS_URL=redis://127.0.0.1:6379 npx tsx --test --test-concurrency=1 test/*.test.ts
```

Seven tests move the clock forward to let a stored value or a lock expire. They run on the file store only, because Redis uses its own clock.

### What is not tested

Nobody has deployed this code to Vercel. Test these points on a preview deployment before you rely on it:

- `request.url` in the function must show the original path (`/mcp`, `/token`) after the rewrite in `vercel.json`. If it does not, give each path its own rewrite.
- Vercel must compile `api/index.ts`, which imports `../src/remote.js` from a TypeScript source file.
- The storage must be a Redis that accepts a TCP connection with a `redis://` or `rediss://` address.

## Publishing

The remote server is a service that people deploy from the repository. It does not need an npm package, a Docker image or an MCP Registry entry.
