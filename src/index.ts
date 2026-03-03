#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Yazio } from 'yazio';
import { v4 as uuidv4 } from 'uuid';

const TOKEN_CACHE_PATH = process.env.YAZIO_TOKEN_CACHE_PATH || '/tmp/yazio-token-cache.json';

interface CachedToken {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
}

function loadCachedToken(): CachedToken | null {
  try {
    const token: CachedToken = JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    if (token.access_token && token.expires_at > Date.now()) return token;
    console.error('⏰ Cached token expired, will re-authenticate');
    return null;
  } catch {
    return null;
  }
}

function saveCachedToken(token: CachedToken): void {
  try {
    writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
    console.error('💾 Token cached to', TOKEN_CACHE_PATH);
  } catch (error) {
    console.error('⚠️ Failed to cache token:', (error as Error).message);
  }
}

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
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
  AddWaterIntakeInputSchema,
  GetDietaryPreferencesInputSchema,
  GetUserGoalsInputSchema,
  SearchByBarcodeInputSchema,
  ScanBarcodeImageInputSchema,
  type GetFoodEntriesInput,
  type GetDailySummaryInput,
  type GetWaterIntakeInput,
  type SearchProductsInput,
  type GetProductInput,
  type GetUserExercisesInput,
  type GetUserSuggestedProductsInput,
  type AddConsumedItemInput,
  type RemoveConsumedItemInput,
  type AddWaterIntakeInput,
  type SearchByBarcodeInput,
  type ScanBarcodeImageInput,
} from './schemas.js';
import type { YazioExerciseOptions, YazioSuggestedProductsOptions, YazioAddWaterIntakeOptions } from './types.js';

class YazioMcpServer {
  private server: McpServer;
  private yazioClient: Yazio | null = null;

  constructor() {
    this.server = new McpServer({ name: 'yazio-mcp', version });
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

    const onRefresh = ({ token }: { token: CachedToken }) => saveCachedToken(token);
    const cachedToken = loadCachedToken();

    // Try cached token first
    if (cachedToken) {
      try {
        console.error('🔑 Using cached token (expires', new Date(cachedToken.expires_at).toISOString(), ')');
        this.yazioClient = new Yazio({
          credentials: { username, password },
          token: cachedToken,
          onRefresh,
        });
        await this.yazioClient.user.get();
        console.error('✅ Successfully authenticated with Yazio');
        this.extendWaterIntakeSupport(this.yazioClient);
        return;
      } catch {
        console.error('⚠️ Cached token failed, re-authenticating...');
      }
    }

    // Fresh auth (either no cache or cache failed)
    try {
      console.error('🔐 Authenticating...');
      this.yazioClient = new Yazio({ credentials: { username, password }, onRefresh });
      await this.yazioClient.user.get();
      this.trySaveFreshToken();
      console.error('✅ Successfully authenticated with Yazio');
      this.extendWaterIntakeSupport(this.yazioClient);
    } catch (error) {
      console.error('❌ Failed to authenticate with Yazio:', (error as Error).message);
      process.exit(1);
    }
  }

  private trySaveFreshToken(): void {
    try {
      // @ts-expect-error - Accessing internal auth token to cache after fresh login
      const token = this.yazioClient?.auth?.token;
      if (token?.access_token) saveCachedToken(token as CachedToken);
    } catch {
      /* ignore */
    }
  }

  private extendWaterIntakeSupport(client: Yazio): void {
    // @ts-expect-error - Monkey-patching yazio client to add missing method (https://github.com/juriadams/yazio/issues/3)
    client.user.addWaterIntake = async (entries: YazioAddWaterIntakeOptions): Promise<void> => {
      // @ts-expect-error - Accessing internal auth token
      const token = client.auth.token.access_token;
      const baseUrl = (client as Yazio & { baseUrl?: string }).baseUrl || 'https://yzapi.yazio.com/v15';

      const response = await fetch(`${baseUrl}/user/water-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(entries),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to add water intake: ${response.status} ${response.statusText} - ${errorText}`);
      }
    };
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
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => this.getUser()
    );

    this.server.registerTool(
      'get_user_consumed_items',
      {
        description: 'Get food entries for a specific date',
        inputSchema: GetFoodEntriesInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args: GetFoodEntriesInput) => this.getUserConsumedItems(args)
    );

    this.server.registerTool(
      'get_user_dietary_preferences',
      {
        description: 'Get user dietary preferences and restrictions',
        inputSchema: GetDietaryPreferencesInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => this.getUserDietaryPreferences()
    );

    this.server.registerTool(
      'get_user_exercises',
      {
        description: 'Get user exercise data for a date or date range',
        inputSchema: GetUserExercisesInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args: GetUserExercisesInput) => this.getUserExercises(args)
    );

    this.server.registerTool(
      'get_user_goals',
      {
        description: 'Get user nutrition and fitness goals',
        inputSchema: GetUserGoalsInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => this.getUserGoals()
    );

    this.server.registerTool(
      'get_user_settings',
      {
        description: 'Get user settings and preferences',
        inputSchema: GetUserSettingsInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => this.getUserSettings()
    );

    this.server.registerTool(
      'get_user_suggested_products',
      {
        description: 'Get product suggestions for the user',
        inputSchema: GetUserSuggestedProductsInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args: GetUserSuggestedProductsInput) => this.getUserSuggestedProducts(args)
    );

    this.server.registerTool(
      'get_user_water_intake',
      {
        description: 'Get water intake data for a specific date',
        inputSchema: GetWaterIntakeInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args: GetWaterIntakeInput) => this.getUserWaterIntake(args)
    );

    this.server.registerTool(
      'get_user_weight',
      {
        description: 'Get user weight data',
        inputSchema: GetUserWeightInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => this.getUserWeight()
    );

    this.server.registerTool(
      'get_user_daily_summary',
      {
        description: 'Get daily nutrition summary for a specific date',
        inputSchema: GetDailySummaryInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args: GetDailySummaryInput) => this.getUserDailySummary(args)
    );

    this.server.registerTool(
      'search_products',
      {
        description:
          "Search for food products in Yazio database. You can optionally specify user's sex, country and locale of the products to search for.",
        inputSchema: SearchProductsInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args: SearchProductsInput) => this.searchProducts(args)
    );

    this.server.registerTool(
      'search_by_barcode',
      {
        description:
          'Search for a food product by its EAN/UPC barcode number. Searches the Yazio database and filters results by matching EAN code.',
        inputSchema: SearchByBarcodeInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args: SearchByBarcodeInput) => this.searchByBarcode(args)
    );

    this.server.registerTool(
      'scan_barcode_image',
      {
        description:
          'Scan a barcode from an image and look up the product in Yazio. Accepts a base64-encoded image, decodes the barcode using zbarimg, and returns the matching product with nutritional info. Use this when you receive a photo of a barcode/product label and need to identify it — no vision model required.',
        inputSchema: ScanBarcodeImageInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args: ScanBarcodeImageInput) => this.scanBarcodeImage(args)
    );

    this.server.registerTool(
      'get_product',
      {
        description: 'Get detailed information about a specific product by ID',
        inputSchema: GetProductInputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args: GetProductInput) => this.getProduct(args)
    );

    this.server.registerTool(
      'add_user_consumed_item',
      {
        description: 'Add a food item to user consumption log',
        inputSchema: AddConsumedItemInputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async (args: AddConsumedItemInput) => this.addUserConsumedItem(args)
    );

    this.server.registerTool(
      'remove_user_consumed_item',
      {
        description: 'Remove a food item from user consumption log',
        inputSchema: RemoveConsumedItemInputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args: RemoveConsumedItemInput) => this.removeUserConsumedItem(args)
    );

    this.server.registerTool(
      'add_user_water_intake',
      {
        description:
          'Log a water intake entry. Requires date (YYYY-MM-DD HH:mm:ss format) and cumulative water_intake in milliliters (ml). Always get the latest water intake first and add the new amount to calculate the cumulative value.',
        inputSchema: AddWaterIntakeInputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async (args: AddWaterIntakeInput) => this.addUserWaterIntake(args)
    );
  }

  private setupPromptHandlers(): void {
    this.server.registerPrompt(
      'add_food_item',
      {
        title: 'Add Food Item to Log',
        description: "Guide for adding a food item to the user's consumption log",
      },
      async () => ({
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
   - \`date\`: Date in YYYY-MM-DD format
   - \`daytime\`: One of: "breakfast", "lunch", "dinner", or "snack"
   - \`serving\`: Use a serving type from step 2 (e.g., "portion", "piece", "cup") OR base unit (g or ml)
   - \`serving_quantity\`: Quantity of the serving type (e.g., 1, 2, 0.5)
   - \`amount\`: Direct amount in base units (g or ml). If serving type is provided, use the amount of the serving type * serving_quantity. If serving type is not provided, use the amount of the base unit.

**Important Notes**:
- Always search first if you don't have a product_id
- Check product details to understand available serving types, base unit (g or ml) and amount in serving
- The date should be in ISO format (YYYY-MM-DD)
- You can use serving or base unit approach:
  1. serving type + serving quantity + amount (amount for selected serving type multiplied by serving quantity)
  2. amount in g/ml - serving fields could be omitted
Example:
  1. "I ate 2 apples" - serving type "piece" which has 100g amount (from product details) + serving quantity 2 + amount 200g
  2. "I ate 200g of chicken breast" - amount 200g
- Always provide amount in base units (g or ml), not in servings.`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      'remove_food_item',
      {
        title: 'Remove Food Item from Log',
        description: "Guide for removing a food item from the user's consumption log",
      },
      async () => ({
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
- If multiple items match the description, you may need to ask the user to clarify which specific item to remove`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      'add_water_intake',
      {
        title: 'Add Water Intake to Log',
        description: "Guide for adding water intake entries to the user's log",
      },
      async () => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `To add water intake to the user's log, follow these steps:

1. **Get current water intake**: Use the \`get_user_water_intake\` tool with the \`date\` parameter (in YYYY-MM-DD format) to retrieve the current cumulative water intake for that date. The response will contain a \`water_intake\` field with the current cumulative value in milliliters (ml).

2. **Calculate cumulative value**: Add the new water intake amount (in ml) that the user wants to add to the existing \`water_intake\` value from step 1. This gives you the new cumulative water intake value.

3. **Add the water intake entry**: Use the \`add_user_water_intake\` tool with a single object (the tool will automatically wrap it in an array when sending to the API):
   - \`date\`: Date and time in format "YYYY-MM-DD HH:mm:ss" (e.g., "2025-12-18 12:00:00")
   - \`water_intake\`: The cumulative water intake in milliliters (ml) - this should be the previous cumulative value plus the new intake amount

**Important Notes**:
- Always get the latest water intake first to ensure you're adding to the correct cumulative value
- The \`water_intake\` field must be cumulative (previous total + new intake), not just the new amount
- The date format must be "YYYY-MM-DD HH:mm:ss" with both date and time
- Water intake is measured in milliliters (ml)
- The tool accepts a single object (not an array) - it will be automatically sent as a single-item array to the API

**Example**:
- Current water intake for 2025-12-18: 500ml
- User says: "I want to add 250ml"
- Get latest: 500ml
- Calculate: 500 + 250 = 750ml
- Call tool with: \`{ date: "2025-12-18 12:00:00", water_intake: 750 }\`
- The tool sends: \`[{ date: "2025-12-18 12:00:00", water_intake: 750 }]\` to the API`,
            },
          },
        ],
      })
    );
  }

  private async ensureAuthenticated(): Promise<Yazio> {
    if (!this.yazioClient) {
      throw new Error('Yazio client not initialized. Check environment variables.');
    }
    return this.yazioClient;
  }

  private textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
  }

  private async getUserConsumedItems(args: GetFoodEntriesInput) {
    const client = await this.ensureAuthenticated();
    try {
      const foodEntries = await client.user.getConsumedItems({ date: new Date(args.date) });
      return this.textResult(`Food entries for ${args.date}:\n\n${JSON.stringify(foodEntries, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get food entries: ${error}`);
    }
  }

  private async getUser() {
    const client = await this.ensureAuthenticated();
    try {
      const userInfo = await client.user.get();
      return this.textResult(`User info:\n\n${JSON.stringify(userInfo, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get user info: ${error}`);
    }
  }

  private async getUserDailySummary(args: GetDailySummaryInput) {
    const client = await this.ensureAuthenticated();
    try {
      const summary = await client.user.getDailySummary({ date: new Date(args.date) });
      return this.textResult(`Daily summary for ${args.date}:\n\n${JSON.stringify(summary, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get daily summary: ${error}`);
    }
  }

  private async getUserWeight() {
    const client = await this.ensureAuthenticated();
    try {
      const weight = await client.user.getWeight();
      return this.textResult(`User weight data:\n\n${JSON.stringify(weight, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get user weight: ${error}`);
    }
  }

  private async getUserWaterIntake(args: GetWaterIntakeInput) {
    const client = await this.ensureAuthenticated();
    try {
      const waterIntake = await client.user.getWaterIntake({ date: new Date(args.date) });
      return this.textResult(`Water intake for ${args.date}:\n\n${JSON.stringify(waterIntake, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get water intake: ${error}`);
    }
  }

  private async searchProducts(args: SearchProductsInput) {
    const client = await this.ensureAuthenticated();
    try {
      const products = await client.products.search(args);
      return { ...this.textResult(`Products:\n\n${JSON.stringify(products, null, 2)}`), products };
    } catch (error) {
      throw new Error(`Failed to search products: ${error}`);
    }
  }

  private async scanBarcodeImage(args: ScanBarcodeImageInput) {
    // Strip data URL prefix if present
    const dataUrlMatch = args.image.match(/^data:[^;]+;base64,(.+)$/);
    const base64Data = dataUrlMatch ? dataUrlMatch[1] : args.image;
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Decode image to raw pixel data using sharp or manual PNG parsing
    let pixelData: { data: Uint8ClampedArray; width: number; height: number };
    try {
      const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      pixelData = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
    } catch {
      throw new Error('Failed to decode image. Make sure sharp is available or the image is valid PNG/JPEG.');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await readBarcodesFromImageData({ ...pixelData, colorSpace: 'srgb' } as any, {
      formats: ['EAN-8', 'EAN-13', 'UPC-A', 'UPC-E'],
    });

    if (results.length === 0) {
      return this.textResult(
        'No barcode detected in the image. Make sure the barcode is clearly visible and well-lit.'
      );
    }

    const ean = results[0].text;
    const searchResult = await this.searchByBarcode({ ean });
    return this.textResult(`Detected barcode: ${ean}\n\n${searchResult.content[0].text}`);
  }

  private async searchByBarcode(args: SearchByBarcodeInput) {
    const client = await this.ensureAuthenticated();
    try {
      const products = await client.products.search({ query: args.ean });

      if (Array.isArray(products) && products.length > 0) {
        const detailedResults = [];
        for (const product of products.slice(0, 5)) {
          try {
            const detail = await client.products.get(product.product_id);
            if (detail?.eans?.includes(args.ean)) detailedResults.push(detail);
          } catch {
            /* skip */
          }
        }

        if (detailedResults.length > 0) {
          return this.textResult(
            `Found ${detailedResults.length} product(s) matching barcode ${args.ean}:\n\n${JSON.stringify(detailedResults, null, 2)}`
          );
        }

        return this.textResult(
          `No exact barcode match found for ${args.ean}, but here are search results:\n\n${JSON.stringify(products, null, 2)}`
        );
      }

      return this.textResult(`No products found for barcode ${args.ean}`);
    } catch (error) {
      throw new Error(`Failed to search by barcode: ${error}`);
    }
  }

  private async getProduct(args: GetProductInput) {
    const client = await this.ensureAuthenticated();
    try {
      const product = await client.products.get(args.id);
      return this.textResult(`Product details for ID "${args.id}":\n\n${JSON.stringify(product, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get product: ${error}`);
    }
  }

  private async getUserExercises(args: GetUserExercisesInput) {
    const client = await this.ensureAuthenticated();
    try {
      const apiOptions: YazioExerciseOptions = {};
      if (args.date) apiOptions.date = args.date;
      const exercises = await client.user.getExercises(apiOptions);
      return this.textResult(`User exercises:\n\n${JSON.stringify(exercises, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get user exercises: ${error}`);
    }
  }

  private async getUserSettings() {
    const client = await this.ensureAuthenticated();
    try {
      const settings = await client.user.getSettings();
      return this.textResult(`User settings:\n\n${JSON.stringify(settings, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get user settings: ${error}`);
    }
  }

  private async getUserSuggestedProducts(args: GetUserSuggestedProductsInput) {
    const client = await this.ensureAuthenticated();
    try {
      const options: YazioSuggestedProductsOptions = { daytime: 'breakfast', ...args };
      const suggestions = await client.user.getSuggestedProducts(options);
      return this.textResult(`Product suggestions:\n\n${JSON.stringify(suggestions, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get product suggestions: ${error}`);
    }
  }

  private async addUserConsumedItem(args: AddConsumedItemInput) {
    const client = await this.ensureAuthenticated();
    try {
      await client.user.addConsumedItem({ ...args, id: uuidv4() });
      return this.textResult('Successfully added consumed item');
    } catch (error) {
      throw new Error(`Failed to add consumed item: ${error}`);
    }
  }

  private async removeUserConsumedItem(args: RemoveConsumedItemInput) {
    const client = await this.ensureAuthenticated();
    try {
      const result = await client.user.removeConsumedItem(args.itemId);
      return this.textResult(
        `Successfully removed consumed item with ID: ${args.itemId}\n\n${JSON.stringify(result, null, 2)}`
      );
    } catch (error) {
      throw new Error(`Failed to remove consumed item: ${error}`);
    }
  }

  private async addUserWaterIntake(args: AddWaterIntakeInput) {
    const client = await this.ensureAuthenticated();
    try {
      // @ts-expect-error - Using monkey-patched method
      await client.user.addWaterIntake([{ date: args.date, water_intake: args.water_intake }]);
      return this.textResult('Successfully logged water intake entry');
    } catch (error) {
      throw new Error(`Failed to add water intake: ${error}`);
    }
  }

  private async getUserDietaryPreferences() {
    const client = await this.ensureAuthenticated();
    try {
      const preferences = await client.user.getDietaryPreferences();
      return this.textResult(`Dietary preferences:\n\n${JSON.stringify(preferences, null, 2)}`);
    } catch (error) {
      throw new Error(`Failed to get dietary preferences: ${error}`);
    }
  }

  private async getUserGoals() {
    const client = await this.ensureAuthenticated();
    try {
      const goals = await client.user.getGoals({});
      return this.textResult(`User goals:\n\n${JSON.stringify(goals, null, 2)}`);
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
