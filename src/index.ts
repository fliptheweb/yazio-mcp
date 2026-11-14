#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { YazioApi } from './api/index.js';
import { createServer } from './server.js';

const username = process.env.YAZIO_USERNAME;
const password = process.env.YAZIO_PASSWORD;

if (!username || !password) {
  console.error('❌ YAZIO_USERNAME and YAZIO_PASSWORD environment variables are required');
  console.error('💡 Please set these environment variables with your Yazio account credentials');
  process.exit(1);
}

const client = new YazioApi(
  {
    username,
    password,
    clientId: process.env.YAZIO_CLIENT_ID || undefined,
    clientSecret: process.env.YAZIO_CLIENT_SECRET || undefined,
  },
  { appUserAgent: process.env.YAZIO_APP_USER_AGENT || undefined },
);

client.getUser().then(
  () => console.error('✅ Successfully authenticated with Yazio using environment variables'),
  (error: Error) => {
    console.error('❌ Failed to authenticate with Yazio:', error.message);
    console.error('💡 Please check your YAZIO_USERNAME and YAZIO_PASSWORD environment variables');
    process.exit(1);
  },
);

const stdio = serveStdio(() => createServer(client), {
  legacy: 'serve',
  onerror: (error) => console.error('MCP stdio error:', error),
});
console.error('Yazio MCP server running on stdio');

process.on('SIGINT', async () => {
  await stdio.close();
  process.exit(0);
});
