/* eslint-disable @typescript-eslint/no-deprecated -- SSEServerTransport is intentional: MCP 2024-11-05 SSE protocol required for Claude client compatibility */
import * as http from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type ClaudeConnectorPlugin from "../main";
import { createMcpServer } from "./mcp-server-factory";

/**
 * Standalone HTTP MCP server (HTTP+SSE transport, MCP spec 2024-11-05).
 *
 * Endpoints:
 *   GET  /sse           – open an SSE stream; the SDK sends an `endpoint` event
 *                         carrying the POST URL for that session.
 *   POST /messages      – send a JSON-RPC request; delegated to SSEServerTransport.
 *
 * Bound to 127.0.0.1 only; never accessible from outside the machine.
 */
export class StandaloneServer {
	private server: http.Server | null = null;
	private readonly transports = new Map<string, SSEServerTransport>();
	private readonly plugin: ClaudeConnectorPlugin;
	private readonly port: number;
	private readonly authToken: string;

	constructor(
		plugin: ClaudeConnectorPlugin,
		port: number,
		authToken: string
	) {
		this.plugin = plugin;
		this.port = port;
		this.authToken = authToken;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) =>
				this.handleRequest(req, res)
			);
			this.server.on("error", reject);
			this.server.listen(this.port, "127.0.0.1", () => resolve());
		});
	}

	stop(): Promise<void> {
		for (const transport of this.transports.values()) {
			void transport.close();
		}
		this.transports.clear();
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => resolve());
				this.server = null;
			} else {
				resolve();
			}
		});
	}

	get isRunning(): boolean {
		return this.server?.listening === true;
	}

	// ── Request routing ────────────────────────────────────────────────────

	private handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void {
		this.setCors(res);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (!this.checkAuth(req)) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

		if (url.pathname === "/sse" && req.method === "GET") {
			void this.handleSse(res);
		} else if (url.pathname === "/messages" && req.method === "POST") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			void this.handleMessages(req, res, sessionId);
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	// ── SSE endpoint ───────────────────────────────────────────────────────

	private async handleSse(res: http.ServerResponse): Promise<void> {
		const postEndpoint = `http://127.0.0.1:${this.port}/messages`;
		const transport = new SSEServerTransport(postEndpoint, res);
		const mcpServer = createMcpServer(this.plugin);

		this.transports.set(transport.sessionId, transport);
		transport.onclose = () => {
			this.transports.delete(transport.sessionId);
		};

		await mcpServer.connect(transport);
	}

	// ── Messages endpoint ──────────────────────────────────────────────────

	private async handleMessages(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		sessionId: string
	): Promise<void> {
		const transport = this.transports.get(sessionId);
		if (!transport) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid or expired sessionId" }));
			return;
		}

		await transport.handlePostMessage(req, res);
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private checkAuth(req: http.IncomingMessage): boolean {
		const header = req.headers["authorization"];
		return typeof header === "string" && header === `Bearer ${this.authToken}`;
	}

	private setCors(res: http.ServerResponse): void {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization"
		);
	}
}
