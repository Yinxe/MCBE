// ─── 通用资源采集纯逻辑（domain 层，零 @minecraft，流程：寻点→靠近→采集→收集→换点） ───
// CollectorSpec 数据表 = 全部采集对象的唯一真源，新增采集对象=在这里加一行数据；
// harvestRecipe(kind) 把数据行装配成 HarvestRecipe，供逐拍决策大脑（HarvestAI）消费。
// 注：getBlocks 的 includeTypes 只要有一个 id 引擎不认识就整批抛错，白名单一律用 Bedrock 原生 id。

import type { Vec3 } from "./Coords";
import { distance3d, horizontalDistance } from "./Coords";
import type { PoolPoint } from "./Pool";
import type { DurabilitySnapshot } from "./ToolRules";
import { isDurabilityCritical } from "./ToolRules";

// ─── 采集对象目录（CollectorSpec） ──────────────────────────────

/** 采集对象 id（模式族 harvest_<kind> 的 kind 段；目录/UI 派生顺序=表序） */
export type HarvestKindId = "wood";

/** 工具策略（按目标类别选主手工具；评分见下方纯函数） */
export type ToolStrategy = "axe" | "pickaxe" | "leaf" | "shovel";

/** 列续航方向：bottomUp=自列底向上连挖；topDown=自列顶向下连挖 */
export type DigOrder = "bottomUp" | "topDown";

/** 掉落物拾取匹配规则（引擎吸拾筛选的数据源；excludePrefixes 先判） */
export interface DropAcceptRule {
  exact: readonly string[];
  suffixes: readonly string[];
  excludePrefixes: readonly string[];
}

/** 扫描体积 y 盒（相对假人脚位格：down 向下、up 向上，含 0 层） */
export interface ScanBox {
  down: number;
  up: number;
}

/** 单个采集对象的完整数据行 */
export interface CollectorSpec {
  id: HarvestKindId;
  /** 中文名（播报/面板派生） */
  label: string;
  /** RegionScanner includeTypes——只放扁平 id（引擎整批拒绝防线） */
  scanTypeIds: readonly string[];
  dropAccept: DropAcceptRule;
  toolStrategy: ToolStrategy;
  scanBox: ScanBox;
  digOrder: DigOrder;
  /** 首格=列底且允许逐拍下探验基（树木贴根口径；原木专用） */
  probeBase: boolean;
  /** 首格高出脚层此值以上即整列收场：够不着的树冠/上层原木不再追挖，转下株 */
  reachUp: number;
  /** 下探深度上限（格，相对站位层）：超出即视为坑缘已尽，换邻列 */
  maxDown: number;
  /** 起砍后掉落扫尾窗口（tick）：逐格破坏的残粒与延迟枯萎掉落在此窗内按节拍补吸 */
  dropSettleTicks: number;
}

/** 采集对象目录（表序=命令 list/面板下拉顺序） */
export const HARVEST_KINDS: readonly CollectorSpec[] = [
  {
    id: "wood",
    label: "原木",
    scanTypeIds: [
      "minecraft:oak_log",
      "minecraft:spruce_log",
      "minecraft:birch_log",
      "minecraft:jungle_log",
      "minecraft:acacia_log",
      "minecraft:dark_oak_log",
      "minecraft:mangrove_log",
      "minecraft:cherry_log",
      "minecraft:pale_oak_log",
      "minecraft:crimson_stem",
      "minecraft:warped_stem",
    ],
    dropAccept: {
      // 去皮系以 _log 结尾但非自然掉落；树苗=整树摇落物
      exact: ["minecraft:log", "minecraft:log2"],
      suffixes: ["_log", "_stem", "_sapling"],
      excludePrefixes: ["minecraft:stripped_"],
    },
    toolStrategy: "axe",
    scanBox: { down: 8, up: 24 }, // 树干整体罩进体积：列顶=最顶原木
    digOrder: "bottomUp", // 自树基起沿列逐格上挖，砍到够不着即整株收场转下株（Bedrock 无树木倾倒）
    probeBase: true,
    reachUp: 5,
    maxDown: 0, // bottomUp 不向下续航
    dropSettleTicks: 40, // 逐格伐干掉落即出，短窗扫尾接住残粒
  },
];

/** 按 id 取采集对象目录项，缺项抛错 */
export function specOf(kind: HarvestKindId): CollectorSpec {
  const spec = HARVEST_KINDS.find((k) => k.id === kind);
  if (!spec) throw new Error(`采集对象目录缺项: ${kind}`);
  return spec;
}

/** 严格解析（命令校验用）；非法返回 undefined */
export function parseHarvestKind(value: unknown): HarvestKindId | undefined {
  return typeof value === "string" ? HARVEST_KINDS.find((k) => k.id === value)?.id : undefined;
}

/** 规范化；非法/缺省回退 fallback（默认 wood） */
export function normalizeHarvestKind(value: unknown, fallback: HarvestKindId = "wood"): HarvestKindId {
  return parseHarvestKind(value) ?? fallback;
}

// ─── 常量（数值口径集中，能力侧零魔法数） ──────────────────────

/** 破坏距上限（格），与 breakAt maxDistance 同口径（引擎不限距，纯策略值） */
export const HARVEST_BREAK_REACH = 7;
/** 单格破坏进度上限（tick）：目标在自检距内不代表引擎真够得着（模拟玩家实际够距可能小于
 *  HARVEST_BREAK_REACH），连破无超时护栏会在此格每 tick 空挥永不返回。取最慢合法破坏（徒手原木约 60t）
 *  的三倍以上余量，既不误断真实慢破坏，又给卡死一个确定出口。 */
export const HARVEST_CELL_BREAK_BUDGET_TICKS = 200;
/** 同列换站位后单格破坏预算下限（tick）：预算防的是"最慢合法破坏"，与尝试次数无关，
 *  首格全额已足够证明慢不是常态；此后每换一次站位减半至此下限——真够不着的列不再每轮付满额学费。 */
export const HARVEST_RETRY_BUDGET_FLOOR_TICKS = 50;
/** 认领半径（格，水平）：与统一 ≤16 导航同口径 */
export const HARVEST_PICK_MAX_DIST = 16;
/** 扫描水平半径（格，x/z；y 盒随采集对象） */
export const HARVEST_SCAN_RADIUS_XZ = 16;
/** 单轮认领复查预算（点） */
export const HARVEST_CLAIM_PROBES = 6;
/** 会话侧扫描冷却（tick） */
export const HARVEST_SCAN_COOLDOWN_TICKS = 120;
/** 池侧扫描节流（tick）：同 (维度,对象) 全维度共用一次进行中的扫描 */
export const HARVEST_GROUND_SCAN_THROTTLE_TICKS = 60;
/** 启动稳定期（tick） */
export const HARVEST_INIT_TICKS = 20;
/** 瞬态（取不到快照）后的重探等待（tick） */
export const HARVEST_RECHECK_TICKS = 50;
/** 干涸判定：连续 0 新点可信扫描轮数 */
export const HARVEST_DRY_TRIES = 3;
/** 够不着/走不通列的会话私有跳过时长（tick）：到期复评，不进共享池失败计数 */
export const HARVEST_SKIP_TTL = 600;
/** 无其他可领点时的跳过时长（tick）：池水位不足且手上没有别的去处，才提前复评被跳过的列 */
export const HARVEST_SKIP_TTL_STARVED = 150;
/** 侧向发现列向下探基上限（格）：把邻株半腰格回退到其真正树基，防以悬空格起砍 */
export const HARVEST_DISCOVER_PROBE = 16;
/** 扫描分帧预算（命中格/tick） */
export const HARVEST_SCAN_BUDGET = 300;
/** 一列的贴靠总预算（tick）：超时判该列走不通，释放点位并短期跳过（实测值、改动需附证据） */
export const HARVEST_NAV_DEADLINE_TICKS = 400;
/** 单个站位候选的走位预算（tick）：引擎观测到停下即提前回结论，此值只兜"一直在挪但到不了"
 *  （5s 内走不完一段 ≤16 格贴靠即视为该候选不可用，换下一候选）（实测值、改动需附证据） */
export const HARVEST_NAV_WALK_BUDGET_TICKS = 100;
/** 大脑等待走位结论期间的唤醒间隔（tick）：与 engine 导航观测节拍一致，不逐拍空转 */
export const HARVEST_NAV_POLL_TICKS = 10;
/** 连续多少列导航整列无果（站位用尽/超时）才终态暂停（列）：任一次开砍即清零 */
export const HARVEST_NAV_GIVEUP_TRIES = 3;
/** 采集导航净速倍率（navigateToLocation speed）：略高于默认 1，缩短贴靠走位耗时 */
export const HARVEST_NAV_SPEED = 1.2;

// ─── 到位判据常量 ────────────────────────────────────────────

/** 贴靠舒适余量（格）：到位判据 = 脚位到目标角点距 ≤ REACH - 此值，防止在距离临界格反复来回 */
export const HARVEST_REACH_MARGIN = 1.5;

// ─── 点位与几何（纯函数） ──────────────────────────────────────

/**
 * 采集点（列点模型）：loc=该列扫描体积内最高目标格，base=同批命中最低格
 * （bottomUp 直接用 base 起挖，免去逐 tick 下探）。
 */
export interface HarvestPoint extends PoolPoint {
  /** 列键 `${x}:${z}`（池按 dim#kind 分域，列键在域内唯一） */
  key: string;
  loc: Vec3;
  base: Vec3;
}

/** 列键（同一 x:z 列共享一个点：破完一列再换列） */
export function columnKey(x: number, z: number): string {
  return `${x}:${z}`;
}

/** 点池域键（HarvestGrounds 注册表索引） */
export function harvestPoolKey(dimId: string, kind: HarvestKindId): string {
  return `${dimId}#${kind}`;
}

/**
 * 命中格集合 → 每列最高/最低目标格（列去重）。
 * 传入扫描锚点 `at` 时输出按离锚点水平距离升序（就近入池，池 FIFO 即近似优先队列）；
 * 缺省按 y 降序、同高按列键升序（确定性入池序）。
 */
export function topmostPerColumn(hits: readonly Vec3[], at?: Vec3): HarvestPoint[] {
  const top = new Map<string, Vec3>();
  const bottom = new Map<string, Vec3>();
  for (const h of hits) {
    const key = columnKey(h.x, h.z);
    const cur = top.get(key);
    if (!cur || h.y > cur.y) top.set(key, h);
    const low = bottom.get(key);
    if (!low || h.y < low.y) bottom.set(key, h);
  }
  const out: HarvestPoint[] = [];
  for (const [key, loc] of top) out.push({ key, loc, base: bottom.get(key)! });
  if (at) {
    out.sort(
      (a, b) =>
        horizontalDistance(at, { x: a.loc.x, y: 0, z: a.loc.z }) -
          horizontalDistance(at, { x: b.loc.x, y: 0, z: b.loc.z }) || a.key.localeCompare(b.key)
    );
  } else {
    out.sort((a, b) => b.loc.y - a.loc.y || a.loc.x - b.loc.x || a.loc.z - b.loc.z);
  }
  return out;
}

/** 认领 prefilter：假人到列的水平距离 ≤ 认领半径（纯算术，不触世界） */
export function withinPickReach(bot: Vec3, p: HarvestPoint, maxDist = HARVEST_PICK_MAX_DIST): boolean {
  return horizontalDistance(bot, { x: p.loc.x + 0.5, y: bot.y, z: p.loc.z + 0.5 }) <= maxDist;
}

/**
 * 该列是否正是假人当下脚踩的那一列（同 x/z 位，不论层）。认领复核用它区分两种"首格当下不成立"：
 * 同列=就地自掘（须短期跳过，绝不下挖自己站位）；异列多只是离得远看不够高，走过去由到场重算。
 * @param bot - 假人位置（连续坐标）
 * @param point - 待认领列点
 */
export function isBotOwnColumn(bot: Vec3, point: { loc: Vec3 }): boolean {
  return Math.floor(bot.x) === point.loc.x && Math.floor(bot.z) === point.loc.z;
}

/** 已在破坏舒适圈内（到位/就地开挖唯一判据，见 withinStandGate） */
export function inBreakReach(
  bot: Vec3,
  loc: Vec3,
  margin = HARVEST_REACH_MARGIN,
  reach = HARVEST_BREAK_REACH
): boolean {
  return withinStandGate(bot, loc, reach - margin, reach);
}

/**
 * 贴靠到位统一判据：脚位到目标角点距 ≤ gate 即到位；假人水平落在目标列
 * footprint 内（正下方）时放宽到 hardGate。
 */
export function withinStandGate(pos: Vec3, target: Vec3, gate: number, hardGate: number): boolean {
  const d = distance3d(pos, target);
  if (d <= gate) return true;
  return d <= hardGate && inTargetFootprint(pos, target);
}

/** 水平 footprint 判定：pos 的 x/z 落进目标块占位 [x,x+1)×[z,z+1) 内 */
export function inTargetFootprint(pos: Vec3, target: Vec3): boolean {
  const tx = Math.floor(target.x);
  const tz = Math.floor(target.z);
  return pos.x >= tx && pos.x < tx + 1 && pos.z >= tz && pos.z < tz + 1;
}

/**
 * 贴靠导航高位 Y（实测值、改动需附证据）：navigateToLocation 的引擎语义为"寻路到目标所在列的
 * 地面"，取高于世界建筑高度 320 的常量，脚位层由引擎按 xz 列自行投影，脚本侧不猜地面。
 */
export const HARVEST_NAV_HIGH_Y = 330;

/** 贴靠候选环（目标列水平 8 邻） */
const RING_8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * 贴靠候选列（纯几何、零世界访问）：目标列的水平 8 邻，按离假人水平距离升序。
 * 只出 xz：目标列本身不出（其投影落点是树顶），脚位层一律交引擎按列投影地面（HARVEST_NAV_HIGH_Y）；
 * 够不够得着由到场后的 inBreakReach 复判，几何侧不设闸。
 * @param target - 当前工作格（取 xz 列）
 * @param bot - 假人位置（连续坐标，仅用于就近排序）
 * @returns 候选列（y 恒为 HARVEST_NAV_HIGH_Y）
 */
export function approachCandidates(target: Vec3, bot: Vec3): Vec3[] {
  const tx = Math.floor(target.x);
  const tz = Math.floor(target.z);
  const out: Vec3[] = RING_8.map(([dx, dz]) => ({ x: tx + dx, y: HARVEST_NAV_HIGH_Y, z: tz + dz }));
  // 排序基准=导航终点（列中心），与 issueStand 发出的坐标一致
  const center = (c: Vec3): Vec3 => ({ x: c.x + 0.5, y: 0, z: c.z + 0.5 });
  out.sort((a, b) => horizontalDistance(bot, center(a)) - horizontalDistance(bot, center(b)));
  return out;
}

/** 目标格类型是否属本采集对象（认领时复查、向下连挖、6 邻发现共用判据） */
export function isTargetId(spec: CollectorSpec, typeId: string | undefined): boolean {
  return typeId !== undefined && spec.scanTypeIds.includes(typeId);
}

/** 掉落物拾取筛选谓词（excludePrefixes 先判，再 exact/suffixes 任一命中） */
export function makeDropAccept(spec: CollectorSpec): (itemTypeId: string) => boolean {
  const exact = new Set(spec.dropAccept.exact);
  return (typeId: string) => {
    if (spec.dropAccept.excludePrefixes.some((p) => typeId.startsWith(p))) return false;
    return exact.has(typeId) || spec.dropAccept.suffixes.some((s) => typeId.endsWith(s));
  };
}

/** 整点采完后的 6 邻发现候选（新暴露列点入池；失败标记与已知键由池补录去重拒绝） */
export function discoveryCells(loc: Vec3): Vec3[] {
  return [
    { x: loc.x + 1, y: loc.y, z: loc.z },
    { x: loc.x - 1, y: loc.y, z: loc.z },
    { x: loc.x, y: loc.y, z: loc.z + 1 },
    { x: loc.x, y: loc.y, z: loc.z - 1 },
    { x: loc.x, y: loc.y + 1, z: loc.z },
    { x: loc.x, y: loc.y - 1, z: loc.z },
  ];
}

/**
 * 侧向发现列向下探到真正树基：从 seed 逐拍下探到本列最低连续目标格。
 * 被砍列顶等高的邻格常是邻株半腰（上方悬空），bottomUp 若以它起砍则四周无立足位反复够不着；
 * 探到地表那一格才是可站可砍的起砍位。
 * @param read - 读取某格方块 typeId（区块未加载返回 undefined，按探到边界处理）
 * @param isTarget - 该 typeId 是否属本采集对象
 * @param seed - 发现的邻格（多为半腰格）
 * @param maxProbe - 下探格数上限
 * @returns 该列最低连续目标格（bottomUp 起砍格）
 */
export function probeColumnBase(
  read: (loc: Vec3) => string | undefined,
  isTarget: (typeId: string | undefined) => boolean,
  seed: Vec3,
  maxProbe = HARVEST_DISCOVER_PROBE
): Vec3 {
  let base = seed;
  for (let i = 0; i < maxProbe; i++) {
    const below = { x: seed.x, y: base.y - 1, z: seed.z };
    if (!isTarget(read(below))) break;
    base = below;
  }
  return base;
}

/** 向下连挖候选（破掉一格后，同列下一格——该列目标尚未挖完） */
export function belowCell(loc: Vec3): Vec3 {
  return { x: loc.x, y: loc.y - 1, z: loc.z };
}

/** 向上连挖候选（bottomUp：浮空树规则下，破完一格向上移一格） */
export function upCell(loc: Vec3): Vec3 {
  return { x: loc.x, y: loc.y + 1, z: loc.z };
}

/** 连挖方向随挖掘顺序（bottomUp 向树冠上爬 / topDown 向地底下剥） */
export function continuationCell(loc: Vec3, digOrder: DigOrder): Vec3 {
  return digOrder === "bottomUp" ? upCell(loc) : belowCell(loc);
}

/** 探基预算（格数）：列理论最长=扫描区域高度，超出即按当前格停止下探（防无限向下走） */
export function columnProbeLimit(spec: CollectorSpec): number {
  return spec.scanBox.down + spec.scanBox.up + 1;
}

/** 扫描区域（bot 脚位格 ±HARVEST_SCAN_RADIUS_XZ 水平 + spec.y 盒） */
export function harvestScanRect(at: Vec3, spec: CollectorSpec): { min: Vec3; max: Vec3 } {
  const bx = Math.floor(at.x);
  const by = Math.floor(at.y);
  const bz = Math.floor(at.z);
  return {
    min: { x: bx - HARVEST_SCAN_RADIUS_XZ, y: by - spec.scanBox.down, z: bz - HARVEST_SCAN_RADIUS_XZ },
    max: { x: bx + HARVEST_SCAN_RADIUS_XZ, y: by + spec.scanBox.up, z: bz + HARVEST_SCAN_RADIUS_XZ },
  };
}

// ─── 工具策略纯函数 ────────────────────────────────────────────
// 优先级口径：斧=品阶优先/效率>耐久>精准>时运；树叶=精准锄>剪刀>任意精准工具；铲=品阶+效率。

/** 工具类别（附魔 id 对齐全仓编码：efficiency/unbreaking/silk_touch/fortune） */
export type ToolCategory = "axe" | "pickaxe" | "hoe" | "shears" | "shovel" | "other";

/** 背包工具条目（engine 层从容器快照构造；domain 只做数据决策） */
export interface ToolItem {
  slot: number;
  typeId: string;
  enchantments: { id: string; level: number }[];
  category: ToolCategory;
  /** 耐久快照（engine 读取；缺失=视为健康，不参与告急降权） */
  durability?: DurabilitySnapshot;
}

/** 物品 typeId → 工具类别（未知类别归 other——不参与任何策略评分） */
export function toolCategoryOf(typeId: string): ToolCategory {
  if (typeId.endsWith("_axe")) return "axe";
  if (typeId.endsWith("_pickaxe")) return "pickaxe";
  if (typeId.endsWith("_hoe")) return "hoe";
  if (typeId.endsWith("_shovel")) return "shovel";
  if (typeId === "minecraft:shears") return "shears";
  return "other";
}

/** 工具材质 → 品阶分（品阶优先：梯度远大于附魔分）；key=typeId 的 `minecraft:<key>_` 前缀 */
export const MATERIAL_TIER: Record<string, number> = {
  wooden: 1,
  stone: 2,
  iron: 3,
  golden: 4,
  diamond: 5,
  netherite: 6,
};

/** 未识别材质分值（低于木制——兜底） */
export const UNKNOWN_TIER = 0;

/** 材质档次（typeId 前缀解析；shears 无材质 → 0，由类别策略单独打分） */
export function materialTier(typeId: string): number {
  for (const [mat, tier] of Object.entries(MATERIAL_TIER)) {
    if (typeId.startsWith(`minecraft:${mat}_`)) return tier;
  }
  return UNKNOWN_TIER;
}

/** 附魔等级读取（未附魔返回 0） */
export function enchantLevel(item: ToolItem, id: string): number {
  return item.enchantments.find((e) => e.id === id)?.level ?? 0;
}

/** 附魔权重（用户规格：效率>耐久>精准>时运） */
export const ENCHANT_WEIGHTS = { efficiency: 100, unbreaking: 30, silk_touch: 10, fortune: 3 } as const;
/** 品阶权重（远大于附魔总分） */
export const TIER_WEIGHT = 1000;

/** 斧头策略评分：品阶×1000 + 效率×100 + 耐久×30 + 精准×10 + 时运×3（非斧返回 -1=不入选） */
export function scoreAxe(item: ToolItem): number {
  if (item.category !== "axe") return -1;
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency +
    enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking +
    enchantLevel(item, "silk_touch") * ENCHANT_WEIGHTS.silk_touch +
    enchantLevel(item, "fortune") * ENCHANT_WEIGHTS.fortune
  );
}

/** 镐策略评分：口径同斧（品阶优先/效率>耐久>精准>时运）；非镐返回 -1=不入选 */
export function scorePickaxe(item: ToolItem): number {
  if (item.category !== "pickaxe") return -1;
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency +
    enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking +
    enchantLevel(item, "silk_touch") * ENCHANT_WEIGHTS.silk_touch +
    enchantLevel(item, "fortune") * ENCHANT_WEIGHTS.fortune
  );
}

/** 树叶策略评分：精准锄(3000+) > 剪刀(2500+) > 任意精准(1200+) > 其余兜底，梯度保证强制优先级 */
export function scoreLeafTool(item: ToolItem): number {
  const silk = enchantLevel(item, "silk_touch") > 0;
  if (item.category === "hoe" && silk) return 3000 + materialTier(item.typeId) * 100;
  if (item.category === "shears") return 2500 + enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking;
  if (silk)
    return 1200 + materialTier(item.typeId) * 100 + enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency;
  return materialTier(item.typeId) * 100 + enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency;
}

/** 铲策略评分：品阶×1000 + 效率×100 + 耐久×30（非铲返回 -1=不入选） */
export function scoreShovel(item: ToolItem): number {
  if (item.category !== "shovel") return -1;
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency +
    enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking
  );
}

function toolScorer(strategy: ToolStrategy): (item: ToolItem) => number {
  if (strategy === "axe") return scoreAxe;
  if (strategy === "pickaxe") return scorePickaxe;
  if (strategy === "shovel") return scoreShovel;
  return scoreLeafTool;
}

/**
 * 选某策略下的最优工具槽位（全背包扫描取优）。
 * 耐久优先：先在非告急件里取最优，全告急时才退到含告急件取最优（跨品阶兜底）；
 * 无该策略工具返回 undefined=保持当前主手（徒手也能磨）。
 */
export function pickToolSlot(strategy: ToolStrategy, tools: readonly ToolItem[]): number | undefined {
  const score = toolScorer(strategy);
  const bestOf = (accept: (item: ToolItem) => boolean): number | undefined => {
    let best: ToolItem | undefined;
    let bestScore = -Infinity;
    for (const item of tools) {
      const s = score(item);
      if (s < 0) continue;
      if (!accept(item)) continue;
      if (s > bestScore) {
        bestScore = s;
        best = item;
      }
    }
    return best?.slot;
  };
  return (
    bestOf((item) => item.durability === undefined || !isDurabilityCritical(item.durability)) ?? bestOf(() => true)
  );
}

/** 工具策略 → 中文类别名（报警/播报用） */
export function toolStrategyLabel(strategy: ToolStrategy): string {
  switch (strategy) {
    case "axe":
      return "斧";
    case "pickaxe":
      return "镐";
    case "shovel":
      return "铲";
    case "leaf":
      return "锄或剪";
  }
}

// ─── 安全护栏（决策与执行共用的判据，安全先于效用） ──────────

/**
 * 脚下护栏判据：cell 位于自身脚位列的向下延伸（含正踩那一格）。
 * 挖它等于自掘坑位——必须先挪站位或放弃该格。
 * @param bot - 假人位置（连续坐标）
 * @param cell - 拟破坏格（整数格）
 */
export function underFeet(bot: Vec3, cell: Vec3): boolean {
  const f = { x: Math.floor(bot.x), y: Math.floor(bot.y), z: Math.floor(bot.z) };
  return f.x === cell.x && f.z === cell.z && cell.y <= f.y;
}

/**
 * 首格高度护栏：entry 相对脚层高出 maxUp 以上即当前站位够不着。
 * 判够不着只作本假人短期跳过，不记入共享池失败。
 * @param entry - 首工作格
 * @param bot - 假人位置
 * @param maxUp - 可达带上限（格）
 */
export function entryTooHigh(entry: Vec3, bot: Vec3, maxUp: number): boolean {
  return entry.y - Math.floor(bot.y) > maxUp;
}

/**
 * 深度上限护栏：向下续航不得浅于坑缘站位层 maxDown 以下。
 * @param next - 拟续航的下一格
 * @param standLayer - 当前站位脚层
 * @param maxDown - 允许的最大下探深度（格）
 */
export function belowPitLimit(next: Vec3, standLayer: number, maxDown: number): boolean {
  return next.y < standLayer - maxDown;
}

/**
 * 列续航截断判据（护栏组合）：脚下护栏对任意方向成立；坑深上限只约束"向下"续航，
 * 向上爬树（bottomUp）不受坑深截断——否则树基低于站位层的邻株会在第一格上爬时
 * 就被 belowPitLimit 判到列死，只破最底一格、整株却按采毕出池，留下半截悬空树干。
 * @param maxDown - 向下续航深度上限（格）：bottomUp 传 0，topDown 传坑缘深度
 * @returns chain 的 limit 回调（true=本列到此为止）
 */
export function makeChainLimit(maxDown: number): (cur: Vec3, next: Vec3, bot: Vec3) => boolean {
  return (cur, next, bot) =>
    underFeet(bot, next) || (next.y < cur.y && belowPitLimit(next, Math.floor(bot.y), maxDown));
}

// ─── 工作配方（CollectorSpec → 大脑消费的纯数据判据包） ───────

/**
 * 工作配方：一类采集任务的全部纯数据判据（大脑逐拍决策只消费本接口）。
 * @property entryCell - 首工作格（含够不着/脚下护栏截断；null=当下够不着）
 * @property approachCell - 走点目标格（到站后仍按当下位置重算 entryCell）
 * @property nextCell - 同列续航格（向上爬树冠或向下剥土层）
 */
export interface HarvestRecipe {
  /** 装载 id（模式键，如 harvest_wood） */
  readonly id: string;
  /** 中文名（日志/面板） */
  readonly label: string;
  /** 区域扫描白名单（扁平 id；引擎对不认识的 id 整批拒绝） */
  readonly scanTypeIds: readonly string[];
  /** 是否从列底格起步并允许逐拍下探验基（树木贴根口径） */
  readonly probeBase: boolean;
  /** 向上可达带（格）：首格高出脚层此值以上即整列收场 */
  readonly reachUp: number;
  /** 向下深度上限（格）：续航不得浅于站位层此值以下（坑缘口径） */
  readonly maxDown: number;
  /** 起砍后掉落扫尾窗口（tick） */
  readonly dropSettleTicks: number;
  /** 主手工具策略键（engine 工具件按键取材） */
  readonly toolStrategy: ToolStrategy;
  nextCell(cur: Vec3): Vec3;
  entryCell(point: HarvestPoint, bot: Vec3): Vec3 | null;
  approachCell(point: HarvestPoint): Vec3;
  isTarget(typeId: string | undefined): boolean;
  acceptsDrop(typeId: string): boolean;
  scanRect(at: Vec3): { min: Vec3; max: Vec3 };
}

/** 目录行装配成工作配方：决策/执行壳只消费配方，不认识采集目录 */
export function harvestRecipe(kind: HarvestKindId): HarvestRecipe {
  const spec = specOf(kind);
  const accepts = makeDropAccept(spec);
  return {
    id: `harvest_${spec.id}`,
    label: spec.label,
    scanTypeIds: spec.scanTypeIds,
    probeBase: spec.probeBase,
    reachUp: spec.reachUp,
    maxDown: spec.maxDown,
    dropSettleTicks: spec.dropSettleTicks,
    toolStrategy: spec.toolStrategy,
    nextCell: (cur) => continuationCell(cur, spec.digOrder),
    approachCell: (point) => (spec.digOrder === "topDown" ? point.loc : point.base),
    entryCell: (point, bot) => {
      const entry = spec.digOrder === "topDown" ? point.loc : point.base;
      if (underFeet(bot, entry) || entryTooHigh(entry, bot, spec.reachUp)) return null;
      return entry;
    },
    isTarget: (typeId) => isTargetId(spec, typeId),
    acceptsDrop: accepts,
    scanRect: (at) => harvestScanRect(at, spec),
  };
}
