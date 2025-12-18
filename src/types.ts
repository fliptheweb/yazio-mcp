// Type definitions for Yazio API responses
// These are extracted from the yazio package types

export interface YazioProduct {
  id: string;
  name: string;
  is_verified: boolean;
  is_private: boolean;
  is_deleted: boolean;
  has_ean: boolean;
  category: string;
  producer: string | null;
  nutrients: {
    "energy.energy": number;
    "mineral.calcium": number;
    "mineral.chlorine": number;
    "mineral.copper": number;
    "mineral.fluorine": number;
    "mineral.iron": number;
    "mineral.magnesium": number;
    "mineral.manganese": number;
    "mineral.phosphorus": number;
    "mineral.potassium": number;
    "mineral.sulfur": number;
    "mineral.zinc": number;
    "nutrient.carb": number;
    "nutrient.dietaryfiber": number;
    "nutrient.fat": number;
    "nutrient.protein": number;
    "nutrient.sugar": number;
    "vitamin.a": number;
    "vitamin.b1": number;
    "vitamin.b12": number;
    "vitamin.b2": number;
    "vitamin.b6": number;
    "vitamin.d": number;
    "vitamin.e": number;
  };
  updated_at: string;
  servings: {
    serving: string;
    amount: number;
  }[];
  base_unit: string;
  eans: string[];
  language: string;
  countries: string[];
}

export interface YazioProductSearchResult {
  serving: string;
  amount: number;
  name: string;
  is_verified: boolean;
  producer: string;
  nutrients: {
    "energy.energy": number;
    "nutrient.carb": number;
    "nutrient.fat": number;
    "nutrient.protein": number;
  };
  base_unit: string;
  language: string;
  countries: string[];
  score: number;
  product_id: string;
  serving_quantity: number;
}

export interface YazioUserInfo {
  sex: "male" | "female" | "other";
  unit_mass: string;
  unit_energy: string;
  unit_serving: string;
  unit_length: string;
  start_weight: number;
  goal: string;
  diet: {
    name: string;
    carb_percentage: number;
    fat_percentage: number;
    protein_percentage: number;
  } | null;
  email: string;
  premium_type: string;
  first_name: string;
  last_name: string;
  city: string;
  country: string;
  weight_change_per_week: number;
  body_height: number;
  date_of_birth: string;
  registration_date: string;
  timezone_offset: number;
  unit_glucose: string;
  food_database_country: string;
  profile_image: string;
  user_token: string;
  email_confirmation_status: "confirmed" | "unconfirmed";
  newsletter_opt_in: boolean;
  login_type: string;
  siwa_user_id: string | null;
  uuid: string;
  reset_date: string | null;
  activity_degree: string;
  stripe_customer_id: string | null;
}

export interface YazioWeightEntry {
  value: number | null;
  date: string;
  id: string;
  external_id: string | null;
  gateway: string | null;
  source: string | null;
}

export interface YazioSuggestedProduct {
  serving: string | null;
  amount: number;
  product_id: string;
  serving_quantity: number | null;
}

export interface YazioDietaryPreferences {
  restriction: string | null;
}

export interface YazioExercise {
  date: string;
  id: string;
  name: string;
  external_id: string | null;
  gateway: string | null;
  source: string | null;
  note: string | null;
  energy: number;
  distance: number;
  duration: number;
  steps: number;
}

export interface YazioExercises {
  training: YazioExercise[];
  custom_training: YazioExercise[];
}

export interface YazioGoals {
  "energy.energy": number;
  "nutrient.carb": number;
  "nutrient.fat": number;
  "nutrient.protein": number;
  "activity.step": number;
  "bodyvalue.weight": number;
  water: number;
}

export interface YazioSettings {
  has_water_tracker: boolean;
  has_diary_tipps: boolean;
  has_meal_reminders: boolean;
  has_usage_reminders: boolean;
  has_weight_reminders: boolean;
  has_water_reminders: boolean;
  consume_activity_calories: boolean;
  has_feelings: boolean;
  has_fasting_tracker_reminders: boolean;
  has_fasting_stage_reminders: boolean;
}

export interface YazioWaterIntake {
  gateway: string | null;
  source: string | null;
  water_intake: number;
}

export interface YazioDailySummary {
  steps: number;
  activity_energy: number;
  consume_activity_energy: boolean;
  water_intake: number;
  goals: YazioGoals;
  units: {
    unit_mass: string;
    unit_energy: string;
    unit_serving: string;
    unit_length: string;
  };
  meals: {
    breakfast: {
      nutrients: {
        "energy.energy": number;
        "nutrient.carb": number;
        "nutrient.fat": number;
        "nutrient.protein": number;
      };
      energy_goal: number;
    };
    lunch: {
      nutrients: {
        "energy.energy": number;
        "nutrient.carb": number;
        "nutrient.fat": number;
        "nutrient.protein": number;
      };
      energy_goal: number;
    };
    dinner: {
      nutrients: {
        "energy.energy": number;
        "nutrient.carb": number;
        "nutrient.fat": number;
        "nutrient.protein": number;
      };
      energy_goal: number;
    };
    snack: {
      nutrients: {
        "energy.energy": number;
        "nutrient.carb": number;
        "nutrient.fat": number;
        "nutrient.protein": number;
      };
      energy_goal: number;
    };
  };
  user: {
    start_weight?: number;
    current_weight?: number;
    goal?: string;
    sex?: string;
  };
  active_fasting_countdown_template_key: string | null;
}

export interface YazioConsumedItem {
  type: string;
  date: string;
  serving: string | null;
  amount: number;
  id: string;
  product_id: string;
  serving_quantity: number | null;
  daytime: "breakfast" | "lunch" | "dinner" | "snack";
}

export interface YazioConsumedItems {
  products: YazioConsumedItem[];
  recipe_portions: unknown[];
  simple_products: unknown[];
}

// API Options interfaces - these match the actual Yazio library signatures
export interface YazioWeightOptions {
  date?: string | Date;
}

export interface YazioExerciseOptions {
  date?: string | Date; // Only supports single date, not date ranges
}

export interface YazioSuggestedProductsOptions {
  daytime: "breakfast" | "lunch" | "dinner" | "snack";
  date?: string | Date;
}

export interface YazioWaterIntakeOptions {
  date: string | Date;
}

export interface YazioDailySummaryOptions {
  date: string | Date;
}

export interface YazioConsumedItemsOptions {
  date: string | Date;
}

export interface YazioAddConsumedItemOptions {
  date: string | Date;
  serving: string;
  amount: number;
  id: string;
  product_id: string;
  serving_quantity: number;
  daytime: "breakfast" | "lunch" | "dinner" | "snack";
}

export interface YazioRemoveConsumedItemOptions {
  itemId: string;
}

export interface YazioWaterIntakeEntry {
  date: string; // Format: "YYYY-MM-DD HH:mm:ss"
  water_intake: number; // Cumulative water intake in ml
}

export type YazioAddWaterIntakeOptions = YazioWaterIntakeEntry[];
