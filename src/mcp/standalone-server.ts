import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as https from "node:https";
import { Buffer } from "node:buffer";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type ClaudeConnectorPlugin from "../main";
import type { TlsCertBundle } from "./cert-manager";
import { createMcpServer } from "./mcp-server-factory";

/**
 * Built-in HTTPS MCP server (Streamable HTTP transport, current MCP spec).
 *
 * A single endpoint handles the full MCP lifecycle:
 *   GET  /.well-known/oauth-authorization-server – OAuth metadata discovery.
 *   GET  /.well-known/openid-configuration – OpenID-style discovery alias.
 *   POST /oauth/token – OAuth client credentials token exchange.
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
		private readonly oauthClientId: string,
		private readonly oauthClientSecret: string,
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
		const url = new URL(req.url ?? "/", `https://${this.host}:${this.port}`);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (url.pathname === "/.well-known/oauth-authorization-server") {
			this.handleOAuthMetadata(req, res);
			return;
		}

		if (url.pathname === "/.well-known/openid-configuration") {
			this.handleOAuthMetadata(req, res);
			return;
		}

		if (url.pathname === "/oauth/token") {
			void this.handleOAuthToken(req, res);
			return;
		}

		if (!this.checkAuth(req)) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

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

	private async handleOAuthToken(
		req: IncomingMessage,
		res: ServerResponse
	): Promise<void> {
		if (req.method !== "POST") {
			res.writeHead(405, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "method_not_allowed" }));
			return;
		}

		const body = await this.readBody(req);
		const params = this.parseBodyParams(req, body);
		const grantType = params.get("grant_type") ?? "";

		if (grantType !== "client_credentials") {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({ error: "unsupported_grant_type" })
			);
			return;
		}

		const credentials = this.readClientCredentials(req, params);
		if (
			credentials?.clientId !== this.oauthClientId ||
			credentials?.clientSecret !== this.oauthClientSecret
		) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "invalid_client" }));
			return;
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				access_token: this.authToken,
				token_type: "Bearer",
				expires_in: 3600,
			})
		);
	}

	private handleOAuthMetadata(
		req: IncomingMessage,
		res: ServerResponse
	): void {
		if (req.method !== "GET") {
			res.writeHead(405, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "method_not_allowed" }));
			return;
		}

		const issuer = `https://${this.host}:${this.port}`;
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				issuer,
				token_endpoint: `${issuer}/oauth/token`,
				grant_types_supported: ["client_credentials"],
				token_endpoint_auth_methods_supported: [
					"client_secret_basic",
					"client_secret_post",
				],
			})
		);
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private checkAuth(req: IncomingMessage): boolean {
		const header = req.headers.authorization;
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

	private async readBody(req: IncomingMessage): Promise<string> {
		let body = "";
		for await (const chunk of req) {
			let chunkText: string;
			if (typeof chunk === "string") {
				chunkText = chunk;
			} else if (Buffer.isBuffer(chunk)) {
				chunkText = chunk.toString("utf8");
			} else {
				chunkText = String(chunk);
			}
			body += chunkText;
			if (body.length > 32_768) {
				break;
			}
		}
		return body;
	}

	private parseBodyParams(
		req: IncomingMessage,
		body: string
	): URLSearchParams {
		const contentType = (req.headers["content-type"] ?? "")
			.toString()
			.toLowerCase();

		if (contentType.includes("application/json")) {
			try {
				const parsed = JSON.parse(body) as Record<string, unknown>;
				const params = new URLSearchParams();
				for (const [key, value] of Object.entries(parsed)) {
					if (typeof value === "string") {
						params.set(key, value);
					}
				}
				return params;
			} catch {
				return new URLSearchParams();
			}
		}

		return new URLSearchParams(body);
	}

	private readClientCredentials(
		req: IncomingMessage,
		bodyParams: URLSearchParams
	): { clientId: string; clientSecret: string } | null {
		const auth = req.headers.authorization;
		if (typeof auth === "string" && auth.startsWith("Basic ")) {
			const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
			const sep = decoded.indexOf(":");
			if (sep > -1) {
				return {
					clientId: decoded.slice(0, sep),
					clientSecret: decoded.slice(sep + 1),
				};
			}
		}

		const clientId = bodyParams.get("client_id") ?? "";
		const clientSecret = bodyParams.get("client_secret") ?? "";
		if (!clientId || !clientSecret) {
			return null;
		}

		return { clientId, clientSecret };
	}
}
