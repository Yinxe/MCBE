import { argv, parallel, series, task } from "just-scripts";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { cleanTask, setupEnvironment, getOrThrowFromProcess } from "@minecraft/core-build-tasks";
import path from "path";

setupEnvironment(path.resolve(__dirname, ".env"));

// ── Project metadata ────────────────────────────────────────────
const projectName = getOrThrowFromProcess("PROJECT_NAME");
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const pkgVersion = pkg.version;
const pkgName = pkg.name;

// ── Clean paths ─────────────────────────────────────────────────
const CLEAN_DIRS = ["lib", "dist", "temp"];

// ── Tasks ───────────────────────────────────────────────────────
task("sync-version", () => {
  execSync("node tools/sync-version.mjs", { cwd: __dirname, stdio: "inherit" });
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

task("mcaddon", series("clean", "build", () => {
  const outDir = path.resolve(__dirname, "dist/packages");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const outFile = `${pkgName}-v${pkgVersion}.mcaddon`;
  const bpDir = path.resolve(__dirname, `BP/${projectName}`);
  const rpDir = path.resolve(__dirname, `RP/${projectName}`);

  // Create .mcaddon (it's a .zip with BP/ and RP/ folders)
  const pkgPath = path.join(outDir, outFile);
  execSync(`(cd "${path.dirname(bpDir)}" && zip -r "${pkgPath}" "${projectName}/")`, { stdio: "inherit" });
  execSync(`(cd "${path.dirname(rpDir)}" && zip -r "${pkgPath}" "${projectName}/")`, { stdio: "inherit" });

  console.log(`\n  ✓ ${outFile} 创建成功 (${(existsSync(pkgPath) ? readFileSync(pkgPath).length : 0) / 1024} KB)`);
}));

task("local-deploy", () => {
  const minecraftDir = process.env.MINECRAFT_PRODUCT === "Preview"
    ? process.env.HOME + "/.local/share/minecraft-previews/games/com.mojang"
    : process.env.HOME + "/.local/share/minecraft/games/com.mojang";

  const devBp = path.resolve(minecraftDir, "development_behavior_packs", projectName);
  const devRp = path.resolve(minecraftDir, "development_resource_packs", projectName);

  console.log(`  Deploying to ${devBp} …`);

  execSync(`rm -rf "${devBp}" "${devRp}"`, { stdio: "inherit" });
  execSync(`cp -r "${path.resolve(__dirname, "BP", projectName)}" "${devBp}"`, { stdio: "inherit" });
  execSync(`cp -r "${path.resolve(__dirname, "RP", projectName)}" "${devRp}"`, { stdio: "inherit" });

  console.log("  ✓ 本地部署完成");
});
