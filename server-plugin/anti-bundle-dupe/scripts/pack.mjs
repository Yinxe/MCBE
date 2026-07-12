#!/usr/bin/env node
/**
 * Pack anti-bundle-dupe BP into .mcpack
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";

const projectDir = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));

const pkgVersion = pkg.version;
const productName = pkg.productName;
const bpDir = resolve(projectDir, "BP", pkg.mcbe.bpDir);
const distDir = resolve(projectDir, "dist", "packages");
const outputFile = resolve(distDir, `${productName}-v${pkgVersion}.mcpack`);

// 版本同步
execSync("pnpm run build", { cwd: projectDir, stdio: "inherit" });

// 确保 dist 目录存在
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

// 打包 BP 目录
execSync(`cd "${bpDir}" && zip -r "${outputFile}" . -x ".*"`, { stdio: "inherit" });

console.log(`✓ 打包完成: ${outputFile}`);
