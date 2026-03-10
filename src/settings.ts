import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ClaudeConnectorPlugin from "./main";

export interface ClaudeConnectorSettings {
	/** Port for the standalone HTTP server (used when Local REST API is absent). */
	standalonePort: number;
	/** Bearer token for the standalone HTTP server. Auto-generated on first load. */
	standaloneAuthToken: string;
	/** Whether to run a server at all. */
	enableServer: boolean;
	/**
	 * When true, try to register MCP endpoints on obsidian-local-rest-api if it
	 * is installed.  Falls back to the standalone server otherwise.
	 */
	preferLocalRestApi: boolean;
}

export const DEFAULT_SETTINGS: ClaudeConnectorSettings = {
	standalonePort: 3333,
	standaloneAuthToken: "",
	enableServer: false,
	preferLocalRestApi: true,
};

/** Generates a cryptographically-random 32-character alphanumeric token. */
export function generateAuthToken(): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => chars[b % chars.length])
		.join("");
}

export class ClaudeConnectorSettingTab extends PluginSettingTab {
	plugin: ClaudeConnectorPlugin;

	constructor(app: App, plugin: ClaudeConnectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("p", {
			text: "Exposes your Obsidian vault as an MCP server so Claude can read, search, and edit notes via custom connectors.",
			cls: "setting-item-description",
		});

		// ── Enable / disable ────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Enable MCP server")
			.setDesc(
				"Start the local MCP server that Claude connects to."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableServer)
					.onChange(async (value) => {
						this.plugin.settings.enableServer = value;
						await this.plugin.saveSettings();
						if (value) {
							await this.plugin.startMcpServer();
						} else {
							await this.plugin.stopMcpServer();
						}
						this.display();
					})
			);

		// ── Local REST API preference ────────────────────────────────────────
		new Setting(containerEl)
			.setName("Prefer local REST API integration")
			.setDesc(
				"When enabled, registers MCP endpoints on the local REST API plugin if it is installed. Falls back to the standalone server otherwise."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.preferLocalRestApi)
					.onChange(async (value) => {
						this.plugin.settings.preferLocalRestApi = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Standalone server settings ───────────────────────────────────────
		new Setting(containerEl).setName("Standalone server").setHeading();
		containerEl.createEl("p", {
			text: "Used when the local REST API plugin is not installed.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Port")
			.setDesc("Local port for the standalone MCP server (default: 3333).")
			.addText((text) =>
				text
					.setPlaceholder("3333")
					.setValue(String(this.plugin.settings.standalonePort))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.standalonePort = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Auth token")
			.setDesc(
				"Bearer token Claude must supply to authenticate with the standalone server. Keep this secret."
			)
			.addText((text) =>
				text
					.setPlaceholder("Auto-generated on first load")
					.setValue(this.plugin.settings.standaloneAuthToken)
					.onChange(async (value) => {
						this.plugin.settings.standaloneAuthToken = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Regenerate").onClick(async () => {
					this.plugin.settings.standaloneAuthToken = generateAuthToken();
					await this.plugin.saveSettings();
					new Notice(
						"New auth token generated — update your Claude Connector."
					);
					this.display();
				})
			);

		// ── Active connection info ───────────────────────────────────────────
		if (this.plugin.settings.enableServer) {
			const info = this.plugin.getConnectionInfo();
			if (info) {
				const infoEl = containerEl.createDiv({
					cls: "claude-connector-connection-info",
				});
				new Setting(infoEl).setName("Connection info for Claude").setHeading();
				infoEl.createEl("p", {
					text: "Use these values when adding a custom connector in Claude → settings → integrations.",
					cls: "setting-item-description",
				});

				new Setting(infoEl)
					.setName("SSE endpoint URL")
					.addText((text) =>
						text.setValue(info.sseUrl).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.sseUrl);
							new Notice("Copied SSE URL");
						})
					);

				new Setting(infoEl)
					.setName("Bearer token")
					.setDesc("Include as the authorization header value.")
					.addText((text) =>
						text.setValue(info.bearerToken).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.bearerToken);
							new Notice("Copied bearer token");
						})
					);

				infoEl.createEl("p", {
					text: `Mode: ${info.mode}`,
					cls: "setting-item-description",
				});
			}
		}
	}
}
