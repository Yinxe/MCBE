import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { series, task } from "just-scripts";
import path from "path";
import { syncManifestVersion } from "@yinxe/toolkit";

// ── Project metadata ────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.productName;
const PROJECT_NAME = pkg.mcbe.bpDir;
const pkgVersion = pkg.version;

// ── Tasks ───────────────────────────────────────────────────
task("sync-version", () => {
  syncManifestVersion(__dirname, {
    formatName: () => `§l§e《${CHINESE_NAME}》`,
    onManifest: (m) => {
      m.header.description = "合成各种稀有、不可再生物品，创造模式快速获取隐藏方块！";
    },
  });
});

task("build", series("sync-version"));

task("clean", () => {
  for (const dir of ["lib", "dist", "temp"]) {
    const dirPath = path.resolve(__dirname, dir);
    if (existsSync(dirPath)) rmSync(dirPath, { recursive: true, force: true });
  }
});

task("mcaddon", series("clean", "build", () => {
  const outDir = path.resolve(__dirname, "dist/packages");
  mkdirSync(outDir, { recursive: true });

  const outFile = `${CHINESE_NAME}-v${pkgVersion}.mcpack`;
  const bpDir = path.resolve(__dirname, `BP/${PROJECT_NAME}`);
  execSync(`(cd "${bpDir}" && zip -X -r "${path.resolve(outDir, outFile)}" .)`, { stdio: "inherit" });

  const size = existsSync(path.resolve(outDir, outFile))
    ? readFileSync(path.resolve(outDir, outFile)).length : 0;
  console.log(`\n  ✓ ${outFile} 创建成功 (${(size / 1024).toFixed(1)} KB)`);
}));
