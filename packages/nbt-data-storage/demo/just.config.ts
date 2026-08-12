import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync, renameSync } from "fs";
import {
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  copyTask,
  coreLint,
  mcaddonTask,
  STANDARD_CLEAN_PATHS,
  DEFAULT_CLEAN_DIRECTORIES,
  watchTask,
} from "@minecraft/core-build-tasks";
import path from "path";
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit-build";

// ── Project metadata ────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.mcbe.packName;
const PACKAGE_NAME = pkg.name;
const PROJECT_NAME = path.basename(pkg.mcbe.bp);
const pkgVersion = pkg.version;

// ── Tasks ───────────────────────────────────────────────────────
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());

/** 把 package.json 版本同步到 BP manifest（含作者信息注入，幂等） */
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = `NBT 存储测试（@yinxe/nbt-data-storage 演示）v${pkgVersion}`;
    },
  });
});

const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server",
  "@minecraft/server-ui",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: false });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}_bp.mcpack`,
};

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
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}"],
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