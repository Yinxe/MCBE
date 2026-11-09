// 生成配方基线快照:把源项目(迁移前)的每个配方归一化为
// { 材料集合, 图案, 产物, 数量 } 四元组,写入 tools/recipe-baseline.js。
//
// 归一化时刻意「抹平」本次规范化会改变的部分:
//   - identifier 只取名字部分(去掉斜杠或冒号命名空间)
//   - item 去掉 minecraft: 前缀,并把大小写旧别名折叠为小写
//   - (基础 ID + data) 按白名单映射为扁平化 ID 后再比较,使两种写法视为同一物品
// 这样基线既能在迁移前生成,也能在迁移后与新配方逐条对照。
//
// 用法(在 mods/craftablerarities 下):
//   node tools/build-recipe-baseline.js <源配方目录>
const fs = require("node:fs");
const path = require("node:path");
// 本目录的绝对路径:脚本固定从 tools/ 向上定位模组根,不依赖调用时的工作目录
const here = __dirname;

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  console.error("用法: node tools/build-recipe-baseline.js <源配方目录>");
  process.exit(1);
}

// 与 normalize-recipes.mjs 保持一致的白名单与别名表
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

/** 把一个 item 引用归一化为可比较的键 */
function canonicalItem(entry) {
  const raw = typeof entry === "string" ? entry : entry.item;
  const bare = raw.startsWith("minecraft:") ? raw.slice("minecraft:".length) : raw;
  const aliased = LEGACY_ALIASES[bare] ?? bare;
  if (typeof entry !== "string" && entry.data !== undefined) {
    const key = `${aliased}:${entry.data}`;
    if (FLATTENING_MAP[key] !== undefined) return FLATTENING_MAP[key];
    // 未映射的保留 data,使基线也把它当作「带数据值的独立物品」
    return `${aliased}#${entry.data}`;
  }
  return aliased;
}

/** 递归收集配方中所有 item 引用(有序,便于比对图案) */
function collectItems(node, out) {
  if (Array.isArray(node)) {
    for (const entry of node) collectItems(entry, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (node.item !== undefined || node.tag !== undefined) {
    out.push(node.tag !== undefined ? `tag:${node.tag}` : canonicalItem(node));
  }
  for (const value of Object.values(node)) collectItems(value, out);
}

const baseline = {};
for (const name of fs.readdirSync(sourceDirectory).filter((n) => n.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(sourceDirectory, name), "utf8"));
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("minecraft:recipe_")) continue;
    const identifier = value.description.identifier;
    const bareName = identifier.replace(/^.*[/:]/, "");

    // 材料:key 映射按字母序排列,消除键名与书写顺序差异
    const materials = [];
    if (value.key) {
      for (const slot of Object.keys(value.key).sort()) {
        materials.push(`${slot}=${canonicalItem(value.key[slot])}`);
      }
    }
    if (value.ingredients) {
      for (const entry of value.ingredients) materials.push(canonicalItem(entry));
    }

    baseline[bareName] = {
      kind: key.replace("minecraft:", ""),
      pattern: value.pattern ?? null,
      materials,
      result: canonicalItem(value.result),
      count: value.result?.count ?? 1,
    };
  }
}

const target = path.join(here, "recipe-baseline.js");
const header =
  "// 迁移前配方基线:由 tools/build-recipe-baseline.js 生成,供 tools/verify-recipes.js 比对。\n" +
  "// 每个配方归一化为 { kind, pattern, materials, result, count } 五元组,\n" +
  "// 归一化规则刻意抹平本次规范化会改变的部分(命名空间、前缀、大小写别名、辅助值写法)。\n";
fs.writeFileSync(target, `${header}module.exports = ${JSON.stringify(baseline, null, 2)};\n`, "utf8");
console.log(`已写入 ${target}(${Object.keys(baseline).length} 个配方)`);
