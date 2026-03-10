import { PluginManifest } from "obsidian";

// ── JSON-RPC 2.0 ────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number | string | null;
	method: string;
	params?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: number | string | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// ── MCP Protocol ─────────────────────────────────────────────────────────────

export interface McpTool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, JsonSchemaProperty>;
		required?: string[];
	};
}

export interface JsonSchemaProperty {
	type: string;
	description?: string;
	enum?: string[];
}

export interface TextContent {
	type: "text";
	text: string;
}

export interface ToolCallResult {
	content: TextContent[];
	isError?: boolean;
}

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface ResourceContents {
	uri: string;
	mimeType?: string;
	text: string;
}

// ── SSE Session ──────────────────────────────────────────────────────────────

export interface SseSession {
	id: string;
	/** Write a raw SSE event string (already formatted). */
	write(data: string): void;
	end(): void;
	readonly active: boolean;
}

// ── Local REST API bridge ────────────────────────────────────────────────────
// Minimal interface for the obsidian-local-rest-api plugin so we can call
// getPublicApi() without importing its package or express types.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: any, res: any) => void | Promise<void>;

export interface RouteObject {
	get(handler: AnyHandler): RouteObject;
	post(handler: AnyHandler): RouteObject;
}

export interface LocalRestApiExtension {
	addRoute(path: string): RouteObject;
	unregister(): void;
}

export interface LocalRestApiPlugin {
	getPublicApi(manifest: PluginManifest): LocalRestApiExtension;
	settings?: {
		port?: number;
		insecurePort?: number;
		apiKey?: string;
	};
}

// Extend Obsidian App to expose plugins map (internal but stable in practice).
declare module "obsidian" {
	interface App {
		plugins: {
			plugins: Record<string, unknown>;
			enabledPlugins: Set<string>;
		};
	}
}
