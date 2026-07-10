#!/usr/bin/env node

/**
 * ============================================================================
 * sync-version.mjs — 版本同步脚本
 *
 * 在构建时自动执行：
 *   1. 读取 package.json 的 version 字段
 *   2. 同步版本到 BP/<project>/manifest.json 和 RP/<project>/manifest.json
 *
 * 用法:  node tools/sync-version.mjs
 * 依赖:  .env 文件需正确配置 PROJECT_NAME
 * ============================================================================
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 读取配置 ────────────────────────────────────────────────────
const envPath = resolve(ROOT, ".env");
if (!existsSync(envPath)) {
  console.error("  ✗ 缺少 .env 文件，跳过版本同步");
  process.exit(0);
}
const envContent = readFileSync(envPath, "utf8");
const projectName = envContent.match(/PROJECT_NAME="(.+)"/)?.[1];
if (!projectName) {
  console.error("  ✗ 无法从 .env 读取 PROJECT_NAME");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const pkgVersion = pkg.version;
const pkgName = pkg.name;

// ── 同步 manifest.json ──────────────────────────────────────────
function syncManifestVersion() {
  const baseVersion = pkgVersion.split(/[-+]/)[0];
  const versionArr = baseVersion.split(".").map(Number);

  for (const dir of [`BP/${projectName}`, `RP/${projectName}`]) {
    const manifestPath = resolve(ROOT, dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      console.log(`  ⚠ ${dir}/manifest.json 不存在，跳过`);
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    // header
    manifest.header.version = versionArr;
    const currentName = manifest.header.name;
    const baseName = currentName.replace(/\s+v?\d+\.\d+\.\d+([-+][\w.]+)?$/, "");
    manifest.header.name = `${baseName} v${pkgVersion}`;

    // modules
    if (Array.isArray(manifest.modules)) {
      for (const m of manifest.modules) {
        if (Array.isArray(m.version) && m.version.length === 3) {
          m.version = versionArr;
        }
      }
    }

    // dependencies
    if (Array.isArray(manifest.dependencies)) {
      for (const d of manifest.dependencies) {
        if (d.uuid && Array.isArray(d.version)) {
          d.version = versionArr;
        }
      }
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  ✓ ${dir}/manifest.json → version ${pkgVersion}`);
  }
}

// ── 执行 ────────────────────────────────────────────────────────
console.log(`Syncing version ${pkgVersion} …`);
syncManifestVersion();
console.log("Done.");
