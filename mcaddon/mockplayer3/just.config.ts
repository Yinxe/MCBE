import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync } from "fs";
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

// ── Bundle ──────────────────────────────────────────────────────
// BP 依赖 RP，RP 可独立作材质包；.mcaddon 同装两包，UI 图标纹理归 RP。
const RP_UUID = "4497ec44-a22f-4f7f-a723-1f18d14c4e04";
const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-gametest",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: true });
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcaddon`,
};

// ── Tasks ───────────────────────────────────────────────────────
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));

task("update-version", () => {
  console.log(`Syncing manifest versions to ${pkgVersion} …`);
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m, dir, versionArr) => {
      if (dir !== "BP") return; // RP 保持自己的 description（材质包独立可用）
      m.header.description = `模拟玩家（假人）v3 重写 - 单会话模型、资源租约、显式生命周期管线 v${pkgVersion}`;
      const deps: any[] = (m.dependencies ??= []);
      if (!deps.some((d) => d.uuid === RP_UUID)) {
        deps.unshift({ uuid: RP_UUID, version: versionArr });
      }
    },
  });
  console.log("Done.");
});

task("build", series("update-version", "typescript", "bundle"));
task("clean-local", cleanTask(DEFAULT_CLEAN_DIRECTORIES));
task("clean-collateral", cleanCollateralTask(STANDARD_CLEAN_PATHS));
task("clean", parallel("clean-local", "clean-collateral"));
task("copyArtifacts", copyTask(copyTaskOptions));
task("package", series("clean-collateral", "copyArtifacts"));
task(
  "local-deploy",
  watchTask(
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}", "RP/**/*.{json,png}"],
    series("clean-local", "build", "package")
  )
);
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));
task("mcaddon", series("clean-local", "build", "createMcaddonFile"));
