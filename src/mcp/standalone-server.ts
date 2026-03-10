import * as http from "http";
import type ClaudeConnectorPlugin from "../main";
import { JsonRpcRequest, SseSession } from "../types";
import { handleMcpRequest } from "./handlers";
import { SessionManager } from "./session-manager";

/**
 * Standalone HTTP MCP server (HTTP+SSE transport, MCP spec 2024-11-05).
 *
 * Endpoints:
 *   GET  /sse           – open an SSE stream; returns an `endpoint` event
 *                         carrying the POST URL for that session.
 *   POST /messages      – send a JSON-RPC request; response is sent back
 *                         via the SSE stream and 202 is returned immediately.
 *
 * Bound to 127.0.0.1 only; never accessible from outside the machine.
 */
export class StandaloneServer {
	private server: http.Server | null = null;
	private readonly sessions = new SessionManager();
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
		this.sessions.closeAll();
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
			this.handleSse(req, res);
		} else if (url.pathname === "/messages" && req.method === "POST") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			void this.handleMessages(req, res, sessionId);
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	// ── SSE endpoint ───────────────────────────────────────────────────────

	private handleSse(
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void {
		const sessionId = SessionManager.generateId();

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		let active = true;

		const session: SseSession = {
			id: sessionId,
			write: (data: string) => {
				if (active && !res.writableEnded) {
					res.write(data);
				}
			},
			end: () => {
				active = false;
				if (!res.writableEnded) {
					res.end();
				}
			},
			get active() {
				return active && !res.writableEnded;
			},
		};

		this.sessions.add(session);

		// Inform client where to POST messages for this session.
		const postUrl = `http://127.0.0.1:${this.port}/messages?sessionId=${encodeURIComponent(sessionId)}`;
		res.write(`event: endpoint\ndata: ${JSON.stringify(postUrl)}\n\n`);

		// Keep-alive comment every 30 s.
		const pingTimer = setInterval(() => {
			if (!session.active) {
				clearInterval(pingTimer);
				this.sessions.remove(sessionId);
				return;
			}
			res.write(": ping\n\n");
		}, 30_000);

		req.on("close", () => {
			clearInterval(pingTimer);
			active = false;
			this.sessions.remove(sessionId);
		});
	}

	// ── Messages endpoint ──────────────────────────────────────────────────

	private async handleMessages(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		sessionId: string
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid or expired sessionId" }));
			return;
		}

		let body = "";
		for await (const chunk of req) {
			body += chunk;
		}

		let request: JsonRpcRequest;
		try {
			request = JSON.parse(body) as JsonRpcRequest;
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON" }));
			return;
		}

		const response = await handleMcpRequest(request, this.plugin);
		if (response !== null) {
			this.sessions.sendToSession(sessionId, response);
		}

		res.writeHead(202);
		res.end();
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private checkAuth(req: http.IncomingMessage): boolean {
		const header = req.headers["authorization"];
		return (
			typeof header === "string" &&
			header === `Bearer ${this.authToken}`
		);
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
