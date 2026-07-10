#!/usr/bin/env node
/**
 * @yinxe/toolkit version sync CLI (standalone JS — no TS dependency).
 * Run via: node packages/toolkit/bin/sync-version.mjs [project-dir]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

const projectDir = process.argv[2] || process.cwd();
const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));
const version = pkg.version;
const baseVersion = version.split(/[-+]/)[0];
const versionArr = baseVersion.split(".").map(Number);

for (const dir of ["BP", "RP"]) {
  const manifestDir = resolve(projectDir, dir);
  if (!existsSync(manifestDir)) continue;
  for (const item of readdirSync(manifestDir)) {
    const manifestPath = resolve(manifestDir, item, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.header.version = versionArr;
    if (manifest.modules) {
      manifest.modules = manifest.modules.map((m) =>
        Array.isArray(m.version) ? { ...m, version: versionArr } : m
      );
    }
    if (manifest.dependencies) {
      manifest.dependencies = manifest.dependencies.map((d) =>
        d.uuid && Array.isArray(d.version) ? { ...d, version: versionArr } : d
      );
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
}
console.log("✓ Version synced");
