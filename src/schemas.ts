import { z } from 'zod';

export const DaytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type Daytime = z.infer<typeof DaytimeSchema>;

export const DateStringSchema = z.string().describe('Date in YYYY-MM-DD format');
export const ProductIdSchema = z.string().describe('Unique product identifier');
export const ItemIdSchema = z.string().describe('Unique item identifier');
export const QueryStringSchema = z.string().describe('Search query string');
export const LimitSchema = z.number().optional().describe('Maximum number of results to return');

export const DateInputSchema = z.object({
  date: DateStringSchema.describe('Date to get data for')
});

export const OptionalDateInputSchema = z.object({
  date: DateStringSchema.optional().describe('Specific date to get data for (optional)')
});

export const QueryInputSchema = z.object({
  query: QueryStringSchema.describe('Search query')
});

export const OptionalQueryInputSchema = z.object({
  query: QueryStringSchema.optional().describe('Search query (optional)'),
  limit: LimitSchema
});

export const EmptyInputSchema = z.object({});

export const GetFoodEntriesInputSchema = DateInputSchema;
export const GetDailySummaryInputSchema = DateInputSchema;
export const GetUserInfoInputSchema = EmptyInputSchema;
export const GetUserWeightInputSchema = EmptyInputSchema; // Yazio getWeight doesn't accept parameters
export const GetWaterIntakeInputSchema = DateInputSchema;
export const SearchProductsInputSchema = QueryInputSchema;
export const GetProductInputSchema = z.object({
  id: ProductIdSchema.describe('Product ID to get details for')
});
export const GetUserExercisesInputSchema = OptionalDateInputSchema; // Only supports single date, not date ranges
export const GetUserSettingsInputSchema = EmptyInputSchema;
export const GetUserSuggestedProductsInputSchema = OptionalQueryInputSchema;
export const AddConsumedItemInputSchema = z.object({
  productId: z.string().optional().describe('ID of the product to add'),
  amount: z.number().optional().describe('Amount of the product consumed'),
  unit: z.string().optional().describe('Unit of measurement (g, ml, pieces, etc.)'),
  date: z.string().optional().describe('Date when the food was consumed (defaults to today) in YYYY-MM-DD format'),
  mealType: DaytimeSchema.optional().describe('Type of meal')
});
export const RemoveConsumedItemInputSchema = z.object({
  itemId: ItemIdSchema.describe('ID of the consumed item to remove')
});
export const GetDietaryPreferencesInputSchema = EmptyInputSchema;
export const GetUserGoalsInputSchema = EmptyInputSchema;

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
