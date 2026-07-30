import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync, renameSync } from "fs";
import {
  bundleTask,
  cleanCollateralTask,
  cleanTask,
  copyTask,
  coreLint,
  mcaddonTask,
  DEFAULT_CLEAN_DIRECTORIES,
  STANDARD_CLEAN_PATHS,
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

// ── Version sync ──
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = `传送管理 - 玩家间传送请求、TPA、TPHERE、返回点 v${pkgVersion}`;
    },
  });
});

// ── Bundle ──
const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server", "@minecraft/server-ui",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: false });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}_bp.mcpack`,
};

// ── Tasks ──
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
task("createMcpackFile", mcaddonTask(mcaddonTaskOptions));

task("renameOutput", () => {
  const src = path.resolve(__dirname, `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}_bp.mcpack`);
  const dst = path.resolve(__dirname, `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcpack`);
  renameSync(src, dst);
});

task("mcpack", series("clean-local", "build", "createMcpackFile", "renameOutput"));
