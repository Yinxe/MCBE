import { argv, parallel, series, task, tscTask } from "just-scripts";
import {
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  copyTask,
  coreLint,
  mcaddonTask,
  setupEnvironment,
  STANDARD_CLEAN_PATHS,
  DEFAULT_CLEAN_DIRECTORIES,
  getOrThrowFromProcess,
  watchTask,
} from "@minecraft/core-build-tasks";
import path from "path";
import { renameSync } from "fs";
import { bundleOptions, copyOptions } from "@yinxe/toolkit";

setupEnvironment(path.resolve(__dirname, ".env"));

const projectName = getOrThrowFromProcess("PROJECT_NAME");

const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server",
]);
const copyTaskOptions = copyOptions(__dirname, projectName, { hasRp: false });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/KeepInventory.mcpack`,
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
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}"],
    series("clean-local", "build", "package")
  )
);
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));

task("renameBpPack", () => {
  const src = path.resolve(__dirname, "./dist/packages/KeepInventory_bp.mcpack");
  const dst = path.resolve(__dirname, "./dist/packages/KeepInventory.mcpack");
  renameSync(src, dst);
});

task("mcaddon", series("clean-local", "build", "createMcaddonFile", "renameBpPack"));
