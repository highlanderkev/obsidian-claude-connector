# Obsidian Claude Connector

Connect your [Obsidian](https://obsidian.md) vault to [Claude Desktop](https://claude.ai/download)
via [Model Context Protocol (MCP)](https://modelcontextprotocol.io) as a single-click installable
**MCP Bundle** (`.mcpb`).

Claude can read, search, create, and update notes directly inside your vault during a conversation
— without you having to copy-paste anything, and without Obsidian needing to be running.

---

## Features

- **Single-click install** — packaged as an MCPB bundle so Claude Desktop can install it without
  any manual configuration.
- **No extra server required** — runs as a local stdio process managed by Claude Desktop.
- **Direct filesystem access** — reads and writes Markdown files directly from your vault
  directory. No Obsidian installation or plugin API needed at runtime.
- **Vault tools exposed to Claude**:

  | Tool | Description |
  |------|-------------|
  | `list_notes` | List notes, optionally filtered by folder |
  | `read_note` | Read the full content of a note |
  | `search_notes` | Search notes by title or content |
  | `create_note` | Create a new note |
  | `update_note` | Overwrite, append to, or prepend to a note |

- **Vault resources** — every Markdown file is also exposed as an MCP resource with URI
  `obsidian://note/<path>`.
- **Path-traversal protection** — all file operations are validated to stay within the
  vault directory.

---

## Install

### Option A — Install a release build

1. Download the latest `.mcpb` file from the
   [Releases](https://github.com/highlanderkev/obsidian-claude-connector/releases) page.
2. Open the `.mcpb` file with Claude Desktop for macOS or Windows.
3. Claude Desktop will show an installation dialog. Select your Obsidian vault directory
   in the **Vault directory** field.
4. Click **Install** — done.

### Option B — Build and install from source

```bash
git clone https://github.com/highlanderkev/obsidian-claude-connector.git
cd obsidian-claude-connector
npm install
npm run pack   # builds server/index.js then runs mcpb pack
```

Open the resulting `.mcpb` file with Claude Desktop.

---

## Configuration

The bundle exposes one user-configurable setting that Claude Desktop will prompt for
during installation:

| Setting | Description | Required |
|---------|-------------|----------|
| Vault directory | Root folder of your Obsidian vault. All note paths are relative to this directory. | Yes |

---

## Security notes

- The server process runs **locally** on your machine, started by Claude Desktop.
- All file operations are sandboxed to the configured vault directory. Paths containing
  `..` segments that would escape the vault are rejected with an error.
- No vault data is sent anywhere by the server itself. Data flows only between the server
  process and the Claude Desktop client over stdio.

---

## Development

```bash
npm install
npm run dev     # watch mode (rebuilds on source changes)
npm run build   # production build (outputs server/index.js)
npm run pack    # build then pack into a .mcpb bundle
npm run lint    # ESLint
npm run inspector # launch MCP Inspector to test the server interactively
```

### Test with MCP Inspector

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to test
tools and resources interactively.

1. Build the project and run the server directly:

   ```bash
   npm run build
   VAULT_PATH=/path/to/your/vault node server/index.js
   ```

2. In another terminal, launch MCP Inspector:

   ```bash
   npm run inspector
   ```

3. Connect to the running server using the stdio transport, pointing at
   `node server/index.js` with `VAULT_PATH` set.

---

## Project structure

```
src/
  server/
    index.ts              # Entry point — creates MCP server, connects stdio transport
  mcp/
    mcp-server-factory.ts # Registers MCP tools and resources
    tools.ts              # Tool implementations (list, read, search, create, update)
server/
  index.js                # Built output (gitignored; produced by npm run build)
manifest.json             # MCPB bundle manifest (manifest_version: "0.3")
esbuild.config.mjs        # Build configuration
```

---

## References

- [MCP specification](https://modelcontextprotocol.io/specification)
- [MCPB — MCP Bundles spec and tooling](https://github.com/modelcontextprotocol/mcpb)
- [Building desktop extensions with MCPB](https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb)
