import js from "@eslint/js";
import tseslint from 'typescript-eslint';
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'eslint.config.js',
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
	globalIgnores([
		"node_modules",
		"dist",
		"eslint.config.mts",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"server/index.js",
	]),
);
