import {
    bundleTask,
    BundleTaskParameters,
    cleanCollateralTask,
    cleanTask,
    copyTask,
    CopyTaskParameters,
    coreLint,
    DEFAULT_CLEAN_DIRECTORIES,
    getOrThrowFromProcess,
    mcaddonTask,
    setupEnvironment,
    STANDARD_CLEAN_PATHS,
    watchTask,
    ZipTaskParameters,
} from "@minecraft/core-build-tasks";
import fs from "fs";
import { argv, parallel, series, task, tscTask } from "just-scripts";
import path from "path";

setupEnvironment(path.resolve(__dirname, ".env"));

// Sync version from package.json to BP/RP manifests
task("sync-version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  const version = pkg.version.split(".").map(Number);

  // BP manifest
  const bpPath = path.join(__dirname, "BP/MockPlayer/manifest.json");
  const bp = JSON.parse(fs.readFileSync(bpPath, "utf8"));
  bp.header.name = `MockPlayer-v${pkg.version}`;
  bp.header.description = "模拟玩家";
  bp.header.version = version;
  bp.modules = bp.modules.map((m: any) => ({ ...m, version }));
  fs.writeFileSync(bpPath, JSON.stringify(bp, null, 2) + "\n");

  // RP manifest
  const rpPath = path.join(__dirname, "RP/MockPlayer/manifest.json");
  const rp = JSON.parse(fs.readFileSync(rpPath, "utf8"));
  rp.header.version = version;
  rp.modules = rp.modules.map((m: any) => ({ ...m, version }));
  fs.writeFileSync(rpPath, JSON.stringify(rp, null, 2) + "\n");
});

const projectName = getOrThrowFromProcess("PROJECT_NAME");
const pkgVersion: string = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;

const bundleTaskOptions: BundleTaskParameters = {
  entryPoint: path.join(__dirname, "./scripts/main.ts"),
  external: ["@minecraft/server", "@minecraft/server-ui", "@minecraft/server-gametest"],
  outfile: path.resolve(__dirname, "./dist/scripts/main.js"),
  minifyWhitespace: false,
  sourcemap: true,
  outputSourcemapPath: path.resolve(__dirname, "./dist/debug"),
};

const copyTaskOptions: CopyTaskParameters = {
  copyToBehaviorPacks: ["./BP/MockPlayer"],
  copyToScripts: ["./dist/scripts"],
  copyToResourcePacks: ["./RP/MockPlayer"],
};

const mcaddonTaskOptions: ZipTaskParameters = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/MockPlayer-v${pkgVersion}.mcaddon`,
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
task("mcaddon", series("clean-local", "build", "createMcaddonFile"));
