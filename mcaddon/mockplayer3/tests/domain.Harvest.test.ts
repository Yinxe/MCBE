// 通用资源采集纯逻辑单测：CollectorSpec 目录表自洽 / 列点几何与组装纯函数 /
// 工具策略评分梯度（品阶×1000 主导）。
import test from "node:test";
import assert from "node:assert/strict";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";

import type { Vec3 } from "../scripts/domain/Coords";
import type { HarvestPoint, ToolItem } from "../scripts/domain/HarvestRules";
import {
  approachCandidates,
  belowCell,
  belowPitLimit,
  columnKey,
  columnProbeLimit,
  continuationCell,
  discoveryCells,
  entryTooHigh,
  HARVEST_BREAK_REACH,
  HARVEST_CELL_BREAK_BUDGET_TICKS,
  HARVEST_DRY_TRIES,
  HARVEST_NAV_DEADLINE_TICKS,
  HARVEST_NAV_GIVEUP_TRIES,
  HARVEST_NAV_HIGH_Y,
  HARVEST_NAV_POLL_TICKS,
  HARVEST_NAV_WALK_BUDGET_TICKS,
  HARVEST_PICK_MAX_DIST,
  HARVEST_REACH_MARGIN,
  HARVEST_RETRY_BUDGET_FLOOR_TICKS,
  HARVEST_SCAN_RADIUS_XZ,
  HARVEST_SKIP_TTL,
  HARVEST_SKIP_TTL_STARVED,
  harvestPoolKey,
  harvestRecipe,
  harvestScanRect,
  inBreakReach,
  isTargetId,
  makeChainLimit,
  makeDropAccept,
  MATERIAL_TIER,
  materialTier,
  normalizeHarvestKind,
  parseHarvestKind,
  pickToolSlot,
  scoreAxe,
  scoreLeafTool,
  scoreShovel,
  specOf,
  topmostPerColumn,
  toolCategoryOf,
  underFeet,
  upCell,
  withinPickReach,
  HARVEST_KINDS,
} from "../scripts/domain/HarvestRules";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ─── 目录表自洽 ────────────────────────────────────────

test("harvest·目录表：id 唯一且 specOf 与表同源（缺项即抛）", () => {
  const ids = HARVEST_KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const k of HARVEST_KINDS) assert.equal(specOf(k.id), k);
  assert.throws(() => specOf("bedrock" as never), /缺项/);
});

test("harvest·目录表：scanTypeIds 逐格命中方块真值表——非法 id 会让 getBlocks 整批拒绝（用户实测 2026-09-29 树叶扫描失败根因）", () => {
  // 对照表＝vanilla-data 的方块 id 全集（node 侧可读）：扫描白名单写错 id 会让
  // getBlocks 整批拒绝，查表即可发现。
  const known = new Set<string>(Object.values(MinecraftBlockTypes) as string[]);
  for (const spec of HARVEST_KINDS) {
    assert.ok(spec.scanTypeIds.length > 0, spec.id);
    for (const id of spec.scanTypeIds) {
      assert.ok(id.startsWith("minecraft:"), id);
      assert.ok(known.has(id), `${spec.id} 扫描白名单 id 不在方块真值表: ${id}`);
    }
  }
});

test("harvest·目录表：目标格型自身必是感兴趣掉落物（精准采自掉同名不漏吸；排除前缀不误伤）", () => {
  for (const spec of HARVEST_KINDS) {
    const accept = makeDropAccept(spec);
    for (const id of spec.scanTypeIds) {
      assert.ok(accept(id), `${spec.id}: 目标格 ${id} 的自掉物不被吸附表接受`);
    }
  }
});

test("harvest·目录表：原木 bottomUp（贴根砍沿列上伐）", () => {
  assert.equal(specOf("wood").digOrder, "bottomUp");
  for (const k of HARVEST_KINDS) assert.ok(k.digOrder === "bottomUp" || k.digOrder === "topDown", k.id);
});

test("harvest·normalize/parse：非法值 parse 即拒、normalize 兜底 wood（可指定回退）", () => {
  assert.equal(parseHarvestKind("wood"), "wood");
  assert.equal(parseHarvestKind("leaves"), undefined, "树叶档已从目录移除");
  assert.equal(parseHarvestKind("dirt"), undefined, "泥土档已从目录移除");
  assert.equal(parseHarvestKind("bedrock"), undefined);
  assert.equal(parseHarvestKind(undefined), undefined);
  assert.equal(parseHarvestKind(3), undefined);
  assert.equal(normalizeHarvestKind("bedrock"), "wood");
  assert.equal(normalizeHarvestKind(null, "wood"), "wood");
  assert.equal(normalizeHarvestKind("leaves"), "wood", "非法 kind 折回默认 wood");
});

// ─── 掉落物吸附谓词 ────────────────────────────────────

test("harvest·makeDropAccept(wood)：原木/树苗收，去皮木与木板拒", () => {
  const accept = makeDropAccept(specOf("wood"));
  assert.ok(accept("minecraft:oak_log"));
  assert.ok(accept("minecraft:crimson_stem"));
  assert.ok(accept("minecraft:log"), "legacy 聚合物品 id 只允许出现在掉落物匹配表");
  assert.ok(accept("minecraft:oak_sapling"));
  assert.ok(!accept("minecraft:stripped_oak_log")); // 去皮系以 _log 结尾但非自然掉落
  assert.ok(!accept("minecraft:oak_planks"));
  assert.ok(!accept("minecraft:stick"));
  assert.ok(!accept("minecraft:apple"), "苹果归树叶采集的兴趣物，原木档不收");
});

// ─── 列点组装与几何 ────────────────────────────────────

test("harvest·columnKey/harvestPoolKey：负坐标原样入键、域键维度#对象", () => {
  assert.equal(columnKey(-3, 5), "-3:5");
  assert.equal(columnKey(1, 2), "1:2");
  assert.equal(harvestPoolKey("minecraft:overworld", "wood"), "minecraft:overworld#wood");
});

test("harvest·topmostPerColumn：乱序输入取列最高、y 降序同高按列键升序、负坐标正常", () => {
  const pts = topmostPerColumn([
    v(10, 64, 3),
    v(10, 70, 3), // 同列更高
    v(-2, 66, -5),
    v(10, 68, 3),
    v(4, 66, 9), // 与 (-2,-5) 同高 → 按 x 升序（-2 在前）
  ]);
  assert.deepEqual(
    pts.map((p) => [p.key, p.loc.y, p.base.y]),
    [
      ["10:3", 70, 64], // 树冠顶与树脚同随扫描带出
      ["-2:-5", 66, 66],
      ["4:9", 66, 66],
    ]
  );
  assert.deepEqual(topmostPerColumn([]), []);
});

test("harvest·isTargetId：表内类型收、undefined/表外拒", () => {
  const spec = specOf("wood");
  assert.ok(isTargetId(spec, "minecraft:oak_log"));
  assert.ok(!isTargetId(spec, "minecraft:oak_leaves"));
  assert.ok(!isTargetId(spec, undefined));
});

test("harvest·withinPickReach：水平距离按列中心计，≤16 收 >16 拒", () => {
  const bot = v(0.5, 64, 0.5);
  const pt = (key: string, x: number, z: number): HarvestPoint => ({ key, loc: v(x, 64, z), base: v(x, 63, z) });
  assert.ok(withinPickReach(bot, pt("16:0", 16, 0))); // 到列中心恰 16
  assert.ok(!withinPickReach(bot, pt("17:0", 17, 0)));
  assert.ok(withinPickReach(bot, pt("0:-16", 0, -16)));
  assert.ok(!withinPickReach(bot, pt("12:12", 12, 12)), `对角 √288 > ${HARVEST_PICK_MAX_DIST}`);
  assert.equal(HARVEST_PICK_MAX_DIST, 16);
});

test("harvest·inBreakReach：舒适圈=破坏距-余量，列外恰在边上必须再贴靠、列内正下方放宽到硬闸（缺52 死循环入口 + 缺55 修订二）", () => {
  const bot = v(0.5, 64, 0.5);
  assert.ok(inBreakReach(bot, v(0, 64, 4)), "3.54 ≤ 5.5 就地开挖");
  assert.ok(!inBreakReach(bot, v(0, 64, 6)), "5.52 在破坏距内但出舒适圈——旧口径在此判就地开挖，续列即 far");
  assert.ok(
    inBreakReach(bot, v(0, 70, 0)),
    "正下方 6 格高差：角点 6.04 出舒适闸，但水平落进目标列——用户实测足够挖掘（缺55 修订二）"
  );
  assert.ok(!inBreakReach(bot, v(0, 71, 0)), "垂直高差 7 格＝7.04 连硬闸也出，仍须贴靠（绝不举着空气开挖）");
  assert.ok(
    !inBreakReach(bot, v(0, 70, 3)),
    "侧向 3 格同高差 6.52 出闸——正下方例外只属于水平落进该列的体位，绝不放宽成整圈 7 格"
  );
  assert.ok(inBreakReach(bot, v(0, 68, 0), 0, 5), "margin/reach 可代入（4.03 ≤ 5）");
  assert.ok(!inBreakReach(bot, v(0, 68, 3), 1.5, 5), "同距换余量即出局——余量是真安全垫（列外无硬闸例外）");
  assert.equal(HARVEST_BREAK_REACH, 7);
  assert.equal(HARVEST_REACH_MARGIN, 1.5);
});

test("harvest·approachCandidates：只出目标列的水平 8 邻列，脚位层交引擎投影（y 恒为高位常量）", () => {
  const target = v(5, 72, 168);
  const bot = v(5.5, 70, 175);
  const cells = approachCandidates(target, bot);
  assert.equal(cells.length, 8, "8 邻列=8 个候选，一列一条走位");
  assert.ok(
    cells.every((c) => c.y === HARVEST_NAV_HIGH_Y),
    "候选只裁决 xz——脚位层由引擎按列投影地面"
  );
  assert.ok(HARVEST_NAV_HIGH_Y > 320, "高位 Y 必须高于世界建筑高度 320，才不会被当成可站层参与路径");
  assert.ok(!cells.some((c) => c.x === target.x && c.z === target.z), "目标列本身不出：其投影落点是树顶");
  const offsets = new Set(cells.map((c) => `${c.x - target.x},${c.z - target.z}`));
  assert.deepEqual(
    [...offsets].sort(),
    ["-1,-1", "-1,0", "-1,1", "0,-1", "0,1", "1,-1", "1,0", "1,1"],
    "水平 8 邻齐全（含 4 斜角：正贴列被邻株占死时仍有斜向落点）"
  );
});

test("harvest·approachCandidates：按离假人水平距离升序（少走一步是一步），同输入同序", () => {
  const target = v(0, 64, 0);
  const bot = v(0.5, 64, 3.5); // 正北偏东：只有 (0,1) 列离得最近
  const cells = approachCandidates(target, bot);
  const foot = (c: Vec3) => Math.hypot(c.x + 0.5 - bot.x, c.z + 0.5 - bot.z);
  for (let i = 1; i < cells.length; i++) {
    assert.ok(foot(cells[i]!) >= foot(cells[i - 1]!) - 1e-9, `候选按离假人升序：${JSON.stringify(cells)}`);
  }
  assert.deepEqual(cells[0], { x: 0, y: HARVEST_NAV_HIGH_Y, z: 1 }, "首选＝离假人最近的贴靠列");
  assert.deepEqual(approachCandidates(target, bot), approachCandidates(target, bot), "确定性");
});

test("harvest·approachCandidates：候选列与目标层高、假人层高无关（山坡/树基高低同一套环）", () => {
  const bot = v(0.5, 64.2, 0.5);
  const ring = (t: Vec3) =>
    approachCandidates(t, bot)
      .map((c) => `${c.x},${c.z}`)
      .join(" ");
  assert.equal(ring(v(0, 69, 0)), ring(v(0, 64, 0)), "目标高出 5 格不改候选列——够不着的高度由认领 reachUp 把关");
  assert.equal(ring(v(0, 60, 0)), ring(v(0, 64, 0)), "目标低出脚层同样只是 xz 环（下坡挖低格＝走到旁边）");
});

test("harvest·approachCandidates：贴靠列投影到与目标同层即判到位（够不够得着只在到场后复判）", () => {
  const target = v(5, 72, 168);
  const bot = v(5.5, 70, 175);
  for (const c of approachCandidates(target, bot)) {
    assert.ok(inBreakReach(v(c.x + 0.5, target.y, c.z + 0.5), target), `同层贴位必判到位：${JSON.stringify(c)}`);
  }
  assert.ok(!inBreakReach(v(5.5, 72, 174.5), target), "隔 6 格不在环内——贴靠距离确有上限，不是随便站哪都行");
});

test("harvest·discoveryCells/belowCell：六邻齐全不含自身、续列只向下", () => {
  const cells = discoveryCells(v(10, 64, 20));
  assert.equal(cells.length, 6);
  assert.ok(!cells.some((c) => c.x === 10 && c.y === 64 && c.z === 20));
  const keys = new Set(cells.map((c) => columnKey(c.x, c.z)));
  assert.ok(
    keys.has("11:20") && keys.has("9:20") && keys.has("10:21") && keys.has("10:19") && keys.has("10:20"),
    "四向+同列上下"
  );
  assert.deepEqual(belowCell(v(10, 64, 20)), v(10, 63, 20));
});

test("harvest·upCell/continuationCell/columnProbeLimit：续列方向随 digOrder、探基盒身封顶", () => {
  assert.deepEqual(upCell(v(10, 64, 20)), v(10, 65, 20));
  assert.deepEqual(continuationCell(v(10, 64, 20), "bottomUp"), v(10, 65, 20), "bottomUp 向树冠上爬");
  assert.deepEqual(continuationCell(v(10, 64, 20), "topDown"), v(10, 63, 20), "topDown 向地底下剥");
  assert.equal(columnProbeLimit(specOf("wood")), 8 + 24 + 1, "顶格在盒内则整列最长=盒高，超出止损");
});

test("harvest·harvestScanRect：水平 ±16、y 盒随采集对象（wood 向上罩树冠）", () => {
  const wood = harvestScanRect(v(8.5, 64.2, -3.5), specOf("wood"));
  assert.deepEqual(
    wood.min,
    { x: 8 - HARVEST_SCAN_RADIUS_XZ, y: 56, z: -4 - HARVEST_SCAN_RADIUS_XZ },
    "负坐标按 floor 取格"
  );
  assert.deepEqual(wood.max, { x: 24, y: 88, z: 12 });
});

test("harvest·逐拍决策常量：走位观测 10t 一拍/单候选 100t/一轮贴靠 400t/连续 3 列无果暂停/跳过 600t（无他点可领 150t）/干涸 3 轮/认领在扫描半径内", () => {
  assert.equal(HARVEST_NAV_POLL_TICKS, 10);
  assert.equal(HARVEST_NAV_WALK_BUDGET_TICKS, 100);
  assert.equal(HARVEST_NAV_DEADLINE_TICKS, 400);
  assert.ok(
    HARVEST_NAV_WALK_BUDGET_TICKS < HARVEST_NAV_DEADLINE_TICKS,
    "单候选预算必须小于一轮贴靠预算——一轮至少能试完数个候选再判超时"
  );
  assert.equal(HARVEST_NAV_GIVEUP_TRIES, 3);
  assert.equal(HARVEST_SKIP_TTL, 600);
  assert.equal(HARVEST_SKIP_TTL_STARVED, 150);
  assert.ok(HARVEST_SKIP_TTL_STARVED < HARVEST_SKIP_TTL, "短窗只用于没别的去处时提前复评");
  assert.equal(HARVEST_DRY_TRIES, 3);
  assert.equal(HARVEST_CELL_BREAK_BUDGET_TICKS, 200);
  assert.equal(HARVEST_RETRY_BUDGET_FLOOR_TICKS, 50);
  assert.ok(HARVEST_RETRY_BUDGET_FLOOR_TICKS < HARVEST_CELL_BREAK_BUDGET_TICKS, "换站学费下限必须低于首格全额预算");
  assert.ok(HARVEST_PICK_MAX_DIST <= HARVEST_SCAN_RADIUS_XZ, "认领半径不得超过扫描盒，否则池里永远没有圈外点");
});

test("harvest·topmostPerColumn(at)：给扫描锚点则按离锚点水平距离升序入池（就近优先），同距按列键确定序", () => {
  const at = v(0.5, 64, 0.5);
  const pts = topmostPerColumn([v(30, 64, 0), v(2, 70, 0), v(0, 66, -2), v(-2, 66, 0), v(5, 64, 5)], at);
  const order = pts.map((p) => p.key);
  assert.deepEqual(order, ["2:0", "-2:0", "0:-2", "5:5", "30:0"]);
  assert.deepEqual(topmostPerColumn([v(1, 2, 3)], at), topmostPerColumn([v(1, 2, 3)], at), "确定性");
});

// ─── 工作配方适配 ──────────────────────────────────────

test("harvest·harvestRecipe：目录行装配——首格策略/护栏截断/续航方向/记忆键与扫描盒同源", () => {
  const wood = harvestRecipe("wood");
  assert.equal(wood.id, "harvest_wood");
  const bot = v(8.5, 64.2, 0.5);
  const point = { key: "10:0", loc: v(10, 70, 0), base: v(10, 65, 0) };
  // bottomUp：entry=列底格；高出可达带（70-64>5）的顶格不入选、脚下列即 null
  assert.deepEqual(wood.entryCell(point, bot), v(10, 65, 0));
  assert.equal(wood.entryCell({ key: "8:0", loc: v(8, 70, 0), base: v(8, 64, 0) }, bot), null, "脚下列永不作首格");
  assert.equal(
    wood.entryCell({ key: "9:0", loc: v(9, 76, 0), base: v(9, 71, 0) }, bot),
    null,
    "列底高出可达带即够不着"
  );
  assert.deepEqual(wood.nextCell(v(10, 65, 0)), v(10, 66, 0), "原木向树冠上爬");
  assert.deepEqual(wood.scanRect(bot), harvestScanRect(bot, specOf("wood")), "扫描盒与目录同源");
  assert.ok(wood.isTarget("minecraft:oak_log") && !wood.isTarget("minecraft:dirt"));
  assert.ok(wood.acceptsDrop("minecraft:oak_log") && !wood.acceptsDrop("minecraft:stripped_oak_log"));
});

// ─── 安全护栏 ──────────────────────────────────────────

test("harvest·underFeet：同列下方含正踩格一律禁挖，邻列/上方不受限", () => {
  const bot = v(8.5, 64.2, 0.5);
  assert.ok(underFeet(bot, v(8, 64, 0)), "正踩格");
  assert.ok(underFeet(bot, v(8, 60, 0)), "脚下同列向下延伸");
  assert.ok(!underFeet(bot, v(8, 65, 0)), "同列上方可挖");
  assert.ok(!underFeet(bot, v(9, 60, 0)), "邻列不受限");
});

test("harvest·entryTooHigh/belowPitLimit：可达带与坑缘各自的截断边界", () => {
  const bot = v(8.5, 64.2, 0.5);
  assert.ok(!entryTooHigh(v(8, 69, 0), bot, 5), "恰在带上沿可挖");
  assert.ok(entryTooHigh(v(8, 70, 0), bot, 5), "高出上沿即够不着");
  assert.ok(belowPitLimit(v(8, 59, 0), 64, 4), "坑缘以下第 1 格截断");
  assert.ok(!belowPitLimit(v(8, 60, 0), 64, 4), "恰在坑缘可挖");
});

test("harvest·makeChainLimit：脚下护栏双向成立；坑深只截向下，bottomUp(maxDown=0) 上爬不断列", () => {
  const bot = v(8.5, 64.2, 0.5);
  const bottomUp = makeChainLimit(0);
  assert.ok(bottomUp(v(8, 65, 0), v(8, 64, 0), bot), "脚下列向下截断（脚下护栏）");
  assert.ok(!bottomUp(v(9, 64, 0), v(9, 65, 0), bot), "邻列向上爬树不受坑深截断");
  assert.ok(bottomUp(v(9, 64, 0), v(9, 63, 0), bot), "邻列向下受坑缘(maxDown=0)截断");
  const topDown = makeChainLimit(4);
  assert.ok(topDown(v(9, 60, 0), v(9, 59, 0), bot), "剥到坑缘以下第 1 格截断（坑缘 60 本身可挖）");
  assert.ok(!topDown(v(9, 61, 0), v(9, 60, 0), bot), "恰在坑缘不截断");
  assert.ok(!topDown(v(9, 61, 0), v(9, 61, 1), bot), "同层不触发坑深");
});

// ─── 工具策略评分 ──────────────────────────────────────

function tool(slot: number, typeId: string, enchantments: { id: string; level: number }[] = []): ToolItem {
  return { slot, typeId, enchantments, category: toolCategoryOf(typeId) };
}

test("harvest·toolCategoryOf/materialTier：类别按后缀、材质按前缀", () => {
  assert.equal(toolCategoryOf("minecraft:iron_axe"), "axe");
  assert.equal(toolCategoryOf("minecraft:golden_hoe"), "hoe");
  assert.equal(toolCategoryOf("minecraft:diamond_shovel"), "shovel");
  assert.equal(toolCategoryOf("minecraft:shears"), "shears");
  assert.equal(toolCategoryOf("minecraft:stick"), "other");
  assert.equal(materialTier("minecraft:netherite_axe"), MATERIAL_TIER.netherite);
  assert.equal(materialTier("minecraft:shears"), 0);
});

test("harvest·pickToolSlot(axe)：品阶主导（木斧效率5 < 石斧）、同品阶效率>耐久>精准>时运", () => {
  const tools = [tool(0, "minecraft:wooden_axe", [{ id: "efficiency", level: 5 }]), tool(1, "minecraft:stone_axe")];
  assert.equal(pickToolSlot("axe", tools), 1, "品阶×1000 梯度远大于附魔总分");
  const ench = [
    tool(0, "minecraft:iron_axe", [{ id: "unbreaking", level: 1 }]),
    tool(1, "minecraft:iron_axe", [{ id: "silk_touch", level: 1 }]),
    tool(2, "minecraft:iron_axe", [{ id: "fortune", level: 1 }]),
    tool(3, "minecraft:iron_axe", [{ id: "efficiency", level: 1 }]),
  ];
  assert.equal(pickToolSlot("axe", ench), 3);
  assert.ok(scoreAxe(ench[3]!) > scoreAxe(ench[0]!));
  assert.ok(scoreAxe(ench[0]!) > scoreAxe(ench[1]!));
  assert.ok(scoreAxe(ench[1]!) > scoreAxe(ench[2]!));
});

test("harvest·pickToolSlot(axe)：非斧一律出局（剪刀锄头铲不给分）、空背包 undefined", () => {
  assert.equal(
    pickToolSlot("axe", [tool(0, "minecraft:shears"), tool(1, "minecraft:iron_hoe", [{ id: "efficiency", level: 5 }])]),
    undefined
  );
  assert.equal(pickToolSlot("axe", []), undefined);
  assert.ok(scoreAxe(tool(0, "minecraft:iron_pickaxe")) < 0);
});

test("harvest·pickToolSlot(leaf)：精准锄 > 剪刀 > 任意精准 > 无精准（netherite 精准斧也越不过剪刀）", () => {
  const silkAxe = tool(0, "minecraft:netherite_axe", [
    { id: "silk_touch", level: 1 },
    { id: "efficiency", level: 5 },
  ]);
  const shears = tool(1, "minecraft:shears", [{ id: "unbreaking", level: 5 }]);
  const woodenSilkHoe = tool(2, "minecraft:wooden_hoe", [{ id: "silk_touch", level: 1 }]);
  const plainDiamondAxe = tool(3, "minecraft:diamond_axe", [{ id: "efficiency", level: 5 }]);
  assert.equal(pickToolSlot("leaf", [silkAxe, shears, woodenSilkHoe, plainDiamondAxe]), 2, "木精准锄仍压剪刀");
  assert.equal(pickToolSlot("leaf", [silkAxe, shears, plainDiamondAxe]), 1, "无锄时剪刀 > netherite 精准斧");
  assert.equal(pickToolSlot("leaf", [silkAxe, plainDiamondAxe]), 0, "无剪刀时精准斧 > 无精准钻斧");
  assert.equal(pickToolSlot("leaf", [plainDiamondAxe]), 3, "全无精准时按品阶+效率兜底");
  assert.ok(scoreLeafTool(shears) > scoreLeafTool(silkAxe), "剪刀档分数梯度恒压任意精准");
  assert.ok(scoreLeafTool(woodenSilkHoe) > scoreLeafTool(shears), "精准锄档恒压剪刀");
});

test("harvest·pickToolSlot(shovel)：只认铲、铲内品阶优先效率次之", () => {
  assert.equal(
    pickToolSlot("shovel", [
      tool(0, "minecraft:diamond_axe", [{ id: "efficiency", level: 5 }]),
      tool(1, "minecraft:wooden_shovel"),
    ]),
    1
  );
  assert.equal(
    pickToolSlot("shovel", [
      tool(0, "minecraft:iron_shovel", [{ id: "unbreaking", level: 3 }]),
      tool(1, "minecraft:stone_shovel", [{ id: "efficiency", level: 1 }]),
    ]),
    0,
    "铁铲带耐久仍高过石铲带效率（品阶主导）"
  );
  assert.ok(
    scoreShovel(tool(0, "minecraft:iron_shovel", [{ id: "efficiency", level: 1 }])) >
      scoreShovel(tool(1, "minecraft:iron_shovel", [{ id: "fortune", level: 5 }]))
  );
  assert.equal(pickToolSlot("shovel", [tool(0, "minecraft:shears")]), undefined);
});
