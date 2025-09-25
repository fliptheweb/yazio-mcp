# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is an MCP (Model Context Protocol) server that provides access to Yazio nutrition and diet data. The server allows Claude to authenticate with Yazio accounts and retrieve food intake, calorie tracking, and nutritional information.

## Common Commands
- `npm install` - Install dependencies
- `npm start` - Start the MCP server using tsx
- `npm run dev` - Start in development mode (same as start)

## Architecture
- **TypeScript project using tsx** (no build step required)
- **MCP Server**: Built with @modelcontextprotocol/sdk
- **Yazio Client**: Custom client for unofficial Yazio API (`src/yazio-client.ts`)
- **Main Server**: MCP server implementation (`src/index.ts`)

## Key Components
- `YazioClient`: Handles authentication and API requests to Yazio
- `YazioMcpServer`: MCP server that exposes Yazio data through tools
- Uses OAuth2 authentication with token refresh capability
- Supports date-range queries for diet data and specific date food entries

## API Integration
Uses the unofficial Yazio API (reverse-engineered). Key considerations:
- No official public API exists
- Based on community documentation from GitHub repos
- Requires Yazio account credentials
- Has CORS restrictions and may change without notice

## Available MCP Tools

### Data Retrieval
- `get_diet_data`: Retrieve diet data for date ranges
- `get_food_entries`: Get food entries for specific dates
- `get_daily_summary`: Get daily nutrition summary for specific dates
- `get_user_info`: Get user profile information
- `get_user_weight`: Get user weight tracking data
- `get_water_intake`: Get water intake for specific dates
- `get_user_exercises`: Get exercise data for dates/ranges
- `get_user_settings`: Get user settings and preferences
- `get_dietary_preferences`: Get dietary preferences and restrictions
- `get_user_goals`: Get nutrition and fitness goals

### Product Management
- `search_products`: Search Yazio food database
- `get_product`: Get detailed product information by ID
- `get_user_suggested_products`: Get personalized product suggestions

### Food Logging
- `add_consumed_item`: Add food items to consumption log
- `remove_consumed_item`: Remove food items from consumption log

## Authentication
Requires environment variables: `YAZIO_USERNAME` and `YAZIO_PASSWORD`
Server will exit with error if not provided.