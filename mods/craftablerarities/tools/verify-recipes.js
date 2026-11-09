// 配方等价性校验:把当前配方归一化后与 tools/recipe-baseline.js 逐条比对。
//
// 比对四项:材料集合、图案、产物、数量。任一项不一致即判失败,并以非零码退出。
// 归一化规则与 build-recipe-baseline.js 完全一致,保证「迁移前后同一物品」在两种写法下得到相同键。
//
// 用法(在 mods/craftablerarities 下):
//   npm run verify:recipes
const fs = require("node:fs");
const path = require("node:path");
// 本目录的绝对路径:脚本固定从 tools/ 向上定位模组根,不依赖调用时的工作目录
const here = __dirname;

const recipesDirectory = path.join(here, "..", "behavior_packs", "craftablerarities", "recipes");
const baselinePath = path.join(here, "recipe-baseline.js");

// 与 normalize-recipes.js / build-recipe-baseline.js 保持一致的归一化表
const LEGACY_ALIASES = { Feather: "feather", String: "string", TNT: "tnt" };
const FLATTENING_MAP = {
  "coral:0": "tube_coral",
  "coral:1": "brain_coral",
  "coral:2": "bubble_coral",
  "coral:3": "fire_coral",
  "coral:4": "horn_coral",
  "coral_block:0": "tube_coral_block",
  "coral_block:1": "brain_coral_block",
  "coral_block:2": "bubble_coral_block",
  "coral_block:3": "fire_coral_block",
  "coral_block:4": "horn_coral_block",
  "skull:0": "skeleton_skull",
  "skull:1": "wither_skeleton_skull",
  "skull:2": "zombie_head",
  "skull:5": "dragon_head",
  "monster_egg:0": "infested_stone",
  "monster_egg:1": "infested_cobblestone",
  "monster_egg:2": "infested_stone_bricks",
  "monster_egg:3": "infested_mossy_stone_bricks",
  "monster_egg:4": "infested_cracked_stone_bricks",
  "monster_egg:5": "infested_chiseled_stone_bricks",
  "stonebrick:0": "stone_bricks",
  "stonebrick:1": "mossy_stone_bricks",
  "stonebrick:2": "cracked_stone_bricks",
  "stonebrick:3": "chiseled_stone_bricks",
  "stained_glass_pane:10": "purple_stained_glass_pane",
  "stained_hardened_clay:1": "orange_terracotta",
  "double_plant:5": "peony",
  "red_flower:7": "pink_tulip",
  "yellow_wool:4": "yellow_wool",
  "stone:3": "diorite",
};

function canonicalItem(entry) {
  const raw = typeof entry === "string" ? entry : entry.item;
  const bare = raw.startsWith("minecraft:") ? raw.slice("minecraft:".length) : raw;
  const aliased = LEGACY_ALIASES[bare] ?? bare;
  if (typeof entry !== "string" && entry.data !== undefined) {
    const key = `${aliased}:${entry.data}`;
    if (FLATTENING_MAP[key] !== undefined) return FLATTENING_MAP[key];
    return `${aliased}#${entry.data}`;
  }
  return aliased;
}

const baseline = require(baselinePath);
const actual = {};

for (const name of fs.readdirSync(recipesDirectory).filter((n) => n.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(recipesDirectory, name), "utf8"));
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("minecraft:recipe_")) continue;
    const bareName = value.description.identifier.replace(/^.*[/:]/, "");

    const materials = [];
    if (value.key) {
      for (const slot of Object.keys(value.key).sort()) {
        materials.push(`${slot}=${canonicalItem(value.key[slot])}`);
      }
    }
    if (value.ingredients) {
      for (const entry of value.ingredients) materials.push(canonicalItem(entry));
    }

    actual[bareName] = {
      kind: key.replace("minecraft:", ""),
      pattern: value.pattern ?? null,
      materials,
      result: canonicalItem(value.result),
      count: value.result?.count ?? 1,
    };
  }
}

const baselineNames = Object.keys(baseline).sort();
const actualNames = Object.keys(actual).sort();
const problems = [];

for (const name of baselineNames.filter((n) => !actualNames.includes(n))) {
  problems.push(`缺失配方:${name}`);
}
for (const name of actualNames.filter((n) => !baselineNames.includes(n))) {
  problems.push(`新增配方(基线中不存在):${name}`);
}
for (const name of baselineNames.filter((n) => actualNames.includes(n))) {
  const before = baseline[name];
  const after = actual[name];
  for (const field of ["kind", "pattern", "materials", "result", "count"]) {
    const b = JSON.stringify(before[field]);
    const a = JSON.stringify(after[field]);
    if (b !== a) problems.push(`${name}.${field}: 基线 ${b} ≠ 现在 ${a}`);
  }
}

console.log(`基线配方:${baselineNames.length} 个`);
console.log(`当前配方:${actualNames.length} 个`);
console.log(`逐字段比对:${baselineNames.length * 5} 项`);

if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 处差异:`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

console.log("\n✓ 全部配方等价:材料集合、图案、产物、数量均未变化");
