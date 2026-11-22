// ─── 产物生成（依赖 @minecraft/core-build-tasks 的 zipTask） ─────
// 本模块是唯一依赖构建工具的部分;纯逻辑在 versions.ts / discovery.ts /
// configuration.ts 中,可脱离构建环境单独测试。

import * as fs from "fs";
import * as path from "path";
import { zipTask } from "@minecraft/core-build-tasks";
import { getModuleName, readPackageJson, resolvePackingConfiguration } from "./configuration";
import { reconcilePackDependencyDirection } from "./dependencies";
import { readPackManifestFile, resolvePackDirectories } from "./discovery";
import { resolvePackDescription, resolvePackDisplayName } from "./metadata";
import {
  INTERMEDIATE_PACKAGE_DIRECTORY,
  SCRIPT_API_MODULE_NAME,
  type PackingMode,
  type PackManifest,
} from "./types";
import { parseVersion } from "./versions";

/** 写回包清单 */
function writePackManifest(packDirectory: string, manifest: PackManifest): void {
  fs.writeFileSync(path.join(packDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * 把 `package.json` 派生的声明同步进所有包清单。
 *
 * 写入 `header.name`、`header.description`、`header.version`、各 `modules[].version`、
 * `header.min_engine_version`,并校正两包之间的依赖方向。
 *
 * 这些字段同属「从 package.json 派生到清单」的声明字段,因此合并在同一处一次读写,
 * 避免多个任务分别对同一批清单读改写而产生中间态(任一任务失败会留下部分字段已改、
 * 部分未改的清单)。任一解析失败均报错中止。
 *
 * 依赖方向由本函数统一保证,见下方 `syncPackDependencyDirection`。
 */
export function synchronizePackVersions(projectRoot: string): void {
  const packageJson = readPackageJson(projectRoot);
  const version = parseVersion(packageJson.version);
  // 显示名与描述先解析:缺必需字段时在读取清单之前就报错,不留下半写状态
  const displayName = resolvePackDisplayName(packageJson);
  const description = resolvePackDescription(packageJson);
  const configuration = resolvePackingConfiguration(projectRoot);
  const minimumEngineVersion = configuration.minimumEngineVersion;
  const minimumEngineVersionSource =
    packageJson.packing?.minimum_engine_version !== undefined
      ? "显式配置 packing.minimum_engine_version"
      : `由 ${SCRIPT_API_MODULE_NAME} 依赖版本 ${packageJson.dependencies?.[SCRIPT_API_MODULE_NAME]} 推导`;
  console.log(`[packaging] 最低游戏版本 ${minimumEngineVersion.join(".")}(${minimumEngineVersionSource})`);
  console.log(`[packaging] 清单显示名 ${displayName}`);
  const { behaviorPackDirectory, resourcePackDirectory } = resolvePackDirectories(projectRoot);

  if (!behaviorPackDirectory && !resourcePackDirectory) {
    throw new Error("模组目录下没有探测到任何行为包或资源包(需要含 manifest.json 的包目录),打包中止。");
  }

  const behaviorManifest = behaviorPackDirectory
    ? readPackManifestFile(path.join(behaviorPackDirectory, "manifest.json"))
    : undefined;
  const resourceManifest = resourcePackDirectory
    ? readPackManifestFile(path.join(resourcePackDirectory, "manifest.json"))
    : undefined;

  if (behaviorManifest && behaviorPackDirectory) {
    applyDerivedHeader(behaviorManifest, displayName, description, version, minimumEngineVersion);
  }
  if (resourceManifest && resourcePackDirectory) {
    applyDerivedHeader(resourceManifest, displayName, description, version, minimumEngineVersion);
  }

  // 依赖方向:行为包 → 资源包(单向)。两包都在时由这里统一保证,
  // 无论清单里原先写的是哪个方向、还是根本没写。
  if (behaviorManifest && resourceManifest) {
    syncPackDependencyDirection(behaviorManifest, resourceManifest, version);
  }

  if (behaviorManifest && behaviorPackDirectory) {
    writePackManifest(behaviorPackDirectory, behaviorManifest);
    console.log(
      `[packaging] 已同步行为包显示名、描述、版本与最低游戏版本 ${minimumEngineVersion.join(".")}:` +
        `${path.relative(projectRoot, behaviorPackDirectory)}`
    );
  }

  if (resourceManifest && resourcePackDirectory) {
    writePackManifest(resourcePackDirectory, resourceManifest);
    console.log(
      `[packaging] 已同步资源包显示名、描述、版本与最低游戏版本 ${minimumEngineVersion.join(".")}:` +
        `${path.relative(projectRoot, resourcePackDirectory)}`
    );
  }
}

/** 把 `package.json` 派生的显示名、描述、版本与最低游戏版本写入清单 */
function applyDerivedHeader(
  manifest: PackManifest,
  displayName: string,
  description: string,
  version: number[],
  minimumEngineVersion: [number, number, number]
): void {
  manifest.header.name = displayName;
  manifest.header.description = description;
  manifest.header.version = version;
  manifest.header.min_engine_version = minimumEngineVersion;
  for (const module of manifest.modules) {
    module.version = version;
  }
}

/**
 * 校正行为包与资源包之间的依赖方向:行为包依赖资源包,资源包不依赖行为包。
 *
 * 依赖的 `version` 与目标包的 `header.version` 保持一致(两者都已同步为
 * `package.json#version`),避免版本不匹配导致依赖被判为未满足。
 * 方向规则与纯逻辑见 `dependencies.ts`。
 */
function syncPackDependencyDirection(
  behaviorManifest: PackManifest,
  resourceManifest: PackManifest,
  version: number[]
): void {
  const behaviorPackUuid = behaviorManifest.header.uuid;
  const resourcePackUuid = resourceManifest.header.uuid;

  const result = reconcilePackDependencyDirection(
    behaviorPackUuid,
    resourcePackUuid,
    behaviorManifest.dependencies ?? [],
    resourceManifest.dependencies ?? [],
    version
  );

  behaviorManifest.dependencies = result.behaviorDependencies;
  if (result.resourceDependencies) {
    resourceManifest.dependencies = result.resourceDependencies;
  } else {
    // 删空就整个去掉这个字段:空数组在清单里是无意义的噪声
    delete resourceManifest.dependencies;
  }

  if (result.appended) {
    console.log(`[packaging] 行为包补上对资源包的依赖:${resourcePackUuid}`);
  }
  if (result.removed) {
    console.log(`[packaging] 已移除资源包对行为包的反向依赖:${behaviorPackUuid}`);
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
