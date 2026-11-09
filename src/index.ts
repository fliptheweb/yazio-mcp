#!/usr/bin/env node

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { v4 as uuidv4 } from "uuid";

import {
  GetFoodEntriesInputSchema,
  GetDailySummaryInputSchema,
  GetUserInfoInputSchema,
  GetUserWeightInputSchema,
  GetUserWeightHistoryInputSchema,
  GetWaterIntakeInputSchema,
  SearchProductsInputSchema,
  GetProductInputSchema,
  GetRecipeInputSchema,
  GetUserRecipesInputSchema,
  DeleteUserRecipeInputSchema,
  GetUserExercisesInputSchema,
  GetUserSettingsInputSchema,
  GetUserSuggestedProductsInputSchema,
  AddConsumedItemInputSchema,
  RemoveConsumedItemInputSchema,
  AddWaterIntakeInputSchema,
  GetDietaryPreferencesInputSchema,
  GetUserGoalsInputSchema,
  CreateProductInputSchema,
  AddQuickEntryInputSchema,
  AddConsumedRecipeInputSchema,
  CreateUserRecipeInputSchema,
  GetUserNoteInputSchema,
  SetUserNoteInputSchema,
  SearchProductsOutputSchema,
  GetProductOutputSchema,
  GetUserGoalsOutputSchema,
  GetUserDailySummaryOutputSchema,
  type GetFoodEntriesInput,
  type GetDailySummaryInput,
  type GetWaterIntakeInput,
  type SearchProductsInput,
  type GetProductInput,
  type GetRecipeInput,
  type DeleteUserRecipeInput,
  type GetUserExercisesInput,
  type GetUserGoalsInput,
  type GetUserWeightInput,
  type GetUserWeightHistoryInput,
  type GetUserSuggestedProductsInput,
  type AddConsumedItemInput,
  type RemoveConsumedItemInput,
  type AddWaterIntakeInput,
  type CreateProductInput,
  type AddQuickEntryInput,
  type AddConsumedRecipeInput,
  type CreateUserRecipeInput,
  type GetUserNoteInput,
  type SetUserNoteInput,
} from './schemas.js';
import { YazioApi } from './api/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const SERVER_INSTRUCTIONS = `Access to the signed-in user's Yazio nutrition and fitness data via an unofficial API.

Conventions:
- Dates are YYYY-MM-DD; diary and water entries also take "YYYY-MM-DD HH:mm:ss". Amounts are in base units, grams (g) or milliliters (ml).
- daytime (meal) is one of: breakfast, lunch, dinner, snack.
- get_* and search_products only read. add_*, create_*, set_user_note, remove_user_consumed_item and delete_user_recipe change the user's data.

Logging food: search_products, then get_product for its servings and base unit, then add_user_consumed_item. For food that isn't in the database, use add_quick_entry for a one-off entry or create_product for something eaten again. For a recipe, use add_user_consumed_recipe.

Water: add_user_water_intake with add_ml adds to the day's total.

Notes: get_user_note reads the day's diary note and feeling tags, set_user_note changes them.

Removing a diary entry: get_user_consumed_items gives the entry's id (not its product_id) for remove_user_consumed_item.`;

class YazioMcpServer {
  private yazioClient: YazioApi | null = null;
  private stdio: StdioServerHandle | null = null;

  constructor() {
    this.setupErrorHandling();
    this.initializeClient();
  }

  // serveStdio calls this for the connection, for 2025-era (initialize) and 2026-07-28 clients alike
  private createServer(): McpServer {
    const server = new McpServer(
      {
        name: 'yazio-mcp',
        version,
        title: 'Yazio',
        description: "Access the signed-in user's Yazio nutrition and diet data (unofficial)",
        websiteUrl: 'https://github.com/fliptheweb/yazio-mcp',
      },
      { instructions: SERVER_INSTRUCTIONS },
    );
    this.setupToolHandlers(server);
    this.setupResourceHandlers(server);
    this.setupPromptHandlers(server);
    return server;
  }

  private async initializeClient(): Promise<void> {
    const username = process.env.YAZIO_USERNAME;
    const password = process.env.YAZIO_PASSWORD;

    if (!username || !password) {
      console.error('❌ YAZIO_USERNAME and YAZIO_PASSWORD environment variables are required');
      console.error('💡 Please set these environment variables with your Yazio account credentials');
      process.exit(1);
    }

    try {
      this.yazioClient = new YazioApi({
        username,
        password,
        clientId: process.env.YAZIO_CLIENT_ID || undefined,
        clientSecret: process.env.YAZIO_CLIENT_SECRET || undefined,
      });
      // Test the connection
      await this.yazioClient.getUser();
      console.error('✅ Successfully authenticated with Yazio using environment variables');
    } catch (error) {
      console.error('❌ Failed to authenticate with Yazio:', (error as Error).message);
      console.error('💡 Please check your YAZIO_USERNAME and YAZIO_PASSWORD environment variables');
      process.exit(1);
    }
  }

  private setupErrorHandling(): void {
    process.on('SIGINT', async () => {
      await this.stdio?.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(server: McpServer): void {
    server.registerTool(
      'get_user',
      {
        title: 'Get User Profile',
        description: 'Get Yazio user profile information',
        inputSchema: GetUserInfoInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUser();
      }
    );

    server.registerTool(
      'get_user_consumed_items',
      {
        title: 'Get Consumed Items',
        description: 'Get food entries for a specific date',
        inputSchema: GetFoodEntriesInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetFoodEntriesInput) => {
        return await this.getUserConsumedItems(args);
      }
    );

    server.registerTool(
      'get_user_dietary_preferences',
      {
        title: 'Get Dietary Preferences',
        description: 'Get user dietary preferences and restrictions',
        inputSchema: GetDietaryPreferencesInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUserDietaryPreferences();
      }
    );

    server.registerTool(
      'get_user_exercises',
      {
        title: 'Get Exercises',
        description: 'Get user exercise data for a date or date range',
        inputSchema: GetUserExercisesInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetUserExercisesInput) => {
        return await this.getUserExercises(args);
      }
    );

    server.registerTool(
      'get_user_goals',
      {
        title: 'Get Goals',
        description: 'Get user nutrition and fitness goals',
        inputSchema: GetUserGoalsInputSchema,
        outputSchema: GetUserGoalsOutputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetUserGoalsInput) => {
        return await this.getUserGoals(args);
      }
    );

    server.registerTool(
      'get_user_settings',
      {
        title: 'Get Settings',
        description: 'Get user settings and preferences',
        inputSchema: GetUserSettingsInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUserSettings();
      }
    );

    server.registerTool(
      'get_user_suggested_products',
      {
        title: 'Get Suggested Products',
        description: 'Get product suggestions for the user for a meal (daytime) on a date',
        inputSchema: GetUserSuggestedProductsInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args: GetUserSuggestedProductsInput) => {
        return await this.getUserSuggestedProducts(args);
      }
    );

    server.registerTool(
      'get_user_water_intake',
      {
        title: 'Get Water Intake',
        description: 'Get water intake data for a specific date',
        inputSchema: GetWaterIntakeInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetWaterIntakeInput) => {
        return await this.getUserWaterIntake(args);
      }
    );

    server.registerTool(
      'get_user_weight',
      {
        title: 'Get Weight',
        description: 'Get the last weight entry up to a date. Use get_user_weight_history for all entries in a date range.',
        inputSchema: GetUserWeightInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetUserWeightInput) => {
        return await this.getUserWeight(args);
      }
    );

    server.registerTool(
      'get_user_weight_history',
      {
        title: 'Get Weight History',
        description: 'Get all weight entries between two dates in one call, e.g. for trends. A day can have several entries at different times.',
        inputSchema: GetUserWeightHistoryInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetUserWeightHistoryInput) => {
        return await this.getUserWeightHistory(args);
      }
    );

    server.registerTool(
      'get_user_daily_summary',
      {
        title: 'Get Daily Summary',
        description: 'Get daily nutrition summary for a specific date',
        inputSchema: GetDailySummaryInputSchema,
        outputSchema: GetUserDailySummaryOutputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetDailySummaryInput) => {
        return await this.getUserDailySummary(args);
      }
    );

    server.registerTool(
      'search_products',
      {
        title: 'Search Food Products',
        description: 'Search for food products in Yazio database. You can optionally specify user\'s sex, country and locale of the products to search for.',
        inputSchema: SearchProductsInputSchema,
        outputSchema: SearchProductsOutputSchema,
        // outputSchema: SearchProductsOutputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args: SearchProductsInput) => {
        return await this.searchProducts(args);
      }
    );

    server.registerTool(
      'get_product',
      {
        title: 'Get Product Details',
        description: 'Get detailed information about a specific product by ID',
        inputSchema: GetProductInputSchema,
        outputSchema: GetProductOutputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args: GetProductInput) => {
        return await this.getProduct(args);
      }
    );

    server.registerTool(
      'get_recipe',
      {
        title: 'Get Recipe',
        description: 'Get a recipe by ID with its ingredients, portion count and nutrients per portion. Use it to resolve recipe_id of recipe portions in get_user_consumed_items.',
        inputSchema: GetRecipeInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetRecipeInput) => {
        return await this.getRecipe(args);
      }
    );

    server.registerTool(
      'get_user_recipes',
      {
        title: 'Get User Recipes',
        description: "Get the user's own recipes with their ingredients and nutrients",
        inputSchema: GetUserRecipesInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUserRecipes();
      }
    );

    server.registerTool(
      'delete_user_recipe',
      {
        title: 'Delete Recipe',
        description: "Permanently delete one of the user's own recipes. It can't be restored, so confirm with the user first.",
        inputSchema: DeleteUserRecipeInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async (args: DeleteUserRecipeInput) => {
        return await this.deleteUserRecipe(args);
      }
    );

    server.registerTool(
      'add_user_consumed_item',
      {
        title: 'Add Consumed Item',
        description: 'Add a food item to user consumption log. Pass date with time ("YYYY-MM-DD HH:mm:ss") to keep the time of the entry; date only (YYYY-MM-DD) logs it at 00:00.',
        inputSchema: AddConsumedItemInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: AddConsumedItemInput) => {
        return await this.addUserConsumedItem(args);
      }
    );

    server.registerTool(
      'remove_user_consumed_item',
      {
        title: 'Remove Consumed Item',
        description: 'Remove a food item from user consumption log',
        inputSchema: RemoveConsumedItemInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async (args: RemoveConsumedItemInput) => {
        return await this.removeUserConsumedItem(args);
      }
    );

    server.registerTool(
      'add_user_water_intake',
      {
        title: 'Add Water Intake',
        description: 'Log water intake at a date and time ("YYYY-MM-DD HH:mm:ss"). Pass add_ml (the amount drunk): the server reads the current daily total and adds to it. To correct the day\'s total, pass water_intake as the corrected absolute total in ml.',
        inputSchema: AddWaterIntakeInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: AddWaterIntakeInput) => {
        return await this.addUserWaterIntake(args);
      }
    );

    server.registerTool(
      'create_product',
      {
        title: 'Create Product',
        description: 'Create a custom product (e.g. a restaurant dish or a brand missing in search) from label values per 100 g/ml. Returns its product_id for add_user_consumed_item. Search first: creating duplicates clutters the database.',
        inputSchema: CreateProductInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: CreateProductInput) => {
        return await this.createProduct(args);
      }
    );

    server.registerTool(
      'add_quick_entry',
      {
        title: 'Add Quick Entry',
        description: 'Log a one-off diary entry with a name and total nutrition of the eaten amount (Yazio "quick add"), without creating a product. Shows up in get_user_consumed_items as simple_products and is removed with remove_user_consumed_item.',
        inputSchema: AddQuickEntryInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: AddQuickEntryInput) => {
        return await this.addQuickEntry(args);
      }
    );

    server.registerTool(
      'add_user_consumed_recipe',
      {
        title: 'Add Recipe Portion',
        description: 'Log portions of a recipe to the diary. Shows up in get_user_consumed_items as recipe_portions. Use get_recipe for the nutrients per portion.',
        inputSchema: AddConsumedRecipeInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: AddConsumedRecipeInput) => {
        return await this.addUserConsumedRecipe(args);
      }
    );

    server.registerTool(
      'create_user_recipe',
      {
        title: 'Create Recipe',
        description: 'Create a recipe from products and their amounts in the whole recipe. The nutrients per portion are calculated from the products. Returns the recipe ID for add_user_consumed_recipe.',
        inputSchema: CreateUserRecipeInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args: CreateUserRecipeInput) => {
        return await this.createUserRecipe(args);
      }
    );

    server.registerTool(
      'get_user_note',
      {
        title: 'Get Note',
        description: "Get the user's diary note and feeling tags for a date (the Notes card in the Yazio diary)",
        inputSchema: GetUserNoteInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetUserNoteInput) => {
        return await this.getUserNote(args);
      }
    );

    server.registerTool(
      'set_user_note',
      {
        title: 'Set Note',
        description: "Set the user's diary note and/or feeling tags for a date. Fields you leave out keep their current value; the note text replaces the old text, so include it to append.",
        inputSchema: SetUserNoteInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async (args: SetUserNoteInput) => {
        return await this.setUserNote(args);
      }
    );
  }

  // The same read-only data as the get_* tools, for clients that attach resources as context
  private setupResourceHandlers(server: McpServer): void {
    const jsonResource = (
      name: string,
      uri: string,
      title: string,
      description: string,
      read: (client: YazioApi) => Promise<unknown>,
    ) => {
      server.registerResource(name, uri, { title, description, mimeType: 'application/json' }, async (url) => {
        const data = await read(await this.ensureAuthenticated());
        return { contents: [{ uri: url.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
      });
    };

    jsonResource('user_profile', 'yazio://user/profile', 'Yazio Profile', "The user's Yazio profile", (client) => client.getUser());
    jsonResource('user_goals', 'yazio://user/goals', 'Yazio Goals', "The user's daily nutrition and fitness goals", (client) =>
      client.getGoals(),
    );
    jsonResource('user_settings', 'yazio://user/settings', 'Yazio Settings', "The user's app settings", (client) =>
      client.getSettings(),
    );
    jsonResource(
      'user_dietary_preferences',
      'yazio://user/dietary-preferences',
      'Yazio Dietary Preferences',
      "The user's dietary preferences and restrictions",
      (client) => client.getDietaryPreferences(),
    );
  }

  private setupPromptHandlers(server: McpServer): void {
    server.registerPrompt(
      'add_food_item',
      {
        title: 'Add Food Item to Log',
        description: 'Guide for adding a food item to the user\'s consumption log',
      },
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `To add a food item to the user's consumption log, follow these steps:

1. **Search for the product**: Use the \`search_products\` tool with a query string (e.g., "chicken breast", "apple", "pasta"), optionally specifying user's sex, country and locale of the products to search for. This will return a list of matching products with their IDs and short information about the product and serving.

2. **Clarify the product**: If multiple products are found, ask the user to clarify which product they want to use.

3. **Get product details**: Use the \`get_product\` tool with the \`product_id\` from the search results. This will show you full information about the product and serving:
   - Available serving types (e.g., "portion", "gram", "piece", "cup") and their amounts in base units (g or ml)
   - Base unit (g or ml)

4. **Clarify the serving**: If the user doesn't provide a serving type and quantity, ask them to clarify the serving type provided by previous step and quantity they want to add.

5. **Add the consumed item**: Use the \`add_user_consumed_item\` tool with:
   - \`product_id\`: The UUID from step 1
   - \`date\`: Date and time in "YYYY-MM-DD HH:mm:ss" format (or date only in YYYY-MM-DD format)
   - \`daytime\`: One of: "breakfast", "lunch", "dinner", or "snack"
   - \`serving\`: Use a serving type from step 2 (e.g., "portion", "piece", "cup") OR base unit (g or ml)
   - \`serving_quantity\`: Quantity of the serving type (e.g., 1, 2, 0.5)
   - \`amount\`: Direct amount in base units (g or ml). If serving type is provided, use the amount of the serving type * serving_quantity. If serving type is not provided, use the amount of the base unit.

**Important Notes**:
- Always search first if you don't have a product_id
- Check product details to understand available serving types, base unit (g or ml) and amount in serving
- The date should include the time the food was consumed ("YYYY-MM-DD HH:mm:ss"); date only (YYYY-MM-DD) logs it at 00:00
- You can use serving or base unit approach:
  1. serving type + serving quantity + amount (amount for selected serving type multiplied by serving quantity)
  2. amount in g/ml - serving fields could be omitted
Example:
  1. "I ate 2 apples" - serving type "piece" which has 100g amount (from product details) + serving quantity 2 + amount 200g
  2. "I ate 200g of chicken breast" - amount 200g
- Always provide amount in base units (g or ml), not in servings.
`
              }
            }
          ]
        };
      }
    );

    server.registerPrompt(
      'remove_food_item',
      {
        title: 'Remove Food Item from Log',
        description: 'Guide for removing a food item from the user\'s consumption log',
      },
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `To remove a food item from the user's consumption log, follow these steps:

1. **Get consumed items**: Use the \`get_user_consumed_items\` tool with the \`date\` parameter (in YYYY-MM-DD format) to retrieve all food entries for that date.

2. **Identify the item**: From the returned list of consumed items, identify the specific item you want to remove. Each item will have:
   - \`id\`: The unique identifier for the consumed item (this is what you need for removal)
   - \`product_id\`: The product identifier
   - \`name\`: The product name
   - \`date\`: The date it was consumed
   - \`daytime\`: The meal type (breakfast, lunch, dinner, snack)
   - Other details like amount, serving, etc.

3. **Remove the item**: Use the \`remove_user_consumed_item\` tool with:
   - \`itemId\`: The \`id\` field from the consumed item you identified in step 2

**Important Notes**:
- You must first retrieve the consumed items to get the item ID
- The \`itemId\` is different from \`product_id\` - use the \`id\` field from the consumed item
- The date should be in ISO format (YYYY-MM-DD)
- If multiple items match the description, you may need to ask the user to clarify which specific item to remove`
              }
            }
          ]
        };
      }
    );

    server.registerPrompt(
      'add_water_intake',
      {
        title: 'Add Water Intake to Log',
        description: 'Guide for adding water intake entries to the user\'s log',
      },
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `To add water intake to the user's log, call \`add_user_water_intake\` with:
- \`date\`: date and time as "YYYY-MM-DD HH:mm:ss" (e.g. "2025-12-18 12:00:00")
- \`add_ml\`: the amount drunk, in ml

The server reads the day's current total and adds \`add_ml\` to it, so there is no need to fetch or compute the total yourself.

To correct the day's total, e.g. after a wrong entry, pass \`water_intake\` with the corrected absolute total in ml (0 is allowed) instead of \`add_ml\`. Provide one of the two, not both.

**Example**: the user says "I drank 250ml of water" → \`{ date: "2025-12-18 12:00:00", add_ml: 250 }\`. If the day's total was 500 ml, it becomes 750 ml.`
              }
            }
          ]
        };
      }
    );
  }

  private async ensureAuthenticated(): Promise<YazioApi> {
    if (!this.yazioClient) {
      throw new Error('Yazio client not initialized. Check environment variables.');
    }
    return this.yazioClient;
  }


  private async getUserConsumedItems(args: GetFoodEntriesInput) {
    const client = await this.ensureAuthenticated();

    try {
      const foodEntries = await client.getConsumedItems(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Food entries for ${args.date}:\n\n${JSON.stringify(foodEntries, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get food entries: ${error}`);
    }
  }

  private async getUser() {
    const client = await this.ensureAuthenticated();

    try {
      const userInfo = await client.getUser();

      return {
        content: [
          {
            type: 'text' as const,
            text: `User info:\n\n${JSON.stringify(userInfo, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user info: ${error}`);
    }
  }

  private async getUserDailySummary(args: GetDailySummaryInput) {
    const client = await this.ensureAuthenticated();

    try {
      const summary = await client.getDailySummary(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Daily summary for ${args.date}:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
        structuredContent: summary,
      };
    } catch (error) {
      throw new Error(`Failed to get daily summary: ${error}`);
    }
  }

  private async getUserWeight(args: GetUserWeightInput) {
    const client = await this.ensureAuthenticated();

    try {
      const weight = await client.getLastWeight(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `User weight data:\n\n${JSON.stringify(weight, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user weight: ${error}`);
    }
  }

  private async getUserWeightHistory(args: GetUserWeightHistoryInput) {
    const client = await this.ensureAuthenticated();

    try {
      const entries = await client.getWeightHistory(args.start, args.end);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Weight entries (${entries.length}):\n\n${JSON.stringify(entries, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get weight history: ${error}`);
    }
  }

  private async getUserWaterIntake(args: GetWaterIntakeInput) {
    const client = await this.ensureAuthenticated();

    try {
      const waterIntake = await client.getWaterIntake(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Water intake for ${args.date}:\n\n${JSON.stringify(waterIntake, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get water intake: ${error}`);
    }
  }

  private async searchProducts(args: SearchProductsInput) {
    const client = await this.ensureAuthenticated();

    try {
      // structuredContent has to be an object, so the list goes under `products`
      const structuredContent = { products: await client.searchProducts(args) };

      return {
        content: [
          {
            type: 'text' as const,
            text: `Products:\n\n${JSON.stringify(structuredContent.products, null, 2)}`,
          },
        ],
        structuredContent,
      };
    } catch (error) {
      throw new Error(`Failed to search products: ${error}`);
    }
  }

  private async getProduct(args: GetProductInput) {
    const client = await this.ensureAuthenticated();

    try {
      const product = await client.getProduct(args.id);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Product details for ID "${args.id}":\n\n${JSON.stringify(product, null, 2)}`,
          },
        ],
        structuredContent: product,
      };
    } catch (error) {
      throw new Error(`Failed to get product: ${error}`);
    }
  }

  private async getRecipe(args: GetRecipeInput) {
    const client = await this.ensureAuthenticated();

    try {
      const recipe = await client.getRecipe(args.id);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Recipe "${recipe.name}":\n\n${JSON.stringify(recipe, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get recipe: ${error}`);
    }
  }

  private async getUserRecipes() {
    const client = await this.ensureAuthenticated();

    try {
      // The API only lists IDs, so load each recipe
      const ids = await client.getUserRecipeIds();
      const recipes = await Promise.all(ids.map((id) => client.getRecipe(id)));

      return {
        content: [
          {
            type: 'text' as const,
            text: `User recipes (${recipes.length}):\n\n${JSON.stringify(recipes, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user recipes: ${error}`);
    }
  }

  private async deleteUserRecipe(args: DeleteUserRecipeInput) {
    const client = await this.ensureAuthenticated();

    try {
      await client.deleteUserRecipe(args.id);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully deleted recipe with ID: ${args.id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to delete recipe: ${error}`);
    }
  }

  private async getUserExercises(args: GetUserExercisesInput) {
    const client = await this.ensureAuthenticated();

    try {
      const exercises = await client.getExercises(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `User exercises:\n\n${JSON.stringify(exercises, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user exercises: ${error}`);
    }
  }

  private async getUserSettings() {
    const client = await this.ensureAuthenticated();

    try {
      const settings = await client.getSettings();

      return {
        content: [
          {
            type: 'text' as const,
            text: `User settings:\n\n${JSON.stringify(settings, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user settings: ${error}`);
    }
  }

  private async getUserSuggestedProducts(args: GetUserSuggestedProductsInput) {
    const client = await this.ensureAuthenticated();

    try {
      // The API doesn't support limiting, so apply it here
      const suggestions = (await client.getSuggestedProducts(args.daytime ?? 'breakfast', args.date)).slice(0, args.limit);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Product suggestions:\n\n${JSON.stringify(suggestions, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get product suggestions: ${error}`);
    }
  }

  private async addUserConsumedItem(args: AddConsumedItemInput) {
    const client = await this.ensureAuthenticated();

    try {
      const { serving, serving_quantity, ...item } = args;
      const product =
        serving !== undefined && serving_quantity !== undefined
          ? { ...item, id: uuidv4(), serving, serving_quantity }
          : { ...item, id: uuidv4() };
      await client.addConsumedItems({ products: [product] });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully added consumed item`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to add consumed item: ${error}`);
    }
  }

  private async createProduct(args: CreateProductInput) {
    const client = await this.ensureAuthenticated();

    try {
      // The API stores nutrients per 1 g/ml of the base unit, labels give them per 100
      const per100: Record<string, number> = {
        ...args.extra_nutrients_per_100,
        'energy.energy': args.energy_per_100,
        'nutrient.protein': args.protein_per_100,
        'nutrient.fat': args.fat_per_100,
        'nutrient.carb': args.carb_per_100,
      };
      const nutrients = Object.fromEntries(Object.entries(per100).map(([key, value]) => [key, value / 100]));
      const id = uuidv4();

      await client.createProduct({
        id,
        name: args.name,
        category: args.category,
        base_unit: args.base_unit,
        is_private: args.is_private,
        nutrients,
        servings: args.servings ?? [],
        producer: args.producer ?? null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully created product "${args.name}" with product_id: ${id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create product: ${error}`);
    }
  }

  private async addQuickEntry(args: AddQuickEntryInput) {
    const client = await this.ensureAuthenticated();

    try {
      const nutrients: Record<string, number> = { 'energy.energy': args.energy, ...args.extra_nutrients };
      if (args.protein !== undefined) nutrients['nutrient.protein'] = args.protein;
      if (args.fat !== undefined) nutrients['nutrient.fat'] = args.fat;
      if (args.carb !== undefined) nutrients['nutrient.carb'] = args.carb;
      const id = uuidv4();

      await client.addConsumedItems({
        simple_products: [{ id, date: args.date, daytime: args.daytime, name: args.name, nutrients }],
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully added quick entry "${args.name}" with id: ${id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to add quick entry: ${error}`);
    }
  }

  private async addUserConsumedRecipe(args: AddConsumedRecipeInput) {
    const client = await this.ensureAuthenticated();

    try {
      const id = uuidv4();
      await client.addConsumedItems({ recipe_portions: [{ ...args, id }] });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully added ${args.portion_count} portion(s) of recipe ${args.recipe_id} with id: ${id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to add recipe portion: ${error}`);
    }
  }

  private async createUserRecipe(args: CreateUserRecipeInput) {
    const client = await this.ensureAuthenticated();

    try {
      const products = await Promise.all(args.ingredients.map((item) => client.getProduct(item.product_id)));
      const totals: Record<string, number> = {};
      products.forEach((product, i) => {
        for (const [key, value] of Object.entries(product.nutrients)) {
          if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value * args.ingredients[i].amount;
        }
      });
      const nutrients = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / args.portion_count]));
      const id = uuidv4();

      await client.createUserRecipe({
        id,
        name: args.name,
        portion_count: args.portion_count,
        nutrients,
        servings: args.ingredients.map((item, i) => ({
          product_id: item.product_id,
          name: products[i].name,
          producer: products[i].producer,
          amount: item.amount,
          base_unit: products[i].base_unit,
          serving: item.serving ?? null,
          serving_quantity: item.serving_quantity ?? null,
        })),
        instructions: args.instructions ?? [],
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully created recipe "${args.name}" with id: ${id}\n\nNutrients per portion:\n${JSON.stringify(nutrients, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create recipe: ${error}`);
    }
  }

  private async getUserNote(args: GetUserNoteInput) {
    const client = await this.ensureAuthenticated();

    try {
      const feeling = await client.getFeeling(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Note for ${args.date}:\n\n${JSON.stringify(feeling, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get note: ${error}`);
    }
  }

  private async setUserNote(args: SetUserNoteInput) {
    const client = await this.ensureAuthenticated();

    try {
      // The API replaces the whole day, so keep what the caller left out
      const current = await client.getFeeling(args.date);
      const feeling = {
        note: args.note === undefined ? current.note : args.note,
        tags: args.tags ?? current.tags,
      };
      await client.setFeeling(args.date, feeling);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully set the note for ${args.date}:\n\n${JSON.stringify(feeling, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to set note: ${error}`);
    }
  }

  private async removeUserConsumedItem(args: RemoveConsumedItemInput) {
    const client = await this.ensureAuthenticated();

    try {
      await client.removeConsumedItems([args.itemId]);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully removed consumed item with ID: ${args.itemId}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to remove consumed item: ${error}`);
    }
  }

  private async addUserWaterIntake(args: AddWaterIntakeInput) {
    const client = await this.ensureAuthenticated();

    try {
      // Yazio stores the day's cumulative total, not single drinks
      let total = args.water_intake;
      if (args.add_ml !== undefined) {
        const current = await client.getWaterIntake(args.date.slice(0, 10));
        total = (current.water_intake ?? 0) + args.add_ml;
      }
      if (total === undefined) throw new Error('Provide either add_ml or water_intake');

      await client.addWaterIntake([{ date: args.date, water_intake: total }]);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully logged water intake. New daily total: ${total} ml`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to add water intake: ${error}`);
    }
  }

  private async getUserDietaryPreferences() {
    const client = await this.ensureAuthenticated();

    try {
      const preferences = await client.getDietaryPreferences();

      return {
        content: [
          {
            type: 'text' as const,
            text: `Dietary preferences:\n\n${JSON.stringify(preferences, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get dietary preferences: ${error}`);
    }
  }

  private async getUserGoals(args: GetUserGoalsInput) {
    const client = await this.ensureAuthenticated();

    try {
      const goals = await client.getGoals(args.date);

      return {
        content: [
          {
            type: 'text' as const,
            text: `User goals:\n\n${JSON.stringify(goals, null, 2)}`,
          },
        ],
        structuredContent: goals,
      };
    } catch (error) {
      throw new Error(`Failed to get user goals: ${error}`);
    }
  }


  run(): void {
    this.stdio = serveStdio(() => this.createServer(), {
      legacy: 'serve',
      onerror: (error) => console.error('MCP stdio error:', error),
    });
    console.error('Yazio MCP server running on stdio');
  }
}

new YazioMcpServer().run();
