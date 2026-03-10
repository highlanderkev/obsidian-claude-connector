import type ClaudeConnectorPlugin from "../main";
import { JsonRpcRequest, JsonRpcResponse } from "../types";
import { VAULT_TOOLS, executeTool } from "./tools";

const PROTOCOL_VERSION = "2024-11-05";

/**
 * Central MCP JSON-RPC dispatcher.
 * Receives a parsed request and returns a JSON-RPC response.
 * All vault I/O is performed through the plugin's App instance.
 */
export async function handleMcpRequest(
	request: JsonRpcRequest,
	plugin: ClaudeConnectorPlugin
): Promise<JsonRpcResponse | null> {
	const { id, method } = request;

	// Notifications have no id and require no response.
	if (id === undefined && method.startsWith("notifications/")) {
		return null;
	}

	try {
		switch (method) {
			// ── Lifecycle ────────────────────────────────────────────────────
			case "initialize":
				return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: PROTOCOL_VERSION,
						capabilities: {
							tools: {},
							resources: {},
						},
						serverInfo: {
							name: "obsidian-claude-connector",
							version: plugin.manifest.version,
						},
					},
				};

			case "ping":
				return { jsonrpc: "2.0", id, result: {} };

			// ── Tools ────────────────────────────────────────────────────────
			case "tools/list":
				return {
					jsonrpc: "2.0",
					id,
					result: { tools: VAULT_TOOLS },
				};

			case "tools/call": {
				const params = request.params as {
					name: string;
					arguments?: Record<string, unknown>;
				};
				const result = await executeTool(
					params.name,
					params.arguments ?? {},
					plugin
				);
				return { jsonrpc: "2.0", id, result };
			}

			// ── Resources ────────────────────────────────────────────────────
			case "resources/list": {
				const files = plugin.app.vault.getMarkdownFiles();
				const resources = files.map((f) => ({
					uri: `obsidian://note/${encodeURIComponent(f.path)}`,
					name: f.basename,
					description: `Vault note: ${f.path}`,
					mimeType: "text/markdown",
				}));
				return { jsonrpc: "2.0", id, result: { resources } };
			}

			case "resources/read": {
				const params = request.params as { uri: string };
				const encodedPath = params.uri.replace(
					/^obsidian:\/\/note\//,
					""
				);
				const filePath = decodeURIComponent(encodedPath);
				const abstract = plugin.app.vault.getAbstractFileByPath(filePath);
				if (!abstract) {
					return {
						jsonrpc: "2.0",
						id,
						error: {
							code: -32602,
							message: `File not found: ${filePath}`,
						},
					};
				}
				const { TFile } = await import("obsidian");
				if (!(abstract instanceof TFile)) {
					return {
						jsonrpc: "2.0",
						id,
						error: { code: -32602, message: `Path is a folder: ${filePath}` },
					};
				}
				const content = await plugin.app.vault.read(abstract);
				return {
					jsonrpc: "2.0",
					id,
					result: {
						contents: [
							{
								uri: params.uri,
								mimeType: "text/markdown",
								text: content,
							},
						],
					},
				};
			}

			// ── Prompts ──────────────────────────────────────────────────────
			case "prompts/list":
				return { jsonrpc: "2.0", id, result: { prompts: [] } };

			// ── Unknown ──────────────────────────────────────────────────────
			default:
				return {
					jsonrpc: "2.0",
					id,
					error: { code: -32601, message: `Method not found: ${method}` },
				};
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			jsonrpc: "2.0",
			id,
			error: { code: -32603, message: `Internal error: ${message}` },
		};
	}
}
