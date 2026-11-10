import { createRemoteApp, type RemoteApp, type RequestInfo } from './remote/app.js';
import { ConfigError, configFromEnv } from './remote/config.js';

let app: RemoteApp | undefined;
let reported = false;

/** The app for this process. The first call reads the settings from the environment. */
export function remoteApp(): RemoteApp {
  return (app ??= createRemoteApp(configFromEnv()));
}

/**
 * The remote server: MCP over HTTPS, where each user signs in to their own Yazio
 * account. A host calls `fetch` for each request. To import this file starts nothing.
 */
export default {
  async fetch(request: Request, info?: RequestInfo): Promise<Response> {
    let handler: RemoteApp;
    try {
      handler = remoteApp();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      if (!reported) console.error(`❌ ${error.message}`);
      reported = true;
      return new Response(
        JSON.stringify({
          error: 'server_error',
          error_description: 'The server is not configured. See its log.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }
      );
    }
    return handler.fetch(request, info);
  },
};
