import * as fs from "fs";
import * as path from "path";
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
  /** 显式指定的行为包目录(相对模组根目录),缺省时按清单文件探测 */
  behaviorPacks?: string;
  /** 显式指定的资源包目录(相对模组根目录),缺省时按清单文件探测 */
  resourcePacks?: string;
  /** 产物输出目录(相对模组根目录) */
  output: string;
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
    behavior_packs?: string;
    resource_packs?: string;
    output?: string;
  };
}

/** 包清单中与类型判定相关的字段 */
interface PackManifest {
  header: {
    uuid: string;
    version: number[];
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

/** 探测包目录时跳过的目录名,它们不是附加内容包 */
const PACK_DIRECTORY_IGNORELIST = new Set(["node_modules", "dist", "lib", "out", "temp", ".git", ".vscode"]);

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

/** 读取并校验打包配置,缺失字段回落到默认值 */
export function resolvePackingConfiguration(projectRoot: string): PackingConfiguration {
  const packageJson = readPackageJson(projectRoot);
  const packing = packageJson.packing ?? {};
  const mode = packing.mode ?? DEFAULT_PACKING_MODE;
  if (!SUPPORTED_PACKING_MODES.includes(mode)) {
    throw new Error(`packing.mode 的取值 "${mode}" 不受支持,只接受:${SUPPORTED_PACKING_MODES.join("、")}。`);
  }
  return {
    mode,
    behaviorPacks: packing.behavior_packs,
    resourcePacks: packing.resource_packs,
    output: packing.output ?? DEFAULT_OUTPUT_DIRECTORY,
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
function collectCandidatePackDirectories(projectRoot: string): string[] {
  const candidates: string[] = [];
  const considerDirectory = (directory: string): void => {
    if (fs.existsSync(path.join(directory, "manifest.json"))) {
      candidates.push(directory);
    }
  };
  const isIgnored = (name: string): boolean => name.startsWith(".") || PACK_DIRECTORY_IGNORELIST.has(name);

  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnored(entry.name)) {
      continue;
    }
    const topLevelDirectory = path.join(projectRoot, entry.name);
    considerDirectory(topLevelDirectory);
    // 兼容 BP/<name>/manifest.json 这类「分类目录 + 包目录」两层布局
    for (const nested of fs.readdirSync(topLevelDirectory, { withFileTypes: true })) {
      if (nested.isDirectory() && !isIgnored(nested.name)) {
        considerDirectory(path.join(topLevelDirectory, nested.name));
      }
    }
  }
  return candidates;
}

/** 按显式配置解析某类包目录,并校验其存在且清单类型相符 */
function resolveExplicitPackDirectory(
  projectRoot: string,
  configuredPath: string,
  expectedType: PackType,
  configurationKey: string
): string {
  const absolutePath = path.resolve(projectRoot, configuredPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`${configurationKey} 指向的目录不存在:${configuredPath}(解析为 ${absolutePath})。`);
  }
  const detectedType = detectPackType(path.join(absolutePath, "manifest.json"));
  if (detectedType !== expectedType) {
    throw new Error(
      `${configurationKey} 指向的目录 ${configuredPath} 的清单判定为` +
        `${detectedType === "behavior" ? "行为包" : "资源包"},与配置的类型不符。`
    );
  }
  return absolutePath;
}

/** 按清单文件探测某类包目录;同类型命中多个时报歧义错误 */
function detectPackDirectory(
  projectRoot: string,
  expectedType: PackType,
  configurationKey: string
): string | undefined {
  const matchedDirectories = collectCandidatePackDirectories(projectRoot).filter(
    (directory) => detectPackType(path.join(directory, "manifest.json")) === expectedType
  );
  const typeLabel = expectedType === "behavior" ? "行为包" : "资源包";
  if (matchedDirectories.length > 1) {
    const relativePaths = matchedDirectories.map((directory) => path.relative(projectRoot, directory)).join("、");
    throw new Error(
      `探测到多个${typeLabel}目录,无法确定使用哪一个:${relativePaths}。` +
        `请用 package.json 的 packing.${configurationKey} 显式指定。`
    );
  }
  return matchedDirectories[0];
}

/** 解析行为包与资源包目录:显式配置优先,否则按清单文件探测 */
export function resolvePackDirectories(projectRoot: string, configuration: PackingConfiguration): PackDirectories {
  const behaviorPackDirectory = configuration.behaviorPacks
    ? resolveExplicitPackDirectory(projectRoot, configuration.behaviorPacks, "behavior", "packing.behavior_packs")
    : detectPackDirectory(projectRoot, "behavior", "behavior_packs");
  const resourcePackDirectory = configuration.resourcePacks
    ? resolveExplicitPackDirectory(projectRoot, configuration.resourcePacks, "resource", "packing.resource_packs")
    : detectPackDirectory(projectRoot, "resource", "resource_packs");
  return { behaviorPackDirectory, resourcePackDirectory };
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
 * 把 `package.json#version` 同步进所有包清单。
 *
 * 写入 `header.version`、各 `modules[].version`,并把资源包对行为包的依赖版本
 * 同步为行为包版本。版本号不可解析时报错中止。
 */
export function synchronizePackVersions(projectRoot: string): void {
  const packageJson = readPackageJson(projectRoot);
  const version = parseVersion(packageJson.version);
  const configuration = resolvePackingConfiguration(projectRoot);
  const { behaviorPackDirectory, resourcePackDirectory } = resolvePackDirectories(projectRoot, configuration);

  if (!behaviorPackDirectory && !resourcePackDirectory) {
    throw new Error("模组目录下没有探测到任何行为包或资源包(需要含 manifest.json 的包目录),打包中止。");
  }

  let behaviorPackUuid: string | undefined;
  if (behaviorPackDirectory) {
    const manifest = readPackManifest(behaviorPackDirectory);
    behaviorPackUuid = manifest.header.uuid;
    manifest.header.version = version;
    for (const module of manifest.modules) {
      module.version = version;
    }
    writePackManifest(behaviorPackDirectory, manifest);
    console.log(`[packaging] 已同步行为包版本:${path.relative(projectRoot, behaviorPackDirectory)}`);
  }

  if (resourcePackDirectory) {
    const manifest = readPackManifest(resourcePackDirectory);
    manifest.header.version = version;
    for (const module of manifest.modules) {
      module.version = version;
    }
    for (const dependency of manifest.dependencies ?? []) {
      if (behaviorPackUuid && dependency.uuid === behaviorPackUuid) {
        dependency.version = version;
      }
    }
    writePackManifest(resourcePackDirectory, manifest);
    console.log(`[packaging] 已同步资源包版本:${path.relative(projectRoot, resourcePackDirectory)}`);
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
    const { behaviorPackDirectory, resourcePackDirectory } = resolvePackDirectories(projectRoot, configuration);

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
