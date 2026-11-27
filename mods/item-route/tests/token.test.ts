import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_TYPE_ID, isWarehouseToken } from "../scripts/core/token";

test("token: 信物 typeId 判定为真", () => {
  assert.equal(isWarehouseToken(TOKEN_TYPE_ID), true);
  assert.equal(isWarehouseToken("itemroute:warehouse_token"), true);
});

test("token: 原版物品一律不是信物", () => {
  // 旧版默认为木锄，本次变更后必须为假
  assert.equal(isWarehouseToken("minecraft:wooden_hoe"), false);
  assert.equal(isWarehouseToken("minecraft:stick"), false);
  assert.equal(isWarehouseToken("minecraft:diamond"), false);
  // 旧 TOKEN_OPTIONS 里的其它候选也全部失效
  for (const old of [
    "minecraft:parrot_spawn_egg",
    "minecraft:nautilus_shell",
    "minecraft:disc_fragment_5",
    "minecraft:nether_star",
    "minecraft:blaze_powder",
    "minecraft:feather",
    "minecraft:flint",
    "minecraft:blaze_rod",
    "minecraft:breeze_rod",
    "minecraft:arrow",
  ]) {
    assert.equal(isWarehouseToken(old), false, `${old} 不应是信物`);
  }
});

test("token: 空值与近义串为假", () => {
  assert.equal(isWarehouseToken(undefined), false);
  assert.equal(isWarehouseToken(""), false);
  // 大小写变体不归一（Bedrock typeId 恒小写，归一化只会掩盖物品定义写错）
  assert.equal(isWarehouseToken("itemroute:Warehouse_Token"), false);
  assert.equal(isWarehouseToken("ItemRoute:warehouse_token"), false);
  // 缺命名空间
  assert.equal(isWarehouseToken("warehouse_token"), false);
  // 前缀相近的其它物品
  assert.equal(isWarehouseToken("itemroute:warehouse_token_2"), false);
});

test("token: TOKEN_TYPE_ID 形如 namespace:name 且为小写", () => {
  assert.match(TOKEN_TYPE_ID, /^[a-z0-9_]+:[a-z0-9_]+$/);
  assert.ok(TOKEN_TYPE_ID.startsWith("itemroute:"), "沿用模组既有命名空间");
});

// ── 资产一致性：物品定义 / 短名 / 纹理 / 语言键 四者吻合 ─────────
// 这四个文件分属 BP 与 RP，任一处拼写错误在游戏里只表现为「图标丢失」或
// 「显示原始键名」，不会报错。用测试把它们钉在一起。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// 测试在 `.test-build/tests/` 下执行，需要上溯找到模组根（含 behavior_packs 的那层）。
// 不硬编码层数，避免 outDir 调整后静默指错目录。
function findModRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "behavior_packs/item-route"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error(`未能从 ${start} 上溯找到模组根目录`);
}
const MOD_ROOT = findModRoot(__dirname);
const BP_ITEM = join(MOD_ROOT, "behavior_packs/item-route/items/warehouse_token.json");
const RP_TEXTURE_ATLAS = join(MOD_ROOT, "resource_packs/item-route/textures/item_texture.json");
const RP_LANGS = join(MOD_ROOT, "resource_packs/item-route/texts/languages.json");
const RP_ZH = join(MOD_ROOT, "resource_packs/item-route/texts/zh_CN.lang");
const RP_EN = join(MOD_ROOT, "resource_packs/item-route/texts/en_US.lang");

test("资产: 物品定义 identifier 与 TOKEN_TYPE_ID 一致", () => {
  const def = JSON.parse(readFileSync(BP_ITEM, "utf8"));
  assert.equal(def["minecraft:item"].description.identifier, TOKEN_TYPE_ID);
});

test("资产: 物品图标短名在 item_texture.json 中登记且纹理文件存在", () => {
  const def = JSON.parse(readFileSync(BP_ITEM, "utf8"));
  const shortName = def["minecraft:item"].components["minecraft:icon"].textures.default;

  const atlas = JSON.parse(readFileSync(RP_TEXTURE_ATLAS, "utf8"));
  const entry = atlas.texture_data[shortName];
  assert.ok(entry, `item_texture.json 缺少短名 ${shortName}`);

  const texturePath = typeof entry.textures === "string" ? entry.textures : entry.textures[0];
  assert.equal(texturePath, "textures/itemroute/items/warehouse_token");
  assert.ok(existsSync(join(MOD_ROOT, "resource_packs/item-route", `${texturePath}.png`)), "纹理 PNG 不存在");
});

test("资产: 显示名引用的语言键在 zh_CN 与 en_US 中都有", () => {
  const def = JSON.parse(readFileSync(BP_ITEM, "utf8"));
  const langKey = def["minecraft:item"].components["minecraft:display_name"].value;
  assert.equal(langKey, `item.${TOKEN_TYPE_ID}.name`);

  for (const [file, expected] of [
    [RP_ZH, "仓库信物"],
    [RP_EN, "Warehouse Token"],
  ] as const) {
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const line: string | undefined = text.split(/\r?\n/).find((l) => l.startsWith(`${langKey}=`));
    assert.ok(line, `${file} 缺少 ${langKey}`);
    assert.equal(line, `${langKey}=${expected}`);
  }
});

test("资产: languages.json 含 zh_CN 与 en_US", () => {
  const langs = JSON.parse(readFileSync(RP_LANGS, "utf8"));
  assert.ok(langs.includes("zh_CN"));
  assert.ok(langs.includes("en_US"));
});

test("资产: 合成配方产物指向信物类型", () => {
  const recipePath = join(MOD_ROOT, "behavior_packs/item-route/recipes/warehouse_token.json");
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  const shaped = recipe["minecraft:recipe_shapeless"];

  assert.equal(shaped.result.item, TOKEN_TYPE_ID, "配方产物必须是信物");
  assert.equal(shaped.result.count, 1);
  assert.deepEqual(shaped.tags, ["crafting_table"], "配方必须在工作台可做");

  const ingredients: string[] = shaped.ingredients.map((i: { item: string }) => i.item);
  assert.ok(ingredients.includes("minecraft:chest"), "原料应含箱子（仓库语义）");
  assert.ok(ingredients.includes("minecraft:stick"), "原料应含木棍（生存早期可得）");
});
