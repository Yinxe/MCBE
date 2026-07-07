import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import {
  BundleTaskParameters,
  CopyTaskParameters,
  bundleTask,
  cleanTask,
  cleanCollateralTask,
  copyTask,
  coreLint,
  mcaddonTask,
  setupEnvironment,
  ZipTaskParameters,
  STANDARD_CLEAN_PATHS,
  DEFAULT_CLEAN_DIRECTORIES,
  getOrThrowFromProcess,
  watchTask,
} from "@minecraft/core-build-tasks";
import path from "path";

setupEnvironment(path.resolve(__dirname, ".env"));

// ── Project metadata ────────────────────────────────────────────
const projectName = getOrThrowFromProcess("PROJECT_NAME");
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const pkgVersion = pkg.version;
const pkgName = pkg.name;

// ── Bundle ──────────────────────────────────────────────────────
const bundleTaskOptions: BundleTaskParameters = {
  entryPoint: path.join(__dirname, "./scripts/main.ts"),
  external: ["@minecraft/server", "@minecraft/server-ui"],
  outfile: path.resolve(__dirname, "./dist/scripts/main.js"),
  minifyWhitespace: false,
  sourcemap: true,
  outputSourcemapPath: path.resolve(__dirname, "./dist/debug"),
};

// ── Copy / Package ──────────────────────────────────────────────
const copyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: [`./BP/${projectName}`],
  copyToScripts: ["./dist/scripts"],
  copyToResourcePacks: [`./RP/${projectName}`],
};
const mcaddonTaskOptions: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${pkgName}-v${pkgVersion}.mcaddon`,
};

// ── Tasks ───────────────────────────────────────────────────────
task("lint", coreLint(["scripts/**/*.ts"], argv().fix));
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));

/** 同步版本号（委托 tools/sync-version.mjs） */
task("sync-version", () => {
  execSync("node tools/sync-version.mjs", { cwd: __dirname, stdio: "inherit" });
});

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
task("mcaddon", series("clean-local", "build", "createMcaddonFile"));
