#!/usr/bin/env node
// 核对本地模拟产出的发布资产：确认 release/ 下存在本次模组本次版本的三类最终产物，
// 且没有把中间产物、旧版本或其它模组的文件混进待发布清单。
//
// 用法：node tools/release-local/check-assets.mjs <模组目录名>
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const mod = process.argv[2];

if (!mod) {
  console.error("用法：node tools/release-local/check-assets.mjs <模组目录名>");
  process.exit(2);
}

const manifestPath = join(repositoryRoot, "mods", mod, "package.json");
if (!existsSync(manifestPath)) {
  console.error(`✗ 模组名 ${mod} 不存在：未找到 mods/${mod}/package.json`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// 产物文件名使用去掉 scope 的模块名，与 @mc-toolchain/mod-packaging 的取值方式一致
const name = String(manifest.name).replace(/^@[^/]+\//, "");
const version = String(manifest.version);
const productName = manifest.productName ?? "";

const expectedFileNames = [
  `${name}-v${version}_bp.mcpack`,
  `${name}-v${version}_rp.mcpack`,
  `${name}-v${version}.mcaddon`,
];

const releaseDirectory = join(repositoryRoot, "release");
if (!existsSync(releaseDirectory)) {
  console.error(`✗ release/ 不存在：本地模拟没有产出任何打包结果`);
  process.exit(1);
}

const entries = readdirSync(releaseDirectory);
const matched = expectedFileNames.filter((fileName) => entries.includes(fileName));

if (matched.length === 0) {
  console.error(`✗ release/ 下没有 ${name}-v${version} 的 .mcpack 或 .mcaddon 产物`);
  console.error(`  当前 release/ 内容：${entries.join(", ") || "（空）"}`);
  process.exit(1);
}

// 中间产物不应出现在待发布清单里（mcaddon 模式的中间 mcpack 落在模组的 temp/packs 内层目录）
const intermediate = entries.filter((entry) => entry.includes("temp") || entry.includes("packs"));
if (intermediate.length > 0) {
  console.error(`✗ release/ 中出现疑似中间产物：${intermediate.join(", ")}`);
  process.exit(1);
}

// 提示其它模组的残留（不算失败：本地 release/ 不纳入版本控制，历史打包会留下旧文件）
const others = entries.filter(
  (entry) => !matched.includes(entry) && /\.(mcpack|mcaddon)$/.test(entry) && !entry.startsWith(`${name}-v${version}`)
);

console.log("== 产物核对 ==");
console.log(`模组：${name}  版本：${version}`);
console.log(`Release 标题：${productName} ${version}${productName ? "" : "（缺少 productName，发布步骤会失败）"}`);
console.log(`tag：${name}@${version}`);
console.log("待发布资产（保持英文原名）：");
for (const fileName of matched) {
  console.log(`  ✓ ${fileName}`);
}
if (others.length > 0) {
  console.log(`release/ 中另有其它产物（不会被打包上传）：${others.join(", ")}`);
}
console.log("✓ 资产核对通过");
