import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function text(t: string): { type: "text"; text: string } {
	return { type: "text", text: t };
}

function ok(t: string): CallToolResult {
	return { content: [text(t)] };
}

function err(t: string): CallToolResult {
	return { content: [text(t)], isError: true };
}

/**
 * Returns true when `resolvedFull` is inside `resolvedVault` (or equal to it).
 * Uses `nodePath.resolve` to normalise both paths so that `..` segments cannot
 * escape the vault root.
 */
function isInsideVault(resolvedVault: string, resolvedFull: string): boolean {
	return (
		resolvedFull === resolvedVault ||
		resolvedFull.startsWith(resolvedVault + nodePath.sep)
	);
}

/**
 * Recursively collects all `.md` file paths relative to `vaultPath`.
 * Hidden directories (names starting with ".") are skipped.
 */
async function getMarkdownFiles(vaultPath: string, dir = vaultPath): Promise<string[]> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = nodePath.join(dir, entry.name);
		if (entry.isDirectory()) {
			const sub = await getMarkdownFiles(vaultPath, fullPath);
			files.push(...sub);
		} else if (entry.name.endsWith(".md")) {
			files.push(nodePath.relative(vaultPath, fullPath).replace(/\\/g, "/"));
		}
	}
	return files;
}

function basename(filePath: string): string {
	return nodePath.basename(filePath, ".md");
}

export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	vaultPath: string
): Promise<CallToolResult> {
	const resolvedVault = nodePath.resolve(vaultPath);

	switch (name) {
		case "list_notes": {
			const folder = args["folder"] as string | undefined;
			const limit = (args["limit"] as number | undefined) ?? 50;
			let files = await getMarkdownFiles(resolvedVault);

			if (folder) {
				const normalized = folder.endsWith("/") ? folder : `${folder}/`;
				files = files.filter((f) => f.startsWith(normalized));
			}

			files = files.slice(0, limit);

			if (files.length === 0) {
				return ok("No notes found.");
			}
			return ok(`Found ${files.length} note(s):\n${files.map((f) => `- ${f}`).join("\n")}`);
		}

		case "read_note": {
			const filePath = args["path"] as string;
			const fullPath = nodePath.resolve(resolvedVault, filePath);
			if (!isInsideVault(resolvedVault, fullPath)) {
				return err(`Invalid path: path must be relative to the vault`);
			}
			let content: string;
			try {
				content = await fs.readFile(fullPath, "utf8");
			} catch {
				return err(`Note not found: ${filePath}`);
			}
			return ok(`# ${basename(filePath)}\nPath: ${filePath}\n\n---\n\n${content}`);
		}

		case "search_notes": {
			const query = (args["query"] as string).toLowerCase();
			const searchContent = (args["search_content"] as boolean) ?? false;
			const files = await getMarkdownFiles(resolvedVault);
			const matches: string[] = [];
			const contentSearchFiles: string[] = [];

			// First, collect title matches and build a list of files that need
			// content-based searching (processed with limited concurrency below).
			for (const file of files) {
				if (basename(file).toLowerCase().includes(query)) {
					matches.push(`- ${file} (title match)`);
					continue;
				}
				if (searchContent) {
					contentSearchFiles.push(file);
				}
			}

			// Perform content search with a small, concurrency-limited worker pool.
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
						try {
							const content = await fs.readFile(
								nodePath.join(resolvedVault, file),
								"utf8"
							);
							if (content.toLowerCase().includes(query)) {
								matches.push(`- ${file} (content match)`);
							}
						} catch {
							// Skip unreadable files
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
			const fullPath = nodePath.resolve(resolvedVault, notePath);

			if (!isInsideVault(resolvedVault, fullPath)) {
				return err(`Invalid path: path must be relative to the vault`);
			}

			try {
				await fs.access(fullPath);
				return err(
					`A note already exists at "${notePath}". Use update_note to modify it.`
				);
			} catch {
				// File does not exist — proceed
			}

			// Ensure parent directories exist
			await fs.mkdir(nodePath.dirname(fullPath), { recursive: true });
			await fs.writeFile(fullPath, content, "utf8");
			return ok(`Created note: ${notePath}`);
		}

		case "update_note": {
			const filePath = args["path"] as string;
			const newContent = args["content"] as string;
			const mode = (args["mode"] as string) ?? "overwrite";
			const fullPath = nodePath.resolve(resolvedVault, filePath);

			if (!isInsideVault(resolvedVault, fullPath)) {
				return err(`Invalid path: path must be relative to the vault`);
			}

			let existing: string;
			try {
				existing = await fs.readFile(fullPath, "utf8");
			} catch {
				return err(`Note not found: ${filePath}`);
			}

			let finalContent = newContent;
			if (mode === "append") {
				finalContent = `${existing}\n\n${newContent}`;
			} else if (mode === "prepend") {
				finalContent = `${newContent}\n\n${existing}`;
			}

			await fs.writeFile(fullPath, finalContent, "utf8");
			return ok(`Updated note: ${filePath}`);
		}

		default:
			return err(`Unknown tool: ${name}`);
	}
}
