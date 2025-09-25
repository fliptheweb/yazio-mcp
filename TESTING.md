# Testing Your Yazio MCP Server

This guide explains how to link, test, and use your Yazio MCP server package.

## Prerequisites

1. **Yazio Account**: You need a Yazio account with valid credentials
2. **Node.js**: Version 18+ installed
3. **MCP Client**: A client that supports MCP (like Claude Desktop, Cline, etc.)

## Setup Instructions

### 1. Build the Package

```bash
# Build the TypeScript code
npm run build

# Verify the build was successful
ls dist/
# Should show: index.js, index.d.ts, schemas.js, types.js
```

### 2. Set Up Environment Variables

Create a `.env` file in your project root:

```bash
# .env
YAZIO_USERNAME=your_yazio_email@example.com
YAZIO_PASSWORD=your_yazio_password
```

**⚠️ Security Note**: Never commit `.env` files to version control!

### 3. Test the Server Directly

```bash
# Test that the server starts without errors
YAZIO_USERNAME=your_email YAZIO_PASSWORD=your_password npm start

# Or using .env file
npm start
```

Expected output:
```
✅ Yazio MCP Server started successfully
```

## Linking for Development

### Option 1: Global Link (Recommended for Testing)

```bash
# From your project directory
npm link

# This creates a global symlink to your package
# You can now use it from anywhere with: yazio-mcp
```

### Option 2: Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

## MCP Client Configuration

### For Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "yazio-mcp": {
      "command": "yazio-mcp",
      "args": [],
      "env": {
        "YAZIO_USERNAME": "your_yazio_email@example.com",
        "YAZIO_PASSWORD": "your_yazio_password"
      }
    }
  }
}
```

### For Cline (VS Code Extension)

Add to your Cline configuration:

```json
{
  "mcpServers": {
    "yazio-mcp": {
      "command": "yazio-mcp",
      "args": [],
      "env": {
        "YAZIO_USERNAME": "your_yazio_email@example.com",
        "YAZIO_PASSWORD": "your_yazio_password"
      }
    }
  }
}
```

## Testing the MCP Server

### 1. Basic Functionality Test

Start the server and test basic connectivity:

```bash
# Terminal 1: Start the server
YAZIO_USERNAME=your_email YAZIO_PASSWORD=your_password npm start

# Terminal 2: Test with a simple MCP client
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | yazio-mcp
```

### 2. Available Tools Test

The server provides these tools:

- `get_product` - Get product details by ID
- `get_user` - Get user information
- `get_user_consumed_items` - Get food entries for a date
- `get_user_dietary_preferences` - Get dietary preferences
- `get_user_exercises` - Get exercises for a date
- `get_user_goals` - Get user goals
- `get_user_settings` - Get user settings
- `get_user_suggested_products` - Get product suggestions
- `get_user_water_intake` - Get water intake for a date
- `get_user_weight` - Get current weight
- `search_products` - Search for products
- `get_user_daily_summary` - Get daily nutrition summary
- `add_user_consumed_item` - Add a consumed item
- `remove_user_consumed_item` - Remove a consumed item

### 3. Example Tool Calls

```bash
# Get user information
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_user", "arguments": {}}}' | yazio-mcp

# Search for products
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search_products", "arguments": {"query": "apple"}}}' | yazio-mcp

# Get daily summary
echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_user_daily_summary", "arguments": {"date": "2024-01-15"}}}' | yazio-mcp
```

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   ```
   ❌ YAZIO_USERNAME and YAZIO_PASSWORD environment variables are required
   ```
   **Solution**: Set the environment variables correctly

2. **Build Errors**
   ```
   error TS2307: Cannot find module
   ```
   **Solution**: Run `npm install` and `npm run build`

3. **MCP Client Connection Issues**
   - Verify the server starts without errors
   - Check the command path in your MCP client config
   - Ensure environment variables are set in the client config

4. **Permission Errors**
   ```
   EACCES: permission denied
   ```
   **Solution**: Use `npm link` with proper permissions or run with `sudo`

### Debug Mode

Enable debug logging:

```bash
DEBUG=yazio-mcp YAZIO_USERNAME=your_email YAZIO_PASSWORD=your_password npm start
```

## Publishing to NPM (Optional)

If you want to publish this package:

```bash
# Login to NPM
npm login

# Publish the package
npm publish

# The package will be available as: yazio-mcp
```

## Development Workflow

1. **Make changes** to the source code
2. **Run tests**: `npm run lint && npm run build`
3. **Test locally**: `npm start`
4. **Link globally**: `npm link`
5. **Test with MCP client**: Use your configured MCP client
6. **Publish**: `npm publish` (when ready)

## Support

If you encounter issues:

1. Check the logs for error messages
2. Verify your Yazio credentials
3. Ensure all dependencies are installed
4. Test with a simple MCP client first

The server should work reliably once properly configured!
