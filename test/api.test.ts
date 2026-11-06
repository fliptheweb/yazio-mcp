// Offline tests for src/api with a mocked fetch. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YazioApi, YazioApiError, YAZIO_API_BASE_URL } from '../src/api/index.js';

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
  const { api, apiCalls, tokenCalls } = mockApi((c) => (c.url.endsWith('/user') ? json({ email: 'x' }) : undefined));

  await api.getUser();
  await api.getUser();

  assert.equal(tokenCalls().length, 1);
  const login = tokenCalls()[0];
  assert.equal(login.method, 'POST');
  assert.equal(login.url, `${YAZIO_API_BASE_URL}/oauth/token`);
  assert.equal(login.headers['Content-Type'], 'application/json');
  assert.deepEqual(
    { ...(login.body as object), client_id: undefined, client_secret: undefined },
    { grant_type: 'password', username: 'user@example.com', password: 'secret', client_id: undefined, client_secret: undefined },
  );
  assert.equal(apiCalls()[1].headers.Authorization, 'Bearer access-1');
});

test('concurrent requests share one login', async () => {
  const { api, tokenCalls } = mockApi();
  await Promise.all([api.getSettings(), api.getSettings(), api.getSettings()]);
  assert.equal(tokenCalls().length, 1);
});

test('renews an expired token with the refresh token', async () => {
  let n = 0;
  const { api, tokenCalls, apiCalls } = mockApi((c) => {
    // First token is already inside the expiry margin
    if (c.url.endsWith('/oauth/token')) return tokenResponse(++n, n === 1 ? 30 : 3600);
    return undefined;
  });

  await api.getSettings();
  await api.getSettings();

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

  await api.getSettings();
  await api.getSettings();

  assert.deepEqual(
    tokenCalls().map((c) => (c.body as Record<string, string>).grant_type),
    ['password', 'refresh_token', 'password'],
  );
});

test('retries once with a new token after a 401', async () => {
  let rejected = false;
  const { api, apiCalls } = mockApi((c) => {
    if (c.url.endsWith('/user/settings') && !rejected) {
      rejected = true;
      return json({ error: 'expired' }, 401);
    }
    return undefined;
  });

  await api.getSettings();

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

test('date queries are sent unchanged', async () => {
  const { api, apiCalls } = mockApi((c) => (c.method === 'GET' ? json([]) : undefined));

  await api.getConsumedItems('2026-11-06');
  await api.getDailySummary('2026-11-06');
  await api.getWaterIntake('2026-11-06');
  await api.getSuggestedProducts('dinner', '2026-11-06');
  await api.getGoals('2026-11-06');

  assert.deepEqual(
    apiCalls().map((c) => c.url.replace(YAZIO_API_BASE_URL, '')),
    [
      '/user/consumed-items?date=2026-11-06',
      '/user/widgets/daily-summary?date=2026-11-06',
      '/user/water-intake?date=2026-11-06',
      '/user/products/suggested?date=2026-11-06&daytime=dinner',
      '/user/goals/unmodified?date=2026-11-06',
    ],
  );
});

test('product search applies the same defaults as the yazio package', async () => {
  const { api, apiCalls } = mockApi(() => undefined);
  await api.searchProducts({ query: 'greek yogurt' });
  const url = new URL(apiCalls()[0].url);
  assert.equal(url.pathname, '/v15/products/search');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    query: 'greek yogurt',
    sex: 'male',
    countries: 'DE,US',
    locales: 'en_US,de_US',
  });
});

test('write bodies', async () => {
  const { api, apiCalls } = mockApi();

  await api.addConsumedItems({
    simple_products: [{ id: 'q1', date: '2026-11-06 12:30:00', daytime: 'lunch', name: 'Soup', nutrients: { 'energy.energy': 200 } }],
  });
  await api.removeConsumedItems(['q1']);
  await api.addWaterIntake([{ date: '2026-11-06 12:00:00', water_intake: 750 }]);

  const [add, remove, water] = apiCalls();
  assert.equal(add.method, 'POST');
  assert.deepEqual(add.body, {
    products: [],
    recipe_portions: [],
    simple_products: [{ id: 'q1', date: '2026-11-06 12:30:00', daytime: 'lunch', name: 'Soup', nutrients: { 'energy.energy': 200 } }],
  });
  assert.equal(add.headers['Content-Type'], 'application/json');
  assert.equal(remove.method, 'DELETE');
  assert.deepEqual(remove.body, ['q1']);
  assert.equal(water.url, `${YAZIO_API_BASE_URL}/user/water-intake`);
  assert.deepEqual(water.body, [{ date: '2026-11-06 12:00:00', water_intake: 750 }]);
});
