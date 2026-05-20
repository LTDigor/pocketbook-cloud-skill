#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerPocketBookTools } from "./tools.js";

const server = new McpServer({
  name: "pocketbook-mcp",
  version: "0.1.0",
});

const config = await loadConfig();
registerPocketBookTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("PocketBook MCP server running on stdio");
