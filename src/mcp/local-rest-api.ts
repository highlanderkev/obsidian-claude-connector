/* eslint-disable @typescript-eslint/no-deprecated -- SSEServerTransport is intentional: MCP 2024-11-05 SSE protocol required for Claude client compatibility */
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { App, PluginManifest } from "obsidian";
import type ClaudeConnectorPlugin from "../main";
import type { LocalRestApiExtension, LocalRestApiPlugin } from "../types";
import { createMcpServer } from "./mcp-server-factory";

/**
 * Integrates Claude Connector with the obsidian-local-rest-api plugin.
 *
 * When the Local REST API is present this class registers two routes on its
 * Express server (which already handles HTTPS + auth):
 *   GET  /mcp/sse       – SSE stream; the SDK sends an `endpoint` event for POST URL.
 *   POST /mcp/messages  – receives JSON-RPC requests; delegated to SSEServerTransport.
 *
 * Because the Local REST API's auth middleware runs before every route,
 * Claude must supply the Local REST API's API key as its bearer token.
 */
export class LocalRestApiIntegration {
	private extension: LocalRestApiExtension | null = null;
	private readonly transports = new Map<string, SSEServerTransport>();
	private readonly plugin: ClaudeConnectorPlugin;
	private readonly app: App;
	private readonly manifest: PluginManifest;
	private _active = false;

	constructor(plugin: ClaudeConnectorPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.manifest = plugin.manifest;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	/**
	 * Attempt to register routes on the Local REST API.
	 * Returns true if successful, false if the plugin is not present.
	 */
	register(): boolean {
		const localRestApi = this.getLocalRestApiPlugin();
		if (!localRestApi) return false;

		try {
			this.extension = localRestApi.getPublicApi(this.manifest);
			this.setupRoutes();
			this._active = true;
			return true;
		} catch (e) {
			console.error("[Claude Connector] Failed to register with Local REST API:", e);
			return false;
		}
	}

	unregister(): void {
		for (const transport of this.transports.values()) {
			void transport.close();
		}
		this.transports.clear();

		if (this.extension) {
			try {
				this.extension.unregister();
			} catch {
				// ignore
			}
			this.extension = null;
		}
		this._active = false;
	}

	get active(): boolean {
		return this._active;
	}

	/** Port the Local REST API is listening on (default 27124). */
	get port(): number {
		return this.getLocalRestApiPlugin()?.settings?.port ?? 27124;
	}

	/** Returns the Local REST API's API key (used as the bearer token). */
	get apiKey(): string {
		return this.getLocalRestApiPlugin()?.settings?.apiKey ?? "";
	}

	// ── Route setup ────────────────────────────────────────────────────────

	private setupRoutes(): void {
		if (!this.extension) return;

		// SSE endpoint — Express req/res are compatible with Node.js IncomingMessage/ServerResponse.
		this.extension.addRoute("/mcp/sse").get(
			async (_req: ExpressRequest, res: ExpressResponse) => {
				await this.handleSse(res);
			}
		);

		// POST messages endpoint
		this.extension.addRoute("/mcp/messages").post(
			async (req: ExpressRequest, res: ExpressResponse) => {
				await this.handleMessages(req, res);
			}
		);
	}

	// ── SSE handler ────────────────────────────────────────────────────────

	private async handleSse(res: ExpressResponse): Promise<void> {
		const postEndpoint = `https://127.0.0.1:${this.port}/mcp/messages`;
		// Express res extends Node's ServerResponse, so the cast is safe.
		const transport = new SSEServerTransport(postEndpoint, res as unknown as ServerResponse);
		const mcpServer = createMcpServer(this.plugin);

		this.transports.set(transport.sessionId, transport);
		transport.onclose = () => {
			this.transports.delete(transport.sessionId);
		};

		await mcpServer.connect(transport);
	}

	// ── Messages handler ───────────────────────────────────────────────────

	private async handleMessages(
		req: ExpressRequest,
		res: ExpressResponse
	): Promise<void> {
		const sessionId =
			typeof req.query?.sessionId === "string"
				? req.query.sessionId
				: "";

		const transport = this.transports.get(sessionId);
		if (!transport) {
			res.status(400).json({ error: "Invalid or expired sessionId" });
			return;
		}

		// If body-parser already consumed the stream, pass req.body as parsedBody
		// so the SDK skips raw-body reading.
		await transport.handlePostMessage(
			req as unknown as IncomingMessage,
			res as unknown as ServerResponse,
			req.body
		);
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private getLocalRestApiPlugin(): LocalRestApiPlugin | null {
		const plugins = this.app.plugins?.plugins;
		if (!plugins) return null;
		const p = plugins["obsidian-local-rest-api"];
		if (!p || typeof (p as LocalRestApiPlugin).getPublicApi !== "function") {
			return null;
		}
		return p as LocalRestApiPlugin;
	}
}

// Minimal interfaces describing the Express req/res surface we actually use,
// without importing express itself.

interface ExpressResponse {
	status(code: number): { json(body: unknown): void; end(): void };
}

interface ExpressRequest {
	query?: Record<string, string | undefined>;
	body?: unknown;
}
