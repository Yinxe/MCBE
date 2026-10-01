/**
 * 从 name-maps 读取中文名，给 ItemFamilies.ts 中每个物品添加行内注释。
 * 已有注释的行会跳过。
 */

import fs from "fs";
import path from "path";

// ── 1. 读取所有 name-map 文件 ──────────────────────────────
const mapsDir = "../scripts/data/name-maps";
const nameMap = new Map();

for (const file of fs.readdirSync(mapsDir).filter(f => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts")) {
  const content = fs.readFileSync(path.join(mapsDir, file), "utf8");
  for (const m of content.matchAll(/"minecraft:[^"]+":\s*"[^"]*"/g)) {
    const [key, val] = m[0].split(":").slice(1).join(":").split('"').filter(s => s.trim());
    // key will be like "minecraft:xxx" and val the Chinese name
    const id = m[0].split('"')[1]; // "minecraft:xxx"
    const name = m[0].match(/"([^"]*)"\s*$/)[1]; // last quoted string
    nameMap.set(id, name);
  }
  // Also try simpler format: "minecraft:xxx": "名称"
  for (const m of content.matchAll(/"minecraft:[^"]+"\s*:\s*"[^"]+"/g)) {
    const parts = m[0].match(/"([^"]+)"\s*:\s*"([^"]+)"/);
    if (parts) nameMap.set(parts[1], parts[2]);
  }
}

console.log(`已加载 ${nameMap.size} 条中文名映射`);

// ── 2. 读取并注释 ItemFamilies.ts ──────────────────────────
const famPath = "../scripts/data/ItemFamilies.ts";
const content = fs.readFileSync(famPath, "utf8");
const lines = content.split("\n");

let annotated = 0;
let skipped = 0;

const output = lines.map(line => {
  // Match "minecraft:xxx" at the beginning, optionally followed by comma
  const m = line.match(/^(\s*)"(minecraft:\w+)"(,?)\s*$/);
  if (!m) return line; // not a simple item line

  const [, indent, id, comma] = m;
  const chinese = nameMap.get(id);
  if (!chinese) {
    skipped++;
    return line;
  }

  // Check if already has a comment
  if (line.includes("//")) {
    skipped++;
    return line;
  }

  annotated++;
  return `${indent}"${id}"${comma} // ${chinese}`;
});

fs.writeFileSync(famPath, output.join("\n"), "utf8");
console.log(`注释完成：${annotated} 项新增注释，${skipped} 项跳过（已有注释或无译名）`);
