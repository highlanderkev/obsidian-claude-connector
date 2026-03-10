import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type ClaudeConnectorPlugin from "../main";

/**
 * Modal that shows the current MCP server status and quick-copy connection
 * details that users need when configuring a Claude Custom Connector.
 */
export class ServerStatusModal extends Modal {
	private readonly plugin: ClaudeConnectorPlugin;

	constructor(app: App, plugin: ClaudeConnectorPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Claude Connector — server status");

		const info = this.plugin.getConnectionInfo();

		// Status indicator
		const statusText = info
			? `🟢 Running (${info.mode})`
			: "🔴 Stopped";
		contentEl.createEl("p", {
			text: `Status: ${statusText}`,
			cls: "claude-connector-status-line",
		});

		if (info) {
			contentEl.createEl("p", {
				text: "Copy these values into Claude → settings → integrations → add custom connector.",
				cls: "setting-item-description",
			});

			new Setting(contentEl)
				.setName("SSE endpoint URL")
				.addText((t) => t.setValue(info.sseUrl).setDisabled(true))
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.sseUrl);
						new Notice("Copied SSE URL");
					})
				);

			new Setting(contentEl)
				.setName("OAuth metadata URL")
				.setDesc("Optional: allows OAuth configuration discovery.")
				.addText((t) =>
					t.setValue(info.oauthMetadataUrl).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.oauthMetadataUrl);
						new Notice("Copied OAuth metadata URL");
					})
				);

			new Setting(contentEl)
				.setName("OAuth token URL")
				.setDesc("Use this as Claude OAuth token endpoint.")
				.addText((t) =>
					t.setValue(info.oauthTokenUrl).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.oauthTokenUrl);
						new Notice("Copied OAuth token URL");
					})
				);

			new Setting(contentEl)
				.setName("OAuth client ID")
				.addText((t) =>
					t.setValue(info.oauthClientId).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.oauthClientId);
						new Notice("Copied OAuth client ID");
					})
				);

			new Setting(contentEl)
				.setName("OAuth client secret")
				.addText((t) =>
					t.setValue(info.oauthClientSecret).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.oauthClientSecret);
						new Notice("Copied OAuth client secret");
					})
				);

			new Setting(contentEl)
				.setName("Returned access token")
				.setDesc("OAuth returns this as Bearer token for MCP requests.")
				.addText((t) =>
					t.setValue(info.bearerToken).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.bearerToken);
						new Notice("Copied access token");
					})
				);
		} else {
			contentEl.createEl("p", {
				text: "Enable the MCP server in settings → Claude Connector to start.",
				cls: "setting-item-description",
			});
		}

		// Close button
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Close")
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
