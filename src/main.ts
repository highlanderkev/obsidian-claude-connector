import { Notice, Plugin } from "obsidian";
import { CertManager } from "./mcp/cert-manager";
import { StandaloneServer } from "./mcp/standalone-server";
import type { ClaudeConnectorSettings } from "./settings";
import {
	ClaudeConnectorSettingTab,
	DEFAULT_SETTINGS,
	generateAuthToken,
} from "./settings";
import { ServerStatusModal } from "./ui/status-modal";

export interface ConnectionInfo {
	sseUrl: string;
	oauthMetadataUrl: string;
	oauthTokenUrl: string;
	oauthClientId: string;
	oauthClientSecret: string;
	bearerToken: string;
	mode: "HTTPS";
}

export default class ClaudeConnectorPlugin extends Plugin {
	settings: ClaudeConnectorSettings;

	private standaloneServer: StandaloneServer | null = null;
	private statusBarItem: HTMLElement | null = null;

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async onload() {
		await this.loadSettings();

		// Ensure a token exists on first install.
		if (!this.settings.standaloneAuthToken) {
			this.settings.standaloneAuthToken = generateAuthToken();
		}
 
		if (!this.settings.oauthClientId) {
			this.settings.oauthClientId = generateAuthToken();
		}

		if (!this.settings.oauthClientSecret) {
			this.settings.oauthClientSecret = generateAuthToken();
		}

		if (
			!this.settings.standaloneAuthToken ||
			!this.settings.oauthClientId ||
			!this.settings.oauthClientSecret
		) {
			await this.saveSettings();
		}

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Ribbon icon — opens the status modal
		this.addRibbonIcon("server", "Claude Connector", () => {
			new ServerStatusModal(this.app, this).open();
		});

		// Commands
		this.addCommand({
			id: "show-server-status",
			name: "Show server status",
			callback: () => new ServerStatusModal(this.app, this).open(),
		});

		this.addCommand({
			id: "start-server",
			name: "Start MCP server",
			callback: async () => {
				if (this.isMcpServerRunning()) {
					new Notice("Claude Connector: server is already running.");
					return;
				}
				await this.startMcpServer();
			},
		});

		this.addCommand({
			id: "stop-server",
			name: "Stop MCP server",
			callback: async () => {
				if (!this.isMcpServerRunning()) {
					new Notice("Claude Connector: server is not running.");
					return;
				}
				await this.stopMcpServer();
			},
		});

		// Settings tab
		this.addSettingTab(new ClaudeConnectorSettingTab(this.app, this));

		// Auto-start if the user had the server enabled previously
		if (this.settings.enableServer) {
			await this.startMcpServer();
		}
	}

	onunload(): void {
		void this.stopMcpServer();
	}

	// ── Server management ────────────────────────────────────────────────────

	async startMcpServer(): Promise<void> {
		await this.stopMcpServer();

		// Ensure a TLS certificate exists (generated on first start).
		const bundle = await new CertManager(this).ensureBundle().catch(
			(e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(
					`Claude Connector: failed to generate TLS certificate — ${msg}`
				);
				return null;
			}
		);
		if (!bundle) return;

		const server = new StandaloneServer(
			this,
			this.settings.standaloneHost,
			this.settings.standalonePort,
			this.settings.standaloneAuthToken,
			this.settings.oauthClientId,
			this.settings.oauthClientSecret,
			bundle
		);
		try {
			await server.start();
			this.standaloneServer = server;
			this.updateStatusBar();
			new Notice(
				`Claude Connector: HTTPS MCP server started on port ${this.settings.standalonePort}.`
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Claude Connector: failed to start server — ${msg}`);
		}
	}

	async stopMcpServer(): Promise<void> {
		if (this.standaloneServer) {
			await this.standaloneServer.stop();
			this.standaloneServer = null;
		}
		this.updateStatusBar();
	}

	isMcpServerRunning(): boolean {
		return this.standaloneServer?.isRunning === true;
	}

	/**
	 * Returns the URLs and credentials Claude needs to connect,
	 * or null if the server is not running.
	 */
	getConnectionInfo(): ConnectionInfo | null {
		if (this.standaloneServer?.isRunning) {
			return {
				sseUrl: `https://${this.settings.standaloneHost}:${this.settings.standalonePort}/mcp`,
				oauthMetadataUrl: `https://${this.settings.standaloneHost}:${this.settings.standalonePort}/.well-known/oauth-authorization-server`,
				oauthTokenUrl: `https://${this.settings.standaloneHost}:${this.settings.standalonePort}/oauth/token`,
				oauthClientId: this.settings.oauthClientId,
				oauthClientSecret: this.settings.oauthClientSecret,
				bearerToken: this.settings.standaloneAuthToken,
				mode: "HTTPS",
			};
		}
		return null;
	}

	// ── Persistence ──────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<ClaudeConnectorSettings>),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private updateStatusBar(): void {
		if (!this.statusBarItem) return;
		if (this.standaloneServer?.isRunning) {
			this.statusBarItem.setText(
				`Claude: HTTPS ${this.settings.standaloneHost}:${this.settings.standalonePort}`
			);
		} else {
			this.statusBarItem.setText("Claude: stopped");
		}
	}
}
