#!/usr/bin/env tsx

/**
 * Simple interactive test for add_user_consumed_item
 * This will test the actual endpoint with real data
 */

import { Yazio } from 'yazio';

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

    console.log(products);

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
