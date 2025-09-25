#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Yazio } from 'yazio';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
  type RemoveConsumedItemInput
} from './schemas.js';
import type {
  YazioExerciseOptions,
  YazioSuggestedProductsOptions
} from './types.js';

class YazioMcpServer {
  private server: Server;
  private yazioClient: Yazio | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'yazio-mcp',
        version: '0.0.2',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
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
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_product',
          description: 'Get detailed information about a specific product by ID',
          inputSchema: zodToJsonSchema(GetProductInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'get_user',
          description: 'Get Yazio user profile information',
          inputSchema: zodToJsonSchema(GetUserInfoInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_consumed_items',
          description: 'Get food entries for a specific date',
          inputSchema: zodToJsonSchema(GetFoodEntriesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_dietary_preferences',
          description: 'Get user dietary preferences and restrictions',
          inputSchema: zodToJsonSchema(GetDietaryPreferencesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_exercises',
          description: 'Get user exercise data for a date or date range',
          inputSchema: zodToJsonSchema(GetUserExercisesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_goals',
          description: 'Get user nutrition and fitness goals',
          inputSchema: zodToJsonSchema(GetUserGoalsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_settings',
          description: 'Get user settings and preferences',
          inputSchema: zodToJsonSchema(GetUserSettingsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_suggested_products',
          description: 'Get product suggestions for the user',
          inputSchema: zodToJsonSchema(GetUserSuggestedProductsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'get_user_water_intake',
          description: 'Get water intake data for a specific date',
          inputSchema: zodToJsonSchema(GetWaterIntakeInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'get_user_weight',
          description: 'Get user weight data',
          inputSchema: zodToJsonSchema(GetUserWeightInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'search_products',
          description: 'Search for food products in Yazio database',
          inputSchema: zodToJsonSchema(SearchProductsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'get_user_daily_summary',
          description: 'Get daily nutrition summary for a specific date',
          inputSchema: zodToJsonSchema(GetDailySummaryInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'add_user_consumed_item',
          description: 'Add a food item to user consumption log',
          inputSchema: zodToJsonSchema(AddConsumedItemInputSchema),
          annotations: {
            readOnlyHint: false,
            idempotentHint: false
          }
        },
        {
          name: 'remove_user_consumed_item',
          description: 'Remove a food item from user consumption log',
          inputSchema: zodToJsonSchema(RemoveConsumedItemInputSchema),
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true
          }
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_product':
            return await this.getProduct(GetProductInputSchema.parse(args));

          case 'get_user':
            return await this.getUser();

          case 'get_user_consumed_items':
            return await this.getUserConsumedItems(GetFoodEntriesInputSchema.parse(args));

          case 'get_user_dietary_preferences':
            return await this.getUserDietaryPreferences();

          case 'get_user_exercises':
            return await this.getUserExercises(GetUserExercisesInputSchema.parse(args));

          case 'get_user_goals':
            return await this.getUserGoals();

          case 'get_user_settings':
            return await this.getUserSettings();

          case 'get_user_suggested_products':
            return await this.getUserSuggestedProducts(GetUserSuggestedProductsInputSchema.parse(args));

          case 'get_user_water_intake':
            return await this.getUserWaterIntake(GetWaterIntakeInputSchema.parse(args));

          case 'get_user_weight':
            return await this.getUserWeight();

          case 'search_products':
            return await this.searchProducts(SearchProductsInputSchema.parse(args));

          case 'get_user_daily_summary':
            return await this.getUserDailySummary(GetDailySummaryInputSchema.parse(args));

          case 'add_user_consumed_item':
            return await this.addUserConsumedItem(AddConsumedItemInputSchema.parse(args));

          case 'remove_user_consumed_item':
            return await this.removeUserConsumedItem(RemoveConsumedItemInputSchema.parse(args));

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
            text: `Search results for "${args.query}":\n\n${JSON.stringify(products, null, 2)}`,
          },
        ],
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
      // The Yazio API expects specific parameters, we'll pass them directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.user.addConsumedItem(args as any);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added consumed item:\n\n${JSON.stringify(result, null, 2)}`,
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
            type: 'text',
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
            type: 'text',
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
            type: 'text',
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
