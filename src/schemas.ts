import * as z from "zod";
import {
  DailySummarySchema,
  DateTimeStringSchema,
  DaytimeSchema,
  GoalsSchema,
  ProductCategorySchema,
  ProductSchema,
  ProductSearchResultsSchema,
  ServingNameSchema,
  TrainingNameSchema,
  BodyValueTypeSchema,
} from './api/schemas.js';

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
export const GetUserWeightHistoryInputSchema = z.object({
  start: DateStringSchema.describe('First date, included'),
  end: DateStringSchema.optional().describe('Last date, included (defaults to today)'),
});
export const GetWaterIntakeInputSchema = DateInputSchema;
export const SearchProductsInputSchema = QueryInputSchema;
// The SDK fails a tool call whose structuredContent doesn't match its outputSchema, while API
// responses that don't match their schema are only logged. Output schemas therefore accept any field
// as missing or null and enums as any string.
function lenient(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return lenient(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, field]) => [key, lenient(field).nullish()]),
    );
    return z.looseObject(shape);
  }
  if (schema instanceof z.ZodArray) return z.array(lenient(schema.element as z.ZodType));
  if (schema instanceof z.ZodRecord) return z.record(z.string(), lenient(schema.valueType as z.ZodType).nullish());
  if (schema instanceof z.ZodEnum) return z.string();
  return schema;
}

export const SearchProductsOutputSchema = z.object({ products: lenient(ProductSearchResultsSchema) });
export const GetProductOutputSchema = lenient(ProductSchema);
export const GetUserGoalsOutputSchema = lenient(GoalsSchema);
export const GetUserDailySummaryOutputSchema = lenient(DailySummarySchema);
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
  add_ml: z.number().int().positive().optional().describe('Amount of water to add, in ml. The server reads the current daily total and adds this to it. Preferred. Provide this or water_intake.'),
  water_intake: z.number().int().nonnegative().optional().describe('Absolute daily total in ml. Use it to correct the day\'s total, e.g. after a wrong entry (0 is allowed). Provide this or add_ml.'),
}).refine((args) => (args.add_ml === undefined) !== (args.water_intake === undefined), {
  message: 'Provide either add_ml or water_intake',
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
export const CreateUserRecipeInputSchema = z.object({
  name: z.string().min(1).describe('Recipe name'),
  portion_count: z.number().int().positive().describe('Number of portions the recipe makes'),
  ingredients: z
    .array(z.object({
      product_id: ProductIdSchema.describe('Product ID from search_products or create_product'),
      amount: z.number().positive().describe('Amount of the product in the whole recipe, in its base unit (g or ml)'),
      serving: ServingTypeSchema.optional(),
      serving_quantity: z.number().positive().optional().describe('Quantity of servings'),
    }).refine((item) => (item.serving === undefined) === (item.serving_quantity === undefined), {
      message: 'Pass serving and serving_quantity together, or neither',
    }))
    .min(2)
    .describe('Products in the whole recipe; Yazio requires at least 2'),
  instructions: z.array(z.string().min(1)).optional().describe('Preparation steps'),
});
export const GetUserNoteInputSchema = DateInputSchema;
export const SetUserNoteInputSchema = z.object({
  date: DateStringSchema,
  note: z.string().nullable().optional().describe('Note text for the day; null clears it; leave out to keep the current note'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Feeling tags as in the Yazio app, e.g. ["happy", "motivated", "headache"]; the API rejects unknown tags. [] clears them; leave out to keep the current tags'),
}).refine((args) => args.note !== undefined || args.tags !== undefined, {
  message: 'Provide note, tags or both',
});
export const GetUserMealsInputSchema = EmptyInputSchema;
export const CreateUserMealInputSchema = z.object({
  name: z.string().min(1).describe('Meal name, e.g. "Usual breakfast"'),
  products: z
    .array(z.object({
      product_id: ProductIdSchema.describe('Product ID from search_products or create_product'),
      amount: z.number().positive().describe('Amount in the product\'s base unit (g or ml)'),
      serving: ServingTypeSchema.optional(),
      serving_quantity: z.number().positive().optional().describe('Quantity of servings'),
    }).refine((item) => (item.serving === undefined) === (item.serving_quantity === undefined), {
      message: 'Pass serving and serving_quantity together, or neither',
    }))
    .min(1)
    .describe('Products in the meal'),
});
export const DeleteUserMealInputSchema = z.object({
  id: z.uuid().describe('Meal ID from get_user_meals'),
});
export const AddConsumedMealInputSchema = z.object({
  meal_id: z.uuid().describe('Meal ID from get_user_meals'),
  date: ConsumedAtSchema,
  daytime: DaytimeSchema.describe('Type of meal (breakfast, lunch, dinner, snack)'),
});
export const AddUserWeightInputSchema = z.object({
  date: DateTimeStringSchema.describe('Date and time of the measurement in "YYYY-MM-DD HH:mm:ss" format'),
  weight: z.number().positive().describe('Weight in kg'),
});
export const DeleteUserWeightInputSchema = z.object({
  id: z.uuid().describe('Weight entry ID from add_user_weight or get_user_weight'),
});
/** Weight has its own tools; these are the other types */
const OtherBodyValueTypeSchema = BodyValueTypeSchema.exclude(['weight']);
export const GetUserBodyValuesInputSchema = z.object({
  date: DateStringSchema.optional().describe('The day to read (defaults to today)'),
});
export const AddUserBodyValueInputSchema = z.object({
  type: OtherBodyValueTypeSchema.describe(
    'ratio.fat and ratio.muscle in %, glucoselevel in mg/dL, circumference.* in cm. Always these units, whatever units the app shows'
  ),
  date: DateTimeStringSchema.describe('Date and time of the measurement in "YYYY-MM-DD HH:mm:ss" format'),
  value: z.number().positive(),
});
export const DeleteUserBodyValueInputSchema = z.object({
  id: z.uuid().describe('Entry ID from add_user_body_value or get_user_body_values'),
});
export const AddUserExerciseInputSchema = z.object({
  date: DateTimeStringSchema.describe('Start date and time in "YYYY-MM-DD HH:mm:ss" format'),
  name: z
    .union([TrainingNameSchema, z.string().min(1)])
    .describe('A Yazio training: one of the listed names, or another training name, which the API may reject. With custom: true, any name'),
  custom: z.boolean().default(false).describe('Log a custom exercise with a free name instead of a Yazio training'),
  duration: z.number().int().positive().describe('Duration in minutes'),
  energy: z.number().nonnegative().describe('Burned energy in kcal; Yazio does not calculate it'),
  note: z.string().optional(),
});
export const DeleteUserExerciseInputSchema = z.object({
  id: z.uuid().describe('Exercise ID from get_user_exercises or add_user_exercise'),
});
export const UpdateUserRecipeInputSchema = CreateUserRecipeInputSchema.extend({
  id: z.uuid().describe('Recipe ID from get_user_recipes or create_user_recipe'),
});
export const UpdateUserBodyValueInputSchema = z.object({
  id: z.uuid().describe('Entry ID of a weight or body value, from get_user_weight, get_user_body_values or the add_* tools'),
  value: z.number().nonnegative().describe('New value in the metric unit: kg, % (body fat, muscle), mg/dL (blood glucose) or cm (circumferences)'),
});
export const SetUserActivityInputSchema = z.object({
  date: DateStringSchema.describe('Day of the activity (YYYY-MM-DD)'),
  steps: z.number().int().nonnegative().optional().describe("The day's total step count; replaces the current value"),
  energy: z.number().nonnegative().optional().describe("The day's total energy burned by activity, in kcal; replaces the current value"),
}).refine((args) => args.steps !== undefined || args.energy !== undefined, {
  message: 'Provide steps, energy or both',
});
export const GetUserDailyNutrientsInputSchema = z.object({
  start: DateStringSchema.describe('First date, included'),
  end: DateStringSchema.optional().describe('Last date, included (defaults to today)'),
});
export const GetUserProductsInputSchema = EmptyInputSchema;
export const DeleteUserProductInputSchema = z.object({
  id: ProductIdSchema.describe('ID of one of the user\'s own products, from get_user_products or create_product'),
});
export const GetUserFavoritesInputSchema = EmptyInputSchema;
export const AddUserFavoriteProductInputSchema = z.object({
  product_id: ProductIdSchema,
  amount: z.number().positive().describe('Amount in base units (g or ml) the product is favorited with'),
  serving: ServingTypeSchema.optional(),
  serving_quantity: z.number().positive().optional().describe('Quantity of servings'),
}).refine((args) => (args.serving === undefined) === (args.serving_quantity === undefined), {
  message: 'Pass serving and serving_quantity together, or neither',
});
export const AddUserFavoriteRecipeInputSchema = z.object({
  recipe_id: z.uuid().describe('Recipe ID from get_user_recipes or get_recipe'),
  portion_count: z.number().positive().describe('Number of portions the recipe is favorited with'),
});
export const RemoveUserFavoriteProductInputSchema = z.object({
  product_id: ProductIdSchema.describe('The favorited product\'s product_id'),
});
export const RemoveUserFavoriteRecipeInputSchema = z.object({
  id: z.uuid().describe('The favorite\'s own id from get_user_favorites, not the recipe_id'),
});
export const GetDietaryPreferencesInputSchema = EmptyInputSchema;
export const GetUserGoalsInputSchema = z.object({
  date: DateStringSchema.optional().describe('Date to get the goals for (defaults to today)')
});
export const SetUserGoalsInputSchema = z.object({
  goals: z
    .object({
      'energy.energy': z.number().positive().optional().describe('Energy in kcal per day'),
      'nutrient.protein': z.number().nonnegative().optional().describe('Protein in g per day'),
      'nutrient.fat': z.number().nonnegative().optional().describe('Fat in g per day'),
      'nutrient.carb': z.number().nonnegative().optional().describe('Carbs in g per day'),
      'activity.step': z.number().int().nonnegative().optional().describe('Steps per day'),
      'bodyvalue.weight': z.number().positive().optional().describe('Target weight in kg'),
      water: z.number().nonnegative().optional().describe('Water in ml per day'),
    })
    .refine((goals) => Object.values(goals).some((value) => value !== undefined), {
      message: 'Pass at least one goal',
    })
    .describe('The goals to change; goals you leave out keep their value'),
  date: DateStringSchema.optional().describe('Date the goals apply from (defaults to today)'),
});
export const GetUserConsumedItemsLatestInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(50).describe('How many of the latest items to get (defaults to 50)'),
});
export const GetUserFastingCountdownsInputSchema = EmptyInputSchema;
export const GetUserStreakInputSchema = EmptyInputSchema;

export type Daytime = z.infer<typeof DaytimeSchema>;
export type GetFoodEntriesInput = z.infer<typeof GetFoodEntriesInputSchema>;
export type GetDailySummaryInput = z.infer<typeof GetDailySummaryInputSchema>;
export type GetUserInfoInput = z.infer<typeof GetUserInfoInputSchema>;
export type GetUserWeightInput = z.infer<typeof GetUserWeightInputSchema>;
export type GetUserWeightHistoryInput = z.infer<typeof GetUserWeightHistoryInputSchema>;
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
export type SetUserGoalsInput = z.infer<typeof SetUserGoalsInputSchema>;
export type GetUserConsumedItemsLatestInput = z.infer<typeof GetUserConsumedItemsLatestInputSchema>;
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;
export type AddQuickEntryInput = z.infer<typeof AddQuickEntryInputSchema>;
export type AddConsumedRecipeInput = z.infer<typeof AddConsumedRecipeInputSchema>;
export type CreateUserRecipeInput = z.infer<typeof CreateUserRecipeInputSchema>;
export type GetUserNoteInput = z.infer<typeof GetUserNoteInputSchema>;
export type SetUserNoteInput = z.infer<typeof SetUserNoteInputSchema>;
export type CreateUserMealInput = z.infer<typeof CreateUserMealInputSchema>;
export type DeleteUserMealInput = z.infer<typeof DeleteUserMealInputSchema>;
export type AddConsumedMealInput = z.infer<typeof AddConsumedMealInputSchema>;
export type AddUserWeightInput = z.infer<typeof AddUserWeightInputSchema>;
export type DeleteUserWeightInput = z.infer<typeof DeleteUserWeightInputSchema>;
export type GetUserBodyValuesInput = z.infer<typeof GetUserBodyValuesInputSchema>;
export type AddUserBodyValueInput = z.infer<typeof AddUserBodyValueInputSchema>;
export type DeleteUserBodyValueInput = z.infer<typeof DeleteUserBodyValueInputSchema>;
export type AddUserExerciseInput = z.infer<typeof AddUserExerciseInputSchema>;
export type DeleteUserExerciseInput = z.infer<typeof DeleteUserExerciseInputSchema>;
export type UpdateUserRecipeInput = z.infer<typeof UpdateUserRecipeInputSchema>;
export type UpdateUserBodyValueInput = z.infer<typeof UpdateUserBodyValueInputSchema>;
export type SetUserActivityInput = z.infer<typeof SetUserActivityInputSchema>;
export type GetUserDailyNutrientsInput = z.infer<typeof GetUserDailyNutrientsInputSchema>;
export type DeleteUserProductInput = z.infer<typeof DeleteUserProductInputSchema>;
export type AddUserFavoriteProductInput = z.infer<typeof AddUserFavoriteProductInputSchema>;
export type AddUserFavoriteRecipeInput = z.infer<typeof AddUserFavoriteRecipeInputSchema>;
export type RemoveUserFavoriteProductInput = z.infer<typeof RemoveUserFavoriteProductInputSchema>;
export type RemoveUserFavoriteRecipeInput = z.infer<typeof RemoveUserFavoriteRecipeInputSchema>;
