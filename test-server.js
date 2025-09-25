#!/usr/bin/env node

/**
 * Simple test script for the Yazio MCP Server
 * This script tests basic MCP functionality without requiring a full MCP client
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const SERVER_PATH = join(__dirname, 'dist', 'index.js');
const TEST_TIMEOUT = 10000; // 10 seconds

// Test cases
const tests = [
  {
    name: 'List Tools',
    request: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    }
  },
  {
    name: 'Get User Info',
    request: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_user',
        arguments: {}
      }
    }
  },
  {
    name: 'Search Products',
    request: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_products',
        arguments: {
          query: 'apple'
        }
      }
    }
  }
];

function runTest(testCase) {
  return new Promise((resolve, reject) => {
    console.log(`\n🧪 Testing: ${testCase.name}`);

    const server = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        YAZIO_USERNAME: process.env.YAZIO_USERNAME || 'test@example.com',
        YAZIO_PASSWORD: process.env.YAZIO_PASSWORD || 'testpassword'
      }
    });

    let output = '';
    let errorOutput = '';

    server.stdout.on('data', (data) => {
      output += data.toString();
    });

    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    server.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}\nError: ${errorOutput}`));
        return;
      }
      resolve(output);
    });

    // Send the test request
    server.stdin.write(JSON.stringify(testCase.request) + '\n');
    server.stdin.end();

    // Timeout after 10 seconds
    setTimeout(() => {
      server.kill();
      reject(new Error('Test timed out'));
    }, TEST_TIMEOUT);
  });
}

async function runAllTests() {
  console.log('🚀 Starting Yazio MCP Server Tests');
  console.log('=====================================');

  // Check if credentials are provided
  if (!process.env.YAZIO_USERNAME || !process.env.YAZIO_PASSWORD) {
    console.log('⚠️  Warning: YAZIO_USERNAME and YAZIO_PASSWORD not set');
    console.log('   Some tests may fail. Set them with:');
    console.log('   YAZIO_USERNAME=your_email YAZIO_PASSWORD=your_password node test-server.js');
  }

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await runTest(test);
      console.log(`✅ ${test.name}: PASSED`);
      console.log(`   Response: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name}: FAILED`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n📊 Test Results');
  console.log('================');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Your MCP server is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
  }
}

// Run the tests
runAllTests().catch(console.error);
