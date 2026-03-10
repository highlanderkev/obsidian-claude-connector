import { TFile } from "obsidian";
import type ClaudeConnectorPlugin from "../main";
import { McpTool, ToolCallResult, TextContent } from "../types";

export const VAULT_TOOLS: McpTool[] = [
	{
		name: "list_notes",
		description:
			"List notes in the Obsidian vault, optionally filtered by folder path.",
		inputSchema: {
			type: "object",
			properties: {
				folder: {
					type: "string",
					description:
						'Optional folder path to filter by (e.g. "Projects" or "Daily Notes").',
				},
				limit: {
					type: "number",
					description: "Maximum number of notes to return (default: 50).",
				},
			},
		},
	},
	{
		name: "read_note",
		description: "Read the full Markdown contents of a note by its vault path.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						'Path to the note relative to the vault root (e.g. "Projects/My Project.md").',
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_notes",
		description:
			"Search for notes whose title or content contains a query string.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Text to search for.",
				},
				search_content: {
					type: "boolean",
					description:
						"Also search inside note contents (slower). Default: false.",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "create_note",
		description: "Create a new Markdown note in the vault.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						'Vault-relative path for the new note (e.g. "Ideas/Brainstorm.md"). The .md extension is added automatically if omitted.',
				},
				content: {
					type: "string",
					description: "Markdown content for the new note.",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "update_note",
		description: "Update or append/prepend content to an existing note.",
		inputSchema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Vault-relative path to the note.",
				},
				content: {
					type: "string",
					description: "New content (or the text to append/prepend).",
				},
				mode: {
					type: "string",
					enum: ["overwrite", "append", "prepend"],
					description:
						'How to apply the content: "overwrite" (default), "append", or "prepend".',
				},
			},
			required: ["path", "content"],
		},
	},
];

function text(t: string): TextContent {
	return { type: "text", text: t };
}

function ok(t: string): ToolCallResult {
	return { content: [text(t)] };
}

function err(t: string): ToolCallResult {
	return { content: [text(t)], isError: true };
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	plugin: ClaudeConnectorPlugin
): Promise<ToolCallResult> {
	const vault = plugin.app.vault;

	switch (name) {
		case "list_notes": {
			const folder = args["folder"] as string | undefined;
			const limit = (args["limit"] as number | undefined) ?? 50;
			let files = vault.getMarkdownFiles();

			if (folder) {
				const normalized = folder.endsWith("/") ? folder : `${folder}/`;
				files = files.filter(
					(f) => f.path.startsWith(normalized) || f.path.startsWith(folder + "/")
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

			for (const file of files) {
				if (file.basename.toLowerCase().includes(query)) {
					matches.push(`- ${file.path} (title match)`);
					continue;
				}
				if (searchContent) {
					const content = await vault.cachedRead(file);
					if (content.toLowerCase().includes(query)) {
						matches.push(`- ${file.path} (content match)`);
					}
				}
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
