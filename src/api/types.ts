import type * as z from 'zod';
import type * as S from './schemas.js';

export type YazioUserInfo = z.infer<typeof S.UserSchema>;
export type YazioSettings = z.infer<typeof S.UserSettingsSchema>;
export type YazioDietaryPreferences = z.infer<typeof S.DietaryPreferencesSchema>;
export type YazioGoals = z.infer<typeof S.GoalsSchema>;
export type YazioDailySummary = z.infer<typeof S.DailySummarySchema>;
export type YazioWeightEntry = z.infer<typeof S.WeightEntrySchema>;
export type YazioExercises = z.infer<typeof S.ExercisesSchema>;
export type YazioSuggestedProduct = z.infer<typeof S.SuggestedProductsSchema>[number];
export type YazioWaterIntake = z.infer<typeof S.WaterIntakeSchema>;
export type YazioConsumedItems = z.infer<typeof S.ConsumedItemsSchema>;
export type YazioProductSearchResult = z.infer<typeof S.ProductSearchResultsSchema>[number];
export type YazioProduct = z.infer<typeof S.ProductSchema>;
export type YazioRecipe = z.infer<typeof S.RecipeSchema>;

export type Daytime = z.infer<typeof S.DaytimeSchema>;

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
  recipe_portions?: unknown[];
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
