import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as https from "node:https";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type ClaudeConnectorPlugin from "../main";
import type { TlsCertBundle } from "./cert-manager";
import { createMcpServer } from "./mcp-server-factory";

/**
 * Built-in HTTPS MCP server (Streamable HTTP transport, current MCP spec).
 *
 * A single endpoint handles the full MCP lifecycle:
 *   POST /mcp  – initialise a new session or send JSON-RPC messages.
 *   GET  /mcp  – open a server-sent-event stream for a session.
 *   DELETE /mcp – close a session.
 *
 * Binds to the configured host (default: 127.0.0.1).
 */
export class StandaloneServer {
	private server: https.Server | null = null;
	private readonly transports = new Map<
		string,
		StreamableHTTPServerTransport
	>();

	constructor(
		private readonly plugin: ClaudeConnectorPlugin,
		private readonly host: string,
		private readonly port: number,
		private readonly authToken: string,
		private readonly certBundle: TlsCertBundle
	) {}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = https.createServer(
				{ cert: this.certBundle.cert, key: this.certBundle.key },
				(req, res) => this.handleRequest(req, res)
			);
			this.server.on("error", reject);
			this.server.listen(this.port, this.host, () => resolve());
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
		req: IncomingMessage,
		res: ServerResponse
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

		const url = new URL(
			req.url ?? "/",
			`https://${this.host}:${this.port}`
		);

		if (url.pathname === "/mcp") {
			void this.handleMcp(req, res);
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	// ── MCP endpoint ───────────────────────────────────────────────────────

	private async handleMcp(
		req: IncomingMessage,
		res: ServerResponse
	): Promise<void> {
		const sessionId = req.headers["mcp-session-id"];

		// Route to an existing session.
		if (typeof sessionId === "string") {
			const existing = this.transports.get(sessionId);
			if (!existing) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Session not found" }));
				return;
			}
			await existing.handleRequest(req, res);
			return;
		}

		// No session ID — create a new transport, connect the MCP server, then handle.
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				this.transports.set(id, transport);
			},
		});

		transport.onclose = () => {
			if (transport.sessionId) {
				this.transports.delete(transport.sessionId);
			}
		};

		const mcpServer = createMcpServer(this.plugin);
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res);
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private checkAuth(req: IncomingMessage): boolean {
		const header = req.headers["authorization"];
		return typeof header === "string" && header === `Bearer ${this.authToken}`;
	}

	private setCors(res: ServerResponse): void {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization, mcp-session-id"
		);
	}
}
