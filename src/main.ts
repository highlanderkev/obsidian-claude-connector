import { Notice, Plugin } from "obsidian";
import {
	ClaudeConnectorSettings,
	ClaudeConnectorSettingTab,
	DEFAULT_SETTINGS,
	generateAuthToken,
} from "./settings";
import { StandaloneServer } from "./mcp/standalone-server";
import { LocalRestApiIntegration } from "./mcp/local-rest-api";
import { ServerStatusModal } from "./ui/status-modal";

export interface ConnectionInfo {
	sseUrl: string;
	bearerToken: string;
	mode: "Local REST API (HTTPS)" | "Standalone (HTTP)";
}

export default class ClaudeConnectorPlugin extends Plugin {
	settings: ClaudeConnectorSettings;

	private standaloneServer: StandaloneServer | null = null;
	private localRestApiIntegration: LocalRestApiIntegration | null = null;
	private statusBarItem: HTMLElement | null = null;

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async onload() {
		await this.loadSettings();

		// Ensure a token exists on first install.
		if (!this.settings.standaloneAuthToken) {
			this.settings.standaloneAuthToken = generateAuthToken();
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

		// Listen for the Local REST API loading after us.
		// The obsidian-local-rest-api plugin fires this workspace event in its
		// onload() via: this.app.workspace.trigger("obsidian-local-rest-api:loaded")
		this.registerEvent(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			(this.app.workspace as any).on(
				"obsidian-local-rest-api:loaded",
				async () => {
					if (
						this.settings.enableServer &&
						this.settings.preferLocalRestApi &&
						!this.isMcpServerRunning()
					) {
						await this.startMcpServer();
					}
				}
			)
		);

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

		// Try Local REST API integration first (if the user prefers it)
		if (this.settings.preferLocalRestApi) {
			const integration = new LocalRestApiIntegration(this);
			if (integration.register()) {
				this.localRestApiIntegration = integration;
				this.updateStatusBar();
				new Notice(
					`Claude Connector: MCP endpoints registered on Local REST API (HTTPS port ${integration.port}).`
				);
				return;
			}
		}

		// Fall back to standalone HTTP server
		const server = new StandaloneServer(
			this,
			this.settings.standalonePort,
			this.settings.standaloneAuthToken
		);
		try {
			await server.start();
			this.standaloneServer = server;
			this.updateStatusBar();
			new Notice(
				`Claude Connector: standalone MCP server started on port ${this.settings.standalonePort}.`
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Claude Connector: failed to start server — ${msg}`);
		}
	}

	async stopMcpServer(): Promise<void> {
		if (this.localRestApiIntegration) {
			this.localRestApiIntegration.unregister();
			this.localRestApiIntegration = null;
		}
		if (this.standaloneServer) {
			await this.standaloneServer.stop();
			this.standaloneServer = null;
		}
		this.updateStatusBar();
	}

	isMcpServerRunning(): boolean {
		return (
			this.localRestApiIntegration?.active === true ||
			this.standaloneServer?.isRunning === true
		);
	}

	/**
	 * Returns the URLs and credentials Claude needs to connect,
	 * or null if the server is not running.
	 */
	getConnectionInfo(): ConnectionInfo | null {
		if (this.localRestApiIntegration?.active) {
			const port = this.localRestApiIntegration.port;
			return {
				sseUrl: `https://127.0.0.1:${port}/mcp/sse`,
				bearerToken: this.localRestApiIntegration.apiKey,
				mode: "Local REST API (HTTPS)",
			};
		}
		if (this.standaloneServer?.isRunning) {
			return {
				sseUrl: `http://127.0.0.1:${this.settings.standalonePort}/sse`,
				bearerToken: this.settings.standaloneAuthToken,
				mode: "Standalone (HTTP)",
			};
		}
		return null;
	}

	// ── Persistence ──────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ClaudeConnectorSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private updateStatusBar(): void {
		if (!this.statusBarItem) return;
		if (this.localRestApiIntegration?.active) {
			this.statusBarItem.setText(
				`Claude: HTTPS ${this.localRestApiIntegration.port}`
			);
		} else if (this.standaloneServer?.isRunning) {
			this.statusBarItem.setText(
				`Claude: HTTP ${this.settings.standalonePort}`
			);
		} else {
			this.statusBarItem.setText("Claude: stopped");
		}
	}
}
