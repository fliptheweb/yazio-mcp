#!/usr/bin/env tsx

/**
 * Simple interactive test for add_user_consumed_item
 * This will test the actual endpoint with real data
 */

import { Yazio } from 'yazio';
import { AddConsumedItemInputSchema } from '../src/schemas.js';

async function testRealEndpoint() {
  console.log('🧪 Testing add_user_consumed_item with real Yazio API...\n');

  // Get credentials from user
  const username = process.env.YAZIO_USERNAME;
  const password = process.env.YAZIO_PASSWORD;

  if (!username || !password) {
    console.log('❌ Please set your Yazio credentials:');
    console.log('export YAZIO_USERNAME="your-username"');
    console.log('export YAZIO_PASSWORD="your-password"');
    console.log('\nThen run: npx tsx simple-test.ts');
    return;
  }

  console.log('✅ Credentials found');
  console.log('👤 Username:', username);
  console.log('');

  try {
    // Initialize Yazio client
    console.log('1️⃣ Initializing Yazio client...');
    const yazio = new Yazio({ credentials: { username, password } });
    console.log('✅ Client initialized');

    // Test authentication
    console.log('\n2️⃣ Testing authentication...');
    const user = await yazio.user.get();
    console.log('✅ Authentication successful');
    console.log('👤 User:', `${user.first_name} ${user.last_name}`);

    // Search for a real product
    console.log('\n3️⃣ Searching for products...');
    const products = await yazio.products.search({ query: 'apple' });

    if (products.length === 0) {
      console.log('❌ No products found. Try a different search term.');
      return;
    }

    const product = products[0];

    // Test adding consumed item
    console.log('\n4️⃣ Testing addConsumedItem...');

    const testData = {
      date: new Date(), // Today's date
      serving: null,
      // serving: product.serving,
      serving_quantity: null,
      // serving_quantity: product.serving_quantity,
      id: `test-${Date.now()}`,
      product_id: product.product_id,
      daytime: 'breakfast' as const,
      amount: product.amount,
    };

    console.log('📤 Sending data:', JSON.stringify(testData, null, 2));

    // Validate input first
    // const validatedData = AddConsumedItemInputSchema.parse(testData);
    // console.log('✅ Input validation passed');

    // Call the API
    await yazio.user.addConsumedItem(testData).catch((error) => {
      console.log('❌ Error occurred:', error);
      throw error;
    });

    console.log('✅ Successfully added consumed item!');

    // Verify it was added
    console.log('\n5️⃣ Verifying item was added...');
    const consumedItems = await yazio.user.getConsumedItems(testData.date);

    const matchingItems = consumedItems.filter(item =>
      item.product_id === testData.product_id &&
      item.daytime === testData.daytime
    );

    if (matchingItems.length > 0) {
      console.log('✅ Found the added item:');
      console.log(JSON.stringify(matchingItems[0], null, 2));
    } else {
      console.log('⚠️ Item not found in consumed items list');
      console.log('📋 All consumed items for today:');
      console.log(JSON.stringify(consumedItems, null, 2));
    }

  } catch (error) {
    console.log('❌ Error occurred:');
    console.error(error);

    if (error instanceof Error) {
      console.log('\n🔍 Error details:');
      console.log('- Message:', error.message);
      console.log('- Name:', error.name);

      // Check for specific error types
      if (error.message.includes('401') || error.message.includes('unauthorized')) {
        console.log('💡 This looks like an authentication error. Check your credentials.');
      }
      if (error.message.includes('product_id')) {
        console.log('💡 This looks like a product ID issue. The product might not exist or be accessible.');
      }
      if (error.message.includes('date')) {
        console.log('💡 This looks like a date format issue.');
      }
    }
  }
}

// Run the test
testRealEndpoint().catch(console.error);
