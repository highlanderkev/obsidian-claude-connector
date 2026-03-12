#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/mcp-server-factory.js";

const vaultPath = process.env["VAULT_PATH"] ?? "";

if (!vaultPath) {
	process.stderr.write(
		"Error: VAULT_PATH environment variable is not set.\n" +
		"Please configure the vault directory in the extension settings.\n"
	);
	process.exit(1);
}

const server = createMcpServer(vaultPath);
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("Obsidian Claude Connector MCP server running...\n");
