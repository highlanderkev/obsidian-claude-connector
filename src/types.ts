import type { PluginManifest } from "obsidian";

// ── Local REST API bridge ────────────────────────────────────────────────────
// Minimal interface for the obsidian-local-rest-api plugin so we can call
// getPublicApi() without importing its package or express types.

type AnyHandler = (req: unknown, res: unknown) => void | Promise<void>;

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
