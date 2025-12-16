import * as z from "zod";

export const DaytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const DateStringSchema = z.iso.date();
export const ProductIdSchema = z.uuid({ version: 'v1' }).describe('Product UUID (e.g. 4ceff6e9-78ce-441b-964a-22e81c1dee92)');
export const ServingTypeSchema = z.string().describe('Serving type (e.g. portion, fruit, glass, cup, slice, piece, bar, gram, bottle, can, etc.)');
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
export const SearchProductsOutputSchema = z.object({
  products: z.array(z.object({
    score: z.number(),
    name: z.string(),
    product_id: ProductIdSchema,
    serving: ServingTypeSchema,
    serving_quantity: z.number(),
    amount: z.number(),
    base_unit: z.enum(['g', 'ml']).describe('Base unit: grams (g) or milliliters (ml)'),
    producer: z.string().nullable().describe('Producer name'),
    is_verified: z.boolean(),
    nutrients: z.record(z.string(), z.number()).describe('Nutrients object with keys like energy.energy, nutrient.carb, etc.'),
    countries: z.array(z.string()).describe('Array of country codes (e.g. ["US", "DE"])'),
    language: z.string().describe('Language code (e.g. "en", "de")'),
  })),
});
export const GetProductInputSchema = z.object({
  id: ProductIdSchema.describe('Product ID to get details for')
});
export const GetUserExercisesInputSchema = OptionalDateInputSchema; // Only supports single date, not date ranges
export const GetUserSettingsInputSchema = EmptyInputSchema;
export const GetUserSuggestedProductsInputSchema = OptionalQueryInputSchema;
export const AddConsumedItemInputSchema = z.object({
  id: ProductIdSchema.describe('Unique identifier for the consumed item'),
  product_id: ProductIdSchema,
  date: DateStringSchema.describe('Date when the food was consumed'),
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
  amount: z.number().optional().describe('Amount of the product consumed'),
  serving: ServingTypeSchema,
  serving_quantity: z.number().describe('Quantity of servings')
});
export const RemoveConsumedItemInputSchema = z.object({
  itemId: ItemIdSchema.describe('ID of the consumed item to remove')
});
export const GetDietaryPreferencesInputSchema = EmptyInputSchema;
export const GetUserGoalsInputSchema = EmptyInputSchema;

export type Daytime = z.infer<typeof DaytimeSchema>;
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
