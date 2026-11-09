import path from "path";
import { task, series } from "just-scripts";
import { cleanTask, setupEnvironment } from "@minecraft/core-build-tasks";
import { createPackagesByMode, synchronizePackVersions } from "@mc-toolchain/mod-packaging";

setupEnvironment(path.resolve(__dirname, ".env"));

// 本模组只由行为包内容（配方与物品目录清单）构成，没有脚本与 TypeScript 源码，
// 因此这里不编排 typescript / bundle 任务，只做「清理 → 同步版本 → 按模式打包」。

// 只清理构建中间产物，保留 packing.output 目录里已产出的历史版本。
task("clean-build", cleanTask(["temp", "lib", "dist/scripts", "dist/debug"]));

task("synchronizePackVersions", () => {
  synchronizePackVersions(__dirname);
});

// 唯一打包入口：产物形态由 package.json 的 packing.mode 决定。
task("pack", series("clean-build", "synchronizePackVersions", createPackagesByMode(__dirname)));
