// Yazio API client: one typed method per endpoint.
// Endpoints are based on https://github.com/juriadams/yazio by Juri Adams and its contributors. Thank you!
import { YazioHttp, type Credentials, type YazioHttpOptions } from './http.js';
import * as S from './schemas.js';
import type { AddConsumedItemsDto, CreateProductDto, Daytime, ProductSearchOptions, WaterIntakeEntry } from './types.js';

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

  getUser = () => this.http.request('GET', '/user', { schema: S.UserSchema });

  getSettings = () => this.http.request('GET', '/user/settings', { schema: S.UserSettingsSchema });

  getDietaryPreferences = () =>
    this.http.request('GET', '/user/dietary-preferences', { schema: S.DietaryPreferencesSchema });

  getGoals = (date = today()) =>
    this.http.request('GET', '/user/goals/unmodified', { query: { date }, schema: S.GoalsSchema });

  getDailySummary = (date: string) =>
    this.http.request('GET', '/user/widgets/daily-summary', { query: { date }, schema: S.DailySummarySchema });

  getLastWeight = (date = today()) =>
    this.http.request('GET', '/user/bodyvalues/weight/last', { query: { date }, schema: S.WeightEntrySchema.nullable() });

  getExercises = (date = today()) =>
    this.http.request('GET', '/user/exercises', { query: { date }, schema: S.ExercisesSchema });

  getSuggestedProducts = (daytime: Daytime, date = today()) =>
    this.http.request('GET', '/user/products/suggested', { query: { date, daytime }, schema: S.SuggestedProductsSchema });

  // Diary

  getConsumedItems = (date: string) =>
    this.http.request('GET', '/user/consumed-items', { query: { date }, schema: S.ConsumedItemsSchema });

  addConsumedItems = (items: AddConsumedItemsDto) =>
    this.http.request('POST', '/user/consumed-items', {
      body: { products: [], simple_products: [], recipe_portions: [], ...items },
    });

  /** Works for products, simple products and recipe portions */
  removeConsumedItems = (ids: string[]) => this.http.request('DELETE', '/user/consumed-items', { body: ids });

  // Water

  getWaterIntake = (date: string) =>
    this.http.request('GET', '/user/water-intake', { query: { date }, schema: S.WaterIntakeSchema });

  /** Each entry is the cumulative total of the day at that time */
  addWaterIntake = (entries: WaterIntakeEntry[]) => this.http.request('POST', '/user/water-intake', { body: entries });

  // Products

  searchProducts = ({ query, sex, countries, locales }: ProductSearchOptions) =>
    this.http.request('GET', '/products/search', {
      query: {
        query,
        sex: sex ?? 'male',
        countries: (countries ?? ['DE', 'US']).join(','),
        locales: (locales ?? ['en_US', 'de_US']).join(','),
      },
      schema: S.ProductSearchResultsSchema,
    });

  getProduct = (id: string) =>
    this.http.request('GET', `/products/${encodeURIComponent(id)}`, { schema: S.ProductSchema });

  createProduct = (product: CreateProductDto) => this.http.request('POST', '/user/products', { body: product });

  // Recipes

  /** Any recipe: the user's own or a Yazio recipe (e.g. recipe_id of a consumed recipe portion) */
  getRecipe = (id: string) =>
    this.http.request('GET', `/recipes/${encodeURIComponent(id)}`, { schema: S.RecipeSchema });

  /** IDs of the user's own recipes */
  getUserRecipeIds = () => this.http.request('GET', '/user/recipes', { schema: S.RecipeIdsSchema });

  deleteUserRecipe = (id: string) => this.http.request('DELETE', `/user/recipes/${encodeURIComponent(id)}`);
}
