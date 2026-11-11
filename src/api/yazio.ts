// Endpoints are based on https://github.com/juriadams/yazio by Juri Adams and its contributors.
import { YazioHttp, type Credentials, type YazioHttpOptions } from './http.js';
import * as S from './schemas.js';
import type {
  AddConsumedItemsDto,
  ActivityDto,
  AddExercisesDto,
  BodyValueDto,
  BodyValueType,
  CreateMealDto,
  CreateProductDto,
  CreateUserRecipeDto,
  Daytime,
  FavoriteProductDto,
  FavoriteRecipeDto,
  ProductSearchOptions,
  WaterIntakeEntry,
  WeightDto,
  YazioFeeling,
} from './types.js';

export const today = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export class YazioApi {
  readonly http: YazioHttp;

  constructor(credentials: Credentials, options?: YazioHttpOptions) {
    this.http = new YazioHttp(credentials, options);
  }

  getUser = () => this.http.request('GET', '/user', { schema: S.UserSchema });

  getSettings = () => this.http.request('GET', '/user/settings', { schema: S.UserSettingsSchema });

  getDietaryPreferences = () =>
    this.http.request('GET', '/user/dietary-preferences', { schema: S.DietaryPreferencesSchema });

  getGoals = (date = today()) =>
    this.http.request('GET', '/user/goals', { query: { date }, schema: S.GoalsSchema });

  getDailySummary = (date: string) =>
    this.http.request('GET', '/user/widgets/daily-summary', { query: { date }, schema: S.DailySummarySchema });

  getLastWeight = (date = today()) =>
    this.http.request('GET', '/user/bodyvalues/weight/last', { query: { date }, schema: S.WeightEntrySchema.nullable() });

  /** Every entry between the dates, both included; a day can have several */
  getWeightHistory = (start: string, end = today()) =>
    this.http.request('GET', '/user/bodyvalues/weight', { query: { start, end }, schema: S.WeightHistorySchema });

  /** Every body value of a day, by type */
  getBodyValues = (date = today()) =>
    this.http.request('GET', '/user/bodyvalues', { query: { date }, schema: S.BodyValuesSchema });

  addWeights = (entries: WeightDto[]) => this.addBodyValues('weight', entries);

  /** The body is keyed by value type */
  addBodyValues = (type: BodyValueType, entries: BodyValueDto[]) =>
    this.http.request('POST', '/user/bodyvalues', { body: { [type]: entries } });

  /** Replaces the value of a weight or other body value entry */
  updateBodyValue = (id: string, value: number) =>
    this.http.request('PUT', `/user/bodyvalues/${encodeURIComponent(id)}`, { body: { value } });

  /** Any body value IDs */
  deleteBodyValues = (ids: string[]) => this.http.request('DELETE', '/user/bodyvalues', { body: ids });

  getExercises = (date = today()) =>
    this.http.request('GET', '/user/exercises', { query: { date }, schema: S.ExercisesSchema });

  addExercises = (exercises: AddExercisesDto) => this.http.request('POST', '/user/exercises', { body: exercises });

  addActivity = (activity: ActivityDto[]) => this.addExercises({ activity });

  /** Trainings and custom trainings alike */
  deleteExercises = (ids: string[]) => this.http.request('DELETE', '/user/exercises/trainings', { body: ids });

  getSuggestedProducts = (daytime: Daytime, date = today()) =>
    this.http.request('GET', '/user/products/suggested', { query: { date, daytime }, schema: S.SuggestedProductsSchema });

  getConsumedItems = (date: string) =>
    this.http.request('GET', '/user/consumed-items', { query: { date }, schema: S.ConsumedItemsSchema });

  addConsumedItems = (items: AddConsumedItemsDto) =>
    this.http.request('POST', '/user/consumed-items', {
      body: { products: [], simple_products: [], recipe_portions: [], ...items },
    });

  /** Energy, carb, protein and fat totals and the energy goal for each day of a date range */
  getDailyNutrients = (start: string, end = today()) =>
    this.http.request('GET', '/user/consumed-items/nutrients-daily', { query: { start, end }, schema: S.DailyNutrientsSchema });

  /** Verified for products and simple products; presumably the same for recipe portions */
  removeConsumedItems = (ids: string[]) => this.http.request('DELETE', '/user/consumed-items', { body: ids });

  getWaterIntake = (date: string) =>
    this.http.request('GET', '/user/water-intake', { query: { date }, schema: S.WaterIntakeSchema });

  addWaterIntake = (entries: WaterIntakeEntry[]) => this.http.request('POST', '/user/water-intake', { body: entries });

  searchProducts = ({ query, sex, countries, locales }: ProductSearchOptions) =>
    this.http.request('GET', '/products/search', {
      query: { query, sex, countries: countries?.join(','), locales: locales?.join(',') },
      schema: S.ProductSearchResultsSchema,
    });

  getProduct = (id: string) =>
    this.http.request('GET', `/products/${encodeURIComponent(id)}`, { schema: S.ProductSchema });

  createProduct = (product: CreateProductDto) => this.http.request('POST', '/user/products', { body: product });

  getUserProductIds = () => this.http.request('GET', '/user/products', { schema: S.UserProductIdsSchema });

  deleteUserProduct = (id: string) => this.http.request('DELETE', `/user/products/${encodeURIComponent(id)}`);

  /** The user's own recipes and Yazio recipes */
  getRecipe = (id: string) =>
    this.http.request('GET', `/recipes/${encodeURIComponent(id)}`, { schema: S.RecipeSchema });

  getUserRecipeIds = () => this.http.request('GET', '/user/recipes', { schema: S.RecipeIdsSchema });

  deleteUserRecipe = (id: string) => this.http.request('DELETE', `/user/recipes/${encodeURIComponent(id)}`);

  createUserRecipe = (recipe: CreateUserRecipeDto) => this.http.request('POST', '/user/recipes', { body: recipe });

  /** Replaces the whole recipe; takes the same body as createUserRecipe */
  updateUserRecipe = (recipe: CreateUserRecipeDto) =>
    this.http.request('PUT', `/user/recipes/${encodeURIComponent(recipe.id)}`, { body: recipe });

  getFavoriteProducts = () => this.http.request('GET', '/user/favorites/product', { schema: S.FavoriteProductsSchema });

  getFavoriteRecipes = () => this.http.request('GET', '/user/favorites/recipe', { schema: S.FavoriteRecipesSchema });

  addFavoriteProduct = (favorite: FavoriteProductDto) =>
    this.http.request('PUT', '/user/favorites/products', { body: favorite });

  addFavoriteRecipe = (favorite: FavoriteRecipeDto) => this.http.request('PUT', '/user/favorites/recipes', { body: favorite });

  /** By product_id, not by the favorite's own id */
  removeFavoriteProduct = (productId: string) =>
    this.http.request('DELETE', `/user/favorites/product/${encodeURIComponent(productId)}`);

  /** By the favorite's own id, not by recipe_id */
  removeFavoriteRecipe = (favoriteId: string) =>
    this.http.request('DELETE', `/user/favorites/${encodeURIComponent(favoriteId)}`);

  /** The diary note and feeling tags of a day */
  getFeeling = (date: string) => this.http.request('GET', '/user/feeling', { query: { date }, schema: S.FeelingSchema });

  /** Replaces the day's note and tags; the API ignores a date in the body */
  setFeeling = (date: string, feeling: YazioFeeling) =>
    this.http.request('PUT', '/user/feeling', { query: { date }, body: feeling });

  /** Saved meals: named sets of foods that are logged together */
  getMeals = () => this.http.request('GET', '/user/meals', { schema: S.MealsSchema });

  createMeal = (meal: CreateMealDto) => this.http.request('POST', '/user/meals', { body: meal });

  deleteMeal = (id: string) => this.http.request('DELETE', `/user/meals/${encodeURIComponent(id)}`);
}
