import { YazioHttp, type Credentials, type YazioHttpOptions } from './http.js';
import type {
  AddConsumedItemsDto,
  CreateProductDto,
  Daytime,
  ProductSearchOptions,
  WaterIntakeEntry,
  YazioConsumedItems,
  YazioDailySummary,
  YazioDietaryPreferences,
  YazioExercises,
  YazioGoals,
  YazioProduct,
  YazioProductSearchResult,
  YazioSettings,
  YazioSuggestedProduct,
  YazioUserInfo,
  YazioWaterIntake,
  YazioWeightEntry,
} from './types.js';

/** Today as YYYY-MM-DD in local time */
export const today = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * Typed wrapper for the Yazio API endpoints this server uses.
 * Dates are passed as YYYY-MM-DD (or "YYYY-MM-DD HH:mm:ss" where the API takes a time) and sent unchanged.
 */
export class YazioApi {
  readonly http: YazioHttp;

  constructor(credentials: Credentials, options?: YazioHttpOptions) {
    this.http = new YazioHttp(credentials, options);
  }

  // User

  getUser = () => this.http.request<YazioUserInfo>('GET', '/user');

  getSettings = () => this.http.request<YazioSettings>('GET', '/user/settings');

  getDietaryPreferences = () => this.http.request<YazioDietaryPreferences>('GET', '/user/dietary-preferences');

  getGoals = (date = today()) => this.http.request<YazioGoals>('GET', '/user/goals/unmodified', { query: { date } });

  getDailySummary = (date: string) =>
    this.http.request<YazioDailySummary>('GET', '/user/widgets/daily-summary', { query: { date } });

  getLastWeight = (date = today()) =>
    this.http.request<YazioWeightEntry | null>('GET', '/user/bodyvalues/weight/last', { query: { date } });

  getExercises = (date = today()) => this.http.request<YazioExercises>('GET', '/user/exercises', { query: { date } });

  getSuggestedProducts = (daytime: Daytime, date = today()) =>
    this.http.request<YazioSuggestedProduct[]>('GET', '/user/products/suggested', { query: { date, daytime } });

  // Diary

  getConsumedItems = (date: string) =>
    this.http.request<YazioConsumedItems>('GET', '/user/consumed-items', { query: { date } });

  addConsumedItems = (items: AddConsumedItemsDto) =>
    this.http.request<void>('POST', '/user/consumed-items', {
      body: { products: [], simple_products: [], recipe_portions: [], ...items },
    });

  /** Works for products, simple products and recipe portions */
  removeConsumedItems = (ids: string[]) => this.http.request<void>('DELETE', '/user/consumed-items', { body: ids });

  // Water

  getWaterIntake = (date: string) =>
    this.http.request<YazioWaterIntake>('GET', '/user/water-intake', { query: { date } });

  /** Each entry is the cumulative total of the day at that time */
  addWaterIntake = (entries: WaterIntakeEntry[]) =>
    this.http.request<void>('POST', '/user/water-intake', { body: entries });

  // Products

  searchProducts = ({ query, sex, countries, locales }: ProductSearchOptions) =>
    this.http.request<YazioProductSearchResult[]>('GET', '/products/search', {
      query: {
        query,
        sex: sex ?? 'male',
        countries: (countries ?? ['DE', 'US']).join(','),
        locales: (locales ?? ['en_US', 'de_US']).join(','),
      },
    });

  getProduct = (id: string) => this.http.request<YazioProduct>('GET', `/products/${encodeURIComponent(id)}`);

  createProduct = (product: CreateProductDto) => this.http.request<void>('POST', '/user/products', { body: product });
}
