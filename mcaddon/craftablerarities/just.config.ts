import { getOrThrowFromProcess, setupEnvironment } from "@minecraft/core-build-tasks";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { series, task } from "just-scripts";
import path from "path";
import { syncManifestVersion } from "@yinxe/toolkit";

setupEnvironment(path.resolve(__dirname, ".env"));

// ── Project metadata ────────────────────────────────────────────
const projectName = getOrThrowFromProcess("PROJECT_NAME");
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const pkgVersion = pkg.version;

// ── Clean paths ─────────────────────────────────────────────────
const CLEAN_DIRS = ["lib", "dist", "temp"];

// ── Tasks ───────────────────────────────────────────────────────
task("sync-version", () => {
  syncManifestVersion(__dirname);
});

task("build", series("sync-version"));

task("clean", () => {
  for (const dir of CLEAN_DIRS) {
    const dirPath = path.resolve(__dirname, dir);
    if (existsSync(dirPath)) {
      execSync(`rm -rf "${dirPath}"`, { stdio: "inherit" });
      console.log(`  ✗ cleaned ${dir}`);
    }
  }
});

task("pack", series("clean", "build", () => {
  const outDir = path.resolve(__dirname, "dist/packages");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const outFile = `CraftableRarities-v${pkgVersion}.mcpack`;
  const bpDir = path.resolve(__dirname, `BP/${projectName}`);

  execSync(`(cd "${bpDir}" && zip -X -r "${path.resolve(outDir, outFile)}" .)`, { stdio: "inherit" });

  const size = existsSync(path.resolve(outDir, outFile)) ? readFileSync(path.resolve(outDir, outFile)).length : 0;
  console.log(`\n  ✓ ${outFile} 创建成功 (${(size / 1024).toFixed(1)} KB)`);
}));

task("local-deploy", () => {
  const minecraftDir = process.env.MINECRAFT_PRODUCT === "Preview"
    ? path.resolve(process.env.HOME || "/home", ".local/share/minecraft-previews/games/com.mojang")
    : path.resolve(process.env.HOME || "/home", ".local/share/minecraft/games/com.mojang");

  const devBp = path.resolve(minecraftDir, "development_behavior_packs", projectName);
  console.log(`  Deploying to ${devBp} …`);

  execSync(`rm -rf "${devBp}"`, { stdio: "inherit" });
  execSync(`cp -r "${path.resolve(__dirname, "BP", projectName)}" "${devBp}"`, { stdio: "inherit" });

  console.log("  ✓ 本地部署完成");
});
