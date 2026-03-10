import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	// Override sentence-case to recognise project-specific acronyms and brand names.
	{
		plugins: { obsidianmd },
		rules: {
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					enforceCamelCaseLower: true,
					acronyms: [
						"API", "HTTP", "HTTPS", "URL", "DNS", "TCP", "IP",
						"SSH", "TLS", "SSL", "FTP", "SFTP", "SMTP",
						"JSON", "XML", "HTML", "CSS", "PDF", "CSV", "YAML",
						"SQL", "PNG", "JPG", "JPEG", "GIF", "SVG",
						"2FA", "MFA", "OAuth", "JWT", "LDAP", "SAML",
						"SDK", "IDE", "CLI", "GUI", "CRUD", "REST", "SOAP",
						"CPU", "GPU", "RAM", "SSD", "USB",
						"UI", "OK", "RSS", "S3", "WebDAV", "ID",
						"UUID", "GUID", "SHA", "MD5", "ASCII",
						"UTF-8", "UTF-16", "DOM", "CDN", "FAQ", "AI", "ML",
						// Project-specific
						"MCP", "SSE",
					],
					brands: [
						"iOS", "iPadOS", "macOS", "Windows", "Android", "Linux",
						"Obsidian", "Obsidian Sync", "Obsidian Publish",
						"Google Drive", "Dropbox", "OneDrive", "iCloud Drive",
						"YouTube", "Slack", "Discord", "Telegram",
						"WhatsApp", "Twitter", "X", "Readwise", "Zotero",
						"GitHub",
						// Project-specific
						"Claude", "Claude Connector",
					],
				},
			],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
