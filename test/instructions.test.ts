import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { YazioApi } from '../src/api/index.js';
import { createServer } from '../src/server.js';

/** What a client receives when it connects: the instructions and the server description */
async function initialize() {
  const server = createServer(
    new YazioApi({ username: 'user@example.com', password: 'secret' }, { fetch: (async () => new Response(null, { status: 204 })) as typeof fetch })
  );
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  const answer = new Promise<any>((resolve) => {
    client.onmessage = (message: any) => resolve(message);
  });
  await client.start();
  await client.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  } as any);
  const { result } = await answer;
  await server.close();
  return result;
}

test('a client is told when to use the tools, also without the word Yazio', async () => {
  const { instructions, serverInfo } = await initialize();

  assert.match(instructions, /^When to use:/m);
  for (const topic of ['ate or drank', 'calories', 'water', 'weight', 'exercise', "even when they don't name Yazio"]) {
    assert.ok(instructions.includes(topic), `instructions mention ${topic}`);
  }
  // The how-to part is still there
  assert.match(instructions, /Logging food: search_products/);
  assert.match(serverInfo.description, /food, calories, water, weight/);
});
