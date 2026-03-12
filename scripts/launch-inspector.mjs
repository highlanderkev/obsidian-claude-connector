import { spawn } from "node:child_process";

/** @param {string | undefined} value @param {string} fallback */
function envOrDefault(value, fallback) {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/** @param {string} requestedTransport */
function normalizeInspectorTransport(requestedTransport) {
	const normalized = requestedTransport.trim().toLowerCase();

	if (normalized === "http" || normalized === "streamable-http") {
		return "http";
	}

	if (normalized === "sse") {
		console.warn(
			"Warning: OBSIDIAN_MCP_TRANSPORT=sse is deprecated for this plugin. Using Inspector transport 'http' against the Streamable HTTP endpoint instead."
		);
		return "http";
	}

	throw new Error(
		`Unsupported OBSIDIAN_MCP_TRANSPORT value: ${requestedTransport}. Use 'http' (preferred), 'streamable-http', or 'sse'.`
	);
}

/** @param {string} mcpUrl */
function getDefaultTokenUrl(mcpUrl) {
	const url = new URL(mcpUrl);
	if (url.pathname.endsWith("/mcp")) {
		url.pathname = url.pathname.slice(0, -4) + "/oauth/token";
	} else {
		url.pathname = "/oauth/token";
	}
	url.search = "";
	url.hash = "";
	return url.toString();
}

/** @param {string} tokenUrl @param {string} clientId @param {string} clientSecret */
async function fetchAccessToken(tokenUrl, clientId, clientSecret) {
	const authHeader = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString(
		"base64"
	);

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${authHeader}`,
		},
		body: new URLSearchParams({ grant_type: "client_credentials" }),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Token request failed (${response.status}): ${body || response.statusText}`
		);
	}

	const json = /** @type {unknown} */ (await response.json());
	if (!json || typeof json !== "object" || !("access_token" in json)) {
		throw new Error("Token response did not include access_token");
	}

	const accessToken = json.access_token;
	if (typeof accessToken !== "string") {
		throw new Error("Token response access_token is not a string");
	}

	return accessToken;
}

async function main() {
	const mcpUrl = envOrDefault(
		process.env.OBSIDIAN_MCP_URL,
		"https://127.0.0.1:27124/mcp"
	);
	const requestedTransport = envOrDefault(
		process.env.OBSIDIAN_MCP_TRANSPORT,
		"http"
	);
	const transport = normalizeInspectorTransport(requestedTransport);
	const tokenUrl = envOrDefault(
		process.env.OBSIDIAN_OAUTH_TOKEN_URL,
		getDefaultTokenUrl(mcpUrl)
	);
	const clientId = process.env.OBSIDIAN_OAUTH_CLIENT_ID;
	const clientSecret = process.env.OBSIDIAN_OAUTH_CLIENT_SECRET;
	const hasMismatchedOAuthCredentials = Boolean(clientId) !== Boolean(clientSecret);
	// Backwards-compatible alias: a mismatched state means exactly one of clientId/clientSecret is set.
	const hasPartialOAuthCredentials = hasMismatchedOAuthCredentials;
	const insecureTls = process.env.OBSIDIAN_INSECURE_TLS === "1";
	const prefillAuthHeader = process.env.OBSIDIAN_INSPECTOR_PREFILL_AUTH === "1";

	if (insecureTls) {
		// Disable TLS certificate verification for this process (and spawned children).
		// This is insecure and should only be used for local development or testing.
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
		console.warn(
			"Warning: OBSIDIAN_INSECURE_TLS=1 is set. TLS certificate verification has been disabled for this launcher and its child processes. This is insecure and should only be used for local development."
		);
	}

	let bearerToken;

	if (prefillAuthHeader) {
		bearerToken =
			typeof process.env.OBSIDIAN_BEARER_TOKEN === "string"
				? process.env.OBSIDIAN_BEARER_TOKEN
				: undefined;

		if (!bearerToken && hasPartialOAuthCredentials) {
			throw new Error(
				"Set both OBSIDIAN_OAUTH_CLIENT_ID and OBSIDIAN_OAUTH_CLIENT_SECRET, or set OBSIDIAN_BEARER_TOKEN."
			);
		}

		if (!bearerToken && clientId && clientSecret) {
			bearerToken = await fetchAccessToken(tokenUrl, clientId, clientSecret);
			console.log(`Fetched OAuth token from ${tokenUrl}`);
		}

		if (!bearerToken) {
			throw new Error(
				[
					"No authentication provided for OBSIDIAN_INSPECTOR_PREFILL_AUTH=1.",
					"Set OBSIDIAN_BEARER_TOKEN, or set OBSIDIAN_OAUTH_CLIENT_ID and OBSIDIAN_OAUTH_CLIENT_SECRET.",
					"Example:",
					"OBSIDIAN_INSPECTOR_PREFILL_AUTH=1 OBSIDIAN_OAUTH_CLIENT_ID=\"<client-id>\" OBSIDIAN_OAUTH_CLIENT_SECRET=\"<client-secret>\" npm run inspector:launch",
				].join(" ")
			);
		}
	} else {
		console.log(
			"Auth header prefill is disabled by default to avoid exposing bearer tokens in process arguments."
		);
		console.log(
			"Set OBSIDIAN_INSPECTOR_PREFILL_AUTH=1 if you explicitly want the launcher to pass an Authorization header."
		);
	}

	/** @type {string[]} */
	const args = [
		"exec",
		"@modelcontextprotocol/inspector",
		"--",
		"--transport",
		transport,
		"--server-url",
		mcpUrl,
	];

	if (prefillAuthHeader && typeof bearerToken === "string") {
		args.push("--header", `Authorization: Bearer ${bearerToken}`);
	}

	console.log(
		`Starting MCP Inspector with ${transport.toUpperCase()} transport -> ${mcpUrl}`
	);

	const child = spawn("npm", args, {
		stdio: "inherit",
		env: process.env,
		shell: process.platform === "win32",
	});

	child.on("exit", (code) => {
		process.exit(typeof code === "number" ? code : 1);
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to launch MCP Inspector: ${message}`);
	process.exit(1);
});
