// ─── 包目录探测与类型判定（文件系统逻辑，可 node 单测） ──────────
// 只读文件系统,不依赖 Minecraft 构建工具,因此可脱离游戏环境单独测试。

import * as fs from "fs";
import * as path from "path";
import {
  BEHAVIOR_PACKS_DIRECTORY,
  BEHAVIOR_PACK_MODULE_TYPES,
  LEGACY_PACK_DIRECTORY_NAMES,
  RESOURCE_PACKS_DIRECTORY,
  RESOURCE_PACK_MODULE_TYPE,
  type PackDirectories,
  type PackManifest,
  type PackType,
} from "./types";

/** 读取并解析包清单 */
export function readPackManifestFile(manifestPath: string): PackManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`包目录缺少 manifest.json:${manifestPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackManifest;
  } catch (error) {
    throw new Error(`无法解析包清单 ${manifestPath}:${String(error)}`);
  }
}

/**
 * 依据 `manifest.json` 的模块类型判定包的类型。
 *
 * 含 `data` / `script` 模块 → 行为包;含 `resources` 模块 → 资源包。
 * 两者都不含时报错。
 */
export function detectPackType(manifestPath: string): PackType {
  const manifest = readPackManifestFile(manifestPath);
  const moduleTypes = (manifest.modules ?? []).map((module) => module.type);
  if (moduleTypes.some((type) => BEHAVIOR_PACK_MODULE_TYPES.has(type))) {
    return "behavior";
  }
  if (moduleTypes.includes(RESOURCE_PACK_MODULE_TYPE)) {
    return "resource";
  }
  throw new Error(
    `无法从清单判定包类型:${manifestPath}(modules[].type 为 ${JSON.stringify(moduleTypes)},` +
      `既不含 data/script 也不含 resources)。`
  );
}

/** 收集模组根目录下某官方全名目录中可能为包目录的候选(含 manifest.json 的子目录) */
export function collectCandidatePackDirectories(projectRoot: string, containerName: string): string[] {
  const containerDirectory = path.join(projectRoot, containerName);
  if (!fs.existsSync(containerDirectory) || !fs.statSync(containerDirectory).isDirectory()) {
    return [];
  }
  const candidates: string[] = [];
  for (const entry of fs.readdirSync(containerDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const directory = path.join(containerDirectory, entry.name);
    if (fs.existsSync(path.join(directory, "manifest.json"))) {
      candidates.push(directory);
    }
  }
  return candidates;
}

/**
 * 检测遗留的缩写包目录(`BP` / `RP`)并报错。
 *
 * 仅检查模组根目录下的字面目录名:包目录内层可以叫任意名字,
 * 不参与顶层名校验。
 */
export function assertNoLegacyPackDirectories(projectRoot: string): void {
  for (const legacyName of Object.keys(LEGACY_PACK_DIRECTORY_NAMES)) {
    const officialName = LEGACY_PACK_DIRECTORY_NAMES[legacyName];
    const legacyDirectory = path.join(projectRoot, legacyName);
    if (fs.existsSync(legacyDirectory) && fs.statSync(legacyDirectory).isDirectory()) {
      throw new Error(
        `仅支持官方全名包目录 ${BEHAVIOR_PACKS_DIRECTORY} / ${RESOURCE_PACKS_DIRECTORY},` +
          `检测到 ${legacyName}/。请把 ${legacyName}/<name> 改名为 ${officialName}/<name>。`
      );
    }
  }
}

/** 在官方全名目录下按清单文件探测某类包目录;同类型命中多个时报歧义错误 */
export function detectPackDirectory(projectRoot: string, expectedType: PackType): string | undefined {
  const containerName = expectedType === "behavior" ? BEHAVIOR_PACKS_DIRECTORY : RESOURCE_PACKS_DIRECTORY;
  const matchedDirectories = collectCandidatePackDirectories(projectRoot, containerName).filter(
    (directory) => detectPackType(path.join(directory, "manifest.json")) === expectedType
  );
  const typeLabel = expectedType === "behavior" ? "行为包" : "资源包";
  if (matchedDirectories.length > 1) {
    const relativePaths = matchedDirectories.map((directory) => path.relative(projectRoot, directory)).join("、");
    throw new Error(
      `探测到多个${typeLabel}目录,无法确定使用哪一个:${relativePaths}。` +
        `请只保留一个 ${containerName}/<name> 包目录。`
    );
  }
  return matchedDirectories[0];
}

/** 解析行为包与资源包目录:只在官方全名目录下探测 */
export function resolvePackDirectories(projectRoot: string): PackDirectories {
  assertNoLegacyPackDirectories(projectRoot);
  return {
    behaviorPackDirectory: detectPackDirectory(projectRoot, "behavior"),
    resourcePackDirectory: detectPackDirectory(projectRoot, "resource"),
  };
}
