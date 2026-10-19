---
name: obsidian-claude-connector
description: >-
  Connect, search, read, create, and update Markdown notes in an Obsidian vault
  via the Obsidian Claude Connector MCP server. Use when querying knowledge bases,
  reading vault documents, organizing notes, capturing daily thoughts, or automating
  Obsidian note workflows.
---

# Obsidian Claude Connector Skill

Use this skill to interact with an [Obsidian](https://obsidian.md) vault through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). This allows reading, searching, creating, and updating notes directly in an Obsidian vault without needing Obsidian to be running or installing third-party Obsidian plugins.

---

## 1. Setup & MCP Configuration

### Build the MCP Server

Ensure the server is built before starting:

```bash
npm install
npm run build   # Compiles to server/index.js
```

### Server Configuration

The connector requires the `VAULT_PATH` environment variable pointing to the absolute path of the target Obsidian vault directory.

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/path/to/obsidian-claude-connector/server/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/obsidian/vault"
      }
    }
  }
}
```

#### Antigravity / Claude Code / Stdio MCP Clients
```bash
claude mcp add obsidian node /path/to/obsidian-claude-connector/server/index.js -e VAULT_PATH=/path/to/your/obsidian/vault
```

Alternatively, install the prebuilt `.mcpb` bundle directly via Claude Desktop:
```bash
npm run pack   # Generates obsidian-claude-connector.mcpb
```

---

## 2. Available Tools

The MCP server exposes five primary tools:

### `list_notes`
List notes in the vault, optionally filtered by folder.

* **Parameters:**
  * `folder` *(string, optional)*: Subfolder path to filter by (e.g., `"Projects"`, `"Daily Notes"`).
  * `limit` *(number, optional)*: Maximum number of notes to return (default: `50`).
* **Behavior:** Skips hidden folders (e.g., `.obsidian/`, `.trash/`). Returns relative note paths.

### `read_note`
Read the full Markdown content of a specific note.

* **Parameters:**
  * `path` *(string, required)*: Vault-relative path to the note (e.g., `"Projects/Roadmap.md"` or `"Inbox/Idea.md"`).
* **Behavior:** Returns `# <Title>`, path header, and the complete note content. Returns an error if the note does not exist or escapes the vault.

### `search_notes`
Find notes by title match or deep content inspection.

* **Parameters:**
  * `query` *(string, required)*: Keyword or phrase to search for (case-insensitive).
  * `search_content` *(boolean, optional)*: If `true`, searches both titles and full note text. Defaults to `false` (title search only) for speed.
* **Behavior:** Titles are matched first. Content searches run with bounded concurrency across vault files.

### `create_note`
Create a new Markdown note in the vault.

* **Parameters:**
  * `path` *(string, required)*: Vault-relative path for the note (e.g., `"Meeting Notes/2026-10-19 Sprint Planning"` or `"Inbox/New Idea.md"`). Automatically appends `.md` if omitted.
  * `content` *(string, required)*: Initial Markdown content of the note.
* **Behavior:** Automatically creates parent directories if they don't exist. Safely aborts with an error if a note already exists at that path to prevent accidental overwrites (use `update_note` instead).

### `update_note`
Modify the content of an existing note.

* **Parameters:**
  * `path` *(string, required)*: Vault-relative path to the existing note.
  * `content` *(string, required)*: Content to write or append/prepend.
  * `mode` *(string, optional)*:
    * `"overwrite"` *(default)*: Replaces the entire note content with `content`.
    * `"append"`: Adds two newlines and appends `content` to the end of the note.
    * `"prepend"`: Places `content` at the top, followed by two newlines and existing content.
* **Behavior:** Returns an error if the note does not exist.

---

## 3. Resources

* **URI Template:** `obsidian://note/{+path}`
* **MIME Type:** `text/markdown`
* Allows MCP clients to subscribe to or directly inspect any note in the vault as an MCP Resource.

---

## 4. Best Practices & Workflow Patterns

### Note Discovery Before Creation
Always check if a note or relevant topic already exists before creating a new one:
1. Run `search_notes` with `query="<Topic>"` (and `search_content: true` if searching for concepts or keywords).
2. If notes exist, review them with `read_note` to decide whether to append to an existing note or create a new linked note.

### Preserving Note History & Append Workflow
When logging daily updates, research notes, or meeting logs:
* Prefer `update_note` with `mode: "append"` rather than overwriting.
* When adding sections, include Markdown headers with timestamps or headings:
  ```markdown
  ### 2026-10-19 Update
  - Accomplished X
  - Blocked on Y
  ```

### Obsidian-Friendly Markdown Formatting
* **Wikilinks:** Use `[[Note Name]]` or `[[Folder/Note Name|Alias]]` to link between vault notes.
* **Frontmatter:** Include YAML frontmatter when creating structured notes:
  ```markdown
  ---
  title: Sprint Planning
  date: 2026-10-19
  tags:
    - sprint
    - planning
  ---
  ```
* **Tags:** Use standard tags `#tag` or frontmatter tags for categorization.

### Safety & Sandboxing
* All file paths must be vault-relative.
* Directory traversal (e.g. `../` or absolute filesystem paths) is strictly blocked by the server.
* Hidden configuration directories like `.obsidian` are omitted from listings and searches to protect vault settings and caches.

---

## 5. Direct Filesystem Fallback

If the MCP server is not currently connected as an active MCP tool in the agent's environment, but direct filesystem access is available:
* The agent can read and write files directly in `VAULT_PATH` following the same rules:
  - Markdown files use `.md` extension.
  - Skip `.obsidian/` and other dot-directories.
  - Never write files outside `VAULT_PATH`.

