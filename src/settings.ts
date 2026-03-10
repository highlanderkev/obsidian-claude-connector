import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import { CertManager } from "./mcp/cert-manager";
import type ClaudeConnectorPlugin from "./main";

export interface ClaudeConnectorSettings {
	/** Hostname or IP the server binds to and advertises in the SSE endpoint URL. */
	standaloneHost: string;
	/** Port for the built-in HTTPS MCP server. */
	standalonePort: number;
	/** Access token returned by the local OAuth token endpoint. */
	standaloneAuthToken: string;
	/** OAuth client identifier Claude uses to request an access token. */
	oauthClientId: string;
	/** OAuth client secret Claude uses to request an access token. */
	oauthClientSecret: string;
	/** Whether to run the server at all. */
	enableServer: boolean;
	/** PEM-encoded self-signed TLS certificate. */
	tlsCert: string;
	/** PEM-encoded private key for the TLS certificate. */
	tlsKey: string;
}

export const DEFAULT_SETTINGS: ClaudeConnectorSettings = {
	standaloneHost: "127.0.0.1",
	standalonePort: 27124,
	standaloneAuthToken: "",
	oauthClientId: "",
	oauthClientSecret: "",
	enableServer: false,
	tlsCert: "",
	tlsKey: "",
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
			text: "Exposes your Obsidian vault as an MCP server so Claude can read, search, and edit notes. Runs a built-in HTTPS server — no external plugins required.",
			cls: "setting-item-description",
		});

		// ── Enable / disable ────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Enable MCP server")
			.setDesc("Start the local HTTPS MCP server that Claude connects to.")
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

		// ── Server settings ──────────────────────────────────────────────────
		new Setting(containerEl).setName("Server").setHeading();

		new Setting(containerEl)
			.setName("Host")
			.setDesc(
				"Hostname or IP address the server binds to and advertises in the SSE endpoint URL. Use 127.0.0.1 (default) to restrict to localhost only."
			)
			.addText((text) =>
				text
					.setPlaceholder("127.0.0.1")
					.setValue(this.plugin.settings.standaloneHost)
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed) {
							this.plugin.settings.standaloneHost = trimmed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Port")
			.setDesc("Local port for the HTTPS MCP server (default: 27124).")
			.addText((text) =>
				text
					.setPlaceholder("27124")
					.setValue(String(this.plugin.settings.standalonePort))
					.onChange(async (value) => {
						const port = Number.parseInt(value, 10);
						if (!Number.isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.standalonePort = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Access token")
			.setDesc(
				"Token the plugin returns from OAuth and expects as Authorization: Bearer <token> on MCP requests."
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
					new Notice("New access token generated.");
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("OAuth client ID")
			.setDesc("Client ID Claude uses for OAuth client credentials.")
			.addText((text) =>
				text
					.setPlaceholder("Auto-generated on first load")
					.setValue(this.plugin.settings.oauthClientId)
					.onChange(async (value) => {
						this.plugin.settings.oauthClientId = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Regenerate").onClick(async () => {
					this.plugin.settings.oauthClientId = generateAuthToken();
					await this.plugin.saveSettings();
					new Notice("New OAuth client ID generated.");
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("OAuth client secret")
			.setDesc("Client secret Claude uses for OAuth client credentials.")
			.addText((text) =>
				text
					.setPlaceholder("Auto-generated on first load")
					.setValue(this.plugin.settings.oauthClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.oauthClientSecret = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Regenerate").onClick(async () => {
					this.plugin.settings.oauthClientSecret = generateAuthToken();
					await this.plugin.saveSettings();
					new Notice("New OAuth client secret generated.");
					this.display();
				})
			);

		// ── Certificate management ───────────────────────────────────────────
		new Setting(containerEl).setName("TLS certificate").setHeading();

		const hasCert = Boolean(this.plugin.settings.tlsCert);
		containerEl.createEl("p", {
			text: hasCert
				? "A self-signed certificate has been generated and is stored securely in your plugin data. Claude custom connectors require HTTPS — this certificate enables that."
				: "No certificate yet. Enable the server to auto-generate one, or click Regenerate below.",
			cls: "setting-item-description",
		});

		containerEl.createEl("p", {
			text: "For Claude to connect, your system must trust this certificate. Click \"Open Certificate\" to open it in your system's certificate manager, then follow your OS prompts to mark it as trusted.",
			cls: "setting-item-description",
		});

		containerEl.createEl("details", {}, (details) => {
			details.createEl("summary", { text: "Trust instructions by OS" });
			const list = details.createEl("ul");
			list.createEl("li", {
				text: "macOS: In Keychain Access, double-click the certificate → expand Trust → set \"When using this certificate\" to Always Trust.",
			});
			list.createEl("li", {
				text: "Windows: In the import wizard, choose \"Trusted Root Certification Authorities\" as the store.",
			});
			list.createEl("li", {
				text: "Linux (Chrome/Chromium): go to Settings → Privacy → Manage certificates → Authorities → Import.",
			});
		});

		new Setting(containerEl)
			.setName("Certificate actions")
			.addButton((btn) =>
				btn
					.setButtonText("Open Certificate")
					.setDisabled(!hasCert)
					.onClick(async () => {
						const certPath = path.join(
							os.tmpdir(),
							"obsidian-claude-connector.crt"
						);
						fs.writeFileSync(
							certPath,
							this.plugin.settings.tlsCert
						);
						// eslint-disable-next-line @typescript-eslint/no-require-imports
						const { shell } = require("electron") as {
							shell: { openPath: (p: string) => Promise<string> };
						};
						await shell.openPath(certPath);
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Regenerate Certificate").onClick(async () => {
					await new CertManager(this.plugin).generateAndSave();
					new Notice(
						"New TLS certificate generated — you will need to trust it again."
					);
					// Restart the server so it picks up the new cert.
					if (this.plugin.isMcpServerRunning()) {
						await this.plugin.stopMcpServer();
						await this.plugin.startMcpServer();
					}
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
				new Setting(infoEl)
					.setName("Connection info for Claude")
					.setHeading();
				infoEl.createEl("p", {
					text: "Use these values when adding a custom connector in Claude → Settings → Integrations.",
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
					.setName("OAuth metadata URL")
					.setDesc("Optional: clients can discover OAuth config from this endpoint.")
					.addText((text) =>
						text.setValue(info.oauthMetadataUrl).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.oauthMetadataUrl);
							new Notice("Copied OAuth metadata URL");
						})
					);

				new Setting(infoEl)
					.setName("OAuth token URL")
					.setDesc("Configure Claude OAuth to use this token endpoint.")
					.addText((text) =>
						text.setValue(info.oauthTokenUrl).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.oauthTokenUrl);
							new Notice("Copied OAuth token URL");
						})
					);

				new Setting(infoEl)
					.setName("OAuth client ID")
					.addText((text) =>
						text.setValue(info.oauthClientId).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.oauthClientId);
							new Notice("Copied OAuth client ID");
						})
					);

				new Setting(infoEl)
					.setName("OAuth client secret")
					.addText((text) =>
						text.setValue(info.oauthClientSecret).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.oauthClientSecret);
							new Notice("Copied OAuth client secret");
						})
					);

				new Setting(infoEl)
					.setName("Returned access token")
					.setDesc("OAuth returns this as Bearer token for MCP requests.")
					.addText((text) =>
						text.setValue(info.bearerToken).setDisabled(true)
					)
					.addButton((btn) =>
						btn.setButtonText("Copy").onClick(() => {
							void navigator.clipboard.writeText(info.bearerToken);
							new Notice("Copied bearer token");
						})
					);
			}
		}
	}
}
