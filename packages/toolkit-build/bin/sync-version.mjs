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
import { resolve, dirname, join } from "path";

const projectDir = process.argv[2] || process.cwd();
const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));
const version = pkg.version;
const baseVersion = version.split(/[-+]/)[0];
const versionArr = baseVersion.split(".").map(Number);

const mcbe = pkg.mcbe || {};

// ── 作者/仓库信息注入（根 package.json 的 author 全部字段 + repository） ──
function findRootPkg(fromDir) {
  let dir = resolve(fromDir);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    const hasPkg = existsSync(pkgPath);
    const isRoot =
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      (hasPkg &&
        (() => {
          const p = JSON.parse(readFileSync(pkgPath, "utf8"));
          return p.author && p.repository;
        })());
    if (isRoot) return hasPkg ? JSON.parse(readFileSync(pkgPath, "utf8")) : undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function buildAuthorBlock(fromDir) {
  const root = findRootPkg(fromDir);
  if (!root || !root.author || typeof root.author !== "object") return undefined;
  const lines = [];
  for (const [key, label] of [["name", "作者"], ["email", "邮箱"], ["url", "主页"], ["group", "QQ群"]]) {
    const v = root.author[key];
    if (v !== undefined && v !== null && String(v) !== "") lines.push(`${label}：${v}`);
  }
  if (root.repository && root.repository.url) lines.push(`仓库：${root.repository.url}`);
  return lines.length ? lines.join("\n") : undefined;
}

/** 去掉 description 中旧的作者信息块（幂等，重复构建不叠加）。 */
function stripAuthorBlock(desc) {
  const idx = desc.indexOf("作者：");
  if (idx < 0) return desc;
  return desc.slice(0, idx).replace(/\n+$/, "");
}

const authorBlock = buildAuthorBlock(projectDir);

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

  // 注入作者/仓库信息到 description（\n 换行，含 QQ 群）
  if (authorBlock) {
    const base = stripAuthorBlock(manifest.header.description ?? "");
    manifest.header.description = base ? `${base}\n${authorBlock}` : authorBlock;
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
