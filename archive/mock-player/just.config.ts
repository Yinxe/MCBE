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
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit-build";

const pkg = JSON.parse(require("fs").readFileSync(path.join(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.mcbe.packName;
const PACKAGE_NAME = pkg.name;
const PROJECT_NAME = path.basename(pkg.mcbe.bp);

// ── Version sync ──
// BP 依赖 RP（RP 不依赖 BP，RP 可独立作为材质包使用），.mcaddon 中 BP 必须声明对 RP 的依赖
const RP_UUID = "4497ec44-a22f-4f7f-a723-1f18d14c4e04";
const BP_UUID = "49df180b-e16a-4740-9edd-c655127fcd22";
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m, dir, versionArr) => {
      m.header.description = "创建和管理 AI 模拟玩家（假人），支持行为控制、物品交互、数据持久化";
      if (dir === "BP") {
        const deps: any[] = (m.dependencies ??= []);
        if (!deps.some((d) => d.uuid === RP_UUID)) {
          deps.unshift({ uuid: RP_UUID, version: versionArr });
        }
      } else if (dir === "RP") {
        // RP 不依赖 BP：移除旧的 BP 依赖（若存在），保持独立
        if (Array.isArray(m.dependencies)) {
          m.dependencies = m.dependencies.filter((d: any) => d.uuid !== BP_UUID);
          if (m.dependencies.length === 0) delete m.dependencies;
        }
      }
    },
  });
});

// ── Build ──
const pkgVersion = pkg.version;

const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server", "@minecraft/server-ui", "@minecraft/server-gametest",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME, { hasRp: true });
// mcaddon 需同时包含 BP+RP，BP 依赖 RP（RP 不依赖 BP），输出为 .mcaddon
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcaddon`,
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
    ["scripts/**/*.ts", "BP/**/*.{json,lang,tga,ogg,png}", "RP/**/*.{json,png}"],
    series("clean-local", "build", "package")
  )
);
task("createMcaddonFile", mcaddonTask(mcaddonTaskOptions));

task("mcaddon", series("clean-local", "build", "createMcaddonFile"));
