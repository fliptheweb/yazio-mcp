# Yazio MCP Server <img src="https://assets.yazio.com/frontend/images/branded-logo-dark.svg" alt="Yazio Logo" width="104" height="28" />

> [!IMPORTANT]
> This is **not an official MCP server** and Yazio does **not provide an official API**.

An MCP (Model Context Protocol) server that connects Claude/Cursor to your Yazio nutrition data. Track your diet, search food products, and manage your nutrition goals directly from your AI assistant.

**Available on NPM**: `npx yazio-mcp`

**Claude Desktop Extension**: ~~[yazio-mcp.mcpb](https://github.com/fliptheweb/yazio-mcp/releases/latest/download/yazio-mcp.mcpb)~~ — one-click install is [broken upstream](https://github.com/modelcontextprotocol/mcpb/issues/281), see [workaround](#claude-desktop-extension).

## ✨ Features

- 🔐 **Authentication** - Connect with your Yazio account
- 📊 **Nutrition Analysis** - Get comprehensive diet data and insights
- 🍎 **Food Tracking** - Search, add, and manage food entries
- 🏃‍♂️ **Fitness Data** - Track exercises and water intake
- 📓 **Diary Notes** - Read and write daily notes and feeling tags
- 🥣 **Recipes and Meals** - Create, log, and delete your own recipes and saved meals
- ⚖️ **Weight Monitoring** - Log weight and view its history and trends
- 🎯 **Goal Management** - Access and manage nutrition goals
- 🔍 **Product Search** - Search Yazio's extensive [food database](https://www.yazio.com/en/foods)

## 🚀 Quick Start

Add the following JSON your MCP client configuration:

```json
{
  "mcpServers": {
    "yazio": {
      "command": "npx",
      "args": ["-y", "yazio-mcp"],
      "env": {
        "YAZIO_USERNAME": "your_email@emai.com",
        "YAZIO_PASSWORD": "your_password"
      }
    }
  }
}
```


### Claude Desktop (Extension)

> [!WARNING]
> One-click `.mcpb` install is broken by a Claude Desktop bug ([mcpb#281](https://github.com/modelcontextprotocol/mcpb/issues/281)). **Workaround:** download [yazio-mcp.zip](https://github.com/fliptheweb/yazio-mcp/releases/latest/download/yazio-mcp.zip), extract it, and use **Settings → Extensions → Advanced settings → Install Unpacked Extension**. Or just use the `npx` config above.

### Claude Desktop (Manual)

`~/Library/Application Support/Claude/claude_desktop_config.json`

### Claude Code (CLI)

```bash
claude mcp add yazio -e YAZIO_USERNAME=your_email@email.com -e YAZIO_PASSWORD=your_password -- npx -y yazio-mcp
```

Verify with `claude mcp list`.

### Cursor

There are a few ways to add the server:

- **Settings UI** (easiest) — `Settings → MCP → + Add new MCP server`, then fill in the command, args, and env
- **Project config** — add JSON to `.cursor/mcp.json` in your project root
- **Global config** — add JSON to `~/.cursor/mcp.json` (applies to all projects)


## 💡 Use Cases

![Showcase](https://github.com/user-attachments/assets/3aa47086-d40e-408c-ba51-cbe8cf165404)

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
| `get_user` | Get user profile | - |
| `get_user_daily_summary` | Get daily nutrition summary | `date` |
| `get_user_consumed_items` | Get food entries for a date | `date` |
| `get_user_weight` | Get the last weight entry up to a date | `date` (optional) |
| `get_user_weight_history` | Get all weight entries in a date range | `start`, `end` (optional) |
| `get_user_exercises` | Get exercise data | `date` |
| `get_user_water_intake` | Get water intake | `date` |
| `get_user_goals` | Get nutrition goals | `date` (optional) |
| `get_user_settings` | Get user preferences | - |
| `get_user_dietary_preferences` | Get dietary preferences | - |
| `get_user_suggested_products` | Get suggested products for a meal | `date`, `daytime`, `limit` (all optional) |
| `search_products` | Search food database | `query` |
| `get_product` | Get detailed product info | `id` |
| `get_recipe` | Get a recipe with ingredients and nutrients | `id` |
| `get_user_recipes` | Get your own recipes | - |
| `delete_user_recipe` | Delete one of your own recipes | `id` |
| `add_user_consumed_item` | Add food to your log | `product_id`, `amount`, `date`, `daytime` |
| `add_user_water_intake` | Add water intake entry (cumulative value in ml) | `date`, `water_intake` |
| `remove_user_consumed_item` | Remove food from log | `itemId` |
| `create_product` | Create a custom product from label values per 100 g/ml | `name`, `category`, `energy_per_100`, `protein_per_100`, `fat_per_100`, `carb_per_100` |
| `add_quick_entry` | Log a one-off entry with total nutrition, without a product ("quick add") | `name`, `date`, `daytime`, `energy` |
| `add_user_consumed_recipe` | Log portions of a recipe | `recipe_id`, `portion_count`, `date`, `daytime` |
| `create_user_recipe` | Create a recipe from products; nutrients per portion are calculated | `name`, `portion_count`, `ingredients` |
| `get_user_note` | Get the diary note and feeling tags for a date | `date` |
| `set_user_note` | Set the diary note and/or feeling tags for a date | `date`, `note`, `tags` |
| `get_user_meals` | Get your saved meals | - |
| `create_user_meal` | Save a set of products as a meal | `name`, `products` |
| `delete_user_meal` | Delete a saved meal | `id` |
| `add_user_consumed_meal` | Log all items of a saved meal | `meal_id`, `date`, `daytime` |
| `add_user_weight` | Log a weight measurement in kg | `date`, `weight` |
| `delete_user_weight` | Delete a weight entry | `id` |
| `add_user_exercise` | Log a Yazio training or a custom exercise | `date`, `name`, `duration`, `energy` |
| `delete_user_exercise` | Delete an exercise entry | `id` |

## Test Connection

```bash
YAZIO_USERNAME='your_email' YAZIO_PASSWORD='your_password' npx yazio-mcp
```

## ⚠️ Important Disclaimers

- **Credentials**: Your Yazio credentials are only used for auth on Yazio servers
- **Use at Your Own Risk**: API changes could affect functionality

## 📋 Requirements

- Node.js 20+ (for npx)
- Valid Yazio account
- MCP-compatible client (Claude Desktop, Cursor, etc.)

# Development
1. Download the repository
2. Point to local copy in your mcp config
3. Debugging:

```
YAZIO_USERNAME=X YAZIO_PASSWORD=X npx -y @modelcontextprotocol/inspector npx <local-path>/yazio-mcp
```

## Releasing

Publishing a GitHub Release publishes the package. Release Drafter keeps a stable and a beta draft up to date.

- **Beta:** publish the beta draft (tag `vX.Y.Z-beta.N`, marked as pre-release). It goes to npm `beta`: `npx yazio-mcp@beta`.
- **Stable:** run `npm run release:prepare -- X.Y.Z`, commit and merge, then publish the stable draft with tag `vX.Y.Z`. It goes to npm `latest` and the MCP Registry.
---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
