import fs from "fs";
const c = fs.readFileSync("../scripts/data/ItemFamilies.ts", "utf8");

// Extract all items with their locations
const lines = c.split("\n");
const items = [];
let currentFamily = null;
for (let i = 0; i < lines.length; i++) {
  const fl = lines[i].match(/id: "([^"]+)"/);
  if (fl) currentFamily = fl[1];
  const m = lines[i].match(/"minecraft:[^"]+"/);
  if (m && currentFamily !== "displayName") {
    items.push({ item: m[0], family: currentFamily, line: i + 1 });
  }
}

const seen = {};
const dups = [];
for (const { item, family, line } of items) {
  if (seen[item]) {
    dups.push(`${item}: ${seen[item].family} (line ${seen[item].line}) & ${family} (line ${line})`);
  } else {
    seen[item] = { family, line };
  }
}
console.log("重复:", dups.length);
dups.forEach(d => console.log("  " + d));
