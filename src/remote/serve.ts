import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { RequestInfo } from './app.js';

const MAX_BODY_BYTES = 1024 * 1024;
const HOST_HEADER = /^[A-Za-z0-9.\-:[\]]+$/;

/** The `fetch` function of the remote server */
export interface FetchHandler {
  fetch(request: Request, info?: RequestInfo): Promise<Response>;
}

export interface ServeOptions {
  /** Requests are addressed to this origin. Without it, to the host that the client named. */
  publicUrl?: URL;
}

class BadRequest extends Error {}
class BodyTooLarge extends Error {}
class UnexpectedBody extends Error {}

/** Serves a `fetch` handler on `node:http`, for hosts that run a Node process */
export function serve(app: FetchHandler, options: ServeOptions = {}): Server {
  const server = createServer((req, res) => void handle(app, options, req, res));
  // A client that sends its request slowly, or not at all, does not keep a connection for
  // long. Node has defaults for these. They are set here so that they do not change with Node.
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  // No timeout on the socket itself: an MCP response can be a stream that stays open
  return server;
}

async function handle(
  app: FetchHandler,
  options: ServeOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const url = requestUrl(req, options);
    const body = await readBody(req);
    const request = new Request(url, {
      method: req.method,
      headers: toHeaders(req),
      body,
      signal: controller.signal,
    });
    const response = await app.fetch(request, { clientAddress: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body as ReadableStream), res);
  } catch (error) {
    if (controller.signal.aborted) return; // the client went away mid-response
    if (res.headersSent) return void res.destroy();
    if (error instanceof BadRequest) return plain(res, 400, 'Bad request');
    if (error instanceof BodyTooLarge) return plain(res, 413, 'Request body too large');
    if (error instanceof UnexpectedBody) {
      return plain(res, 400, 'GET and HEAD requests carry no body');
    }
    console.error('Could not serve a request:', error instanceof Error ? error.name : typeof error);
    plain(res, 500, 'Internal server error');
  }
}

function requestUrl(req: IncomingMessage, options: ServeOptions): URL {
  // Exactly one Host header (RFC 9112, section 3.2). Node keeps the first of several, and a
  // proxy in front of this server can route by another one.
  const hosts = req.rawHeaders.filter(
    (name, index) => index % 2 === 0 && name.toLowerCase() === 'host'
  );
  if (hosts.length !== 1) throw new BadRequest();
  // Only an origin-form target: an absolute one, or "//host/..." which URL parsing reads
  // as a new authority, would let the client choose the URL the app sees
  const target = req.url ?? '';
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
    throw new BadRequest();
  }
  let base = options.publicUrl;
  if (!base) {
    const host = req.headers.host ?? '';
    if (!HOST_HEADER.test(host)) throw new BadRequest();
    try {
      // This server speaks plain HTTP. The app decides if that is safe for the host.
      base = new URL(`http://${host}`);
    } catch {
      throw new BadRequest();
    }
  }
  const url = new URL(target, base);
  if (url.origin !== base.origin) throw new BadRequest();
  return url;
}

function plain(res: ServerResponse, status: number, message: string): void {
  // These answers can come before the request body is read. Closing the connection
  // stops a client that continues to send a body which the server refused.
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(message);
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.startsWith(':') || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) {
      throw new UnexpectedBody();
    }
    req.resume();
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
