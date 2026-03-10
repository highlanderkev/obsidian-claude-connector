// Side-effect import makes this file a module so the declaration below is
// treated as a module augmentation rather than an ambient module.
import "obsidian";

// Extend Obsidian App to expose the internal plugins map (stable in practice).
declare module "obsidian" {
	interface App {
		plugins: {
			plugins: Record<string, unknown>;
			enabledPlugins: Set<string>;
		};
	}
}
