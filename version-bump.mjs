import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Bump version in manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");
