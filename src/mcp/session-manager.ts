import { SseSession } from "../types";

/**
 * Shared SSE session registry.
 * Both the standalone server and the Local REST API integration use this
 * to track open SSE connections and send responses back through them.
 */
export class SessionManager {
	private sessions = new Map<string, SseSession>();

	add(session: SseSession): void {
		this.sessions.set(session.id, session);
	}

	get(id: string): SseSession | undefined {
		return this.sessions.get(id);
	}

	remove(id: string): void {
		this.sessions.delete(id);
	}

	/** Send a JSON-RPC response to the session identified by `id`. */
	sendToSession(id: string, payload: unknown): boolean {
		const session = this.sessions.get(id);
		if (!session || !session.active) return false;
		session.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
		return true;
	}

	/** Close and remove all sessions (called on plugin unload). */
	closeAll(): void {
		for (const session of this.sessions.values()) {
			session.end();
		}
		this.sessions.clear();
	}

	/** Returns a UUID-style session identifier. */
	static generateId(): string {
		return (
			Math.random().toString(36).substring(2, 10) +
			Date.now().toString(36)
		);
	}
}
