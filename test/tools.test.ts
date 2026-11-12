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
  const requests: { method: string; url: string; body: any }[] = [];
  const fetchMock = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return json({ token_type: 'bearer', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    requests.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined });
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
  return { text: answer.result.content[0].text as string, posted, requests };
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

test('add_user_consumed_item sends a null serving when none is given, or the app hides the entry', async () => {
  const { posted } = await callTool('add_user_consumed_item', {
    product_id: '9dd69912-becf-11e6-8839-e0071b8a8723',
    date: '2026-01-15 08:30:00',
    daytime: 'breakfast',
    amount: 150,
  });

  assert.deepEqual(posted[0].products, [
    {
      id: posted[0].products![0].id,
      product_id: '9dd69912-becf-11e6-8839-e0071b8a8723',
      date: '2026-01-15 08:30:00',
      daytime: 'breakfast',
      amount: 150,
      serving: null,
      serving_quantity: null,
    },
  ]);
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
  assert.deepEqual(
    body.products!.map((entry: any) => [entry.serving, entry.serving_quantity]),
    [['mug.small', 1], [null, null]]
  );
  // The meal ID itself is in the request, not in the answer: only the new entries are listed
  assert.deepEqual(text.match(UUID), sent);
});

test('update_user_recipe recalculates the nutrients per portion and replaces the recipe', async () => {
  const id = '17c69708-1e7b-4e8d-92a9-a5bcd9715bbc';
  const product = (name: string, kcalPerGram: number) => ({ name, producer: null, base_unit: 'g', nutrients: { 'energy.energy': kcalPerGram } });
  const { requests } = await callTool(
    'update_user_recipe',
    {
      id,
      name: 'Porridge',
      portion_count: 2,
      ingredients: [
        { product_id: '9e721086-becf-11e6-9c03-e0071b8a8723', amount: 100 },
        { product_id: '8b8de2f4-e91f-4cbf-a78c-9ad14ddf96ab', amount: 200 },
      ],
    },
    {
      '/products/9e721086-becf-11e6-9c03-e0071b8a8723': product('Oats', 3.7),
      '/products/8b8de2f4-e91f-4cbf-a78c-9ad14ddf96ab': product('Milk', 0.5),
    }
  );

  const put = requests.find((r) => r.method === 'PUT')!;
  assert.ok(put.url.endsWith(`/user/recipes/${id}`));
  assert.equal(put.body.id, id);
  // (100 g × 3.7 + 200 g × 0.5) / 2 portions
  assert.equal(put.body.nutrients['energy.energy'], 235);
  assert.deepEqual(put.body.servings.map((s: { name: string }) => s.name), ['Oats', 'Milk']);
});

test('get_user_products lists the user\'s products with their ids', async () => {
  const { text } = await callTool('get_user_products', {}, {
    '/user/products': ['9e721086-becf-11e6-9c03-e0071b8a8723'],
    '/products/9e721086-becf-11e6-9c03-e0071b8a8723': { name: 'Granola', nutrients: { 'energy.energy': 4.5 } },
  });

  assert.match(text, /"id": "9e721086-becf-11e6-9c03-e0071b8a8723"/);
  assert.match(text, /"name": "Granola"/);
});

const favoritesOf = (text: string) => JSON.parse(text.slice(text.indexOf('{')));

test('get_user_favorites names each favorite product and recipe', async () => {
  const { text } = await callTool('get_user_favorites', {}, {
    '/user/favorites/product': [
      { id: '4aa6dd13-d417-47da-ac1b-823b873ea303', product_id: '9dd69912-becf-11e6-8839-e0071b8a8723', amount: 150, serving: 'fruit.regular', serving_quantity: 1 },
    ],
    '/user/favorites/recipe': [{ id: 'e06ffe5c-6fae-441d-b8e9-847d4437f576', recipe_id: '17c69708-1e7b-4e8d-92a9-a5bcd9715bbc', portion_count: 2 }],
    '/products/9dd69912-becf-11e6-8839-e0071b8a8723': { name: 'Banana', producer: 'Farm', nutrients: { 'energy.energy': 0.9 } },
    '/recipes/17c69708-1e7b-4e8d-92a9-a5bcd9715bbc': { name: 'Nut mix' },
  });

  const favorites = favoritesOf(text);
  assert.match(text, /^Favorites \(1 products, 1 recipes\)/);
  assert.equal(favorites.products[0].name, 'Banana (Farm)');
  assert.equal(favorites.products[0].product_id, '9dd69912-becf-11e6-8839-e0071b8a8723');
  assert.equal(favorites.products[0].amount, 150);
  assert.equal(favorites.recipes[0].name, 'Nut mix');
  assert.equal(favorites.recipes[0].id, 'e06ffe5c-6fae-441d-b8e9-847d4437f576');
});

test('get_user_favorites still lists a favorite whose name cannot be read', async () => {
  const log = console.error;
  console.error = () => {};
  let text: string;
  try {
    ({ text } = await callTool('get_user_favorites', {}, {
      '/user/favorites/product': [{ id: '4aa6dd13-d417-47da-ac1b-823b873ea303', product_id: '9dd69912-becf-11e6-8839-e0071b8a8723', amount: 100 }],
      '/user/favorites/recipe': [],
    }));
  } finally {
    console.error = log;
  }

  const favorites = favoritesOf(text);
  assert.equal(favorites.products.length, 1);
  assert.equal(favorites.products[0].name, null);
  assert.equal(favorites.products[0].product_id, '9dd69912-becf-11e6-8839-e0071b8a8723');
});
