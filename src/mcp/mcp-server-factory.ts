import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { z } from "zod";
import { executeTool, getMarkdownFiles } from "./tools.js";

/**
 * Creates and returns a fully-configured McpServer for the given vault path.
 * Called once per stdio connection; the server communicates over stdin/stdout.
 */
export function createMcpServer(vaultPath: string): McpServer {
	const resolvedVault = nodePath.resolve(vaultPath);

	const server = new McpServer(
		{
			name: "obsidian-claude-connector",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
				resources: {},
			},
		}
	);

	// ── Tools ───────────────────────────────────────────────────────────────

	server.registerTool(
		"list_notes",
		{
			description:
				"List notes in the Obsidian vault, optionally filtered by folder path.",
			inputSchema: {
				folder: z
					.string()
					.optional()
					.describe(
						'Optional folder path to filter by (e.g. "Projects" or "Daily Notes").'
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum number of notes to return (default: 50)."),
			},
		},
		(args) => executeTool("list_notes", args, resolvedVault)
	);

	server.registerTool(
		"read_note",
		{
			description:
				"Read the full Markdown contents of a note by its vault path.",
			inputSchema: {
				path: z
					.string()
					.describe(
						'Path to the note relative to the vault root (e.g. "Projects/My Project.md").'
					),
			},
		},
		(args) => executeTool("read_note", args, resolvedVault)
	);

	server.registerTool(
		"search_notes",
		{
			description:
				"Search for notes whose title or content contains a query string.",
			inputSchema: {
				query: z.string().describe("Text to search for."),
				search_content: z
					.boolean()
					.optional()
					.describe(
						"Also search inside note contents (slower). Default: false."
					),
			},
		},
		(args) => executeTool("search_notes", args, resolvedVault)
	);

	server.registerTool(
		"create_note",
		{
			description: "Create a new Markdown note in the vault.",
			inputSchema: {
				path: z
					.string()
					.describe(
						'Vault-relative path for the new note (e.g. "Ideas/Brainstorm.md"). The .md extension is added automatically if omitted.'
					),
				content: z
					.string()
					.describe("Markdown content for the new note."),
			},
		},
		(args) => executeTool("create_note", args, resolvedVault)
	);

	server.registerTool(
		"update_note",
		{
			description: "Update or append/prepend content to an existing note.",
			inputSchema: {
				path: z
					.string()
					.describe("Vault-relative path to the note."),
				content: z
					.string()
					.describe("New content (or the text to append/prepend)."),
				mode: z
					.enum(["overwrite", "append", "prepend"])
					.optional()
					.describe(
						'How to apply the content: "overwrite" (default), "append", or "prepend".'
					),
			},
		},
		(args) => executeTool("update_note", args, resolvedVault)
	);

	// ── Resources ────────────────────────────────────────────────────────────

	server.registerResource(
		"vault-notes",
		new ResourceTemplate("obsidian://note/{+path}", {
			list: async () => {
				const files = await getMarkdownFiles(resolvedVault);
				return {
					resources: files.map((f) => ({
						uri: `obsidian://note/${encodeURIComponent(f)}`,
						name: nodePath.basename(f, ".md"),
						description: `Vault note: ${f}`,
						mimeType: "text/markdown",
					})),
				};
			},
		}),
		{ description: "Obsidian vault notes", mimeType: "text/markdown" },
		async (uri) => {
			const raw = uri.toString().replace(/^obsidian:\/\/note\//, "");
			const filePath = decodeURIComponent(raw);
			const fullPath = nodePath.resolve(resolvedVault, filePath);

			if (
				fullPath !== resolvedVault &&
				!fullPath.startsWith(resolvedVault + nodePath.sep)
			) {
				throw new Error(`Invalid path: ${filePath}`);
			}

			let content: string;
			try {
				content = await fs.readFile(fullPath, "utf8");
			} catch {
				throw new Error(`File not found: ${filePath}`);
			}

			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "text/markdown",
						text: content,
					},
				],
			};
		}
	);

	return server;
}
