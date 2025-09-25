import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Yazio } from 'yazio';
import {
  GetDietDataInputSchema,
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
  zodToMcpSchema,
  type GetDietDataInput,
  type GetFoodEntriesInput,
  type GetDailySummaryInput,
  type GetUserWeightInput,
  type GetWaterIntakeInput,
  type SearchProductsInput,
  type GetProductInput,
  type GetUserExercisesInput,
  type GetUserSuggestedProductsInput,
  type AddConsumedItemInput,
  type RemoveConsumedItemInput
} from './schemas.js';

class YazioMcpServer {
  private server: Server;
  private yazioClient: Yazio | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'yazio-mcp-server',
        version: '1.0.0',
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
          name: 'getProduct',
          description: 'Get detailed information about a specific product by ID',
          inputSchema: zodToMcpSchema(GetProductInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'getUser',
          description: 'Get Yazio user profile information',
          inputSchema: zodToMcpSchema(GetUserInfoInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserConsumedItems',
          description: 'Get food entries for a specific date',
          inputSchema: zodToMcpSchema(GetFoodEntriesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserDietaryPreferences',
          description: 'Get user dietary preferences and restrictions',
          inputSchema: zodToMcpSchema(GetDietaryPreferencesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserExercises',
          description: 'Get user exercise data for a date or date range',
          inputSchema: zodToMcpSchema(GetUserExercisesInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserGoals',
          description: 'Get user nutrition and fitness goals',
          inputSchema: zodToMcpSchema(GetUserGoalsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserSettings',
          description: 'Get user settings and preferences',
          inputSchema: zodToMcpSchema(GetUserSettingsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserSuggestedProducts',
          description: 'Get product suggestions for the user',
          inputSchema: zodToMcpSchema(GetUserSuggestedProductsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'getUserWaterIntake',
          description: 'Get water intake data for a specific date',
          inputSchema: zodToMcpSchema(GetWaterIntakeInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'getUserWeight',
          description: 'Get user weight data',
          inputSchema: zodToMcpSchema(GetUserWeightInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'searchProducts',
          description: 'Search for food products in Yazio database',
          inputSchema: zodToMcpSchema(SearchProductsInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        {
          name: 'getUserDailySummary',
          description: 'Get daily nutrition summary for a specific date',
          inputSchema: zodToMcpSchema(GetDailySummaryInputSchema),
          annotations: {
            readOnlyHint: true,
            idempotentHint: true
          }
        },
        {
          name: 'addUserConsumedItem',
          description: 'Add a food item to user consumption log',
          inputSchema: zodToMcpSchema(AddConsumedItemInputSchema),
          annotations: {
            readOnlyHint: false,
            idempotentHint: false
          }
        },
        {
          name: 'removeUserConsumedItem',
          description: 'Remove a food item from user consumption log',
          inputSchema: zodToMcpSchema(RemoveConsumedItemInputSchema),
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
          case 'get_diet_data':
            return await this.getDietData(GetDietDataInputSchema.parse(args));

          case 'get_food_entries':
            return await this.getFoodEntries(GetFoodEntriesInputSchema.parse(args));

          case 'get_user_info':
            return await this.getUserInfo();

          case 'get_daily_summary':
            return await this.getDailySummary(GetDailySummaryInputSchema.parse(args));

          case 'get_user_weight':
            return await this.getUserWeight(GetUserWeightInputSchema.parse(args));

          case 'get_water_intake':
            return await this.getWaterIntake(GetWaterIntakeInputSchema.parse(args));

          case 'search_products':
            return await this.searchProducts(SearchProductsInputSchema.parse(args));

          case 'get_product':
            return await this.getProduct(GetProductInputSchema.parse(args));

          case 'get_user_exercises':
            return await this.getUserExercises(GetUserExercisesInputSchema.parse(args));

          case 'get_user_settings':
            return await this.getUserSettings();

          case 'get_user_suggested_products':
            return await this.getUserSuggestedProducts(GetUserSuggestedProductsInputSchema.parse(args));

          case 'add_consumed_item':
            return await this.addConsumedItem(AddConsumedItemInputSchema.parse(args));

          case 'remove_consumed_item':
            return await this.removeConsumedItem(RemoveConsumedItemInputSchema.parse(args));

          case 'get_dietary_preferences':
            return await this.getDietaryPreferences();

          case 'get_user_goals':
            return await this.getUserGoals();

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

  private async getDietData(args: GetDietDataInput) {
    const client = await this.ensureAuthenticated();

    try {
      const results: any[] = [];
      const start = new Date(args.startDate);
      const end = new Date(args.endDate);
      const current = new Date(start);

      while (current <= end) {
        try {
          const dateStr = current.toISOString().split('T')[0];
          const consumedItems = await client.user.getConsumedItems({ date: current });
          const summary = await client.user.getDailySummary({ date: current });

          results.push({
            date: dateStr,
            consumedItems: consumedItems || [],
            summary: summary || {}
          });
        } catch (error) {
          console.error(`Failed to get data for ${current.toISOString().split('T')[0]}:`, error);
        }
        current.setDate(current.getDate() + 1);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Diet data from ${args.startDate} to ${args.endDate}:\n\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get diet data: ${error}`);
    }
  }

  private async getFoodEntries(args: GetFoodEntriesInput) {
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

  private async getUserInfo() {
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

  private async getDailySummary(args: GetDailySummaryInput) {
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

  private async getUserWeight(args?: GetUserWeightInput) {
    const client = await this.ensureAuthenticated();

    try {
      const options: any = {};
      if (args?.startDate) options.from = new Date(args.startDate);
      if (args?.endDate) options.to = new Date(args.endDate);
      if (args?.limit) options.limit = args.limit;

      const weight = await client.user.getWeight(options);

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

  private async getWaterIntake(args: GetWaterIntakeInput) {
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
      const apiOptions: any = {};
      if (args.date) {
        apiOptions.date = new Date(args.date);
      } else if (args.startDate && args.endDate) {
        apiOptions.from = new Date(args.startDate);
        apiOptions.to = new Date(args.endDate);
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
      const suggestions = await client.user.getSuggestedProducts({
        daytime: 'breakfast',
        ...args
      });

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

  private async addConsumedItem(args: AddConsumedItemInput) {
    const client = await this.ensureAuthenticated();

    try {
      const options: any = { ...args };
      if (args.date) {
        options.date = new Date(args.date);
      }

      const result = await client.user.addConsumedItem(options);

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

  private async removeConsumedItem(args: RemoveConsumedItemInput) {
    const client = await this.ensureAuthenticated();

    try {
      const result = await client.user.removeConsumedItem(args.itemId as any);

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

  private async getDietaryPreferences() {
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
