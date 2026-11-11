import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YazioApi, YazioApiError, API_BASE_URL, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../src/api/index.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: Call) => Response | undefined;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const tokenResponse = (n: number, expiresIn = 3600) =>
  json({ token_type: 'bearer', access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: expiresIn });

function mockApi(handler: Handler = () => undefined) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetchMock = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handled = handler(call);
    if (handled) return handled;
    if (call.url.endsWith('/oauth/token')) return tokenResponse(++tokens);
    return new Response(null, { status: 204 });
  };
  const api = new YazioApi({ username: 'user@example.com', password: 'secret' }, { fetch: fetchMock as typeof fetch });
  const apiCalls = () => calls.filter((c) => !c.url.endsWith('/oauth/token'));
  const tokenCalls = () => calls.filter((c) => c.url.endsWith('/oauth/token'));
  return { api, calls, apiCalls, tokenCalls };
}

test('logs in with the password grant once and reuses the token', async () => {
  const { api, apiCalls, tokenCalls } = mockApi((c) => (c.url.endsWith('/user/dietary-preferences') ? json({ restriction: null }) : undefined));

  await api.getDietaryPreferences();
  await api.getDietaryPreferences();

  assert.equal(tokenCalls().length, 1);
  const login = tokenCalls()[0];
  assert.equal(login.method, 'POST');
  assert.equal(login.url, `${API_BASE_URL}/oauth/token`);
  assert.equal(login.headers['Content-Type'], 'application/json');
  assert.deepEqual(
    { ...(login.body as object), client_id: undefined, client_secret: undefined },
    { grant_type: 'password', username: 'user@example.com', password: 'secret', client_id: undefined, client_secret: undefined },
  );
  assert.equal(apiCalls()[1].headers.Authorization, 'Bearer access-1');
});

test('login uses the default client id/secret unless one is given', async () => {
  const defaults = mockApi();
  await defaults.api.removeConsumedItems(['x']);
  assert.deepEqual(
    [(defaults.tokenCalls()[0].body as Record<string, string>).client_id, (defaults.tokenCalls()[0].body as Record<string, string>).client_secret],
    [DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET],
  );

  const tokens: unknown[] = [];
  const custom = new YazioApi(
    { username: 'u', password: 'p', clientId: 'my-id', clientSecret: 'my-secret' },
    {
      fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
        if (String(input).endsWith('/oauth/token')) {
          tokens.push(JSON.parse(String(init.body)));
          return tokenResponse(1);
        }
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    },
  );
  await custom.removeConsumedItems(['x']);
  assert.deepEqual(
    [(tokens[0] as Record<string, string>).client_id, (tokens[0] as Record<string, string>).client_secret],
    ['my-id', 'my-secret'],
  );
});

test('concurrent requests share one login', async () => {
  const { api, tokenCalls } = mockApi((c) => (c.url.endsWith('/user/recipes') ? json([]) : undefined));
  await Promise.all([api.getUserRecipeIds(), api.getUserRecipeIds(), api.getUserRecipeIds()]);
  assert.equal(tokenCalls().length, 1);
});

test('renews an expired token with the refresh token', async () => {
  let n = 0;
  const { api, tokenCalls, apiCalls } = mockApi((c) => {
    // First token is already inside the expiry margin
    if (c.url.endsWith('/oauth/token')) return tokenResponse(++n, n === 1 ? 30 : 3600);
    return undefined;
  });

  await api.removeConsumedItems(['x']);
  await api.removeConsumedItems(['x']);

  assert.equal(tokenCalls().length, 2);
  assert.deepEqual(
    { grant_type: (tokenCalls()[1].body as Record<string, string>).grant_type, refresh_token: (tokenCalls()[1].body as Record<string, string>).refresh_token },
    { grant_type: 'refresh_token', refresh_token: 'refresh-1' },
  );
  assert.equal(apiCalls()[1].headers.Authorization, 'Bearer access-2');
});

test('falls back to the password when the refresh fails', async () => {
  let n = 0;
  const { api, tokenCalls } = mockApi((c) => {
    if (!c.url.endsWith('/oauth/token')) return undefined;
    const grant = (c.body as Record<string, string>).grant_type;
    if (grant === 'refresh_token') return json({ error: 'invalid_grant' }, 400);
    return tokenResponse(++n, n === 1 ? 30 : 3600);
  });

  await api.removeConsumedItems(['x']);
  await api.removeConsumedItems(['x']);

  assert.deepEqual(
    tokenCalls().map((c) => (c.body as Record<string, string>).grant_type),
    ['password', 'refresh_token', 'password'],
  );
});

test('retries once with a new token after a 401', async () => {
  let rejected = false;
  const { api, apiCalls } = mockApi((c) => {
    if (c.url.endsWith('/user/consumed-items') && !rejected) {
      rejected = true;
      return json({ error: 'expired' }, 401);
    }
    return undefined;
  });

  await api.removeConsumedItems(['x']);

  assert.deepEqual(
    apiCalls().map((c) => c.headers.Authorization),
    ['Bearer access-1', 'Bearer access-2'],
  );
});

test('errors carry status and response body', async () => {
  const { api } = mockApi((c) =>
    c.url.endsWith('/user/products') ? json([{ property_path: 'name', message: 'blank' }], 400) : undefined,
  );

  await assert.rejects(
    api.createProduct({
      id: 'id',
      name: '',
      category: 'dishes',
      base_unit: 'g',
      is_private: true,
      nutrients: {},
      servings: [],
      producer: null,
    }),
    (error: unknown) =>
      error instanceof YazioApiError && error.status === 400 && error.message.includes('POST /user/products') && error.body.includes('blank'),
  );
});

test('login errors do not leak the response body', async () => {
  const { api } = mockApi((c) => (c.url.endsWith('/oauth/token') ? json({ username: 'user@example.com' }, 401) : undefined));
  await assert.rejects(api.getUser(), (error: unknown) => error instanceof Error && !error.message.includes('user@example.com'));
});

test('an unexpected token response is logged without the tokens and still used', async () => {
  const { api, apiCalls } = mockApi((c) =>
    c.url.endsWith('/oauth/token')
      ? json({ token_type: 'bearer', access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: '3600' })
      : undefined,
  );
  const warnings: string[] = [];
  const consoleError = console.error;
  console.error = (message: string) => warnings.push(message);
  try {
    await api.removeConsumedItems(['x']);
  } finally {
    console.error = consoleError;
  }
  assert.equal(apiCalls()[0].headers.Authorization, 'Bearer secret-access');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /expires_in/);
  assert.doesNotMatch(warnings[0], /secret-/);
});

test('responses are validated: extra fields pass, mismatches are logged and passed on', async () => {
  const { api } = mockApi((c) => {
    if (c.url.includes('/user/water-intake')) return json({ water_intake: 750, gateway: null, source: null, new_field: 1 });
    if (c.url.includes('/user/dietary-preferences')) return json({ restriction: 42 });
    return undefined;
  });

  assert.deepEqual(await api.getWaterIntake('2026-11-06'), { water_intake: 750, gateway: null, source: null, new_field: 1 });

  const warnings: string[] = [];
  const consoleError = console.error;
  console.error = (message: string) => warnings.push(message);
  try {
    assert.deepEqual(await api.getDietaryPreferences(), { restriction: 42 });
  } finally {
    console.error = consoleError;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /GET \/user\/dietary-preferences returned an unexpected response shape[\s\S]*restriction/);
});

test('date queries are sent unchanged', async () => {
  const { api, apiCalls } = mockApi((c) => (c.method === 'GET' ? json({}) : undefined));

  // The empty mock responses only log a schema warning; the URLs matter here
  const consoleError = console.error;
  console.error = () => {};
  try {
    await api.getConsumedItems('2026-11-06');
    await api.getDailySummary('2026-11-06');
    await api.getWaterIntake('2026-11-06');
    await api.getSuggestedProducts('dinner', '2026-11-06');
    await api.getGoals('2026-11-06');
    await api.getWeightHistory('2026-01-01', '2026-11-06');
  } finally {
    console.error = consoleError;
  }

  assert.deepEqual(
    apiCalls().map((c) => c.url.replace(API_BASE_URL, '')),
    [
      '/user/consumed-items?date=2026-11-06',
      '/user/widgets/daily-summary?date=2026-11-06',
      '/user/water-intake?date=2026-11-06',
      '/user/products/suggested?date=2026-11-06&daytime=dinner',
      '/user/goals?date=2026-11-06',
      '/user/bodyvalues/weight?start=2026-01-01&end=2026-11-06',
    ],
  );
});

test('product search sends lists comma-separated and leaves out unset options', async () => {
  const { api, apiCalls } = mockApi((c) => (c.url.includes('/products/search') ? json([]) : undefined));
  assert.deepEqual(await api.searchProducts({ query: 'greek yogurt', countries: ['US', 'DE'], locales: ['en_US'] }), []);
  await api.searchProducts({ query: 'apple' });
  const [full, minimal] = apiCalls().map((c) => new URL(c.url));
  assert.equal(full.pathname, '/v15/products/search');
  assert.deepEqual(Object.fromEntries(full.searchParams), { query: 'greek yogurt', countries: 'US,DE', locales: 'en_US' });
  assert.deepEqual(Object.fromEntries(minimal.searchParams), { query: 'apple' });
});

test('write bodies', async () => {
  const { api, apiCalls } = mockApi();

  await api.addConsumedItems({
    simple_products: [{ id: 'q1', date: '2026-11-06 12:30:00', daytime: 'lunch', name: 'Soup', nutrients: { 'energy.energy': 200 } }],
  });
  await api.removeConsumedItems(['q1']);
  await api.addConsumedItems({
    recipe_portions: [{ id: 'p1', recipe_id: 'r1', date: '2026-11-06 19:00:00', daytime: 'dinner', portion_count: 0.5 }],
  });
  await api.addWaterIntake([{ date: '2026-11-06 12:00:00', water_intake: 750 }]);
  await api.deleteUserRecipe('r1');

  const [add, remove, addRecipe, water, deleteRecipe] = apiCalls();
  assert.deepEqual(addRecipe.body, {
    products: [],
    simple_products: [],
    recipe_portions: [{ id: 'p1', recipe_id: 'r1', date: '2026-11-06 19:00:00', daytime: 'dinner', portion_count: 0.5 }],
  });
  assert.equal(add.method, 'POST');
  assert.deepEqual(add.body, {
    products: [],
    recipe_portions: [],
    simple_products: [{ id: 'q1', date: '2026-11-06 12:30:00', daytime: 'lunch', name: 'Soup', nutrients: { 'energy.energy': 200 } }],
  });
  assert.equal(add.headers['Content-Type'], 'application/json');
  assert.equal(remove.method, 'DELETE');
  assert.deepEqual(remove.body, ['q1']);
  assert.equal(water.url, `${API_BASE_URL}/user/water-intake`);
  assert.deepEqual(water.body, [{ date: '2026-11-06 12:00:00', water_intake: 750 }]);
  assert.equal(deleteRecipe.method, 'DELETE');
  assert.equal(deleteRecipe.url, `${API_BASE_URL}/user/recipes/r1`);
});

test('the diary note is read and replaced by date in the query', async () => {
  const { api, apiCalls } = mockApi((c) => (c.method === 'GET' ? json({ note: 'bloated', tags: ['headache'] }) : undefined));

  assert.deepEqual(await api.getFeeling('2026-11-09'), { note: 'bloated', tags: ['headache'] });
  await api.setFeeling('2026-11-09', { note: null, tags: [] });

  const [get, put] = apiCalls();
  assert.equal(get.url, `${API_BASE_URL}/user/feeling?date=2026-11-09`);
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, `${API_BASE_URL}/user/feeling?date=2026-11-09`);
  assert.deepEqual(put.body, { note: null, tags: [] });
});

test('a user recipe is created with a client id', async () => {
  const { api, apiCalls } = mockApi();
  const recipe = {
    id: 'r1',
    name: 'Shake',
    portion_count: 2,
    nutrients: { 'energy.energy': 100, 'nutrient.fat': 1, 'nutrient.protein': 10, 'nutrient.carb': 5 },
    servings: [
      { product_id: 'p1', name: 'Milk', producer: null, amount: 300, base_unit: 'ml', serving: 'glass', serving_quantity: 1 },
      { product_id: 'p2', name: 'Whey', producer: 'Bahs', amount: 30, base_unit: 'g', serving: null, serving_quantity: null },
    ],
    instructions: [],
  };

  await api.createUserRecipe(recipe);

  const [create] = apiCalls();
  assert.equal(create.method, 'POST');
  assert.equal(create.url, `${API_BASE_URL}/user/recipes`);
  assert.deepEqual(create.body, recipe);
});

test('body values are read by day and written keyed by type', async () => {
  const day = { 'ratio.fat': [{ id: 'b1', date: '2026-11-06 08:00:00', value: 21.5 }] };
  const { api, apiCalls } = mockApi((c) => (c.method === 'GET' && c.url.includes('/user/bodyvalues') ? json(day) : undefined));

  assert.deepEqual(await api.getBodyValues('2026-11-06'), day);
  await api.addBodyValues('circumference.waist', [{ id: 'b2', date: '2026-11-06 08:00:00', value: 84 }]);
  await api.addWeights([{ id: 'b3', date: '2026-11-06 08:00:00', value: 80 }]);
  await api.deleteBodyValues(['b2']);

  const [read, add, weight, remove] = apiCalls();
  assert.equal(read.url.replace(API_BASE_URL, ''), '/user/bodyvalues?date=2026-11-06');
  assert.equal(add.method, 'POST');
  assert.deepEqual(add.body, { 'circumference.waist': [{ id: 'b2', date: '2026-11-06 08:00:00', value: 84 }] });
  assert.deepEqual(weight.body, { weight: [{ id: 'b3', date: '2026-11-06 08:00:00', value: 80 }] });
  assert.equal(remove.method, 'DELETE');
  assert.deepEqual(remove.body, ['b2']);
});

test('product search sends the first locale as Accept-Language', async () => {
  const { api, apiCalls } = mockApi((c) => (c.url.includes('/products/search') ? json([]) : undefined));
  await api.searchProducts({ query: 'quark', countries: ['DE'], locales: ['de_DE', 'en_US'] });
  await api.searchProducts({ query: 'apple' });

  const [localized, plain] = apiCalls();
  assert.equal(localized.headers['Accept-Language'], 'de-DE');
  assert.equal(plain.headers['Accept-Language'], undefined);
});

test('endpoints from the yazio-community specification', async () => {
  const { api, apiCalls } = mockApi((c) => {
    if (c.url.includes('/nutrients-daily')) return json([{ date: '2026-11-01', energy: 1800, carb: 200, protein: 90, fat: 60, energy_goal: 2000 }]);
    if (c.method === 'GET' && c.url.endsWith('/user/products')) return json(['p1']);
    if (c.url.endsWith('/user/favorites/product')) return json([]);
    if (c.url.endsWith('/user/favorites/recipe')) return json([]);
    return undefined;
  });

  await api.updateBodyValue('b1', 71.5);
  await api.addActivity([{ date: '2026-11-01', steps: 8000, energy: 250 }]);
  assert.equal((await api.getDailyNutrients('2026-11-01', '2026-11-07'))[0].energy_goal, 2000);
  assert.deepEqual(await api.getUserProductIds(), ['p1']);
  await api.deleteUserProduct('p1');
  await api.updateUserRecipe({ id: 'r1', name: 'Soup', portion_count: 2, nutrients: {}, servings: [], instructions: [] });
  await api.getFavoriteProducts();
  await api.getFavoriteRecipes();
  await api.addFavoriteProduct({ id: 'f1', product_id: 'p1', amount: 150, serving: null, serving_quantity: null });
  await api.addFavoriteRecipe({ id: 'f2', recipe_id: 'r1', portion_count: 1 });
  await api.removeFavoriteProduct('p1');
  await api.removeFavoriteRecipe('f2');

  assert.deepEqual(
    apiCalls().map((c) => [c.method, c.url.replace(API_BASE_URL, ''), c.body]),
    [
      ['PUT', '/user/bodyvalues/b1', { value: 71.5 }],
      ['POST', '/user/exercises', { activity: [{ date: '2026-11-01', steps: 8000, energy: 250 }] }],
      ['GET', '/user/consumed-items/nutrients-daily?start=2026-11-01&end=2026-11-07', undefined],
      ['GET', '/user/products', undefined],
      ['DELETE', '/user/products/p1', undefined],
      ['PUT', '/user/recipes/r1', { id: 'r1', name: 'Soup', portion_count: 2, nutrients: {}, servings: [], instructions: [] }],
      ['GET', '/user/favorites/product', undefined],
      ['GET', '/user/favorites/recipe', undefined],
      ['PUT', '/user/favorites/products', { id: 'f1', product_id: 'p1', amount: 150, serving: null, serving_quantity: null }],
      ['PUT', '/user/favorites/recipes', { id: 'f2', recipe_id: 'r1', portion_count: 1 }],
      // Product favorites are removed by product_id, recipe favorites by the favorite's own id
      ['DELETE', '/user/favorites/product/p1', undefined],
      ['DELETE', '/user/favorites/f2', undefined],
    ],
  );
});
