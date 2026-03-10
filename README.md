# Claude Connector for Obsidian

Connect your Obsidian vault to [Claude](https://claude.ai) via
[Model Context Protocol (MCP)](https://modelcontextprotocol.io) Custom Connectors.

Claude can then read, search, create, and update notes directly inside your vault
during a conversation — without you having to copy-paste anything.

---

## Features

- **MCP server built-in** — the plugin runs a local MCP server that Claude connects to.
- **Two operating modes**:
  - **Integrated** (recommended) — registers MCP endpoints on the
    [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin
    if it is installed, inheriting its HTTPS setup and API key.
  - **Standalone** — runs its own plain-HTTP server (port 3333 by default) when
    obsidian-local-rest-api is not present.
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
- **Desktop only** — uses Node.js networking APIs available in Obsidian Desktop (Electron).

---

## Quick start

### 1. Install the plugin

Copy `main.js`, `manifest.json`, and `styles.css` into:

```
<YourVault>/.obsidian/plugins/obsidian-claude-connector/
```

Reload Obsidian and enable **Claude Connector** under **Settings → Community plugins**.

### 2. (Optional but recommended) Install obsidian-local-rest-api

Install the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
community plugin. Claude Connector will automatically register its MCP endpoints on the
Local REST API's HTTPS server, giving you a more secure connection.

### 3. Enable the MCP server

Go to **Settings → Claude Connector** and toggle **Enable MCP server** on.

The **Connection info** section will appear with:
- **SSE endpoint URL** — paste this into Claude's connector setup.
- **Bearer token** — the API key Claude must supply.

### 4. Add a Custom Connector in Claude

1. Open Claude → **Settings** → **Integrations** → **Add custom connector**.
2. Enter a name (e.g. *My Obsidian Vault*).
3. Paste the **SSE endpoint URL**.
4. Add an `Authorization` header: `Bearer <token>`.
5. Save and connect.

---

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Enable MCP server | Start/stop the server | off |
| Prefer Local REST API | Use obsidian-local-rest-api when available | on |
| Port | Standalone server port | 3333 |
| Auth token | Bearer token for standalone server (auto-generated) | — |

---

## Security notes

- The server only binds to `127.0.0.1` (localhost) — it is **never** accessible from
  outside your machine.
- When using the Local REST API integration, authentication is handled by the Local REST
  API's own API key and HTTPS certificate.
- In standalone mode, all requests must include the correct `Authorization: Bearer <token>`
  header. The token is auto-generated on first install; use **Regenerate** if you need to
  rotate it.
- No vault data is sent anywhere by the plugin itself. Data flows only between Obsidian and
  whichever Claude client connects to the local server.

---

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
npm run lint    # ESLint
```

---

## References

- [MCP specification](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports)
- [Claude Custom Connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Building custom connectors via remote MCP](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)
- [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Obsidian API docs](https://docs.obsidian.md)
