// Types of Yazio API responses (inferred from ./schemas.ts) and request bodies.
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

// Request bodies. Shapes follow the API models of the Yazio Android app.

export type Daytime = z.infer<typeof S.DaytimeSchema>;

/** "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss" (local time, sent as is) */
export type YazioDateTime = string;

export interface ConsumedProductDto {
  id: string;
  product_id: string;
  date: YazioDateTime;
  daytime: Daytime;
  amount: number;
  serving?: string;
  serving_quantity?: number;
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
  recipe_portions?: unknown[];
}

export interface CreateProductDto {
  id: string;
  name: string;
  category: string;
  base_unit: 'g' | 'ml';
  is_private: boolean;
  /** Per 1 g/ml of the base unit */
  nutrients: Record<string, number>;
  servings: { serving: string; amount: number }[];
  producer: string | null;
}

export interface WaterIntakeEntry {
  date: string; // "YYYY-MM-DD HH:mm:ss"
  water_intake: number; // Cumulative water intake of the day in ml
}

export interface ProductSearchOptions {
  query: string;
  sex?: 'male' | 'female';
  countries?: string[];
  locales?: string[];
}
