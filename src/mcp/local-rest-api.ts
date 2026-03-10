import { App, PluginManifest } from "obsidian";
import type ClaudeConnectorPlugin from "../main";
import {
	JsonRpcRequest,
	LocalRestApiExtension,
	LocalRestApiPlugin,
	SseSession,
} from "../types";
import { handleMcpRequest } from "./handlers";
import { SessionManager } from "./session-manager";

/**
 * Integrates Claude Connector with the obsidian-local-rest-api plugin.
 *
 * When the Local REST API is present this class registers two routes on its
 * Express server (which already handles HTTPS + auth):
 *   GET  /mcp/sse       – SSE stream; sends an `endpoint` event for POST URL.
 *   POST /mcp/messages  – receives JSON-RPC requests; responds via SSE.
 *
 * Because the Local REST API's auth middleware runs before every route,
 * Claude must supply the Local REST API's API key as its bearer token.
 */
export class LocalRestApiIntegration {
	private extension: LocalRestApiExtension | null = null;
	private readonly sessions = new SessionManager();
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
		this.sessions.closeAll();
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

		// SSE endpoint
		this.extension.addRoute("/mcp/sse").get(
			(req: unknown, res: unknown) => {
				this.handleSse(res as SseCompatibleResponse);
			}
		);

		// POST messages endpoint
		this.extension.addRoute("/mcp/messages").post(
			async (req: unknown, res: unknown) => {
				await this.handleMessages(
					req as PostRequest,
					res as ResponseLike
				);
			}
		);
	}

	// ── SSE handler ────────────────────────────────────────────────────────

	private handleSse(res: SseCompatibleResponse): void {
		const sessionId = SessionManager.generateId();

		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		// Express does not flush automatically with SSE — call flushHeaders if available.
		if (typeof res.flushHeaders === "function") {
			res.flushHeaders();
		}

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

		const postUrl = `https://127.0.0.1:${this.port}/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`;
		res.write(`event: endpoint\ndata: ${JSON.stringify(postUrl)}\n\n`);

		const pingTimer = setInterval(() => {
			if (!session.active) {
				clearInterval(pingTimer);
				this.sessions.remove(sessionId);
				return;
			}
			res.write(": ping\n\n");
		}, 30_000);

		// Express exposes req.on via the underlying socket; use res.on('close')
		res.on("close", () => {
			clearInterval(pingTimer);
			active = false;
			this.sessions.remove(sessionId);
		});
	}

	// ── Messages handler ───────────────────────────────────────────────────

	private async handleMessages(
		req: PostRequest,
		res: ResponseLike
	): Promise<void> {
		const sessionId =
			typeof req.query?.sessionId === "string"
				? req.query.sessionId
				: "";

		const session = this.sessions.get(sessionId);
		if (!session) {
			res.status(400).json({ error: "Invalid or expired sessionId" });
			return;
		}

		// bodyParser.raw gives us a Uint8Array/Buffer; fall back gracefully.
		let bodyStr: string;
		if (req.body instanceof Uint8Array) {
			bodyStr = new TextDecoder().decode(req.body);
		} else if (typeof req.body === "string") {
			bodyStr = req.body;
		} else {
			bodyStr = JSON.stringify(req.body);
		}

		let request: JsonRpcRequest;
		try {
			request = JSON.parse(bodyStr) as JsonRpcRequest;
		} catch {
			res.status(400).json({ error: "Invalid JSON" });
			return;
		}

		const response = await handleMcpRequest(request, this.plugin);
		if (response !== null) {
			this.sessions.sendToSession(sessionId, response);
		}

		res.status(202).end();
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

// Minimal interfaces that describe what we actually use from Express types,
// without importing express itself.

interface SseCompatibleResponse {
	setHeader(name: string, value: string): void;
	write(data: string): boolean;
	end(): void;
	readonly writableEnded: boolean;
	flushHeaders?(): void;
	on(event: "close", handler: () => void): void;
}

interface ResponseLike {
	status(code: number): { json(body: unknown): void; end(): void };
}

interface PostRequest {
	query?: Record<string, string | undefined>;
	body?: unknown;
}
