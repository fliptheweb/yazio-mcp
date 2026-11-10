import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { YazioApi } from '../src/api/index.js';
import { createServer } from '../src/server.js';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** A server on a fake Yazio. Returns what the tool answered and the diary entries that Yazio received. */
async function callTool(name: string, args: Record<string, unknown>, routes: Record<string, unknown> = {}) {
  const posted: { products?: { id: string }[]; simple_products?: { id: string }[]; recipe_portions?: { id: string }[] }[] = [];
  const fetchMock = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return json({ token_type: 'bearer', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    if (url.endsWith('/user/consumed-items') && init.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }
    const path = Object.keys(routes).find((route) => url.endsWith(route));
    return path ? json(routes[path]) : new Response(null, { status: 204 });
  };
  const server = createServer(
    new YazioApi({ username: 'user@example.com', password: 'secret' }, { fetch: fetchMock as typeof fetch })
  );
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);

  const answers = new Map<number, (message: any) => void>();
  client.onmessage = (message: any) => answers.get(message.id)?.(message);
  await client.start();
  let nextId = 1;
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      answers.set(id, resolve);
      void client.send({ jsonrpc: '2.0', id, method, params } as any);
    });

  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
  const answer = await request('tools/call', { name, arguments: args });
  await server.close();

  assert.equal(answer.result?.isError, undefined, JSON.stringify(answer));
  return { text: answer.result.content[0].text as string, posted };
}

test('add_user_consumed_item returns the ID of the entry it created', async () => {
  const { text, posted } = await callTool('add_user_consumed_item', {
    product_id: '9dd69912-becf-11e6-8839-e0071b8a8723',
    date: '2026-01-15 08:30:00',
    daytime: 'breakfast',
    amount: 150,
  });

  const sent = posted[0].products!.map((entry) => entry.id);
  assert.equal(sent.length, 1);
  assert.deepEqual(text.match(UUID), sent);
});

test('add_user_consumed_meal returns the ID of every entry it created', async () => {
  const meal = {
    id: 'e06ffe5c-6fae-441d-b8e9-847d4437f576',
    name: 'Coffee',
    products: [
      { product_id: '9e721086-becf-11e6-9c03-e0071b8a8723', amount: 60, serving: 'mug.small', serving_quantity: 1, type: 'product' },
      { product_id: '8b8de2f4-e91f-4cbf-a78c-9ad14ddf96ab', amount: 25, serving: null, serving_quantity: null, type: 'product' },
    ],
    simple_products: [{ name: 'Biscuit', nutrients: { 'energy.energy': 50 }, type: 'simple_product' }],
    recipe_portions: [{ recipe_id: '17c69708-1e7b-4e8d-92a9-a5bcd9715bbc', portion_count: 0.5, type: 'recipe_portion' }],
  };
  const { text, posted } = await callTool(
    'add_user_consumed_meal',
    { meal_id: meal.id, date: '2026-01-15 09:00:00', daytime: 'breakfast' },
    { '/user/meals': [meal] }
  );

  const body = posted[0];
  const sent = [...body.products!, ...body.simple_products!, ...body.recipe_portions!].map((entry) => entry.id);
  assert.equal(sent.length, 4);
  // The meal ID itself is in the request, not in the answer: only the new entries are listed
  assert.deepEqual(text.match(UUID), sent);
});
