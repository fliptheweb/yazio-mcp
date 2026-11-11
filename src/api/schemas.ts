// Adapted from the schemas in https://github.com/juriadams/yazio by Juri Adams and its contributors.
import * as z from 'zod';
import type { DateTimeString } from './types.js';

export const DateTimeStringSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
  .transform((value) => value as DateTimeString);

export const DaytimeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

export const ProductCategorySchema = z.enum([
  'babyfood', 'bakedgoods', 'bakingingredients', 'bread', 'candy', 'cerealproducts', 'cheese', 'chocolate',
  'dishes', 'drinksalcoholic', 'drinksnonalcoholic', 'fastfood', 'fish', 'fruits', 'icecream', 'legumes',
  'meat', 'milk', 'miscellaneous', 'nutritionalsupplements', 'oils', 'pasta', 'potatoproducts', 'poultry',
  'riceproducts', 'sauces', 'seeds', 'soyproducts', 'spices', 'spreads', 'vegetables',
]);

export const ServingNameSchema = z.enum([
  'bar', 'bottle', 'can', 'cup', 'each', 'glass', 'package', 'piece', 'portion', 'slice', 'tablespoon', 'tablet', 'teaspoon',
]);

// Verified against POST /user/exercises; the API knows more names than these
export const TrainingNameSchema = z.enum([
  'badminton', 'baseball', 'basketball', 'bowling', 'canoeing', 'climbing', 'cycling', 'darts', 'football',
  'frisbee', 'golf', 'gymnastics', 'handball', 'hiit', 'hiking', 'hockey', 'hunting', 'kayaking', 'pilates',
  'rowing', 'rugby', 'running', 'skiing', 'snowboarding', 'soccer', 'squash', 'stretching', 'surfing',
  'swimming', 'tennis', 'trampoline', 'treadmill', 'volleyball', 'walking', 'yoga', 'zumba',
]);

export const NutrientsSchema = z.record(z.string(), z.number());

export const BasicNutrientsSchema = z.looseObject({
  'energy.energy': z.number(),
  'nutrient.carb': z.number(),
  'nutrient.protein': z.number(),
  'nutrient.fat': z.number(),
});

// Values per 1 g/ml of the base unit
export const ProductNutrientsSchema = BasicNutrientsSchema.extend({
  'mineral.calcium': z.number().optional(),
  'mineral.chlorine': z.number().optional(),
  'mineral.copper': z.number().optional(),
  'mineral.fluorine': z.number().optional(),
  'mineral.iron': z.number().optional(),
  'mineral.magnesium': z.number().optional(),
  'mineral.manganese': z.number().optional(),
  'mineral.phosphorus': z.number().optional(),
  'mineral.potassium': z.number().optional(),
  'mineral.sulfur': z.number().optional(),
  'mineral.zinc': z.number().optional(),
  'nutrient.dietaryfiber': z.number().optional(),
  'nutrient.sugar': z.number().optional(),
  'vitamin.a': z.number().optional(),
  'vitamin.b1': z.number().optional(),
  'vitamin.b12': z.number().optional(),
  'vitamin.b2': z.number().optional(),
  'vitamin.b6': z.number().optional(),
  'vitamin.d': z.number().optional(),
  'vitamin.e': z.number().optional(),
  // Seen in the recipes of https://github.com/yazio-community/yazio-api-specification
  'mineral.arsenic': z.number().optional(),
  'mineral.boron': z.number().optional(),
  'mineral.chrome': z.number().optional(),
  'mineral.fluoride': z.number().optional(),
  'mineral.iodine': z.number().optional(),
  'mineral.selenium': z.number().optional(),
  'nutrient.alcohol': z.number().optional(),
  'nutrient.cholesterol': z.number().optional(),
  'nutrient.monounsaturated': z.number().optional(),
  'nutrient.polyunsaturated': z.number().optional(),
  'nutrient.salt': z.number().optional(),
  'nutrient.saturated': z.number().optional(),
  'nutrient.sodium': z.number().optional(),
  'nutrient.water': z.number().optional(),
  'vitamin.b3': z.number().optional(),
  'vitamin.b5': z.number().optional(),
  'vitamin.b7': z.number().optional(),
  'vitamin.b11': z.number().optional(),
  'vitamin.c': z.number().optional(),
  'vitamin.k': z.number().optional(),
});

export const TokenResponseSchema = z.looseObject({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

export const UserSchema = z.looseObject({
  diet: z
    .looseObject({
      carb_percentage: z.number(),
      fat_percentage: z.number(),
      protein_percentage: z.number(),
      name: z.string(),
    })
    .nullable(),
  email: z.string(),
  premium_type: z.string().nullable(),
  sex: z.enum(['male', 'female', 'other']),
  first_name: z.string(),
  last_name: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  weight_change_per_week: z.number(),
  body_height: z.number(),
  goal: z.string(),
  date_of_birth: z.string(),
  registration_date: z.string(),
  timezone_offset: z.number(),
  unit_length: z.string(),
  unit_mass: z.string(),
  unit_glucose: z.string(),
  unit_serving: z.string(),
  unit_energy: z.string(),
  food_database_country: z.string(),
  profile_image: z.string().nullable(),
  user_token: z.string(),
  start_weight: z.number(),
  email_confirmation_status: z.string(),
  newsletter_opt_in: z.boolean(),
  login_type: z.string(),
  siwa_user_id: z.string().nullable(),
  uuid: z.string(),
  reset_date: z.string().nullable(),
  activity_degree: z.string(),
  stripe_customer_id: z.string().nullable(),
  language: z.string().optional(),
  tags: z.array(z.unknown()).optional(),
});

export const UserSettingsSchema = z.looseObject({
  has_water_tracker: z.boolean(),
  has_diary_tipps: z.boolean(),
  has_meal_reminders: z.boolean(),
  has_usage_reminders: z.boolean(),
  has_weight_reminders: z.boolean(),
  has_water_reminders: z.boolean(),
  consume_activity_calories: z.boolean(),
  has_feelings: z.boolean(),
  has_fasting_tracker_reminders: z.boolean(),
  has_fasting_stage_reminders: z.boolean(),
});

export const DietaryPreferencesSchema = z.looseObject({
  restriction: z.string().nullable(),
});

export const GoalsSchema = z.looseObject({
  'energy.energy': z.number(),
  'nutrient.protein': z.number(),
  'nutrient.fat': z.number(),
  'nutrient.carb': z.number(),
  'activity.step': z.number(),
  'bodyvalue.weight': z.number(),
  water: z.number(),
});

const MealSummarySchema = z.looseObject({
  energy_goal: z.number(),
  nutrients: BasicNutrientsSchema,
});

export const DailySummarySchema = z.looseObject({
  activity_energy: z.number(),
  consume_activity_energy: z.boolean(),
  steps: z.number(),
  water_intake: z.number(),
  goals: GoalsSchema,
  units: z.looseObject({
    unit_mass: z.string(),
    unit_energy: z.string(),
    unit_serving: z.string(),
    unit_length: z.string(),
  }),
  meals: z.looseObject({
    breakfast: MealSummarySchema,
    lunch: MealSummarySchema,
    dinner: MealSummarySchema,
    snack: MealSummarySchema,
  }),
  user: z.looseObject({
    start_weight: z.number().optional(),
    current_weight: z.number().optional(),
    goal: z.string().optional(),
    sex: z.string().optional(),
  }),
  active_fasting_countdown_template_key: z.string().nullable(),
});

export const WeightHistorySchema = z.array(z.looseObject({ date: DateTimeStringSchema, value: z.number() }));

export const WeightEntrySchema = z.looseObject({
  id: z.string(),
  date: DateTimeStringSchema,
  value: z.number().nullable(),
  external_id: z.string().nullable(),
  gateway: z.string().nullable(),
  source: z.string().nullable(),
});

/**
 * The keys POST /user/bodyvalues takes, read back from entries made in the app. Yazio refuses
 * any other key as "not a valid type", without listing the valid ones.
 */
export const BodyValueTypeSchema = z.enum([
  'weight',
  'ratio.fat',
  'ratio.muscle',
  'glucoselevel',
  'circumference.waist',
  'circumference.hip',
  'circumference.chest',
  'circumference.thigh',
  'circumference.arm',
]);

/** One day's body values, keyed by type; a type without entries that day is left out */
export const BodyValuesSchema = z.record(
  z.string(),
  z.array(
    z.looseObject({
      id: z.string(),
      date: DateTimeStringSchema,
      value: z.number().nullable(),
    })
  )
);

const ExerciseSchema = z.looseObject({
  id: z.string(),
  note: z.string().nullable(),
  date: z.string(),
  name: z.string(),
  external_id: z.string().nullable(),
  energy: z.number(),
  distance: z.number(),
  duration: z.number(),
  source: z.string().nullable(),
  gateway: z.string().nullable(),
  steps: z.number(),
});

export const ExercisesSchema = z.looseObject({
  training: z.array(ExerciseSchema),
  custom_training: z.array(ExerciseSchema),
  /** The day's steps and activity totals */
  activity: z
    .looseObject({
      energy: z.number(),
      distance: z.number(),
      duration: z.number(),
      source: z.string().nullable(),
      gateway: z.string().nullable(),
      steps: z.number(),
    })
    .optional(),
});

export const SuggestedProductsSchema = z.array(
  z.looseObject({
    product_id: z.string(),
    amount: z.number(),
    serving: z.string().nullable(),
    serving_quantity: z.number().nullable(),
  }),
);

export const WaterIntakeSchema = z.looseObject({
  water_intake: z.number(),
  gateway: z.string().nullable(),
  source: z.string().nullable(),
});

const ConsumedProductSchema = z.looseObject({
  id: z.string(),
  date: DateTimeStringSchema,
  daytime: DaytimeSchema,
  type: z.string(),
  product_id: z.string(),
  amount: z.number(),
  serving: z.string().nullable(),
  serving_quantity: z.number().nullable(),
});

const ConsumedRecipePortionSchema = z.looseObject({
  id: z.string(),
  date: DateTimeStringSchema,
  daytime: DaytimeSchema,
  type: z.string().optional(),
  recipe_id: z.string(),
  portion_count: z.number(),
});

const ConsumedSimpleProductSchema = z.looseObject({
  id: z.string(),
  date: DateTimeStringSchema,
  daytime: DaytimeSchema,
  type: z.string().optional(),
  name: z.string(),
  nutrients: NutrientsSchema,
  is_ai_generated: z.boolean().optional(),
});

export const ConsumedItemsSchema = z.looseObject({
  products: z.array(ConsumedProductSchema),
  recipe_portions: z.array(ConsumedRecipePortionSchema),
  simple_products: z.array(ConsumedSimpleProductSchema),
});

export const ProductSearchResultsSchema = z.array(
  z.looseObject({
    score: z.number(),
    name: z.string(),
    product_id: z.string(),
    serving: z.string(),
    serving_quantity: z.number(),
    amount: z.number(),
    base_unit: z.string(),
    producer: z.string().nullable(),
    is_verified: z.boolean(),
    nutrients: BasicNutrientsSchema,
    countries: z.array(z.string()),
    language: z.string(),
  }),
);

export const ProductSchema = z.looseObject({
  name: z.string(),
  is_verified: z.boolean(),
  is_private: z.boolean(),
  is_deleted: z.boolean(),
  has_ean: z.boolean(),
  category: z.string(),
  producer: z.string().nullable(),
  nutrients: ProductNutrientsSchema,
  updated_at: z.string().nullable(),
  servings: z.array(z.looseObject({ serving: z.string(), amount: z.number() })),
  base_unit: z.string(),
  eans: z.array(z.string()),
  language: z.string(),
  countries: z.array(z.string()),
});

export const RecipeSchema = z.looseObject({
  id: z.string(),
  yazio_id: z.string().nullable(),
  locale: z.string(),
  name: z.string(),
  portion_count: z.number(),
  nutrients: NutrientsSchema,
  image: z.string().nullable(),
  instructions: z.array(z.string()),
  is_yazio_recipe: z.boolean(),
  available_since: z.string().nullable(),
  is_pro_recipe: z.boolean(),
  servings: z.array(
    z.looseObject({
      producer: z.string().nullable(),
      name: z.string(),
      amount: z.number(),
      base_unit: z.string(),
      serving: z.string().nullable(),
      serving_quantity: z.number().nullable(),
      note: z.string().nullable(),
      product_id: z.string(),
    }),
  ),
});

export const RecipeIdsSchema = z.array(z.string());

export const UserProductIdsSchema = z.array(z.string());

export const DailyNutrientsSchema = z.array(
  z.looseObject({
    date: z.string(),
    energy: z.number(),
    carb: z.number(),
    protein: z.number(),
    fat: z.number(),
    energy_goal: z.number(),
  }),
);

export const FavoriteProductsSchema = z.array(
  z.looseObject({
    id: z.string(),
    product_id: z.string(),
    amount: z.number(),
    serving: z.string().nullable(),
    serving_quantity: z.number().nullable(),
  }),
);

export const FavoriteRecipesSchema = z.array(
  z.looseObject({
    id: z.string(),
    recipe_id: z.string(),
    portion_count: z.number(),
    yazio_id: z.string().nullable(),
  }),
);

export const FeelingSchema = z.looseObject({
  note: z.string().nullable(),
  tags: z.array(z.string()),
});

const MealProductSchema = z.looseObject({
  product_id: z.string(),
  amount: z.number(),
  serving: z.string().nullable(),
  serving_quantity: z.number().nullable(),
});

const MealSimpleProductSchema = z.looseObject({
  name: z.string(),
  nutrients: NutrientsSchema,
});

const MealRecipePortionSchema = z.looseObject({
  recipe_id: z.string(),
  portion_count: z.number(),
});

export const MealsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    products: z.array(MealProductSchema),
    simple_products: z.array(MealSimpleProductSchema),
    recipe_portions: z.array(MealRecipePortionSchema),
  }),
);
