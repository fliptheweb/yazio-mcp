<div align="center">
  <img src="https://assets.yazio.com/frontend/images/yazio-logo.svg" alt="Yazio Logo" width="200" />
</div>

# 🍎 Yazio MCP Server

> **⚠️ Important Notice**: This is **not an official MCP server** and Yazio does **not provide an official API**. This server uses an [unofficial reverse-engineered API](https://github.com/juriadams/yazio) and may stop working at any time.

An MCP (Model Context Protocol) server that connects Claude/Cursor to your Yazio nutrition data. Track your diet, search food products, and manage your nutrition goals directly from your AI assistant.

**Available on NPM**: `npx yazio-mcp`

## ✨ Features

- 🔐 **Authentication** - Connect with your Yazio account
- 📊 **Nutrition Analysis** - Get comprehensive diet data and insights
- 🍎 **Food Tracking** - Search, add, and manage food entries
- 🏃‍♂️ **Fitness Data** - Track exercises and water intake
- ⚖️ **Weight Monitoring** - View weight history and trends
- 🎯 **Goal Management** - Access and manage nutrition goals
- 🔍 **Product Search** - Search Yazio's extensive food database

## 🚀 Quick Start

### 1. Configure MCP Client

Add to your MCP client configuration:

**Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Cursor**: Your Cursor MCP configuration file

```json
{
  "mcpServers": {
    "yazio-mcp": {
      "command": "npx yazio-mcp",
      "env": {
        "YAZIO_USERNAME": "your-email@example.com",
        "YAZIO_PASSWORD": "your-password"
      }
    }
  }
}
```

### 2. Test Connection

```bash
# Test with npx
YAZIO_USERNAME=your_email YAZIO_PASSWORD=your_password npx yazio-mcp
```

## 💡 Use Cases

### 📈 Analyze Your Nutrition Trends
> *"Get my nutrition data for the last week and analyze my eating patterns"*

Claude can retrieve your daily summaries, identify trends, and provide insights about your eating habits, macro distribution, and areas for improvement.

### 🔍 Search Food Products
> *"Search for 'chicken breast' in the Yazio database"*

Find detailed nutritional information for any food product, including calories, macros, vitamins, and minerals.

### 📝 Add Forgotten Meals
> *"Add 200g of grilled salmon for yesterday's dinner"*

Easily log meals you forgot to track in the Yazio app directly from Claude or Cursor.

## 🛠️ Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_user_daily_summary` | Get daily nutrition summary | `date` |
| `get_user_consumed_items` | Get food entries for a date | `date` |
| `get_user_weight` | Get weight data | - |
| `get_user_exercises` | Get exercise data | `date` |
| `get_user_water_intake` | Get water intake | `date` |
| `get_user_goals` | Get nutrition goals | - |
| `get_user_settings` | Get user preferences | - |
| `search_products` | Search food database | `query` |
| `get_product` | Get detailed product info | `id` |
| `add_user_consumed_item` | Add food to your log | `productId`, `amount`, `date`, `mealType` |
| `remove_user_consumed_item` | Remove food from log | `itemId` |


## ⚠️ Important Disclaimers

- **Unofficial API**: This uses a reverse-engineered API that may break
- **No Official Support**: Neither Yazio nor this project provide official support
- **Use at Your Own Risk**: API changes could affect functionality
- **Credentials**: Your Yazio credentials are only used for authentication

## 📋 Requirements

- Node.js 18+ (for npx)
- Valid Yazio account
- MCP-compatible client (Claude Desktop, Cursor, etc.)


## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---
