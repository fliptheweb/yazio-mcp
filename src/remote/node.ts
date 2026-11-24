#!/usr/bin/env node

import { remoteApp } from '../remote.js';
import { ConfigError, settingsFromEnv } from './config.js';
import { serve } from './serve.js';

// The entry point for hosts that run a Node process: the same handler as on a
// serverless host, behind a plain HTTP server on HOST and PORT

try {
  const { host, port, publicUrl } = settingsFromEnv();
  const app = remoteApp();
  const server = serve(app, { publicUrl });

  server.listen(port, host, () => {
    console.log(`🚀 Yazio MCP listening on http://${host}:${port}`);
    if (publicUrl) console.log(`   MCP endpoint: ${new URL('/mcp', publicUrl).href}`);
  });

  const shutdown = () => {
    server.close(() => void app.close().finally(() => process.exit(0)));
    server.closeIdleConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
