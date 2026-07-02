import fs from "fs";

// Read all name-maps to get all item IDs
const dir = "../scripts/data/name-maps";
const allIds = new Set();
for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts")) {
  const c = fs.readFileSync(`${dir}/${file}`, "utf8");
  for (const m of c.matchAll(/"minecraft:[^"]+"/g)) allIds.add(m[0].slice(1, -1));
}

// Read ItemFamilies.ts to get assigned IDs
const fam = fs.readFileSync("../scripts/data/ItemFamilies.ts", "utf8");
const assigned = new Set();
for (const m of fam.matchAll(/"minecraft:[^"]+"/g)) assigned.add(m[0].slice(1, -1));

// Find uncategorized items
const uncat = [...allIds].filter(id => !assigned.has(id)).sort();
console.log(`总物品: ${allIds.size}`);
console.log(`已分类: ${assigned.size}`);
console.log(`未分类: ${uncat.length}`);
console.log("\n未分类物品:");
uncat.forEach(id => console.log(`  ${id}`));
