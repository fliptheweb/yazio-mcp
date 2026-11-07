import * as z from "zod";
import { DaytimeSchema, ProductCategorySchema, ServingNameSchema } from './api/schemas.js';
import type { DateTimeString } from './api/types.js';

export { DaytimeSchema, ProductCategorySchema, ServingNameSchema };
export const DateStringSchema = z.iso.date().describe('Date in YYYY-MM-DD format');
export const ProductIdSchema = z.uuid().describe('Product UUID v1/v4 (e.g. 4ceff6e9-78ce-441b-964a-22e81c1dee92)');
export const ItemIdSchema = ProductIdSchema.describe('Unique item identifier');
export const ServingTypeSchema = z.string().describe('Serving type (e.g. portion, fruit, glass, cup, slice, piece, bar, gram, bottle, can, etc.)');

export const QueryStringSchema = z.string().describe('Search query string');
export const LimitSchema = z.number().int().positive().optional().describe('Maximum number of results to return');

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

export const EmptyInputSchema = z.object({});

export const GetFoodEntriesInputSchema = DateInputSchema;
export const GetDailySummaryInputSchema = DateInputSchema;
export const GetUserInfoInputSchema = EmptyInputSchema;
export const GetUserWeightInputSchema = z.object({
  date: DateStringSchema.optional().describe('Returns the last weight entry up to this date (defaults to today)')
});
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
export const GetRecipeInputSchema = z.object({
  id: z.uuid().describe('Recipe ID, e.g. recipe_id of a recipe portion from get_user_consumed_items or an ID from get_user_recipes')
});
export const GetUserRecipesInputSchema = EmptyInputSchema;
export const DeleteUserRecipeInputSchema = z.object({
  id: z.uuid().describe('ID of one of the user\'s own recipes (from get_user_recipes)')
});
export const GetUserExercisesInputSchema = OptionalDateInputSchema; // Only supports single date, not date ranges
export const GetUserSettingsInputSchema = EmptyInputSchema;
export const GetUserSuggestedProductsInputSchema = z.object({
  date: DateStringSchema.optional().describe('Date to get suggestions for (defaults to today)'),
  daytime: DaytimeSchema.optional().describe('Meal to get suggestions for (defaults to breakfast)'),
  limit: LimitSchema
});
// Consumption time: "YYYY-MM-DD HH:mm:ss" keeps the time, date only logs it at 00:00
const DateTimeStringSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
  .transform((value) => value as DateTimeString);
const ConsumedAtSchema = z
  .union([DateStringSchema, DateTimeStringSchema])
  .describe('Date and time when the food was consumed in "YYYY-MM-DD HH:mm:ss" format (e.g., "2025-12-18 12:30:00"), or date only in YYYY-MM-DD format');

export const AddConsumedItemInputSchema = z.object({
  // id: ProductIdSchema.describe('Random identifier for the consumed item'),
  product_id: ProductIdSchema,
  date: ConsumedAtSchema,
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
  amount: z.number().describe('Amount of the product consumed in base units (g or ml)'),
  serving: ServingTypeSchema.optional(),
  serving_quantity: z.number().optional().describe('Quantity of servings')
}).refine((args) => (args.serving === undefined) === (args.serving_quantity === undefined), {
  message: 'Pass serving and serving_quantity together, or neither',
});
export const RemoveConsumedItemInputSchema = z.object({
  itemId: ItemIdSchema.describe('ID of the consumed item to remove')
});
export const AddWaterIntakeInputSchema = z.object({
  date: DateTimeStringSchema.describe('Date and time in format "YYYY-MM-DD HH:mm:ss" (e.g., "2025-12-18 12:00:00"); a date without time is rejected by the API'),
  water_intake: z.number().int().nonnegative().describe('Cumulative water intake in milliliters (ml)')
});
const ExtraNutrientsSchema = z
  .record(z.string().regex(/^(nutrient|mineral|vitamin)\.[a-z0-9]+$/), z.number().nonnegative())
  .optional()
  .describe('Other nutrients by Yazio key, e.g. {"nutrient.sugar": 5, "nutrient.dietaryfiber": 2, "nutrient.saturated": 1.5, "nutrient.salt": 0.8}; same scale as the main values');

export const CreateProductInputSchema = z.object({
  name: z.string().min(1).describe('Product name as it will show in search and the diary'),
  producer: z.string().optional().describe('Brand / producer / restaurant'),
  category: ProductCategorySchema.describe('Product category'),
  base_unit: z.enum(['g', 'ml']).default('g').describe('Base unit: grams (g) or milliliters (ml)'),
  energy_per_100: z.number().nonnegative().describe('Energy in kcal per 100 g (or 100 ml), as on the label'),
  protein_per_100: z.number().nonnegative().describe('Protein in g per 100 g/ml'),
  fat_per_100: z.number().nonnegative().describe('Fat in g per 100 g/ml'),
  carb_per_100: z.number().nonnegative().describe('Carbohydrates in g per 100 g/ml'),
  extra_nutrients_per_100: ExtraNutrientsSchema,
  servings: z
    .array(z.object({
      serving: ServingNameSchema,
      amount: z.number().positive().describe('Size of one serving in base units (g or ml)'),
    }))
    .optional()
    .describe('Named servings, e.g. [{"serving": "slice", "amount": 25}]'),
  is_private: z.boolean().default(true).describe('Private products are visible only to this user'),
});
export const AddConsumedRecipeInputSchema = z.object({
  recipe_id: z.uuid().describe('Recipe ID from get_user_recipes, or recipe_id of an earlier recipe portion in get_user_consumed_items'),
  date: ConsumedAtSchema,
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
  portion_count: z.number().positive().describe('Number of portions eaten, e.g. 1 or 0.5'),
});
export const AddQuickEntryInputSchema = z.object({
  name: z.string().min(1).describe('Entry name, e.g. "Тартин Pinch"'),
  date: ConsumedAtSchema,
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
  energy: z.number().nonnegative().describe('Total energy of the eaten amount in kcal (not per 100 g)'),
  protein: z.number().nonnegative().optional().describe('Total protein in g'),
  fat: z.number().nonnegative().optional().describe('Total fat in g'),
  carb: z.number().nonnegative().optional().describe('Total carbohydrates in g'),
  extra_nutrients: ExtraNutrientsSchema,
});
export const GetDietaryPreferencesInputSchema = EmptyInputSchema;
export const GetUserGoalsInputSchema = z.object({
  date: DateStringSchema.optional().describe('Date to get the goals for (defaults to today)')
});

export type Daytime = z.infer<typeof DaytimeSchema>;
export type GetFoodEntriesInput = z.infer<typeof GetFoodEntriesInputSchema>;
export type GetDailySummaryInput = z.infer<typeof GetDailySummaryInputSchema>;
export type GetUserInfoInput = z.infer<typeof GetUserInfoInputSchema>;
export type GetUserWeightInput = z.infer<typeof GetUserWeightInputSchema>;
export type GetWaterIntakeInput = z.infer<typeof GetWaterIntakeInputSchema>;
export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;
export type GetProductInput = z.infer<typeof GetProductInputSchema>;
export type GetRecipeInput = z.infer<typeof GetRecipeInputSchema>;
export type DeleteUserRecipeInput = z.infer<typeof DeleteUserRecipeInputSchema>;
export type GetUserExercisesInput = z.infer<typeof GetUserExercisesInputSchema>;
export type GetUserSettingsInput = z.infer<typeof GetUserSettingsInputSchema>;
export type GetUserSuggestedProductsInput = z.infer<typeof GetUserSuggestedProductsInputSchema>;
export type AddConsumedItemInput = z.infer<typeof AddConsumedItemInputSchema>;
export type RemoveConsumedItemInput = z.infer<typeof RemoveConsumedItemInputSchema>;
export type AddWaterIntakeInput = z.infer<typeof AddWaterIntakeInputSchema>;
export type GetDietaryPreferencesInput = z.infer<typeof GetDietaryPreferencesInputSchema>;
export type GetUserGoalsInput = z.infer<typeof GetUserGoalsInputSchema>;
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;
export type AddQuickEntryInput = z.infer<typeof AddQuickEntryInputSchema>;
export type AddConsumedRecipeInput = z.infer<typeof AddConsumedRecipeInputSchema>;
