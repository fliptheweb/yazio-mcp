import type * as z from 'zod';
import type * as S from './schemas.js';

export type YazioUserInfo = z.infer<typeof S.UserSchema>;
export type YazioSettings = z.infer<typeof S.UserSettingsSchema>;
export type YazioDietaryPreferences = z.infer<typeof S.DietaryPreferencesSchema>;
export type YazioGoals = z.infer<typeof S.GoalsSchema>;
export type YazioDailySummary = z.infer<typeof S.DailySummarySchema>;
export type YazioWeightEntry = z.infer<typeof S.WeightEntrySchema>;
export type YazioWeightHistory = z.infer<typeof S.WeightHistorySchema>;
export type YazioExercises = z.infer<typeof S.ExercisesSchema>;
export type YazioBodyValues = z.infer<typeof S.BodyValuesSchema>;
export type BodyValueType = z.infer<typeof S.BodyValueTypeSchema>;
export type YazioSuggestedProduct = z.infer<typeof S.SuggestedProductsSchema>[number];
export type YazioWaterIntake = z.infer<typeof S.WaterIntakeSchema>;
export type YazioConsumedItems = z.infer<typeof S.ConsumedItemsSchema>;
export type YazioProductSearchResult = z.infer<typeof S.ProductSearchResultsSchema>[number];
export type YazioProduct = z.infer<typeof S.ProductSchema>;
export type YazioRecipe = z.infer<typeof S.RecipeSchema>;
export type YazioFeeling = z.infer<typeof S.FeelingSchema>;
export type YazioDailyNutrients = z.infer<typeof S.DailyNutrientsSchema>;
export type YazioFavoriteProduct = z.infer<typeof S.FavoriteProductsSchema>[number];
export type YazioFavoriteRecipe = z.infer<typeof S.FavoriteRecipesSchema>[number];
export type YazioMeal = z.infer<typeof S.MealsSchema>[number];

export type Daytime = z.infer<typeof S.DaytimeSchema>;
export type TrainingName = z.infer<typeof S.TrainingNameSchema>;

/** "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss" (local time, sent as is) */
export type YazioDateTime = string;

/** "YYYY-MM-DD HH:mm:ss" */
export type DateTimeString = `${string}-${string}-${string} ${string}:${string}:${string}`;

interface ConsumedProductBase {
  id: string;
  product_id: string;
  date: YazioDateTime;
  daytime: Daytime;
  amount: number;
}

export type ConsumedProductDto =
  | (ConsumedProductBase & { serving: string; serving_quantity: number })
  | (ConsumedProductBase & { serving?: undefined; serving_quantity?: undefined });

// Inferred: products and simple products are sent with the fields GET /user/consumed-items returns
export interface ConsumedRecipePortionDto {
  id: string;
  recipe_id: string;
  date: YazioDateTime;
  daytime: Daytime;
  portion_count: number;
}

export interface ConsumedSimpleProductDto {
  id: string;
  date: YazioDateTime;
  daytime: Daytime;
  name: string;
  nutrients: Record<string, number>;
}

export interface AddConsumedItemsDto {
  products?: ConsumedProductDto[];
  simple_products?: ConsumedSimpleProductDto[];
  recipe_portions?: ConsumedRecipePortionDto[];
}

export interface CreateProductDto {
  id: string;
  name: string;
  category: z.infer<typeof S.ProductCategorySchema>;
  base_unit: 'g' | 'ml';
  is_private: boolean;
  /** Per 1 g/ml of the base unit */
  nutrients: Record<string, number>;
  servings: { serving: z.infer<typeof S.ServingNameSchema>; amount: number }[];
  producer: string | null;
}

export interface CreateUserRecipeDto {
  id: string;
  name: string;
  portion_count: number;
  /** Per portion; energy.energy, nutrient.fat, nutrient.protein and nutrient.carb are required */
  nutrients: Record<string, number>;
  /** At least 2 */
  servings: {
    product_id: string;
    name: string;
    producer: string | null;
    amount: number;
    base_unit: string;
    serving: string | null;
    serving_quantity: number | null;
  }[];
  instructions: string[];
}

export interface CreateMealDto {
  id: string;
  name: string;
  products: { product_id: string; amount: number; serving: string | null; serving_quantity: number | null }[];
  simple_products: { name: string; nutrients: Record<string, number> }[];
  recipe_portions: { recipe_id: string; portion_count: number }[];
}

/** Always metric, whatever units the app shows: kg, % (ratio.*), mg/dL (glucoselevel) or cm (circumference.*) */
export interface BodyValueDto {
  id: string;
  date: YazioDateTime;
  value: number;
}

/** Weight in kg */
export type WeightDto = BodyValueDto;

/** The API stores 0 kcal when `energy` is missing */
export interface ExerciseDto<Name extends string = string> {
  id: string;
  date: DateTimeString;
  name: Name;
  /** Minutes */
  duration: number;
  /** kcal */
  energy: number;
  note?: string;
}

/** The day's activity totals, as the app sends them from a step counter */
export interface ActivityDto {
  date: YazioDateTime;
  /** kcal */
  energy?: number;
  steps?: number;
}

export interface FavoriteProductDto {
  id: string;
  product_id: string;
  amount: number;
  serving: string | null;
  serving_quantity: number | null;
}

export interface FavoriteRecipeDto {
  id: string;
  recipe_id: string;
  portion_count: number;
}

export interface AddExercisesDto {
  /** The API rejects a name outside its own list, which is longer than TrainingName */
  training?: ExerciseDto<TrainingName | (string & {})>[];
  custom_training?: ExerciseDto[];
  activity?: ActivityDto[];
}

/**
 * POST /user/water-intake, found in https://github.com/juriadams/yazio/issues/3:
 * - the body is a bare array of entries, not wrapped in an object;
 * - `date` must include the time ("YYYY-MM-DD HH:mm:ss"), a date alone is rejected;
 * - `water_intake` is a number in ml (not "250ml") and cumulative: the day's total at that time,
 *   so the last entry of a day is its total.
 */
export interface WaterIntakeEntry {
  date: DateTimeString;
  water_intake: number;
}

export interface ProductSearchOptions {
  query: string;
  sex?: 'male' | 'female';
  countries?: string[];
  locales?: string[];
}
