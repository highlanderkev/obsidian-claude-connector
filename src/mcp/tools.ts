import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TFile } from "obsidian";
import type ClaudeConnectorPlugin from "../main";

function text(t: string): { type: "text"; text: string } {
	return { type: "text", text: t };
}

function ok(t: string): CallToolResult {
	return { content: [text(t)] };
}

function err(t: string): CallToolResult {
	return { content: [text(t)], isError: true };
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	plugin: ClaudeConnectorPlugin
): Promise<CallToolResult> {
	const vault = plugin.app.vault;

	switch (name) {
		case "list_notes": {
			const folder = args["folder"] as string | undefined;
			const limit = (args["limit"] as number | undefined) ?? 50;
			let files = vault.getMarkdownFiles();

			if (folder) {
				const normalized = folder.endsWith("/") ? folder : `${folder}/`;
				files = files.filter(
					(f) => f.path.startsWith(normalized) || f.path.startsWith(`${folder}/`)
				);
			}

			files = files.slice(0, limit);

			if (files.length === 0) {
				return ok("No notes found.");
			}
			return ok(`Found ${files.length} note(s):\n${files.map((f) => `- ${f.path}`).join("\n")}`);
		}

		case "read_note": {
			const path = args["path"] as string;
			const abstract = vault.getAbstractFileByPath(path);
			if (!abstract || !(abstract instanceof TFile)) {
				return err(`Note not found: ${path}`);
			}
			const content = await vault.read(abstract);
			return ok(`# ${abstract.basename}\nPath: ${abstract.path}\n\n---\n\n${content}`);
		}

		case "search_notes": {
			const query = (args["query"] as string).toLowerCase();
			const searchContent = (args["search_content"] as boolean) ?? false;
			const files = vault.getMarkdownFiles();
			const matches: string[] = [];
			const contentSearchFiles: TFile[] = [];

			// First, collect title matches synchronously and build a list of files
			// that need content-based searching (to be processed with limited concurrency).
			for (const file of files) {
				if (file.basename.toLowerCase().includes(query)) {
					matches.push(`- ${file.path} (title match)`);
					continue;
				}
				if (searchContent) {
					contentSearchFiles.push(file);
				}
			}

			// Perform content search with a small, concurrency-limited worker pool
			// to avoid blocking plugin activity with many sequential file reads.
			if (searchContent && contentSearchFiles.length > 0) {
				const maxConcurrentReads = 5;
				let index = 0;

				const worker = async () => {
					while (true) {
						const currentIndex = index++;
						if (currentIndex >= contentSearchFiles.length) {
							break;
						}
						const file = contentSearchFiles[currentIndex];
						if (!file) {
							continue;
						}
						const content = await vault.cachedRead(file);
						if (content.toLowerCase().includes(query)) {
							matches.push(`- ${file.path} (content match)`);
						}
					}
				};

				const workerCount = Math.min(maxConcurrentReads, contentSearchFiles.length);
				const workers: Promise<void>[] = [];
				for (let i = 0; i < workerCount; i++) {
					workers.push(worker());
				}
				await Promise.all(workers);
			}

			if (matches.length === 0) {
				return ok(`No notes found matching "${query}".`);
			}
			return ok(`Found ${matches.length} match(es):\n${matches.join("\n")}`);
		}

		case "create_note": {
			const rawPath = args["path"] as string;
			const content = args["content"] as string;
			const notePath = rawPath.endsWith(".md") ? rawPath : `${rawPath}.md`;

			if (vault.getAbstractFileByPath(notePath)) {
				return err(
					`A note already exists at "${notePath}". Use update_note to modify it.`
				);
			}

			// Ensure parent folders exist
			const parentPath = notePath.split("/").slice(0, -1).join("/");
			if (parentPath) {
				await vault.createFolder(parentPath).catch(() => {
					// Folder may already exist — ignore the error
				});
			}

			const file = await vault.create(notePath, content);
			return ok(`Created note: ${file.path}`);
		}

		case "update_note": {
			const path = args["path"] as string;
			const newContent = args["content"] as string;
			const mode = (args["mode"] as string) ?? "overwrite";

			const abstract = vault.getAbstractFileByPath(path);
			if (!abstract || !(abstract instanceof TFile)) {
				return err(`Note not found: ${path}`);
			}

			let finalContent = newContent;
			if (mode === "append") {
				const existing = await vault.read(abstract);
				finalContent = `${existing}\n\n${newContent}`;
			} else if (mode === "prepend") {
				const existing = await vault.read(abstract);
				finalContent = `${newContent}\n\n${existing}`;
			}

			await vault.modify(abstract, finalContent);
			return ok(`Updated note: ${abstract.path}`);
		}

		default:
			return err(`Unknown tool: ${name}`);
	}
}
