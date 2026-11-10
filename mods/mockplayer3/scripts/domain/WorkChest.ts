// ─── 工作箱（通用工作容器，domain 纯逻辑） ────────────────────────
// 概念：每个假人可绑定一个普通木头箱子作工作箱；在线期间背包里"与本模式工作
// 内容匹配、且由本假人采得"的物品按格搬入箱中（工具/穿戴件/信物永不搬）。
// 只对 minecraft:chest 有效（陷阱箱/木桶/潜影盒一律不算）；容量以容器实际
// size 为准（小箱 27 格、大箱 54 格）。搬运失败（箱满/丢失/被抢）源槽保留，
// 物品只会留在背包，绝不消失。
// 大箱两半取坐标逐轴最小值作箱原点，id 由原点唯一确定（两半点击归同箱）。

import type { Vec3 } from "./Coords";

/** 普通木头箱子方块 id（工作箱唯一合法方块；陷阱箱/木桶/潜影盒不算） */
export const PLAIN_CHEST_TYPE_ID = "minecraft:chest";

/** 工作箱注册信息（DP 键 mp:wchest 注册表条目 + 记录绑定引用的对象） */
export interface WorkChestInfo {
  /** 全局唯一箱 id："维度:x,y,z"（x/y/z=箱原点整数格） */
  id: string;
  dimId: string;
  /** 箱原点：单箱=自身格；大箱=两半逐轴最小格 */
  origin: Vec3;
  /** 自定义名称（注册面板填写；空=未命名） */
  name: string;
}

/** 主背包快捷栏 0 格（主手工具位，任何搬运都不触碰） */
export const PROTECTED_MAINHAND_SLOT = 0;

/** 工作箱名长度上限 */
export const MAX_CHEST_NAME_LENGTH = 32;

/** 该方块 id 能否作工作箱（普通木头箱子） */
export function isPlainChestType(typeId: string): boolean {
  return typeId === PLAIN_CHEST_TYPE_ID;
}

/** 整数格归一（向下取整） */
function floorCell(p: Vec3): Vec3 {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/** 两半格求箱原点：逐轴取最小（同 y 平面相邻，等价于取西北半） */
export function chestOrigin(a: Vec3, b: Vec3): Vec3 {
  const fa = floorCell(a);
  const fb = floorCell(b);
  return { x: Math.min(fa.x, fb.x), y: Math.min(fa.y, fb.y), z: Math.min(fa.z, fb.z) };
}

/** 由原点生成箱 id */
export function workChestId(dimId: string, origin: Vec3): string {
  const o = floorCell(origin);
  return `${dimId}:${o.x},${o.y},${o.z}`;
}

/** 名称规范化：去首尾空白、截上限；非法输入回空串（=未命名） */
export function normalizeChestName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_CHEST_NAME_LENGTH);
}

/** DP 读回 unknown 的注册表条目形状守卫（坏条目入表会把搬运引到非法坐标） */
export function isWorkChestShape(value: unknown): value is WorkChestInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<WorkChestInfo>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.dimId !== "string" || v.dimId.length === 0) return false;
  if (typeof v.name !== "string") return false;
  const o = v.origin as Partial<Vec3> | undefined;
  return (
    o !== undefined &&
    Number.isInteger(o.x) &&
    Number.isInteger(o.y) &&
    Number.isInteger(o.z) &&
    workChestId(v.dimId, o as Vec3) === v.id
  );
}

// ─── 搬运计划 ────────────────────────────────────────────────

/** 背包格观测探针（engine 逐格读实体背包后喂入；空格不喂） */
export interface InventorySlotProbe {
  slot: number;
  typeId: string;
  amount: number;
}

/** 搬运计划条目：格号 + 件数（供播报与日志） */
export interface TransferEntry {
  slot: number;
  amount: number;
}

/**
 * 搬运计划：命中工作产物且不在保护名单的格按格号升序入选。
 * @param probes - 非空格观测
 * @param isProduct - 本模式工作产物判据（见 workProductMatcher）
 * @param protectedIds - 永不搬运的物品类型（主手/穿戴/副手/信物）
 */
export function planWorkTransfer(
  probes: readonly InventorySlotProbe[],
  isProduct: (typeId: string) => boolean,
  protectedIds: ReadonlySet<string>
): TransferEntry[] {
  const out: TransferEntry[] = [];
  for (const p of probes) {
    if (p.slot === PROTECTED_MAINHAND_SLOT) continue;
    if (p.amount <= 0 || !isProduct(p.typeId) || protectedIds.has(p.typeId)) continue;
    out.push({ slot: p.slot, amount: p.amount });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

// ─── 各模式工作产物判据 ──────────────────────────────────────

/**
 * 渔获掉落类型白名单（基岩版钓鱼池：鱼/宝藏/垃圾三档 + 丛林垃圾，含旧版别名 id）。
 * 吸取过滤与工作箱搬运共用这一份（物品实体不带来源归属，只能按类型过滤）。
 * 垃圾档水瓶以 minecraft:potion 形态入包；竹子/可可豆仅丛林水域产出。
 */
export const FISHING_LOOT_IDS: readonly string[] = [
  // 鱼
  "minecraft:cod",
  "minecraft:salmon",
  "minecraft:pufferfish",
  "minecraft:tropical_fish",
  "minecraft:clownfish",
  "minecraft:fish",
  // 宝藏
  "minecraft:enchanted_book",
  "minecraft:bow",
  "minecraft:fishing_rod",
  "minecraft:name_tag",
  "minecraft:nautilus_shell",
  "minecraft:saddle",
  // 垃圾
  "minecraft:lily_pad",
  "minecraft:bamboo",
  "minecraft:cocoa_beans",
  "minecraft:string",
  "minecraft:bowl",
  "minecraft:leather",
  "minecraft:leather_boots",
  "minecraft:bone",
  "minecraft:rotten_flesh",
  "minecraft:stick",
  "minecraft:tripwire_hook",
  "minecraft:ink_sac",
  "minecraft:potion",
];

/**
 * 矿石类方块 → 实际掉落物品（Bedrock 原生口径：铁矿出粗铁不出铁矿块）。
 * 键=被挖方块 id，值=掉落物品 id 列表；表外方块按"掉落=自身方块物品"处理。
 */
export const MINED_BLOCK_DROPS: Readonly<Record<string, readonly string[]>> = {
  "minecraft:coal_ore": ["minecraft:coal"],
  "minecraft:deepslate_coal_ore": ["minecraft:coal"],
  "minecraft:iron_ore": ["minecraft:raw_iron"],
  "minecraft:deepslate_iron_ore": ["minecraft:raw_iron"],
  "minecraft:gold_ore": ["minecraft:raw_gold"],
  "minecraft:deepslate_gold_ore": ["minecraft:raw_gold"],
  "minecraft:copper_ore": ["minecraft:raw_copper"],
  "minecraft:deepslate_copper_ore": ["minecraft:raw_copper"],
  "minecraft:diamond_ore": ["minecraft:diamond"],
  "minecraft:deepslate_diamond_ore": ["minecraft:diamond"],
  "minecraft:emerald_ore": ["minecraft:emerald"],
  "minecraft:deepslate_emerald_ore": ["minecraft:emerald"],
  "minecraft:redstone_ore": ["minecraft:redstone"],
  "minecraft:deepslate_redstone_ore": ["minecraft:redstone"],
  "minecraft:lapis_ore": ["minecraft:lapis_lazuli"],
  "minecraft:deepslate_lapis_ore": ["minecraft:lapis_lazuli"],
  "minecraft:quartz_ore": ["minecraft:quartz"],
  "minecraft:nether_gold_ore": ["minecraft:gold_nugget"],
  "minecraft:ancient_debris": ["minecraft:netherite_scrap"],
  "minecraft:stone": ["minecraft:cobblestone"],
  "minecraft:granite": ["minecraft:granite"],
  "minecraft:diorite": ["minecraft:diorite"],
  "minecraft:andesite": ["minecraft:andesite"],
  "minecraft:deepslate": ["minecraft:cobbled_deepslate"],
  "minecraft:tuff": ["minecraft:tuff"],
};

/** 挖掘产物候选集：本会话挖过的每格方块 → 其可能掉落的物品 id 全集 */
export function minedProductSet(minedBlocks: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const blockId of minedBlocks) {
    out.add(blockId); // 方块自身形态（多数岩石/矿物直接掉落方块物品）
    for (const drop of MINED_BLOCK_DROPS[blockId] ?? []) out.add(drop);
  }
  return out;
}

/**
 * 采集掉落匹配（DropAcceptRule 同款口径）：excludePrefixes 先判，再 exact，后 suffixes。
 * @param rule - 采集对象目录里的掉落匹配规则
 */
export function dropAcceptMatch(
  rule: { exact: readonly string[]; suffixes: readonly string[]; excludePrefixes: readonly string[] },
  typeId: string
): boolean {
  for (const p of rule.excludePrefixes) if (typeId.startsWith(p)) return false;
  if (rule.exact.includes(typeId)) return true;
  for (const s of rule.suffixes) if (typeId.endsWith(s)) return true;
  return false;
}

/** 采集对象的掉落匹配规则（与吸拾同一份目录数据） */
export interface HarvestDropRule {
  exact: readonly string[];
  suffixes: readonly string[];
  excludePrefixes: readonly string[];
}

/**
 * 按工作模式取工作产物判据；mined 仅 mine 模式消费。
 * 表外模式（wander/attack/raid/follow/place/vault/none）一律不产搬运。
 * @param mode - record.workMode
 * @param mined - 本会话挖过的方块 id 集合（mine 模式搬运依据）
 * @param harvestDropRule - 当前采集模式对象的掉落规则（harvest_* 模式搬运依据）
 */
export function workProductMatcher(
  mode: string,
  mined: Iterable<string>,
  harvestDropRule: HarvestDropRule | null
): (typeId: string) => boolean {
  if (mode === "fishing") {
    const loot = new Set(FISHING_LOOT_IDS);
    return (typeId) => loot.has(typeId);
  }
  if (mode === "mine") {
    const products = minedProductSet(mined);
    return (typeId) => products.has(typeId);
  }
  if (mode.startsWith("harvest_")) {
    if (!harvestDropRule) return () => false;
    return (typeId) => dropAcceptMatch(harvestDropRule, typeId);
  }
  return () => false;
}
