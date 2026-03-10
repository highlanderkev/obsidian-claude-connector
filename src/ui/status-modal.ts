import { App, Modal, Notice, Setting } from "obsidian";
import type ClaudeConnectorPlugin from "../main";

/**
 * Modal that shows the current MCP server status and quick-copy connection
 * details that users need when configuring a Claude Custom Connector.
 */
export class ServerStatusModal extends Modal {
	private plugin: ClaudeConnectorPlugin;

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
				.setName("Bearer token")
				.setDesc(
					"Paste this as the value of the Authorization header (e.g. Bearer <token>)."
				)
				.addText((t) =>
					t.setValue(info.bearerToken).setDisabled(true)
				)
				.addButton((b) =>
					b.setButtonText("Copy").onClick(() => {
						void navigator.clipboard.writeText(info.bearerToken);
						new Notice("Copied bearer token");
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
