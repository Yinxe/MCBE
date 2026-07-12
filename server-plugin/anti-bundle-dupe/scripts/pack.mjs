#!/usr/bin/env node
/**
 * Pack anti-bundle-dupe BP into .mcpack
 */
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));

const pkgVersion = pkg.version;
const bpDir = resolve(projectDir, pkg.mcbe.bp);
const distDir = resolve(projectDir, "dist", "packages");
const outputFile = resolve(distDir, `${pkg.name}-v${pkgVersion}.mcpack`);

// 版本同步
execSync("pnpm run build", { cwd: projectDir, stdio: "inherit" });

// 确保 dist 目录存在
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

// 打包 BP 目录
execSync(`cd "${bpDir}" && zip -r "${outputFile}" . -x ".*"`, { stdio: "inherit" });

console.log(`✓ 打包完成: ${outputFile}`);
