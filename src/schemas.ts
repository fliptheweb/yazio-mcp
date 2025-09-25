import { z } from 'zod';

// Simple schemas for TypeScript types and MCP schemas only
export const DaytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type Daytime = z.infer<typeof DaytimeSchema>;

export const DateStringSchema = z.string().describe('Date in YYYY-MM-DD format');
export const ProductIdSchema = z.string().describe('Unique product identifier');

export const GetDietDataInputSchema = z.object({
  startDate: DateStringSchema.describe('Start date for the diet data range'),
  endDate: DateStringSchema.describe('End date for the diet data range')
});

export const GetFoodEntriesInputSchema = z.object({
  date: DateStringSchema.describe('Date to get food entries for')
});

export const GetDailySummaryInputSchema = z.object({
  date: DateStringSchema.describe('Date to get nutrition summary for')
});

export const GetUserInfoInputSchema = z.object({});

export const GetUserWeightInputSchema = z.object({
  startDate: z.string().optional().describe('Start date for weight data range'),
  endDate: z.string().optional().describe('End date for weight data range'),
  limit: z.number().optional().describe('Maximum number of weight entries to return')
});

export const GetWaterIntakeInputSchema = z.object({
  date: DateStringSchema.describe('Date to get water intake data for')
});

export const SearchProductsInputSchema = z.object({
  query: z.string().describe('Search query for food products')
});

export const GetProductInputSchema = z.object({
  id: ProductIdSchema.describe('Product ID to get details for')
});

export const GetUserExercisesInputSchema = z.object({
  date: z.string().optional().describe('Specific date to get exercises for'),
  startDate: z.string().optional().describe('Start date for exercise data range'),
  endDate: z.string().optional().describe('End date for exercise data range')
});

export const GetUserSettingsInputSchema = z.object({});

export const GetUserSuggestedProductsInputSchema = z.object({
  query: z.string().optional().describe('Search query for product suggestions'),
  limit: z.number().optional().describe('Maximum number of suggestions to return')
});

export const AddConsumedItemInputSchema = z.object({
  productId: z.string().optional().describe('ID of the product to add'),
  amount: z.number().optional().describe('Amount of the product consumed'),
  unit: z.string().optional().describe('Unit of measurement (g, ml, pieces, etc.)'),
  date: z.string().optional().describe('Date when the food was consumed (defaults to today) in YYYY-MM-DD format'),
  mealType: DaytimeSchema.optional().describe('Type of meal')
});

export const RemoveConsumedItemInputSchema = z.object({
  itemId: z.string().describe('ID of the consumed item to remove')
});

export const GetDietaryPreferencesInputSchema = z.object({});

export const GetUserGoalsInputSchema = z.object({});

// MCP Tool input types
export type GetDietDataInput = z.infer<typeof GetDietDataInputSchema>;
export type GetFoodEntriesInput = z.infer<typeof GetFoodEntriesInputSchema>;
export type GetDailySummaryInput = z.infer<typeof GetDailySummaryInputSchema>;
export type GetUserInfoInput = z.infer<typeof GetUserInfoInputSchema>;
export type GetUserWeightInput = z.infer<typeof GetUserWeightInputSchema>;
export type GetWaterIntakeInput = z.infer<typeof GetWaterIntakeInputSchema>;
export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;
export type GetProductInput = z.infer<typeof GetProductInputSchema>;
export type GetUserExercisesInput = z.infer<typeof GetUserExercisesInputSchema>;
export type GetUserSettingsInput = z.infer<typeof GetUserSettingsInputSchema>;
export type GetUserSuggestedProductsInput = z.infer<typeof GetUserSuggestedProductsInputSchema>;
export type AddConsumedItemInput = z.infer<typeof AddConsumedItemInputSchema>;
export type RemoveConsumedItemInput = z.infer<typeof RemoveConsumedItemInputSchema>;
export type GetDietaryPreferencesInput = z.infer<typeof GetDietaryPreferencesInputSchema>;
export type GetUserGoalsInput = z.infer<typeof GetUserGoalsInputSchema>;
