# Claude Connector for Obsidian

Connect your Obsidian vault to [Claude](https://claude.ai) via
[Model Context Protocol (MCP)](https://modelcontextprotocol.io) Custom Connectors.

Claude can then read, search, create, and update notes directly inside your vault
during a conversation — without you having to copy-paste anything.

---

## Features

- **MCP server built-in** — the plugin runs a local HTTPS MCP server that Claude connects to.
- **No external plugins required** — generates and manages its own self-signed TLS
  certificate so Claude custom connectors can connect over HTTPS without any additional setup.
- **Vault tools exposed to Claude**:

  |Tool|Description|
  |----|-----------|
  |`list_notes`|List notes, optionally filtered by folder|
  |`read_note`|Read the full content of a note|
  |`search_notes`|Search notes by title or content|
  |`create_note`|Create a new note|
  |`update_note`|Overwrite, append to, or prepend to a note|

- **Vault resources** — every Markdown file is also exposed as an MCP resource with URI
  `obsidian://note/<path>`.
- **Desktop only** — uses Node.js networking APIs available in Obsidian Desktop (Electron).

---

## Quick start

### 1. Install the plugin

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<YourVault>/.obsidian/plugins/obsidian-claude-connector/
```

Reload Obsidian and enable **Claude Connector** under **Settings → Community plugins**.

### 2. Enable the MCP server

Go to **Settings → Claude Connector** and toggle **Enable MCP server** on.

The plugin will automatically generate a self-signed TLS certificate and start a local
HTTPS server. The **Connection info** section will appear with:

- **SSE endpoint URL** — paste this into Claude's connector setup.
- **OAuth metadata URL** — optional discovery document for OAuth settings.
- **OAuth token URL** — endpoint Claude calls to get an access token.
- **OAuth client ID / client secret** — credentials Claude sends to the token endpoint.

### 3. Trust the TLS certificate

Because the plugin uses a self-signed certificate, your system must trust it before
Claude can connect.

1. Click **Open Certificate** in the **TLS certificate** section of the plugin settings.
2. Your OS certificate manager will open — follow the prompts to add and trust the certificate:

   |OS|Steps|
   |--|-----|
   |**macOS**|In Keychain Access, double-click the certificate → expand **Trust** → set **"When using this certificate"** to **Always Trust**|
   |**Windows**|In the import wizard, choose **Trusted Root Certification Authorities** as the certificate store|
   |**Linux (Chrome/Chromium)**|Settings → Privacy → Manage certificates → Authorities → Import|

> **One-time step.** The certificate is stored in the plugin's data and reused across
> Obsidian restarts. You only need to trust it again if you click **Regenerate Certificate**.

### 4. Add a Custom Connector in Claude

1. Open Claude → **Settings** → **Integrations** → **Add custom connector**.
1. Enter a name (e.g. *My Obsidian Vault*).
1. Paste the **SSE endpoint URL**.
1. In OAuth settings, configure:

   - Metadata URL (optional): the plugin's **OAuth metadata URL**
   - Token URL: the plugin's **OAuth token URL**
   - Client ID: the plugin's **OAuth client ID**
   - Client secret: the plugin's **OAuth client secret**
   - Grant type: `client_credentials`

1. Save and connect.

---

## Configuration

|Setting|Description|Default|
|-------|-----------|-------|
|Enable MCP server|Start/stop the HTTPS server|off|
|Port|Server port|27124|
|Access token|Bearer token returned by OAuth and used on MCP requests|—|
|OAuth client ID|OAuth client ID for connector authentication|—|
|OAuth client secret|OAuth client secret for connector authentication|—|
|Open Certificate|Open the TLS cert in your OS certificate manager|—|
|Regenerate Certificate|Generate a new cert (requires re-trusting)|—|

---

## Security notes

- The server only binds to `127.0.0.1` (localhost) — it is **never** accessible from
  outside your machine.
- The self-signed TLS certificate is generated locally and stored in your plugin's data
  file. The private key never leaves your machine.
- Claude authenticates with OAuth client credentials (`client_id` + `client_secret`) at
  the local token endpoint (`/oauth/token`).
- The plugin also exposes OAuth metadata at
  `/.well-known/oauth-authorization-server` for automatic discovery.
- For broader client compatibility, the same metadata is also available at
  `/.well-known/openid-configuration`.
- MCP requests must include `Authorization: Bearer <token>`, where `<token>` is the
  access token returned by that OAuth exchange.
- No vault data is sent anywhere by the plugin itself. Data flows only between Obsidian
  and whichever Claude client connects to the local server.

---

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
npm run lint    # ESLint
npm run inspector # launch MCP Inspector UI
npm run inspector:launch # launch Inspector with prefilled connection options
```

### Test with MCP Inspector

Use the MCP Inspector to test tools and resources exposed by this plugin.

1. Start the plugin server in Obsidian (**Settings → Claude Connector** → enable **MCP server**).
2. Launch Inspector from this project:

```bash
npm run inspector
```

3. In Inspector, connect using values from the plugin's **Connection info for Claude** panel:

  - Transport/endpoint URL: use Inspector transport `http` with the plugin endpoint URL (for example `https://127.0.0.1:27124/mcp`)
  - OAuth metadata URL (optional): **OAuth metadata URL**
  - OAuth token URL: **OAuth token URL**
  - OAuth client ID: **OAuth client ID**
  - OAuth client secret: **OAuth client secret**
  - Grant type: `client_credentials`

The plugin serves MCP over Streamable HTTP, and MCP Inspector exposes that mode as `http`, not `streamable-http`. The launcher accepts `OBSIDIAN_MCP_TRANSPORT=sse` for backwards compatibility only, and automatically converts it to Inspector transport `http` internally because the plugin server does not use the deprecated SSE transport.

If your OS has not trusted the plugin certificate yet, complete the certificate trust step first in the plugin settings.

### Inspector launcher (secure by default)

Use `npm run inspector:launch` to start Inspector with a prefilled server URL.

By default, the launcher does **not** pass an `Authorization` header on the command line so bearer tokens are not exposed in process arguments (for example via `ps`).

If you want convenience over this protection for local debugging, set `OBSIDIAN_INSPECTOR_PREFILL_AUTH=1` to opt in to prefilled Authorization headers.

Supported environment variables:

- `OBSIDIAN_MCP_URL` (default: `https://127.0.0.1:27124/mcp`)
- `OBSIDIAN_MCP_TRANSPORT` (default: `http`; `streamable-http` and `sse` are accepted aliases)
- `OBSIDIAN_INSPECTOR_PREFILL_AUTH=1` (optional; prefill `Authorization` header, exposes token in process args)
- `OBSIDIAN_BEARER_TOKEN` (optional, direct token)
- `OBSIDIAN_OAUTH_TOKEN_URL` (optional, defaults from `OBSIDIAN_MCP_URL`)
- `OBSIDIAN_OAUTH_CLIENT_ID` (optional, used to fetch token)
- `OBSIDIAN_OAUTH_CLIENT_SECRET` (optional, used to fetch token)
- `OBSIDIAN_INSECURE_TLS=1` (deprecated; retained only for backwards compatibility. Prefer `npm run inspector:launch:insecure` instead; this flag’s behavior may be removed in a future release.)

If you hit a self-signed certificate error in Inspector, either trust the plugin certificate in your OS first, or use:

```bash
npm run inspector:launch:insecure
```

First-run one-liner (OAuth + insecure TLS):

```bash
OBSIDIAN_MCP_URL="https://127.0.0.1:27124/mcp" OBSIDIAN_OAUTH_CLIENT_ID="<client-id>" OBSIDIAN_OAUTH_CLIENT_SECRET="<client-secret>" npm run inspector:launch:insecure
```

Prefill Authorization header explicitly (less secure, but convenient):

```bash
OBSIDIAN_MCP_URL="https://127.0.0.1:27124/mcp" OBSIDIAN_INSPECTOR_PREFILL_AUTH=1 OBSIDIAN_OAUTH_CLIENT_ID="<client-id>" OBSIDIAN_OAUTH_CLIENT_SECRET="<client-secret>" npm run inspector:launch:insecure
```

Example:

```bash
OBSIDIAN_MCP_URL="https://127.0.0.1:27124/mcp" \
OBSIDIAN_OAUTH_CLIENT_ID="<client-id>" \
OBSIDIAN_OAUTH_CLIENT_SECRET="<client-secret>" \
npm run inspector:launch
```

---

## References

- [MCP specification](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports)
- [Claude Custom Connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Building custom connectors via remote MCP](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers)
- [Obsidian API docs](https://docs.obsidian.md)
