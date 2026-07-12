import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync, writeFileSync } from "fs";
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
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit";

// ── Project metadata ────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.mcbe.packName;
const PACKAGE_NAME = pkg.name;
const PROJECT_NAME = path.basename(pkg.mcbe.bp);
const pkgVersion = pkg.version;

// ── Bundle ──────────────────────────────────────────────────────
const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server", "@minecraft/server-ui",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME);
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcaddon`,
};

// ── Tasks ───────────────────────────────────────────────────────
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));

/** 从 package.json 生成 scripts/version.ts */
task("generate-version", () => {
  const buildTime = new Date().toISOString();
  const content = [
    "// 此文件由 just.config.ts 在构建时自动生成\n",
    `export const VERSION = "${pkgVersion}";`,
    `export const BUILD_TIME = "${buildTime}";`,
    `export const PROJECT_URL = "https://github.com/YinxSmartHouse/SmartWarehouse";`,
  ].join("\n");
  writeFileSync(path.resolve(__dirname, "scripts/version.ts"), content + "\n");
  console.log(`  ✓ scripts/version.ts → v${pkgVersion} (${buildTime})`);
});

task("update-version", () => {
  console.log(`Syncing manifest versions to ${pkgVersion} …`);
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = `智能仓库管理 - 自动分拣、容器整理、仓库统计、容量预警 v${pkgVersion}`;
    },
  });
  console.log("Done.");
});

task("build", series("generate-version", "update-version", "typescript", "bundle"));
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
task("mcaddon", series("clean-local", "build", "createMcaddonFile"));
