import * as z from "zod";

export const DaytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const DateStringSchema = z.iso.date().describe('Date in YYYY-MM-DD format');
export const ProductIdSchema = z.uuid().describe('Product UUID v1/v4 (e.g. 4ceff6e9-78ce-441b-964a-22e81c1dee92)');
export const ItemIdSchema = ProductIdSchema.describe('Unique item identifier');
export const ServingTypeSchema = z.string().describe('Serving type (e.g. portion, fruit, glass, cup, slice, piece, bar, gram, bottle, can, etc.)');

export const QueryStringSchema = z.string().describe('Search query string');
export const LimitSchema = z.number().optional().describe('Maximum number of results to return');

export const DateInputSchema = z.object({
  date: DateStringSchema
});

export const OptionalDateInputSchema = z.object({
  date: DateStringSchema.optional()
});

export const QueryInputSchema = z.object({
  query: QueryStringSchema.describe('Search query'),
  sex: z.enum(["male", "female"]).default("male").optional(),
  countries: z.array(z.string()).default(["US"]).optional().describe('Array of country codes for product search (e.g. ["US", "DE", "TR"])'),
  locales: z.array(z.string()).default(["en_US"]).optional().describe('Array of locale codes (e.g. ["en_US", "de_US"])')
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

// -- Tool output schemas -----------------------------------------------------
// These mirror the shapes the `yazio` client returns (which it already
// validates upstream), so they document the real field names/types for the
// model. Because the Yazio API is unofficial and reverse-engineered, every
// field is null-tolerant and objects are `loose`: the schema advertises the
// expected shape without rejecting a response that adds, drops, or nulls a
// field. Advertised as a tool `outputSchema`, so the SDK validates the tool's
// `structuredContent` against it on every call.

// Yazio nutrient maps use dotted metric keys (e.g. "energy.energy",
// "nutrient.carb", "mineral.iron", "vitamin.a"); values are numbers.
export const NutrientMapSchema = z.record(z.string(), z.number().nullish())
  .describe('Nutrients keyed by Yazio metric, e.g. energy.energy, nutrient.carb, mineral.iron, vitamin.a');

export const SearchProductsOutputSchema = z.object({
  products: z.array(z.looseObject({
    score: z.number().nullish(),
    name: z.string().nullish(),
    product_id: z.string().nullish().describe('Product UUID'),
    serving: z.string().nullish().describe('Serving type (e.g. portion, glass, piece)'),
    serving_quantity: z.number().nullish(),
    amount: z.number().nullish(),
    base_unit: z.string().nullish().describe('Base unit: grams (g) or milliliters (ml)'),
    producer: z.string().nullish().describe('Producer name'),
    is_verified: z.boolean().nullish(),
    nutrients: NutrientMapSchema.nullish(),
    countries: z.array(z.string()).nullish().describe('Array of country codes (e.g. ["US", "DE"])'),
    language: z.string().nullish().describe('Language code (e.g. "en", "de")'),
  })).describe('Matching food products, best match first'),
});
export type SearchProductsOutput = z.infer<typeof SearchProductsOutputSchema>;

// getProduct → Product (or null when not found; the tool handles null itself).
export const GetProductOutputSchema = z.looseObject({
  id: z.string().nullish().describe('Product UUID'),
  name: z.string().nullish(),
  category: z.string().nullish().describe('Yazio product category'),
  producer: z.string().nullish(),
  base_unit: z.string().nullish().describe('Base unit: grams (g) or milliliters (ml)'),
  is_verified: z.boolean().nullish(),
  is_private: z.boolean().nullish(),
  is_deleted: z.boolean().nullish(),
  has_ean: z.boolean().nullish(),
  eans: z.array(z.string()).nullish().describe('Barcodes (EANs)'),
  language: z.string().nullish().describe('Language code (e.g. "en", "de")'),
  countries: z.array(z.string()).nullish().describe('Array of country codes'),
  updated_at: z.string().nullish(),
  nutrients: NutrientMapSchema.nullish().describe('Per-base-unit nutrients keyed by Yazio metric'),
  servings: z.array(z.looseObject({
    serving: z.string().nullish().describe('Serving type (e.g. portion, piece, cup)'),
    amount: z.number().nullish().describe('Amount of this serving in base units'),
  })).nullish().describe('Available serving types and their amount in base units'),
});

// getUserGoals → UserGoals. Daily targets keyed by Yazio metric.
export const GetUserGoalsOutputSchema = z.looseObject({
  'energy.energy': z.number().nullish().describe('Daily energy goal (kcal)'),
  'nutrient.protein': z.number().nullish().describe('Daily protein goal (g)'),
  'nutrient.fat': z.number().nullish().describe('Daily fat goal (g)'),
  'nutrient.carb': z.number().nullish().describe('Daily carbohydrate goal (g)'),
  'activity.step': z.number().nullish().describe('Daily step goal'),
  'bodyvalue.weight': z.number().nullish().describe('Target body weight'),
  water: z.number().nullish().describe('Daily water goal (ml)'),
});

// getUserDailySummary → UserDailySummary. Large nested object; top-level fields
// are documented and the deeply-nested blobs (goals/units/meals/user) are kept
// loose so their full contents pass through untouched.
export const GetUserDailySummaryOutputSchema = z.looseObject({
  activity_energy: z.number().nullish().describe('Energy burned via activity (kcal)'),
  consume_activity_energy: z.boolean().nullish(),
  steps: z.number().nullish(),
  water_intake: z.number().nullish().describe('Cumulative water intake (ml)'),
  goals: NutrientMapSchema.nullish().describe('Daily goals keyed by Yazio metric'),
  units: z.looseObject({}).nullish().describe('User unit preferences (energy, mass, volume, etc.)'),
  meals: z.looseObject({}).nullish().describe('Per-meal consumed items and totals (breakfast/lunch/dinner/snack)'),
  user: z.looseObject({}).nullish().describe('User profile snapshot for the day'),
  active_fasting_countdown_template_key: z.string().nullish(),
});

export const GetProductInputSchema = z.object({
  id: ProductIdSchema.describe('Product ID to get details for')
});
export const GetUserExercisesInputSchema = OptionalDateInputSchema; // Only supports single date, not date ranges
export const GetUserSettingsInputSchema = EmptyInputSchema;
export const GetUserSuggestedProductsInputSchema = OptionalQueryInputSchema;
export const AddConsumedItemInputSchema = z.object({
  // id: ProductIdSchema.describe('Random identifier for the consumed item'),
  product_id: ProductIdSchema,
  date: DateStringSchema.describe('Date when the food was consumed'),
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
  amount: z.number().describe('Amount of the product consumed in base units (g or ml)'),
  serving: ServingTypeSchema.optional(),
  serving_quantity: z.number().optional().describe('Quantity of servings')
});
export const RemoveConsumedItemInputSchema = z.object({
  itemId: ItemIdSchema.describe('ID of the consumed item to remove')
});
export const AddWaterIntakeInputSchema = z.object({
  date: z.string().describe('Date and time in format "YYYY-MM-DD HH:mm:ss" (e.g., "2025-12-18 12:00:00")'),
  water_intake: z.number().describe('Cumulative water intake in milliliters (ml)')
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
export type AddWaterIntakeInput = z.infer<typeof AddWaterIntakeInputSchema>;
export type GetDietaryPreferencesInput = z.infer<typeof GetDietaryPreferencesInputSchema>;
export type GetUserGoalsInput = z.infer<typeof GetUserGoalsInputSchema>;
