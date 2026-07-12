import {
    bundleTask,
    cleanCollateralTask,
    cleanTask,
    copyTask,
    coreLint,
    DEFAULT_CLEAN_DIRECTORIES,
    mcaddonTask,
    STANDARD_CLEAN_PATHS,
    watchTask,
} from "@minecraft/core-build-tasks";
import { argv, parallel, series, task, tscTask } from "just-scripts";
import path from "path";
import { renameSync } from "fs";
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit";

const pkg = JSON.parse(require("fs").readFileSync(path.join(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.mcbe.packName;
const PACKAGE_NAME = pkg.name;
const PROJECT_NAME = path.basename(pkg.mcbe.bp);

// ── Version sync ──
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = "创建和管理 AI 模拟玩家（假人），支持行为控制、物品交互、数据持久化";
    },
  });
});

// ── Build ──
const pkgVersion = pkg.version;

const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server", "@minecraft/server-ui", "@minecraft/server-gametest",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: false });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}_bp.mcpack`,
};

task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));
task("build", series("sync-version", "typescript", "bundle"));
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));
task("copyArtifacts", copyTask(copyTaskOptions));
task("package", series("clean-collateral", "copyArtifacts"));
task(
  "local-deploy",
  watchTask(
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}", "RP/**/*.{json,lang,tga,ogg,png}"],
    series("clean-local", "build", "package")
  )
);
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));

task("renameOutput", () => {
  const src = path.resolve(__dirname, `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}_bp.mcpack`);
  const dst = path.resolve(__dirname, `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcpack`);
  renameSync(src, dst);
});

task("mcaddon", series("clean-local", "build", "createMcaddonFile", "renameOutput"));
