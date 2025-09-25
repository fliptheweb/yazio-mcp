# Claude Desktop Setup for Yazio MCP Server

## Prerequisites
1. Install [Claude Desktop](https://claude.ai/download)
2. Install dependencies: `npm install`
3. Test your Yazio credentials: `npm run test-credentials your-email your-password`

## Authentication

The server requires Yazio credentials via environment variables:

**macOS/Linux:**
```bash
export YAZIO_USERNAME="your-email@example.com"
export YAZIO_PASSWORD="your-password"
```

**Windows:**
```cmd
set YAZIO_USERNAME=your-email@example.com
set YAZIO_PASSWORD=your-password
```

## Configuration

### Step 1: Locate Claude Desktop Config File

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### Step 2: Add MCP Server Configuration

Add this to your Claude Desktop config file (replace the path and credentials):

```json
{
  "mcpServers": {
    "yazio": {
      "command": "npx",
      "args": ["tsx", "/FULL/PATH/TO/YOUR/yazio-mcp/src/index.ts"],
      "env": {
        "YAZIO_USERNAME": "your-email@example.com",
        "YAZIO_PASSWORD": "your-password"
      }
    }
  }
}
```

**Important:** Replace `/FULL/PATH/TO/YOUR/yazio-mcp` with the actual full path to this project directory.

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop completely for the configuration to take effect.

## Authentication Process

The server automatically authenticates on startup using the environment variables. You'll see either:
- ✅ Success message if authentication works
- ❌ Error message if credentials are missing or invalid (server will exit)

## Available Commands in Claude Desktop

Once authenticated, you can use these natural language commands:

### Data Retrieval
- **"Show my diet data for [date range]"** → Uses `get_diet_data`
- **"What did I eat on [date]?"** → Uses `get_food_entries`
- **"Show my daily nutrition summary for [date]"** → Uses `get_daily_summary`
- **"Show my Yazio profile"** → Uses `get_user_info`
- **"Show my weight data"** → Uses `get_user_weight`
- **"How much water did I drink on [date]?"** → Uses `get_water_intake`
- **"Show my exercise data for [date]"** → Uses `get_user_exercises`
- **"Show my user settings"** → Uses `get_user_settings`
- **"Show my dietary preferences"** → Uses `get_dietary_preferences`
- **"Show my nutrition goals"** → Uses `get_user_goals`

### Product Search & Management
- **"Search for [food] in Yazio"** → Uses `search_products`
- **"Get details for product ID [id]"** → Uses `get_product`
- **"Get product suggestions for [query]"** → Uses `get_user_suggested_products`

### Food Logging (Write Operations)
- **"Add [amount] [unit] of [food] to my [meal] today"** → Uses `add_consumed_item`
- **"Remove consumed item with ID [id]"** → Uses `remove_consumed_item`

## Troubleshooting

### Server Not Found
- Ensure the `cwd` path in the config is correct
- Restart Claude Desktop after config changes
- Check that `npm start` works when run manually in the project directory

### Authentication Failures
- Test credentials first with: `npm run test-credentials your-email your-password`
- Ensure you're using the same email/password as your Yazio mobile app
- Check for typos in environment variables
- Verify environment variables are set: `echo $YAZIO_USERNAME $YAZIO_PASSWORD`

### No Data Returned
- Ensure you have data in your Yazio app for the requested dates
- Try requesting data for dates when you know you logged food
- Some endpoints might return empty arrays if no data exists

## Security Notes

- Credentials are stored in Claude Desktop configuration or system environment variables
- No credentials are transmitted outside your local machine
- Environment variables are only visible to the MCP server process
- Consider using system-level environment variables instead of config file for better security
