import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool, getMarkdownFiles } from "../../src/mcp/tools.js";

type ToolResult = Awaited<ReturnType<typeof executeTool>>;
type TextContent = Extract<ToolResult["content"][number], { type: "text" }>;

function getTextContent(result: ToolResult): string {
	const textBlock = result.content.find(
		(item): item is TextContent => item.type === "text"
	);
	return textBlock?.text ?? "";
}

describe("mcp tools", () => {
	let vaultDir: string;

	beforeEach(async () => {
		vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-connector-test-"));
	});

	afterEach(async () => {
		await fs.rm(vaultDir, { recursive: true, force: true });
	});

	it("lists markdown files recursively and skips hidden directories", async () => {
		await fs.mkdir(path.join(vaultDir, "projects"), { recursive: true });
		await fs.mkdir(path.join(vaultDir, ".obsidian"), { recursive: true });
		await fs.writeFile(path.join(vaultDir, "root.md"), "root", "utf8");
		await fs.writeFile(path.join(vaultDir, "projects", "plan.md"), "plan", "utf8");
		await fs.writeFile(path.join(vaultDir, ".obsidian", "ignored.md"), "ignored", "utf8");

		const files = await getMarkdownFiles(vaultDir);
		expect(files.sort()).toEqual(["projects/plan.md", "root.md"]);
	});

	it("creates and reads a note", async () => {
		const createResult = await executeTool(
			"create_note",
			{ path: "notes/idea", content: "hello world" },
			vaultDir
		);
		expect(createResult.isError).toBeUndefined();
		expect(getTextContent(createResult)).toContain("Created note: notes/idea.md");

		const readResult = await executeTool("read_note", { path: "notes/idea.md" }, vaultDir);
		expect(readResult.isError).toBeUndefined();
		expect(getTextContent(readResult)).toContain("hello world");
	});

	it("rejects path traversal attempts", async () => {
		const result = await executeTool("read_note", { path: "../outside.md" }, vaultDir);
		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Invalid path");
	});

	it("supports append and prepend update modes", async () => {
		await executeTool("create_note", { path: "daily.md", content: "middle" }, vaultDir);

		await executeTool(
			"update_note",
			{ path: "daily.md", content: "top", mode: "prepend" },
			vaultDir
		);
		await executeTool(
			"update_note",
			{ path: "daily.md", content: "bottom", mode: "append" },
			vaultDir
		);

		const readResult = await executeTool("read_note", { path: "daily.md" }, vaultDir);
		const content = getTextContent(readResult);
		expect(content).toContain("top");
		expect(content).toContain("middle");
		expect(content).toContain("bottom");
	});

	it("searches by title and content", async () => {
		await executeTool(
			"create_note",
			{ path: "Projects/MCP Plan.md", content: "alpha" },
			vaultDir
		);
		await executeTool(
			"create_note",
			{ path: "scratch.md", content: "contains beta value" },
			vaultDir
		);

		const titleResult = await executeTool(
			"search_notes",
			{ query: "mcp", search_content: false },
			vaultDir
		);
		expect(getTextContent(titleResult)).toContain("title match");

		const contentResult = await executeTool(
			"search_notes",
			{ query: "beta", search_content: true },
			vaultDir
		);
		expect(getTextContent(contentResult)).toContain("content match");
	});
});
