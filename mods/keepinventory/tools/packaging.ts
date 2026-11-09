import * as fs from "node:fs";
import * as path from "node:path";
import { zipTask } from "@minecraft/core-build-tasks";

/**
 * 自定义打包逻辑。
 *
 * 配置全部来自模组 `package.json`:包名与版本为必需来源,`packing` 块整体可选。
 * 包的类型以各包目录中 `manifest.json` 的 `modules[].type` 为准,目录名只作为探测线索。
 */

/** 打包模式 */
export type PackingMode = "auto" | "mcpack" | "mcaddon";

/** 包的类型 */
export type PackType = "behavior" | "resource";

/** 解析后的打包配置(全部字段都有默认值) */
export interface PackingConfiguration {
  /** 产物形态;`auto` 依据探测到的包数量自动决定 */
  mode: PackingMode;
  /** 产物输出目录(相对模组根目录) */
  output: string;
  /**
   * 最低游戏版本(三段数字)。
   *
   * 显式配置优先;缺省时由 `@minecraft/server` 依赖版本推导。
   */
  minimumEngineVersion: [number, number, number];
}

/** 探测/解析得到的包目录(绝对路径) */
export interface PackDirectories {
  behaviorPackDirectory?: string;
  resourcePackDirectory?: string;
}

/** `package.json` 中与打包相关的字段 */
interface PackageJson {
  name: string;
  version: string;
  packing?: {
    mode?: PackingMode;
    output?: string;
    minimum_engine_version?: number[];
  };
  dependencies?: Record<string, string>;
}

/** 包清单中与类型判定相关的字段 */
interface PackManifest {
  header: {
    uuid: string;
    version: number[];
    min_engine_version?: number[];
  };
  modules: Array<{
    type: string;
    version: number[];
  }>;
  dependencies?: Array<{
    uuid?: string;
    module_name?: string;
    version: number[] | string;
  }>;
}

const DEFAULT_PACKING_MODE: PackingMode = "auto";
const DEFAULT_OUTPUT_DIRECTORY = "dist/packages";
const SUPPORTED_PACKING_MODES: PackingMode[] = ["auto", "mcpack", "mcaddon"];

/** 行为包的官方顶层目录名;与 `mct` 模板一致,不可配置 */
const BEHAVIOR_PACKS_DIRECTORY = "behavior_packs";

/** 资源包的官方顶层目录名;与 `mct` 模板一致,不可配置 */
const RESOURCE_PACKS_DIRECTORY = "resource_packs";

/** 已被废弃的缩写目录名,出现时报错并提示改名 */
const LEGACY_PACK_DIRECTORY_NAMES: Record<string, string> = {
  BP: BEHAVIOR_PACKS_DIRECTORY,
  RP: RESOURCE_PACKS_DIRECTORY,
};

/** `packing` 块支持的字段名;出现其它字段时报错,避免拼写错误被静默当成「未配置」 */
const SUPPORTED_PACKING_KEYS = new Set(["mode", "output", "minimum_engine_version"]);

/** 脚本 API 模块名,最低游戏版本的推导来源 */
const SCRIPT_API_MODULE_NAME = "@minecraft/server";

/** 「脚本 API 版本 → 最低游戏版本」映射表条目 */
interface ScriptApiVersionMapping {
  /** `@minecraft/server` 的版本 */
  scriptApiVersion: string;
  /** 该脚本 API 版本可用所需的最低游戏版本 */
  minimumEngineVersion: [number, number, number];
}

/**
 * 「`@minecraft/server` 版本 → 最低游戏版本」映射表,按脚本 API 版本降序。
 *
 * Minecraft 官方不提供该对应关系的机器可读数据(脚本 API 包、`mct` 数据目录、
 * `bedrock-samples` 的 `version.json` 都不含对方版本),因此只能静态维护。
 * 数据来源与逐条验证方式见 `docs/research/minecraft-server-api-versions.md`。
 *
 * 注意:该对应关系由「同批发布」推断而来,并非严格的版本公式——例如 1.12.0 与
 * 1.13.0 同日发布,分属 1.21.20 与 1.21.30。新增条目时务必对照该文档核实。
 */
const SCRIPT_API_VERSION_MAPPINGS: ScriptApiVersionMapping[] = [
  { scriptApiVersion: "2.11.0", minimumEngineVersion: [1, 26, 60] },
  { scriptApiVersion: "2.10.0", minimumEngineVersion: [1, 26, 50] },
  { scriptApiVersion: "2.9.0", minimumEngineVersion: [1, 26, 40] },
  { scriptApiVersion: "2.8.0", minimumEngineVersion: [1, 26, 30] },
  { scriptApiVersion: "2.7.0", minimumEngineVersion: [1, 26, 20] },
  { scriptApiVersion: "2.6.0", minimumEngineVersion: [1, 26, 10] },
  { scriptApiVersion: "2.5.0", minimumEngineVersion: [1, 26, 0] },
  { scriptApiVersion: "2.4.0", minimumEngineVersion: [1, 21, 130] },
  { scriptApiVersion: "2.3.0", minimumEngineVersion: [1, 21, 120] },
  { scriptApiVersion: "2.2.0", minimumEngineVersion: [1, 21, 110] },
  { scriptApiVersion: "2.1.0", minimumEngineVersion: [1, 21, 100] },
  { scriptApiVersion: "2.0.0", minimumEngineVersion: [1, 21, 90] },
  { scriptApiVersion: "1.19.0", minimumEngineVersion: [1, 21, 80] },
  { scriptApiVersion: "1.18.0", minimumEngineVersion: [1, 21, 70] },
  { scriptApiVersion: "1.17.0", minimumEngineVersion: [1, 21, 60] },
  { scriptApiVersion: "1.16.0", minimumEngineVersion: [1, 21, 50] },
  { scriptApiVersion: "1.15.0", minimumEngineVersion: [1, 21, 40] },
  { scriptApiVersion: "1.14.0", minimumEngineVersion: [1, 21, 30] },
  { scriptApiVersion: "1.13.0", minimumEngineVersion: [1, 21, 30] },
  { scriptApiVersion: "1.12.0", minimumEngineVersion: [1, 21, 20] },
  { scriptApiVersion: "1.11.0", minimumEngineVersion: [1, 21, 0] },
];

/** 判定为行为包的模块类型 */
const BEHAVIOR_PACK_MODULE_TYPES = new Set(["data", "script"]);
/** 判定为资源包的模块类型 */
const RESOURCE_PACK_MODULE_TYPE = "resources";

/** 打包中间产物目录(相对模组根目录),用于暂存 mcaddon 内部的 mcpack */
const INTERMEDIATE_PACKAGE_DIRECTORY = path.join("temp", "packs");

/** 读取模组的 `package.json` */
function readPackageJson(projectRoot: string): PackageJson {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`找不到模组的 package.json:${packageJsonPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch (error) {
    throw new Error(`无法解析模组的 package.json ${packageJsonPath}:${String(error)}`);
  }
}

/** 取模组名:去掉 npm scope 后的包名 */
function getModuleName(packageJson: PackageJson): string {
  const segments = packageJson.name.split("/");
  return segments[segments.length - 1];
}

/**
 * 把 `package.json#version` 解析为 `[major, minor, patch]`。
 *
 * 仅接受三段数字;带预发布/构建后缀(如 `0.0.1-beta.1`)时取前三段并告警,
 * 无法解析为三段数字时报错。
 */
export function parseVersion(version: string): [number, number, number] {
  const matched = /^(\d+)\.(\d+)\.(\d+)([-+].*)?$/.exec(version);
  if (!matched) {
    throw new Error(`无法把 package.json 的 version "${version}" 解析为三段数字(major.minor.patch),打包中止。`);
  }
  if (matched[4]) {
    console.warn(
      `[packaging] version "${version}" 含后缀 "${matched[4]}",仅取前三段 ${matched[1]}.${matched[2]}.${matched[3]}。`
    );
  }
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/**
 * 把脚本 API 依赖版本规范化为三段数字。
 *
 * 依赖声明可能带范围前缀(`^2.0.0`、`~2.0.0`、`>=2.0.0`)或预发布后缀,
 * 这里去掉前缀、取前三段;带后缀时取前三段并告警。无法解析时报错。
 */
export function normalizeScriptApiVersion(dependencyVersion: string): [number, number, number] {
  const withoutRangePrefix = dependencyVersion.trim().replace(/^[\^~>=<\s]+/, "");
  const matched = /^(\d+)\.(\d+)\.(\d+)([-+].*)?$/.exec(withoutRangePrefix);
  if (!matched) {
    throw new Error(
      `无法把 ${SCRIPT_API_MODULE_NAME} 的依赖版本 "${dependencyVersion}" 解析为三段数字,` +
        `请在 package.json 的 packing.minimum_engine_version 中显式指定最低游戏版本。`
    );
  }
  if (matched[4]) {
    console.warn(
      `[packaging] ${SCRIPT_API_MODULE_NAME} 依赖版本 "${dependencyVersion}" 含后缀 "${matched[4]}",` +
        `仅取前三段 ${matched[1]}.${matched[2]}.${matched[3]}。`
    );
  }
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/** 逐段按数值比较两个三段版本号:返回负数表示左小,0 表示相等,正数表示左大 */
function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

/**
 * 在映射表中查找给定脚本 API 版本对应的最低游戏版本。
 *
 * 查找语义为「取不超过该依赖版本的最大脚本 API 版本」对应档位,
 * 使依赖写 `2.0.1` 这类补丁位差异也能落到 `2.0.0` 那一档。
 *
 * 但超出表中已覆盖区间时返回 `undefined`——**不得**把高于最高档的版本
 * 钳到最高档:那会让未收录的新版本(如 3.0.0)静默得到一个看似合理的旧值,
 * 产出版本声明偏低的行为包。低于最低档同样视为未收录。
 */
export function findMinimumEngineVersion(
  scriptApiVersion: [number, number, number]
): [number, number, number] | undefined {
  let matched: [number, number, number] | undefined;
  let matchedApiVersion: [number, number, number] | undefined;
  for (const mapping of SCRIPT_API_VERSION_MAPPINGS) {
    const candidate = parseVersion(mapping.scriptApiVersion);
    if (compareVersions(candidate, scriptApiVersion) <= 0) {
      if (!matchedApiVersion || compareVersions(candidate, matchedApiVersion) > 0) {
        matched = mapping.minimumEngineVersion;
        matchedApiVersion = candidate;
      }
    }
  }
  if (!matchedApiVersion) {
    return undefined;
  }
  // 依赖版本高于表中最高档说明尚未收录,不能沿用最高档的值。
  const highestMappedVersion = SCRIPT_API_VERSION_MAPPINGS.map((mapping) =>
    parseVersion(mapping.scriptApiVersion)
  ).reduce((highest, candidate) => (compareVersions(candidate, highest) > 0 ? candidate : highest));
  if (compareVersions(scriptApiVersion, highestMappedVersion) > 0) {
    return undefined;
  }
  return matched;
}

/**
 * 解析最低游戏版本:显式配置优先,缺省时由 `@minecraft/server` 依赖版本推导。
 *
 * 两者都不可用时抛错并指明原因,不猜测、不回落到固定值——错误的
 * `min_engine_version` 只会在低版本客户端加载后才暴露,属于用户侧故障。
 */
export function resolveMinimumEngineVersion(packageJson: PackageJson): [number, number, number] {
  const explicitValue = packageJson.packing?.minimum_engine_version;
  if (explicitValue !== undefined) {
    if (
      !Array.isArray(explicitValue) ||
      explicitValue.length !== 3 ||
      !explicitValue.every((part) => Number.isInteger(part) && part >= 0)
    ) {
      throw new Error(
        `packing.minimum_engine_version 的取值 ${JSON.stringify(explicitValue)} 不合法,` +
          `应形如 [1, 21, 90] 的三段非负整数数组。`
      );
    }
    return [explicitValue[0], explicitValue[1], explicitValue[2]] as [number, number, number];
  }

  const dependencyVersion = packageJson.dependencies?.[SCRIPT_API_MODULE_NAME];
  if (!dependencyVersion) {
    throw new Error(
      `未配置 packing.minimum_engine_version,且 package.json 中没有 ${SCRIPT_API_MODULE_NAME} 依赖,` +
        `无法推导最低游戏版本。请显式配置 packing.minimum_engine_version,如 [1, 21, 90]。`
    );
  }

  const scriptApiVersion = normalizeScriptApiVersion(dependencyVersion);
  const derived = findMinimumEngineVersion(scriptApiVersion);
  if (!derived) {
    const knownVersions = SCRIPT_API_VERSION_MAPPINGS.map((mapping) => mapping.scriptApiVersion).join("、");
    throw new Error(
      `${SCRIPT_API_MODULE_NAME} 依赖版本 ${scriptApiVersion.join(".")} 不在版本映射表中,` +
        `无法推导最低游戏版本。请显式配置 packing.minimum_engine_version,` +
        `或把该版本补进 tools/packaging.ts 的映射表(当前收录:${knownVersions})。`
    );
  }
  return derived;
}

/** 校验 `packing` 块只包含受支持的字段,避免拼写错误被静默忽略 */
function validatePackingKeys(packing: NonNullable<PackageJson["packing"]>): void {
  const unknownKeys = Object.keys(packing).filter((key) => !SUPPORTED_PACKING_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `package.json 的 packing 中出现不支持的字段:${unknownKeys.join("、")}。` +
        `可用字段:${[...SUPPORTED_PACKING_KEYS].join("、")}。`
    );
  }
}

/** 读取并校验打包配置,缺失字段回落到默认值 */
export function resolvePackingConfiguration(projectRoot: string): PackingConfiguration {
  const packageJson = readPackageJson(projectRoot);
  const packing = packageJson.packing ?? {};
  validatePackingKeys(packing);
  const mode = packing.mode ?? DEFAULT_PACKING_MODE;
  if (!SUPPORTED_PACKING_MODES.includes(mode)) {
    throw new Error(`packing.mode 的取值 "${mode}" 不受支持,只接受:${SUPPORTED_PACKING_MODES.join("、")}。`);
  }
  return {
    mode,
    output: packing.output ?? DEFAULT_OUTPUT_DIRECTORY,
    minimumEngineVersion: resolveMinimumEngineVersion(packageJson),
  };
}

/**
 * 依据 `manifest.json` 的模块类型判定包的类型。
 *
 * 含 `data` / `script` 模块 → 行为包;含 `resources` 模块 → 资源包。
 * 两者都不含时报错。
 */
export function detectPackType(manifestPath: string): PackType {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`包目录缺少 manifest.json:${manifestPath}`);
  }
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackManifest;
  } catch (error) {
    throw new Error(`无法解析包清单 ${manifestPath}:${String(error)}`);
  }
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

/** 收集模组根目录下可能为包目录的候选(最多向下两层,跳过忽略列表) */
function collectCandidatePackDirectories(projectRoot: string, containerName: string): string[] {
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
function assertNoLegacyPackDirectories(projectRoot: string): void {
  for (const [legacyName, officialName] of Object.entries(LEGACY_PACK_DIRECTORY_NAMES)) {
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
function detectPackDirectory(projectRoot: string, expectedType: PackType): string | undefined {
  const containerName = expectedType === "behavior" ? BEHAVIOR_PACKS_DIRECTORY : RESOURCE_PACKS_DIRECTORY;
  const matchedDirectories = collectCandidatePackDirectories(projectRoot, containerName).filter(
    (directory) => detectPackType(path.join(directory, "manifest.json")) === expectedType
  );
  const typeLabel = expectedType === "behavior" ? "行为包" : "资源包";
  if (matchedDirectories.length > 1) {
    const relativePaths = matchedDirectories.map((directory) => path.relative(projectRoot, directory)).join("、");
    throw new Error(
      `探测到多个${typeLabel}目录,无法确定使用哪一个:${relativePaths}。` +
        `请只保留一个${containerName}/<name> 包目录。`
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

/** 读取包清单 */
function readPackManifest(packDirectory: string): PackManifest {
  const manifestPath = path.join(packDirectory, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackManifest;
  } catch (error) {
    throw new Error(`无法解析包清单 ${manifestPath}:${String(error)}`);
  }
}

/** 写回包清单 */
function writePackManifest(packDirectory: string, manifest: PackManifest): void {
  fs.writeFileSync(path.join(packDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * 把 `package.json` 派生的声明同步进所有包清单。
 *
 * 写入 `header.version`、各 `modules[].version`、`header.min_engine_version`,
 * 并把资源包对行为包的依赖版本同步为行为包版本。
 *
 * `min_engine_version` 与 `header.version` 同属「从 package.json 派生到清单」的
 * 声明字段,因此合并在同一处一次读写,避免两个任务分别对同一批清单读改写。
 * 任一解析失败均报错中止。
 */
export function synchronizePackVersions(projectRoot: string): void {
  const packageJson = readPackageJson(projectRoot);
  const version = parseVersion(packageJson.version);
  const configuration = resolvePackingConfiguration(projectRoot);
  const minimumEngineVersion = configuration.minimumEngineVersion;
  const minimumEngineVersionSource =
    packageJson.packing?.minimum_engine_version !== undefined
      ? "显式配置 packing.minimum_engine_version"
      : `由 ${SCRIPT_API_MODULE_NAME} 依赖版本 ${packageJson.dependencies?.[SCRIPT_API_MODULE_NAME]} 推导`;
  console.log(`[packaging] 最低游戏版本 ${minimumEngineVersion.join(".")}(${minimumEngineVersionSource})`);
  const { behaviorPackDirectory, resourcePackDirectory } = resolvePackDirectories(projectRoot);

  if (!behaviorPackDirectory && !resourcePackDirectory) {
    throw new Error("模组目录下没有探测到任何行为包或资源包(需要含 manifest.json 的包目录),打包中止。");
  }

  let behaviorPackUuid: string | undefined;
  if (behaviorPackDirectory) {
    const manifest = readPackManifest(behaviorPackDirectory);
    behaviorPackUuid = manifest.header.uuid;
    manifest.header.version = version;
    manifest.header.min_engine_version = minimumEngineVersion;
    for (const module of manifest.modules) {
      module.version = version;
    }
    writePackManifest(behaviorPackDirectory, manifest);
    console.log(
      `[packaging] 已同步行为包版本与最低游戏版本 ${minimumEngineVersion.join(".")}:` +
        `${path.relative(projectRoot, behaviorPackDirectory)}`
    );
  }

  if (resourcePackDirectory) {
    const manifest = readPackManifest(resourcePackDirectory);
    manifest.header.version = version;
    manifest.header.min_engine_version = minimumEngineVersion;
    for (const module of manifest.modules) {
      module.version = version;
    }
    for (const dependency of manifest.dependencies ?? []) {
      if (behaviorPackUuid && dependency.uuid === behaviorPackUuid) {
        dependency.version = version;
      }
    }
    writePackManifest(resourcePackDirectory, manifest);
    console.log(
      `[packaging] 已同步资源包版本与最低游戏版本 ${minimumEngineVersion.join(".")}:` +
        `${path.relative(projectRoot, resourcePackDirectory)}`
    );
  }
}

/**
 * 执行一次 zipTask 并等待其完成。
 *
 * zipTask 返回的 TaskFunction 实际是一个忽略入参、直接返回 Promise 的 async 函数,
 * 因此这里同时兼容「回调完成」与「Promise 完成」两种路径。
 */
function runZipTask(
  outputFile: string,
  zipContents: Array<{ contents: string[]; targetPath?: string }>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const zip = zipTask(outputFile, zipContents);
    const completion = zip(() => {
      resolve();
    });
    if (completion && typeof (completion as PromiseLike<void>).then === "function") {
      (completion as PromiseLike<void>).then(() => resolve(), reject);
      return;
    }
    resolve();
  });
}

/** 生成行为包 `.mcpack`(包内容置于压缩包根目录,脚本产物放在 scripts/ 下) */
async function createBehaviorPackArchive(
  projectRoot: string,
  behaviorPackDirectory: string,
  outputFile: string
): Promise<void> {
  const zipContents: Array<{ contents: string[]; targetPath?: string }> = [{ contents: [behaviorPackDirectory] }];
  const scriptOutputDirectory = path.join(projectRoot, "dist", "scripts");
  if (fs.existsSync(scriptOutputDirectory)) {
    zipContents.push({ contents: [scriptOutputDirectory], targetPath: "scripts" });
  }
  await runZipTask(outputFile, zipContents);
}

/** 按 `packing.mode` 产出产物 */
export function createPackagesByMode(projectRoot: string) {
  return async function createPackages(): Promise<void> {
    const packageJson = readPackageJson(projectRoot);
    const moduleName = getModuleName(packageJson);
    const versionText = parseVersion(packageJson.version).join(".");
    const configuration = resolvePackingConfiguration(projectRoot);
    const { behaviorPackDirectory, resourcePackDirectory } = resolvePackDirectories(projectRoot);

    const packCount = (behaviorPackDirectory ? 1 : 0) + (resourcePackDirectory ? 1 : 0);
    if (packCount === 0) {
      throw new Error("模组目录下没有探测到任何行为包或资源包(需要含 manifest.json 的包目录),打包中止。");
    }

    const resolvedMode: PackingMode =
      configuration.mode === "auto" ? (packCount === 2 ? "mcaddon" : "mcpack") : configuration.mode;
    if (resolvedMode === "mcaddon" && packCount < 2) {
      throw new Error(`packing.mode 为 "mcaddon" 但只探测到 ${packCount} 个包;单个包应使用 "mcpack" 模式。打包中止。`);
    }

    const outputDirectory = path.resolve(projectRoot, configuration.output);
    fs.mkdirSync(outputDirectory, { recursive: true });

    const behaviorPackFile = path.join(outputDirectory, `${moduleName}-v${versionText}_bp.mcpack`);
    const resourcePackFile = path.join(outputDirectory, `${moduleName}-v${versionText}_rp.mcpack`);
    const addonFile = path.join(outputDirectory, `${moduleName}-v${versionText}.mcaddon`);

    if (resolvedMode === "mcpack") {
      if (behaviorPackDirectory) {
        await createBehaviorPackArchive(projectRoot, behaviorPackDirectory, behaviorPackFile);
        console.log(`[packaging] 已产出行为包:${path.relative(projectRoot, behaviorPackFile)}`);
      }
      if (resourcePackDirectory) {
        await runZipTask(resourcePackFile, [{ contents: [resourcePackDirectory] }]);
        console.log(`[packaging] 已产出资源包:${path.relative(projectRoot, resourcePackFile)}`);
      }
      return;
    }

    // mcaddon:先在中间目录生成两个 mcpack,再合并为单个 .mcaddon,
    // 使输出目录中只留下 .mcaddon,不残留中间 mcpack。
    if (!behaviorPackDirectory || !resourcePackDirectory) {
      throw new Error('packing.mode 为 "mcaddon" 时必须同时探测到行为包与资源包,打包中止。');
    }
    const intermediateDirectory = path.resolve(projectRoot, INTERMEDIATE_PACKAGE_DIRECTORY);
    fs.mkdirSync(intermediateDirectory, { recursive: true });
    const intermediateBehaviorPackFile = path.join(intermediateDirectory, path.basename(behaviorPackFile));
    const intermediateResourcePackFile = path.join(intermediateDirectory, path.basename(resourcePackFile));

    await createBehaviorPackArchive(projectRoot, behaviorPackDirectory, intermediateBehaviorPackFile);
    await runZipTask(intermediateResourcePackFile, [{ contents: [resourcePackDirectory] }]);
    await runZipTask(addonFile, [{ contents: [intermediateBehaviorPackFile, intermediateResourcePackFile] }]);
    fs.rmSync(intermediateDirectory, { recursive: true, force: true });
    console.log(`[packaging] 已产出附加内容包:${path.relative(projectRoot, addonFile)}`);
  };
}
