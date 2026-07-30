#!/usr/bin/env node
/**
 * @yinxe/toolkit version sync CLI.
 *
 * Reads package.json's mcbe config and syncs version + packName to all
 * linked BP/RP manifests. Supports both the new config format:
 *
 *   "mcbe": { "packName": "显示名", "bp": "BP/MockPlayer" }
 *   "mcbe": { "packName": "显示名", "bp": "BP/SmartWarehouse", "rp": "RP/SmartWarehouse" }
 *
 * And the legacy format:
 *
 *   "mcbe": { "bpDir": "MockPlayer" }
 *
 * Usage: node sync-version.mjs [project-dir]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";

const projectDir = process.argv[2] || process.cwd();
const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));
const version = pkg.version;
const baseVersion = version.split(/[-+]/)[0];
const versionArr = baseVersion.split(".").map(Number);

const mcbe = pkg.mcbe || {};

// ── Determine manifest paths ────────────────────────────────────
const manifestPaths = [];

if (mcbe.bp || mcbe.rp) {
  // New format: explicit paths
  const packName = mcbe.packName || pkg.productName || pkg.name;

  for (const key of ["bp", "rp"]) {
    const dir = mcbe[key];
    if (!dir) continue;
    const manifestPath = resolve(projectDir, dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    manifestPaths.push(manifestPath);
  }
} else if (mcbe.bpDir) {
  // Legacy format: BP/<bpDir>/
  for (const dir of ["BP", "RP"]) {
    const manifestDir = resolve(projectDir, dir);
    if (!existsSync(manifestDir)) continue;
    for (const item of readdirSync(manifestDir)) {
      const manifestPath = resolve(manifestDir, item, "manifest.json");
      if (existsSync(manifestPath)) manifestPaths.push(manifestPath);
    }
  }
}

// ── Update manifests ────────────────────────────────────────────
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.header.version = versionArr;

  // Update display name
  if (mcbe.packName && manifest.header.name !== undefined) {
    manifest.header.name = `${mcbe.packName} v${baseVersion}`;
  }

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

console.log(`✓ Synced ${versionArr.join(".")} → ${manifestPaths.map(p => p.replace(projectDir, ".")).join(", ")}`);
