# Yazio MCP Server

An MCP (Model Context Protocol) server for accessing Yazio nutrition and diet data. This server allows Claude to retrieve your food intake, calorie tracking, and nutritional information from the Yazio app.

## Features

- 🔐 Secure authentication with Yazio account
- 📊 Retrieve comprehensive diet data for date ranges
- 🍎 Get detailed food entries for specific dates
- 👤 Access user profile and settings information
- 🏃‍♂️ Track exercises and fitness data
- 💧 Monitor water intake
- ⚖️ Weight tracking and history
- 🔍 Search and manage food products
- 🎯 View and manage nutrition goals
- 📝 Add and remove consumed food items

## Installation

```bash
npm install yazio-mcp-server
```

## Usage

### As an MCP Server

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "yazio": {
      "command": "npx",
      "args": ["yazio-mcp-server"],
      "env": {
        "YAZIO_USERNAME": "your-email@example.com",
        "YAZIO_PASSWORD": "your-password"
      }
    }
  }
}
```

### Direct Usage

```bash
# Set environment variables
export YAZIO_USERNAME="your-email@example.com"
export YAZIO_PASSWORD="your-password"

# Run the server
npx yazio-mcp-server
```

### Development

```bash
# Clone the repository
git clone https://github.com/arturkornakov/yazio-mcp.git
cd yazio-mcp

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Available Tools

### configure_yazio
Configure your Yazio credentials for API access.

**Parameters:**
- `username` (string): Your Yazio account email/username
- `password` (string): Your Yazio account password

### get_diet_data
Get comprehensive diet and nutrition data for a date range.

**Parameters:**
- `startDate` (string): Start date in YYYY-MM-DD format
- `endDate` (string): End date in YYYY-MM-DD format

### get_food_entries
Get detailed food entries for a specific date.

**Parameters:**
- `date` (string): Date in YYYY-MM-DD format

### get_daily_summary
Get daily nutrition summary for a specific date.

**Parameters:**
- `date` (string): Date in YYYY-MM-DD format

### get_user_info
Retrieve your Yazio user profile information.

### get_user_weight
Get user weight data and tracking history.

### get_water_intake
Get water intake data for a specific date.

**Parameters:**
- `date` (string): Date in YYYY-MM-DD format

### search_products
Search for food products in the Yazio database.

**Parameters:**
- `query` (string): Search query for food products

### get_product
Get detailed information about a specific product by ID.

**Parameters:**
- `id` (string): Product ID

### get_user_exercises
Get user exercise data for a date or date range.

**Parameters:**
- `date` (string): Date in YYYY-MM-DD format (optional if using date range)
- `startDate` (string): Start date in YYYY-MM-DD format for date range
- `endDate` (string): End date in YYYY-MM-DD format for date range

### get_user_settings
Get user settings and preferences.

### get_user_suggested_products
Get product suggestions for the user.

**Parameters:**
- `query` (string): Search query for product suggestions
- `limit` (number): Maximum number of suggestions to return

### add_consumed_item
Add a food item to user consumption log.

**Parameters:**
- `productId` (string): Product ID to add
- `amount` (number): Amount consumed
- `unit` (string): Unit of measurement (g, ml, pieces, etc.)
- `date` (string): Date in YYYY-MM-DD format (defaults to today)
- `mealType` (string): Type of meal (breakfast, lunch, dinner, snack)

### remove_consumed_item
Remove a food item from user consumption log.

**Parameters:**
- `itemId` (string): ID of the consumed item to remove

### get_dietary_preferences
Get user dietary preferences and restrictions.

### get_user_goals
Get user nutrition and fitness goals.


## Authentication

The server requires Yazio credentials to be provided via environment variables:

```bash
export YAZIO_USERNAME="your-email@example.com"
export YAZIO_PASSWORD="your-password"
```

**Required Environment Variables:**
- `YAZIO_USERNAME` - Your Yazio account email/username
- `YAZIO_PASSWORD` - Your Yazio account password

The server will exit with an error if these environment variables are not set.

## API Integration

This server uses the community-maintained `juriadams/yazio` package for API access. The integration:
- Uses the unofficial Yazio API (reverse-engineered)
- Provides robust authentication and token management
- Is not officially supported by Yazio
- May change without notice as Yazio updates their app
- Requires valid Yazio account credentials

## Dependencies

- `@modelcontextprotocol/sdk`: MCP server framework (v1.18.2 with tool annotations)
- `yazio`: Community-maintained Yazio API client
- `zod`: Runtime type validation and schema definitions
