// ─── 共享打包包的对外入口 ──────────────────────────────────────
// 模组只需在 just.config.ts 中导入这里导出的内容并编排任务,
// 不应在自身目录内保留打包逻辑的实现。

export type {
  PackDirectories,
  PackageJson,
  PackageJsonAuthor,
  PackageJsonRepository,
  PackingConfiguration,
  PackingMode,
  PackManifest,
  PackType,
} from "./types";
export {
  BEHAVIOR_PACKS_DIRECTORY,
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_PACKING_MODE,
  INTERMEDIATE_PACKAGE_DIRECTORY,
  LEGACY_PACK_DIRECTORY_NAMES,
  RESOURCE_PACKS_DIRECTORY,
  SCRIPT_API_MODULE_NAME,
  SUPPORTED_PACKING_KEYS,
  SUPPORTED_PACKING_MODES,
} from "./types";

export { getModuleName, readPackageJson, resolvePackingConfiguration, resolvePackingConfigurationFrom, validatePackingKeys } from "./configuration";
export {
  assertNoLegacyPackDirectories,
  collectCandidatePackDirectories,
  detectPackDirectory,
  detectPackType,
  readPackManifestFile,
  resolvePackDirectories,
} from "./discovery";
export { normalizeRepositoryUrl, resolvePackDescription, resolvePackDisplayName } from "./metadata";
export { createPackagesByMode, synchronizePackVersions } from "./packs";
export {
  compareVersions,
  findMinimumEngineVersion,
  normalizeScriptApiVersion,
  parseVersion,
  resolveMinimumEngineVersion,
  SCRIPT_API_VERSION_MAPPINGS,
} from "./versions";
export type { ScriptApiVersionMapping } from "./versions";
