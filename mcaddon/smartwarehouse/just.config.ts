import { argv, parallel, series, task, tscTask } from "just-scripts";
import { readFileSync, writeFileSync } from "fs";
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

// ── Version sync ────────────────────────────────────────────────
  uuid?: string;
interface ManifestModule {
  version: number[];
  [key: string]: unknown;
}

  module_name?: string;
  version: number[];
  [key: string]: unknown;
}
interface ManifestHeader {
  name: string;
  version: number[];
  [key: string]: unknown;
}
interface Manifest {
  header: ManifestHeader;
  modules?: ManifestModule[];
  dependencies?: ManifestDependency[];
  [key: string]: unknown;
}

function syncManifestVersion() {
  // pkgVersion 可能含 pre-release 后缀如 "0.0.34-beta"，manifest 只认 3 个整数
  const baseVersion = pkgVersion.split(/[-+]/)[0]; // "0.0.34-beta" → "0.0.34"
  const versionArr = baseVersion.split(".").map(Number);

  for (const dir of [`BP/${projectName}`, `RP/${projectName}`]) {
    const manifestPath = path.resolve(__dirname, dir, "manifest.json");
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    manifest.header.version = versionArr;

    // Inject version into display name (strip any prior version suffix first)
    const currentName = manifest.header.name;
    const baseName = currentName.replace(/\s+v?\d+\.\d+\.\d+([-+][\w.]+)?$/, "");
    manifest.header.name = `${baseName} v${pkgVersion}`;

    if (manifest.modules) {
      manifest.modules.forEach((m: ManifestModule) => {
        if (Array.isArray(m.version) && m.version.length === 3) {
          m.version = versionArr;
        }
      });
    }

    if (manifest.dependencies) {
      manifest.dependencies.forEach((d: ManifestDependency) => {
        if (d.uuid && Array.isArray(d.version)) {
          d.version = versionArr;
        }
      });
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  ✓ ${dir}/manifest.json → version ${pkgVersion}`);
  }
}

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
  syncManifestVersion();
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
