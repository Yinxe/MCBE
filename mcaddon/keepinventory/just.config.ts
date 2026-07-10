import { argv, parallel, series, task, tscTask } from "just-scripts";
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
import { renameSync } from "fs";
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit";

const pkg = JSON.parse(require("fs").readFileSync(path.join(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.productName;
const PROJECT_NAME = pkg.mcbe.bpDir;
const pkgVersion = pkg.version;

// ── Version sync ──
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = "死亡不掉落·无需开启作弊·保留成就·极限复活";
    },
  });
});

// ── Build ──
const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: false });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${CHINESE_NAME}-v${pkgVersion}_bp.mcpack`,
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
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}"],
    series("clean-local", "build", "package")
  )
);
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));

task("renameOutput", () => {
  const src = path.resolve(__dirname, `./dist/packages/${CHINESE_NAME}-v${pkgVersion}_bp.mcpack`);
  const dst = path.resolve(__dirname, `./dist/packages/${CHINESE_NAME}-v${pkgVersion}.mcpack`);
  renameSync(src, dst);
});

task("mcaddon", series("clean-local", "build", "createMcaddonFile", "renameOutput"));
