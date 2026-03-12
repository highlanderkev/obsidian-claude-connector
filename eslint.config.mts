import js from "@eslint/js";
import type { Linter } from "eslint";
import { ESLintUtils } from "@typescript-eslint/utils";
import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";
import {
	createSentenceCaseReporter,
	resolveSentenceCaseConfig,
} from "eslint-plugin-obsidianmd/dist/lib/rules/ui/sentenceCaseUtil.js";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

const ruleCreator = ESLintUtils.RuleCreator((name) => `local:${name}`);

const defaultOptions = [{}];

const METHOD_STRING_ARG_POS = {
	setName: 0,
	setButtonText: 0,
	setTooltip: 0,
	setPlaceholder: 0,
	setText: 0,
	setTitle: 0,
	addRibbonIcon: 1,
	addOption: 1,
};

function getStringFromNode(node: unknown): string | null {
	if (!node || typeof node !== "object" || !("type" in node)) {
		return null;
	}

	if (
		node.type === "TSAsExpression" ||
		node.type === "TSSatisfiesExpression" ||
		node.type === "TSNonNullExpression"
	) {
		return "expression" in node ? getStringFromNode(node.expression) : null;
	}

	if (node.type === "Literal") {
		return "value" in node && typeof node.value === "string" ? node.value : null;
	}

	if (
		node.type === "TemplateLiteral" &&
		"expressions" in node &&
		Array.isArray(node.expressions) &&
		node.expressions.length === 0 &&
		"quasis" in node &&
		Array.isArray(node.quasis)
	) {
		const quasi = node.quasis[0];
		if (!quasi || typeof quasi !== "object" || !("value" in quasi)) {
			return null;
		}
		const value = quasi.value;
		return value && typeof value === "object" && "raw" in value && typeof value.raw === "string"
			? value.raw
			: null;
	}

	return null;
}

function isPropertyWithKey(prop: unknown, keyName: string): boolean {
	if (!prop || typeof prop !== "object" || !("key" in prop)) {
		return false;
	}

	const { key } = prop;
	if (!key || typeof key !== "object" || !("type" in key)) {
		return false;
	}

	if (key.type === "Identifier") {
		return "name" in key && key.name === keyName;
	}

	if (key.type === "Literal") {
		return "value" in key && key.value === keyName;
	}

	return false;
}

const uiLabelSentenceCase = ruleCreator({
	name: "ui-label-sentence-case",
	meta: {
		type: "suggestion",
		docs: {
			description: "Enforce sentence case for explicit UI labels",
		},
		fixable: "code",
		hasSuggestions: false,
		schema: [
			{
				type: "object",
				properties: {
					mode: { type: "string", enum: ["loose", "strict"] },
					brands: { type: "array", items: { type: "string" } },
					acronyms: { type: "array", items: { type: "string" } },
					ignoreWords: { type: "array", items: { type: "string" } },
					ignoreRegex: { type: "array", items: { type: "string" } },
					allowAutoFix: { type: "boolean" },
					enforceCamelCaseLower: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		messages: {
			useSentenceCase: "Use sentence case for UI labels.",
		},
	},
	defaultOptions,
	create(context) {
		const { evaluatorOptions, allowAutoFix } = resolveSentenceCaseConfig(
			context.options
		);

		const reportIfNeeded = createSentenceCaseReporter({
			context,
			evaluatorOptions,
			allowAutoFix,
			messageId: "useSentenceCase",
			debugLabel: "local/ui-label-sentence-case",
		});

		function checkAddCommand(node: unknown): void {
			if (!node || typeof node !== "object" || !("arguments" in node)) {
				return;
			}

			const args = node.arguments;
			if (!Array.isArray(args) || args.length < 1) {
				return;
			}

			const arg = args[0];
			if (!arg || typeof arg !== "object" || !("type" in arg) || arg.type !== "ObjectExpression") {
				return;
			}

			if (!("properties" in arg) || !Array.isArray(arg.properties)) {
				return;
			}

			for (const prop of arg.properties) {
				if (!prop || typeof prop !== "object") {
					continue;
				}
				if (!("type" in prop) || prop.type !== "Property" || !isPropertyWithKey(prop, "name")) {
					continue;
				}
				if (!("value" in prop)) {
					continue;
				}
				const str = getStringFromNode(prop.value);
				if (str != null) {
					reportIfNeeded(prop.value, str);
				}
			}
		}

		return {
			CallExpression(node) {
				const callee = node.callee;

				if (callee.type === "Identifier" && callee.name === "addCommand") {
					checkAddCommand(node);
					return;
				}

				if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") {
					return;
				}

				const methodName = callee.property.name;
				if (methodName === "addCommand") {
					checkAddCommand(node);
					return;
				}

				if (!(methodName in METHOD_STRING_ARG_POS)) {
					return;
				}

				const argIndex = METHOD_STRING_ARG_POS[methodName as keyof typeof METHOD_STRING_ARG_POS];
				const arg = node.arguments[argIndex];
				if (!arg || arg.type === "SpreadElement") {
					return;
				}

				const str = getStringFromNode(arg);
				if (str != null) {
					reportIfNeeded(arg, str);
				}
			},
		};
	},
});

const localPlugin: Linter.Plugin = {
	rules: {
		"ui-label-sentence-case": uiLabelSentenceCase,
	},
};

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
						'eslint.config.mts',
						'eslint.config.js',
						'scripts/launch-inspector.mjs',
						'manifest.json'
					]
				},
				tsconfigRootDir,
				extraFileExtensions: ['.json']
			},
		},
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	// Override sentence-case to recognise project-specific acronyms and brand names.
	{
		plugins: {
			obsidianmd,
			local: localPlugin,
		},
		rules: {
			"obsidianmd/ui/sentence-case": "off",
			"local/ui-label-sentence-case": [
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
					ignoreRegex: [
						"^OAuth metadata URL$",
						"^OAuth token URL$",
						"^OAuth client ID$",
						"^OAuth client secret$",
					],
				},
			],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"eslint.config.mts",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
