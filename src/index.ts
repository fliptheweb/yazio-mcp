#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Yazio } from 'yazio';
import { v4 as uuidv4 } from "uuid";
import {
  GetFoodEntriesInputSchema,
  GetDailySummaryInputSchema,
  GetUserInfoInputSchema,
  GetUserWeightInputSchema,
  GetWaterIntakeInputSchema,
  SearchProductsInputSchema,
  GetProductInputSchema,
  GetUserExercisesInputSchema,
  GetUserSettingsInputSchema,
  GetUserSuggestedProductsInputSchema,
  AddConsumedItemInputSchema,
  RemoveConsumedItemInputSchema,
  GetDietaryPreferencesInputSchema,
  GetUserGoalsInputSchema,
  type GetFoodEntriesInput,
  type GetDailySummaryInput,
  type GetWaterIntakeInput,
  type SearchProductsInput,
  type GetProductInput,
  type GetUserExercisesInput,
  type GetUserSuggestedProductsInput,
  type AddConsumedItemInput,
  type RemoveConsumedItemInput,
} from './schemas.js';
import type {
  YazioExerciseOptions,
  YazioSuggestedProductsOptions
} from './types.js';

class YazioMcpServer {
  private server: McpServer;
  private yazioClient: Yazio | null = null;

  constructor() {
    this.server = new McpServer({
      name: 'yazio-mcp',
      version: '0.0.5',
    });

    this.setupToolHandlers();
    this.setupPromptHandlers();
    this.setupErrorHandling();
    this.initializeClient();
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
      this.yazioClient = new Yazio({
        credentials: {
          username,
          password
        }
      });
      // Test the connection
      await this.yazioClient.user.get();
      console.error('✅ Successfully authenticated with Yazio using environment variables');
    } catch (error) {
      console.error('❌ Failed to authenticate with Yazio:', (error as Error).message);
      console.error('💡 Please check your YAZIO_USERNAME and YAZIO_PASSWORD environment variables');
      process.exit(1);
    }
  }

  private setupErrorHandling(): void {
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.registerTool(
      'get_user',
      {
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

    this.server.registerTool(
      'get_user_consumed_items',
      {
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

    this.server.registerTool(
      'get_user_dietary_preferences',
      {
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

    this.server.registerTool(
      'get_user_exercises',
      {
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

    this.server.registerTool(
      'get_user_goals',
      {
        description: 'Get user nutrition and fitness goals',
        inputSchema: GetUserGoalsInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUserGoals();
      }
    );

    this.server.registerTool(
      'get_user_settings',
      {
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

    this.server.registerTool(
      'get_user_suggested_products',
      {
        description: 'Get product suggestions for the user',
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

    this.server.registerTool(
      'get_user_water_intake',
      {
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

    this.server.registerTool(
      'get_user_weight',
      {
        description: 'Get user weight data',
        inputSchema: GetUserWeightInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        return await this.getUserWeight();
      }
    );

    this.server.registerTool(
      'get_user_daily_summary',
      {
        description: 'Get daily nutrition summary for a specific date',
        inputSchema: GetDailySummaryInputSchema,
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args: GetDailySummaryInput) => {
        return await this.getUserDailySummary(args);
      }
    );

    this.server.registerTool(
      'search_products',
      {
        description: 'Search for food products in Yazio database',
        inputSchema: SearchProductsInputSchema,
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

    this.server.registerTool(
      'get_product',
      {
        description: 'Get detailed information about a specific product by ID',
        inputSchema: GetProductInputSchema,
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

    this.server.registerTool(
      'add_user_consumed_item',
      {
        description: 'Add a food item to user consumption log',
        inputSchema: AddConsumedItemInputSchema,
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
        },
      },
      async (args: AddConsumedItemInput) => {
        return await this.addUserConsumedItem({
          ...args,

        });
      }
    );

    this.server.registerTool(
      'remove_user_consumed_item',
      {
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
  }

  private setupPromptHandlers(): void {
    this.server.registerPrompt(
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

1. **Search for the product**: Use the \`search_products\` tool with a query string (e.g., "chicken breast", "apple", "pasta"). This will return a list of matching products with their IDs.

2. **Clarify the product**: If multiple products are found, ask the user to clarify which product they want to use.

3. **Get product details**: Use the \`get_product\` tool with the \`product_id\` from the search results. This will show you:
   - Available serving types (e.g., "portion", "gram", "piece", "cup")
   - Serving quantities and amounts
   - Base unit (g or ml)
   - Full nutritional information

4. **Clarify the serving**: If the user doesn't provide a serving type and quantity, ask them to clarify the serving type and quantity they want to use based on the product details.

5. **Add the consumed item**: Use the \`add_user_consumed_item\` tool with:
   - \`product_id\`: The UUID from step 1
   - \`date\`: Date in YYYY-MM-DD format
   - \`daytime\`: One of: "breakfast", "lunch", "dinner", or "snack"
   - **Either**:
     * \`serving\` + \`serving_quantity\`: Use a serving type from step 2 (e.g., "portion", "piece", "cup") with the quantity (e.g., 1, 2, 0.5)
     * **OR** \`amount\`: Direct amount in base units (grams or milliliters, e.g., 200 for 200g or 250 for 250ml)
   - Note: Serving fields (\`serving\`, \`serving_quantity\`) can be omitted if using \`amount\`

**Important Notes**:
- Always search first if you don't have a product_id
- Check product details to understand available serving types and base unit (g or ml)
- The date should be in ISO format (YYYY-MM-DD)
- You can use either serving-based approach (serving + serving_quantity) OR direct amount (in base units)
- If the user provides an amount (e.g., "200g"), use the \`amount\` parameter with the numeric value (200) and omit serving fields`
              }
            }
          ]
        };
      }
    );

    this.server.registerPrompt(
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
  }

  private async ensureAuthenticated(): Promise<Yazio> {
    if (!this.yazioClient) {
      throw new Error('Yazio client not initialized. Check environment variables.');
    }
    return this.yazioClient;
  }


  private async getUserConsumedItems(args: GetFoodEntriesInput) {
    const client = await this.ensureAuthenticated();

    try {
      const foodEntries = await client.user.getConsumedItems({ date: new Date(args.date) });

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
      const userInfo = await client.user.get();

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
      const summary = await client.user.getDailySummary({ date: new Date(args.date) });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Daily summary for ${args.date}:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get daily summary: ${error}`);
    }
  }

  private async getUserWeight() {
    const client = await this.ensureAuthenticated();

    try {
      // Yazio getWeight doesn't support date ranges, just single date
      const weight = await client.user.getWeight();

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

  private async getUserWaterIntake(args: GetWaterIntakeInput) {
    const client = await this.ensureAuthenticated();

    try {
      const waterIntake = await client.user.getWaterIntake({ date: new Date(args.date) });

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
      const products = await client.products.search(args);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Products:\n\n${JSON.stringify(products, null, 2)}`,
          },
        ],
        products,
      };
    } catch (error) {
      throw new Error(`Failed to search products: ${error}`);
    }
  }

  private async getProduct(args: GetProductInput) {
    const client = await this.ensureAuthenticated();

    try {
      const product = await client.products.get(args.id);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Product details for ID "${args.id}":\n\n${JSON.stringify(product, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get product: ${error}`);
    }
  }

  private async getUserExercises(args: GetUserExercisesInput) {
    const client = await this.ensureAuthenticated();

    try {
      const apiOptions: YazioExerciseOptions = {};
      if (args.date) {
        apiOptions.date = args.date;
      }

      const exercises = await client.user.getExercises(apiOptions);

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
      const settings = await client.user.getSettings();

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
      const options: YazioSuggestedProductsOptions = {
        daytime: 'breakfast',
        ...args
      };
      const suggestions = await client.user.getSuggestedProducts(options);

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
      const id = uuidv4();
      await client.user.addConsumedItem({ ...args, id });

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

  private async removeUserConsumedItem(args: RemoveConsumedItemInput) {
    const client = await this.ensureAuthenticated();

    try {
      const result = await client.user.removeConsumedItem(args.itemId);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully removed consumed item with ID: ${args.itemId}\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to remove consumed item: ${error}`);
    }
  }

  private async getUserDietaryPreferences() {
    const client = await this.ensureAuthenticated();

    try {
      const preferences = await client.user.getDietaryPreferences();

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

  private async getUserGoals() {
    const client = await this.ensureAuthenticated();

    try {
      const goals = await client.user.getGoals({});

      return {
        content: [
          {
            type: 'text' as const,
            text: `User goals:\n\n${JSON.stringify(goals, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get user goals: ${error}`);
    }
  }


  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Yazio MCP server running on stdio');
  }
}

const server = new YazioMcpServer();
server.run().catch(console.error);
