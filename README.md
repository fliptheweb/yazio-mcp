# Yazio MCP Server <img src="https://assets.yazio.com/frontend/images/branded-logo-dark.svg" alt="Yazio Logo" width="104" height="28" />

> [!IMPORTANT]
> This is **not an official MCP server** and Yazio does **not provide an official API**.
> This server uses an [unofficial reverse-engineered API](https://github.com/juriadams/yazio) and may stop working at any time.

An MCP (Model Context Protocol) server that connects Claude/Cursor to your Yazio nutrition data. Track your diet, search food products, and manage your nutrition goals directly from your AI assistant.

**Available on NPM**: `npx yazio-mcp`

**Claude Desktop Extension**: ~~[yazio-mcp.mcpb](https://github.com/fliptheweb/yazio-mcp/releases/latest/download/yazio-mcp.mcpb)~~ — one-click install is [broken upstream](https://github.com/modelcontextprotocol/mcpb/issues/281), see [workaround](#claude-desktop-extension).

## ✨ Features

- 🔐 **Authentication** - Connect with your Yazio account
- 📊 **Nutrition Analysis** - Get comprehensive diet data and insights
- 🍎 **Food Tracking** - Search, add, and manage food entries
- 🏃‍♂️ **Fitness Data** - Track exercises and water intake
- ⚖️ **Weight Monitoring** - View weight history and trends
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


## 🔌 Compatibility

This is a **local stdio MCP server**: an MCP client launches it (via `npx`) and talks to it over stdin/stdout. It's built on the official `@modelcontextprotocol/server` **v2** SDK and targets the [MCP `2026-07-28` ("v2") spec](https://blog.modelcontextprotocol.io/posts/2026-07-28/). That spec's headline change — a **stateless core** (no `initialize` handshake, no session id) — only affects *remote HTTP* servers; stdio is unchanged, and the v2 SDK stays backward-compatible with `2025`-era clients. So **yazio-mcp works with any MCP client that can run a local stdio server, whether or not that client has adopted the 2026-07-28 spec.**

### Clients that can run this server (local stdio)

| Client | Runs `yazio-mcp` | MCP `2026-07-28` (v2) | Evidence |
|--------|:---:|:---:|----------|
| **Claude Desktop** | ✅ | 🟡 rolling out | Anthropic is bringing `2026-07-28` to Claude products ([blog](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)) |
| **Claude Code (CLI)** | ✅ | 🟡 rolling out | Same rollout; stronger MCP handling noted in the [Aug 2026 changelog](https://code.claude.com/docs/en/changelog) |
| **VS Code (GitHub Copilot)** | ✅ | ✅ ships v2 features | `2026-07-28` extensions — MCP Apps & Enterprise Managed Auth — are already supported in VS Code ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)) |
| **Cursor** | ✅ | ➖ not publicly confirmed | Ships first-class MCP support; no `2026-07-28` announcement at time of writing |
| Other stdio clients (Windsurf, Cline, Zed, …) | ✅ | varies | Anything that speaks MCP over stdio can run this server |

**Legend:** ✅ yes / confirmed · 🟡 rolling out or partial · ➖ MCP works, `2026-07-28` support not publicly confirmed. *Status as of August 2026 — check each vendor for the latest.*

> [!NOTE]
> **Browser-hosted agents** (ChatGPT, Gemini on the web) connect to **remote** MCP servers over HTTP, not local stdio — they can't launch `yazio-mcp` directly. You'd need to host it behind an HTTP transport first.

The official **TypeScript, Python, Go, and C# SDKs** speak `2026-07-28` today; **Rust** is in beta ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)).


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
| `add_user_water_intake` | Add water intake entry (cumulative value in ml) | `date`, `water_intake` |
| `remove_user_consumed_item` | Remove food from log | `itemId` |

## Test Connection

```bash
YAZIO_USERNAME='your_email' YAZIO_PASSWORD='your_password' npx yazio-mcp
```

## ⚠️ Important Disclaimers

- **Unofficial API**: This uses a [reverse-engineered API](https://github.com/juriadams/yazio) that may break
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
---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
