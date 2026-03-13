import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/mcp-server-factory.js";

function getToolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
	const parsedResult = CallToolResultSchema.safeParse(result);
	if (!parsedResult.success) {
		return "";
	}
	const textBlock = parsedResult.data.content.find(
		(item): item is Extract<(typeof parsedResult.data.content)[number], { type: "text" }> =>
			item.type === "text"
	);
	return textBlock?.text ?? "";
}

describe("mcp server factory", () => {
	let vaultDir: string;
	let server: ReturnType<typeof createMcpServer> | undefined;
	let client: Client | undefined;

	beforeEach(async () => {
		vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-mcp-factory-test-"));
		await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
		await fs.writeFile(path.join(vaultDir, "notes", "existing.md"), "existing", "utf8");

		server = createMcpServer(vaultDir);
		client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	});

	afterEach(async () => {
		const closeOperations: Promise<void>[] = [];
		if (client) {
			closeOperations.push(client.close());
		}
		if (server) {
			closeOperations.push(server.close());
		}
		await Promise.allSettled(closeOperations);
		await fs.rm(vaultDir, { recursive: true, force: true });
	});

	it("registers expected MCP tools", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		const tools = await client.listTools();
		const names = tools.tools.map((tool) => tool.name).sort();
		expect(names).toEqual([
			"create_note",
			"list_notes",
			"read_note",
			"search_notes",
			"update_note",
		]);
	});

	it("executes registered tools through MCP client", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		const createResult = await client.callTool({
			name: "create_note",
			arguments: { path: "notes/new-note", content: "hello from tool" },
		});
		expect(getToolText(createResult)).toContain("Created note: notes/new-note.md");

		const readResult = await client.callTool({
			name: "read_note",
			arguments: { path: "notes/new-note.md" },
		});
		expect(getToolText(readResult)).toContain("hello from tool");
	});

	it("returns an error result for unknown tools", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		const result = await client.callTool({
			name: "missing_tool",
			arguments: {},
		});

		const parsedResult = CallToolResultSchema.parse(result);
		expect(parsedResult.isError).toBe(true);
		expect(getToolText(parsedResult)).toContain("Tool missing_tool not found");
	});

	it("applies folder filtering through list_notes", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		await fs.mkdir(path.join(vaultDir, "projects"), { recursive: true });
		await fs.writeFile(path.join(vaultDir, "projects", "alpha.md"), "a", "utf8");
		await fs.writeFile(path.join(vaultDir, "projects", "beta.md"), "b", "utf8");
		await fs.writeFile(path.join(vaultDir, "scratch.md"), "c", "utf8");

		const result = await client.callTool({
			name: "list_notes",
			arguments: { folder: "projects" },
		});

		const text = getToolText(result);
		expect(text).toContain("Found 2 note(s):");
		expect(text).toContain("projects/alpha.md");
		expect(text).toContain("projects/beta.md");
		expect(text).not.toContain("scratch.md");
	});

	it("applies result limits through list_notes", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		await fs.writeFile(path.join(vaultDir, "a.md"), "a", "utf8");
		await fs.writeFile(path.join(vaultDir, "b.md"), "b", "utf8");
		await fs.writeFile(path.join(vaultDir, "c.md"), "c", "utf8");

		const result = await client.callTool({
			name: "list_notes",
			arguments: { limit: 2 },
		});

		const text = getToolText(result);
		expect(text).toContain("Found 2 note(s):");
		expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
	});

	it("lists and reads note resources", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		await fs.writeFile(path.join(vaultDir, "notes", "Roadmap 2026.md"), "goals", "utf8");

		const resources = await client.listResources();
		const roadmapResource = resources.resources.find((resource) =>
			resource.uri.includes("Roadmap%202026.md")
		);
		expect(roadmapResource).toBeDefined();

		const uri = roadmapResource?.uri;
		if (!uri) {
			throw new Error("Expected roadmap resource URI");
		}

		const readResourceResult = await client.readResource({ uri });
		const textContent = readResourceResult.contents.find(
			(content): content is Extract<(typeof readResourceResult.contents)[number], { text: string }> =>
				"text" in content
		);

		expect(textContent?.text).toBe("goals");
		expect(textContent?.uri).toBe(uri);
	});

	it("rejects resource path traversal", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		await expect(
			client.readResource({ uri: "obsidian://note/..%2Foutside.md" })
		).rejects.toThrow(/Invalid path/);
	});

	it("rejects reads for missing resources", async () => {
		if (!client) {
			throw new Error("Client was not initialized");
		}

		await expect(
			client.readResource({ uri: "obsidian://note/notes%2Fmissing.md" })
		).rejects.toThrow(/File not found/);
	});
});
