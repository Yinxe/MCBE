// 配方规范化脚本:斜杠 identifier → 冒号;item 补 minecraft: 前缀并修正大小写旧别名;
// 按「白名单映射」把可证明等价的 (item, data) 改写为扁平化显式 ID,其余保留原写法。
//
// 用法(在 mods/craftablerarities 下):
//   node tools/normalize-recipes.js --dry-run   只报告将要做出的改动,不写文件
//   node tools/normalize-recipes.js             实际写入
//
// 设计依据见 openspec/changes/add-craftablerarities-mod/design.md:
// 只有能机械核对到官方数据值表的组合才改写,无法证明等价的保留原写法。
const fs = require("node:fs");
const path = require("node:path");
// 本目录的绝对路径:脚本固定从 tools/ 向上定位模组根,不依赖调用时的工作目录
const here = __dirname;

const recipesDirectory = path.join(here, "..", "behavior_packs", "craftablerarities", "recipes");
const dryRun = process.argv.includes("--dry-run");

const MODULE_NAMESPACE = "craftablerarities";

// 大小写旧别名 → 现行 ID(去掉 minecraft: 前缀后的形式)
const LEGACY_ALIASES = {
  Feather: "feather",
  String: "string",
  TNT: "tnt",
};

// 白名单:(基础 ID, data) → 扁平化后的显式 ID
// 每一条都能在官方数据值表中找到确定映射,依据记录在 docs/research/bedrock-item-data-values.md
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

// 显式保留原写法的组合(数据值表达的不是变种索引,无法映射为独立 ID)
const KEPT_WITH_DATA = new Set(["bubble_column:0", "bubble_column:1", "potion:7"]);

/** 递归遍历配方对象,对每个含 item 的对象做规范化 */
function normalizeNode(node, changes, file) {
  if (Array.isArray(node)) {
    for (const entry of node) normalizeNode(entry, changes, file);
    return;
  }
  if (node === null || typeof node !== "object") return;

  if (typeof node.item === "string") {
    const originalItem = node.item;
    const bare = originalItem.startsWith("minecraft:")
      ? originalItem.slice("minecraft:".length)
      : originalItem;
    const aliased = LEGACY_ALIASES[bare] ?? bare;
    const dataKey = node.data === undefined ? null : `${aliased}:${node.data}`;

    if (dataKey !== null && FLATTENING_MAP[dataKey] !== undefined) {
      // 白名单命中:改写为扁平化显式 ID,并移除 data
      const originalData = node.data;
      node.item = `minecraft:${FLATTENING_MAP[dataKey]}`;
      delete node.data;
      changes.push(`${file}: ${originalItem} + data:${originalData} → ${node.item}`);
    } else {
      if (dataKey !== null && !KEPT_WITH_DATA.has(dataKey)) {
        throw new Error(
          `${file}: 遇到既不在改写白名单、也不在保留清单中的组合 ${dataKey}。` +
            `请先在 docs/research/bedrock-item-data-values.md 中确认其映射,再更新脚本。`
        );
      }
      node.item = `minecraft:${aliased}`;
    }
  }

  for (const value of Object.values(node)) {
    normalizeNode(value, changes, file);
  }
}

const files = fs.readdirSync(recipesDirectory).filter((name) => name.endsWith(".json")).sort();
const changes = [];
const identifierChanges = [];
let recipeCount = 0;

for (const name of files) {
  const filePath = path.join(recipesDirectory, name);
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("minecraft:recipe_")) continue;
    recipeCount += 1;
    const identifier = value.description.identifier;
    const bare = identifier.replace(/^.*[/:]/, "");
    const normalized = `${MODULE_NAMESPACE}:${bare}`;
    if (normalized !== identifier) {
      identifierChanges.push(`${name}: ${identifier} → ${normalized}`);
      value.description.identifier = normalized;
    }
    normalizeNode(value, changes, name);
  }

  if (!dryRun) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

console.log(`配方文件:${files.length} 个,配方条目:${recipeCount} 个`);
console.log(`identifier 改写:${identifierChanges.length} 条`);
console.log(`辅助值改写:${changes.length} 条`);
if (dryRun) {
  console.log("\n--- identifier 改写(前 5 条)---");
  for (const line of identifierChanges.slice(0, 5)) console.log(`  ${line}`);
  console.log("\n--- 辅助值改写 ---");
  for (const line of changes) console.log(`  ${line}`);
  console.log("\n(dry-run:未写入任何文件)");
}
