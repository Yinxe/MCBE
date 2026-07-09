#!/usr/bin/env node

/**
 * ============================================================================
 * init-project.mjs — Minecraft Bedrock Add-on 项目初始化脚本
 *
 * 用法:  node tools/init-project.mjs <new-project-name>
 * 示例:  node tools/init-project.mjs my-cool-addon
 *
 * 功能:
 *   1. 重命名 BP/<old>/ → BP/<new>/
 *   2. 重命名 RP/<old>/ → RP/<new>/
 *   3. 更新 .env 中的 PROJECT_NAME
 *   4. 更新 package.json 的 name 和 description
 *   5. 自动生成 BP/RP manifest.json 中所有 UUID
 *   6. 更新 GitHub Actions 中的项目名称引用
 * ============================================================================
 */

import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 询问确认 ────────────────────────────────────────────────────
function ask(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── 替换 manifest.json 中的 UUID（按结构解析，非字符串替换） ──────
function updateManifestUUIDs(manifestPath, uuidMap) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // header.uuid
  if (manifest.header) {
    manifest.header.uuid = uuidMap.header;
    if (Array.isArray(manifest.header.version)) {
      manifest.header.version = [0, 0, 1];
    }
  }

  // modules — 只重置被替换 UUID 的 module 的版本
  if (Array.isArray(manifest.modules)) {
    manifest.modules.forEach((mod, i) => {
      if (uuidMap.modules && uuidMap.modules[i]) {
        mod.uuid = uuidMap.modules[i];
        mod.version = [0, 0, 1];
      }
    });
  }

  // dependencies — 只更新有 uuid 的依赖（跳过 module_name 依赖）
  if (Array.isArray(manifest.dependencies)) {
    manifest.dependencies.forEach((dep, i) => {
      if (dep.uuid && uuidMap.dependencies && uuidMap.dependencies[i]) {
        dep.uuid = uuidMap.dependencies[i];
        dep.version = [0, 0, 1];
      }
    });
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

// ── 主逻辑 ──────────────────────────────────────────────────────
async function main() {
  const newName = process.argv[2];
  if (!newName) {
    console.error("用法: node tools/init-project.mjs <new-project-name>");
    console.error("示例: node tools/init-project.mjs my-cool-addon");
    process.exit(1);
  }

  // 验证项目名格式
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(newName)) {
    console.error("错误: 项目名只允许小写字母、数字、连字符 (-) 和下划线 (_)");
    process.exit(1);
  }

  // ── 读取当前配置 ──────────────────────────────────────────────
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) throw new Error("缺少 .env 文件");
  const envContent = readFileSync(envPath, "utf8");
  const currentName = envContent.match(/PROJECT_NAME="(.+)"/)?.[1];
  if (!currentName) throw new Error("无法从 .env 读取 PROJECT_NAME");

  if (currentName === newName) {
    console.log(`  当前 PROJECT_NAME 已是 "${newName}"，无需修改。`);
    process.exit(0);
  }

  console.log(`\n  当前项目: ${currentName}`);
  console.log(`  新项目:   ${newName}\n`);

  const answer = await ask("  确认初始化? (y/N) ");
  if (answer !== "y" && answer !== "yes") {
    console.log("  已取消。");
    process.exit(0);
  }

  console.log("\n  ── 开始初始化 ────────────────────────────────────\n");

  // ── 1. 重命名 BP/ ─────────────────────────────────────────────
  const bpOld = resolve(ROOT, "BP", currentName);
  const bpNew = resolve(ROOT, "BP", newName);
  if (existsSync(bpOld)) {
    renameSync(bpOld, bpNew);
    console.log(`  ✓ BP/${currentName}/ → BP/${newName}/`);
  } else {
    console.log(`  ⚠ BP/${currentName}/ 不存在，跳过`);
  }

  // ── 2. 重命名 RP/ ─────────────────────────────────────────────
  const rpOld = resolve(ROOT, "RP", currentName);
  const rpNew = resolve(ROOT, "RP", newName);
  if (existsSync(rpOld)) {
    renameSync(rpOld, rpNew);
    console.log(`  ✓ RP/${currentName}/ → RP/${newName}/`);
  } else {
    console.log(`  ⚠ RP/${currentName}/ 不存在，跳过`);
  }

  // ── 3. 更新 .env ─────────────────────────────────────────────
  const newEnv = envContent.replace(
    /PROJECT_NAME="(.+)"/,
    `PROJECT_NAME="${newName}"`
  );
  writeFileSync(envPath, newEnv);
  console.log(`  ✓ .env updated PROJECT_NAME="${newName}"`);

  // ── 4. 更新 package.json ─────────────────────────────────────
  const pkgPath = resolve(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = newName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ package.json updated name="${newName}"`);

  // ── 5. 更新 manifest.json 的 name 字段 ────────────────────────
  for (const dir of [`BP/${newName}`, `RP/${newName}`]) {
    const manifestPath = resolve(ROOT, dir, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.header.name = manifest.header.name.replace(/^[^\s]+/, newName);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`  ✓ ${dir}/manifest.json name 已更新`);
    }
  }

  // ── 6. 生成 UUID 并更新 manifest.json ─────────────────────────
  const bpHeaderUuid = randomUUID();
  const bpDataUuid = randomUUID();
  const rpHeaderUuid = randomUUID();

  const bpManifestPath = resolve(ROOT, "BP", newName, "manifest.json");
  const rpManifestPath = resolve(ROOT, "RP", newName, "manifest.json");

  if (existsSync(bpManifestPath)) {
    updateManifestUUIDs(bpManifestPath, {
      header: bpHeaderUuid,
      modules: [bpDataUuid],
      dependencies: [rpHeaderUuid], // RP UUID
    });
    console.log(`  ✓ BP/${newName}/manifest.json UUID 已刷新`);
  }

  if (existsSync(rpManifestPath)) {
    updateManifestUUIDs(rpManifestPath, {
      header: rpHeaderUuid,
      modules: [randomUUID()],
      dependencies: [bpHeaderUuid], // BP UUID
    });
    console.log(`  ✓ RP/${newName}/manifest.json UUID 已刷新`);
  }

  // ── 6. 更新 GitHub Actions ────────────────────────────────────
  const workflowDir = resolve(ROOT, ".github", "workflows");
  if (existsSync(workflowDir)) {
    for (const file of readdirSync(workflowDir)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const filePath = resolve(workflowDir, file);
      let content = readFileSync(filePath, "utf8");
      if (content.includes("PROJECT_NAME")) {
        content = content.replace(
          /PROJECT_NAME:.*?['"][^'"]*['"]/,
          `PROJECT_NAME: '${newName}'`
        );
        writeFileSync(filePath, content);
        console.log(`  ✓ .github/workflows/${file} 已更新`);
      }
    }
  }

  // ── 完成 ───────────────────────────────────────────────────────
  console.log(`\n  ──────────────────────────────────────────────────`);
  console.log(`  ✅ 初始化完成！\n`);
  console.log(`  下一步:`);
  console.log(`    npm install`);
  console.log(`    npm run build\n`);
}

main().catch((err) => {
  console.error("初始化失败:", err.message);
  process.exit(1);
});
