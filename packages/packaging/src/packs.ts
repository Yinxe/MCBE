// ─── 产物生成（依赖 @minecraft/core-build-tasks 的 zipTask） ─────
// 本模块是唯一依赖构建工具的部分;纯逻辑在 versions.ts / discovery.ts /
// configuration.ts 中,可脱离构建环境单独测试。

import * as fs from "fs";
import * as path from "path";
import { zipTask } from "@minecraft/core-build-tasks";
import { getModuleName, readPackageJson, resolvePackingConfiguration } from "./configuration";
import { readPackManifestFile, resolvePackDirectories } from "./discovery";
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
    const manifest = readPackManifestFile(path.join(behaviorPackDirectory, "manifest.json"));
    behaviorPackUuid = manifest.header.uuid;
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
    writePackManifest(behaviorPackDirectory, manifest);
    console.log(
      `[packaging] 已同步行为包版本与最低游戏版本 ${minimumEngineVersion.join(".")}:` +
        `${path.relative(projectRoot, behaviorPackDirectory)}`
    );
  }

  if (resourcePackDirectory) {
    const manifest = readPackManifestFile(path.join(resourcePackDirectory, "manifest.json"));
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
