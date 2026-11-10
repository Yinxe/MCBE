import { argv, parallel, series, task, tscTask } from "just-scripts";
import {
  BundleTaskParameters,
  CopyTaskParameters,
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  copyTask,
  coreLint,
  setupEnvironment,
  STANDARD_CLEAN_PATHS,
  DEFAULT_CLEAN_DIRECTORIES,
  getOrThrowFromProcess,
  watchTask,
} from "@minecraft/core-build-tasks";
import path from "path";
import { createPackagesByMode, synchronizePackVersions } from "@mc-toolchain/mod-packaging";

setupEnvironment(path.resolve(__dirname, ".env"));
const projectName = getOrThrowFromProcess("PROJECT_NAME");

// 行为包与资源包共用同一个包目录名(item-route),故两个复制目标都用 projectName。
const bundleTaskOptions: BundleTaskParameters = {
  entryPoint: path.join(__dirname, "./scripts/main.ts"),
  // 只把官方 Script API 包留作外部依赖。名称映射表用的纯数据包(见 package.json
  // 的 dependencies)必须内联进 bundle —— 游戏运行时并不提供它。
  external: ["@minecraft/server", "@minecraft/server-ui"],
  outfile: path.resolve(__dirname, "./dist/scripts/main.js"),
  minifyWhitespace: false,
  sourcemap: true,
  outputSourcemapPath: path.resolve(__dirname, "./dist/debug"),
};

const copyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: [`./behavior_packs/${projectName}`],
  copyToResourcePacks: [`./resource_packs/${projectName}`],
  copyToScripts: ["./dist/scripts"],
};

task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));
task("build", series("typescript", "bundle"));
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));
task("copyArtifacts", copyTask(copyTaskOptions));
task("package", series("clean-collateral", "copyArtifacts"));
task(
  "local-deploy",
  watchTask(
    ["scripts/**/*.ts", "behavior_packs/**/*.{json,lang,tga,ogg,png}", "resource_packs/**/*.{json,lang,tga,ogg,png}"],
    series("clean-local", "build", "package")
  )
);

// ---- 自定义打包 ----
// 只清理构建中间产物,保留 packing.output 目录里已产出的历史版本。
task("clean-build", cleanTask(["temp", "lib", "dist/scripts", "dist/debug"]));
task("synchronizePackVersions", () => {
  synchronizePackVersions(__dirname);
});

// 唯一打包入口:产物形态由 package.json 的 packing.mode 决定。
task("pack", series("clean-build", "build", "synchronizePackVersions", createPackagesByMode(__dirname)));
