// ─── 钓鱼钩认主规则（core 层） ─────────────────────────
// 纯逻辑：鱼钩主人 tag 编码与解析（对齐 TridentClaimRules 风格）。
//
// 实体 tag 约定（钓鱼钩 minecraft:fishing_hook 上的持久标记）：
//   mp:fisher:<name> — 鱼钩主人（投掷者，玩家或假人）
//
// 用途：鱼钩生成时打上主人 tag，后期按主人查询鱼钩
//   （dimension.getEntities({ tags: [makeFisherTag(name)] })）。
// 独立于投掷物认主前缀（mp:owner:）——钓鱼钩无"双任认主"语义，收回即消失。

import type { Vec3 } from "../rules/Types";

/** 鱼钩主人 tag 前缀 */
export const FISHER_TAG_PREFIX = "mp:fisher:";

/** 基岩版钓鱼钩实体 ID */
export const FISHING_HOOK_ID = "minecraft:fishing_hook";

/** 钓鱼竿物品 ID */
export const FISHING_ROD_ID = "minecraft:fishing_rod";

/** 是否钓鱼钩实体 */
export function isFishingHook(typeId: string): boolean {
  return typeId === FISHING_HOOK_ID;
}

/** 是否钓鱼竿物品 */
export function isFishingRod(typeId: string): boolean {
  return typeId === FISHING_ROD_ID;
}

/** 构建鱼钩主人 tag */
export function makeFisherTag(name: string): string {
  return `${FISHER_TAG_PREFIX}${name}`;
}

/**
 * 解析鱼钩主人 tag；非 mp:fisher: 前缀或空名返回 undefined。
 * 名字不编码（与投掷物认主一致：基岩版玩家名不含冒号）。
 */
export function parseFisherTag(tag: string): string | undefined {
  if (!tag.startsWith(FISHER_TAG_PREFIX)) return undefined;
  const name = tag.slice(FISHER_TAG_PREFIX.length);
  return name || undefined;
}

// ─── 落点 / 下沉判定（闭包钓鱼流程用，纯函数可单测） ───

/** 空气方块 ID */
export const AIR_BLOCK_ID = "minecraft:air";

/** 水方块 ID（普通水/流动水都能钓） */
export const WATER_BLOCK_IDS = ["minecraft:water", "minecraft:flowing_water"] as const;

/** 是否水方块（鱼钩入水判定） */
export function isWaterBlock(typeId: string): boolean {
  return (WATER_BLOCK_IDS as readonly string[]).includes(typeId);
}

/** 咬钩下沉阈值（格，用户规格 0.25）：相对**稳定后最高点**的下沉量超过该值 = 上钩 */
export const BITE_DROP_THRESHOLD = 0.25;

/** 是否咬钩下沉信号（下沉量 = 最高点 - 当前，正值表示下沉） */
export function isBiteDrop(drop: number): boolean {
  return drop > BITE_DROP_THRESHOLD;
}

/** 咬钩判定状态（core 纯逻辑，可单测） */
export interface BiteTracker {
  /** 稳定后观测到的最高点（滚动最大值，下沉参照——用户规格：
   *  "将鱼钩稳定后的最高点坐标记录下来，之后的每一次下沉都以最高点作为参照"） */
  maxY: number;
}

/** 创建初始咬钩判定状态 */
export function initialBiteTracker(y: number): BiteTracker {
  return { maxY: y };
}

/**
 * 更新咬钩判定（用户规格）：每次下沉都以**稳定后最高点**为参照计算下沉量，
 * **超过 0.25 格即判断上钩**。
 * 最高点参照天然防误判：正常浮动（±0.1 内）时下沉量 < 阈值不触发；上浮时
 * 最高点跟随刷新（参照重置）；真下沉（哪怕缓慢渐进）时最高点不变、下沉量
 * 随深度持续增大——比"单窗口对比/滚动累计"更简洁且不漏检。
 *
 * @param prev - 上一窗口的判定状态（initialBiteTracker 创建）
 * @param y    - 当前鱼钩高度
 * @returns 更新后的状态 + 是否判定咬钩（bite=true 时调用方收竿）
 */
export function updateBiteTracker(prev: BiteTracker, y: number): { tracker: BiteTracker; bite: boolean } {
  const maxY = Math.max(prev.maxY, y); // 滚动最高点（上浮则刷新参照）
  const drop = maxY - y; // 相对最高点的下沉量
  return { tracker: { maxY }, bite: drop > BITE_DROP_THRESHOLD };
}

/** 鱼钩落点状态（稳定后判定）：water=正常入水 / landed=勾中固体方块（落陆地）/ snagged=勾中实体生物 */
export type HookPlacement = "water" | "landed" | "snagged";

/**
 * 鱼钩落点判定（用户规格 2.1.x）：
 *   - **勾中任何实体 = snagged**（玩家/鱼/水生生物/其他生物都算——勾住任何
 *     实体都不能正常钓鱼；鱼钩本身除外，由调用方从实体列表排除）
 *   - 无实体时：在水中 = water（正常入水），不在水中 = landed（勾中固体方块）
 */
export function judgeHookPlacement(inWater: boolean, hasEntityNearby: boolean): HookPlacement {
  if (hasEntityNearby) return "snagged";
  return inWater ? "water" : "landed";
}

// ─── 钓鱼点寻找（用户规格：水面筛选 → 8 邻候选 → 条件过滤 → 距离排序） ───

/** 水平 8 邻方向（水面相邻候选点位：3x3 去中心） */
export const ADJACENT_8: readonly { dx: number; dz: number }[] = [
  { dx: -1, dz: -1 },
  { dx: 0, dz: -1 },
  { dx: 1, dz: -1 },
  { dx: -1, dz: 0 },
  { dx: 1, dz: 0 },
  { dx: -1, dz: 1 },
  { dx: 0, dz: 1 },
  { dx: 1, dz: 1 },
];

/** 危险方块 ID（假人站上会掉血/不能站立）：岩浆块（踩上持续掉血）/岩浆/流动岩浆/火 */
const UNSAFE_BLOCK_IDS = [
  "minecraft:magma_block",
  "minecraft:lava",
  "minecraft:flowing_lava",
  "minecraft:fire",
] as const;

/**
 * 安全支撑方块判定（用户规格："安全的实心方块，不然是岩浆块或岩浆，
 * 能够保证假人站上去的时候不会掉血"）。⚠️ 只排危险方块——实体实心
 * 由调用方 isSolid 判定（本函数无 mc API）。
 */
export function isSafeSupport(typeId: string): boolean {
  return !(UNSAFE_BLOCK_IDS as readonly string[]).includes(typeId);
}

/**
 * 水面判定（用户规格："只选择水面（水方块上面一定是空气的方块）"）。
 * @param waterTypeId 方块 typeId
 * @param aboveTypeId 方块上方 1 格 typeId
 */
export function isSurfaceWater(waterTypeId: string, aboveTypeId: string): boolean {
  return isWaterBlock(waterTypeId) && aboveTypeId === AIR_BLOCK_ID;
}

/**
 * 钓鱼点条件判定（用户规格）：支撑方块 = 安全的实心方块 + **上方两格都是空气**
 * （站立格 = 支撑块上方第 1 格，假人高 2 格，站立格与头顶格都不能被堵）。
 * ⚠️ 支撑块"与水相邻"由候选生成保证（候选即水面水平 8 邻位置）。
 */
export function judgeFishingSpot(supportTypeId: string, above1TypeId: string, above2TypeId: string): boolean {
  return (
    isSafeSupport(supportTypeId) &&
    above1TypeId === AIR_BLOCK_ID &&
    above2TypeId === AIR_BLOCK_ID
  );
}

/** 抛竿瞄准延伸上限（格，用户规格：最多 5 格，5 格 = 五星级钓鱼点） */
export const AIM_MAX_LEVEL = 5;

/** 抛竿瞄准点（钓鱼点延伸目标水域） */
export interface CastAim {
  /** 瞄准点坐标（延伸路径最远水格，水面层） */
  target: Vec3;
  /** 延伸长度（1-5，星级评分：连续水体格数，越长越优秀越好抛竿） */
  level: number;
}

/**
 * 计算抛竿瞄准点（用户规格）：从钓鱼点出发，面向"钓鱼点连接的方向"
 * （stand 指向最近相邻水面），沿水平方向向外延伸最多 5 格，**延伸路径
 * 必须全是水**（连续水体）——延伸越长评分越高（1 星=小水坑很差，
 * 5 星=五星级钓鱼点最易抛竿）。最远连续水格 = 瞄准点。
 *
 * @param stand   - 钓鱼点站立格
 * @param waters  - 相邻水面列表（取最近者定方向）
 * @param isWater - 水体判定（坐标 → 是否水/流动水）
 * @returns 瞄准点与星级；waters 为空或方向异常返回 undefined
 */
export function computeCastAim(
  stand: Vec3,
  waters: readonly Vec3[],
  isWater: (loc: Vec3) => boolean
): CastAim | undefined {
  if (waters.length === 0) return undefined;
  // 最近水面（按 stand 水平曼哈顿距离）→ 连接方向
  let nearest = waters[0]!;
  let bestDist = Math.abs(nearest.x - stand.x) + Math.abs(nearest.z - stand.z);
  for (const w of waters) {
    const d = Math.abs(w.x - stand.x) + Math.abs(w.z - stand.z);
    if (d < bestDist) {
      bestDist = d;
      nearest = w;
    }
  }
  const dx = Math.sign(nearest.x - stand.x);
  const dz = Math.sign(nearest.z - stand.z);
  if (dx === 0 && dz === 0) return { target: nearest, level: 1 }; // 方向异常防御（理论不出现）

  // 沿方向延伸（nearest = 第 1 格，必是水）：路径必须连续水体
  let level = 1;
  let target = nearest;
  for (let i = 1; i < AIM_MAX_LEVEL; i++) {
    const loc = { x: nearest.x + dx * i, y: nearest.y, z: nearest.z + dz * i };
    if (isWater(loc)) {
      level = i + 1;
      target = loc;
    } else {
      break;
    }
  }
  return { target, level };
}

/** 钓鱼点（相邻水面收集全部——多个水面可共享同一钓鱼点） */
export interface FishingSpot {
  /** 站立格坐标（假人脚所在格 = 支撑方块上方 1 格，导航/站位用） */
  stand: Vec3;
  /** 支撑方块坐标 */
  support: Vec3;
  /** 相邻水面坐标列表（该钓鱼点面向的全部水面，可能多个） */
  waters: Vec3[];
  /** 抛竿瞄准点（沿连接方向延伸最长 5 格连续水域的最远点）+ 星级评分 */
  aim: CastAim;
}

/**
 * 从水面列表生成钓鱼点候选（core 纯逻辑，可单测）：
 * 对每个水面方块检查水平 8 邻位置——实体实心 + 安全 + 上方两格空气 → 候选。
 * **同一站立格被多个水面共享时去重，相邻水面坐标全部收集进 waters**。
 * 收集完成后统一计算每个钓鱼点的抛竿瞄准点与星级评分（aim）。
 *
 * @param waterBlocks 水面方块坐标列表（已按 isSurfaceWater 筛选）
 * @param blockType   方块 typeId 查询（坐标 → typeId；不可访问返回 undefined）
 * @param isSolid     实体方块判定（坐标 → 是否实体实心，非空气非液体）
 * @returns 去重后的钓鱼点列表（waters 含全部相邻水面 + aim 瞄准点/星级）
 */
export function collectFishingSpots(
  waterBlocks: readonly Vec3[],
  blockType: (loc: Vec3) => string | undefined,
  isSolid: (loc: Vec3) => boolean
): FishingSpot[] {
  const seen = new Map<string, FishingSpot>();
  for (const water of waterBlocks) {
    for (const { dx, dz } of ADJACENT_8) {
      const support = { x: water.x + dx, y: water.y, z: water.z + dz };
      const supportType = blockType(support);
      if (!supportType || !isSolid(support)) continue; // 必须实体实心方块
      const above1 = blockType({ x: support.x, y: support.y + 1, z: support.z });
      const above2 = blockType({ x: support.x, y: support.y + 2, z: support.z });
      if (!judgeFishingSpot(supportType, above1 ?? "", above2 ?? "")) continue;
      const stand = { x: support.x, y: support.y + 1, z: support.z };
      const key = `${stand.x},${stand.y},${stand.z}`;
      const existing = seen.get(key);
      if (existing) {
        // 多个水面共享同一钓鱼点：水面坐标合并（去重）
        if (!existing.waters.some((w) => w.x === water.x && w.y === water.y && w.z === water.z)) {
          existing.waters.push(water);
        }
      } else {
        seen.set(key, { stand, support, waters: [water], aim: { target: water, level: 1 } });
      }
    }
  }
  // 统一计算瞄准点（waters 已合并完毕，最近水面方向才准确）
  const collected = [...seen.values()];
  for (const spot of collected) {
    spot.aim =
      computeCastAim(spot.stand, spot.waters, (loc) => {
        const t = blockType(loc);
        return t !== undefined && isWaterBlock(t);
      }) ?? { target: spot.waters[0]!, level: 1 }; // 防御：waters 非空（由水面生成）
  }
  return collected;
}

/**
 * 钓鱼点候选排序（用户规格）：**星级评分降序优先**（5 星最优先，评分越高
 * 越容易抛竿越优秀），**同星级内按到中心坐标平方距离升序**（就近优先）。
 */
export function sortFishingSpots(spots: readonly FishingSpot[], center: Vec3): FishingSpot[] {
  return [...spots].sort((a, b) => {
    if (a.aim.level !== b.aim.level) return b.aim.level - a.aim.level; // 星级降序
    return distSq(a.stand, center) - distSq(b.stand, center); // 距离升序
  });
}

/** 寻找钓鱼点失败原因：no-water=范围内没有水面 / no-spot=有水面但无满足条件的钓鱼点 / error=扫描异常 */
export type FindSpotsFailure = "no-water" | "no-spot" | "error";

/**
 * 寻找钓鱼点失败原因分类（core 纯函数）：按水面数/钓鱼点数判定。
 * @returns 失败原因；成功（水面与钓鱼点都有）返回 undefined
 */
export function classifyFishingScan(surfaceCount: number, spotCount: number): FindSpotsFailure | undefined {
  if (surfaceCount === 0) return "no-water";
  if (spotCount === 0) return "no-spot";
  return undefined;
}

function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ─── 钓鱼点状态判定（AI 行为用：点位有效/占用/朝向） ────

/**
 * 完整钓鱼点判定（AI 决策复用，用户规格）：安全支撑方块（非岩浆/岩浆块等
 * 危险方块） + **上方两格都是空气**（站立格 + 头顶格）+ **至少一个相邻水面**。
 * ⚠️ 支撑块实体实心由调用方 isSolid 判定（本函数无 mc API）；相邻水面指
 * 支撑块同层水平 8 邻内的水方块。
 *
 * @param stand              - 站立格坐标（假人脚所在格 = 支撑块上方 1 格）
 * @param supportTypeId      - 支撑方块 typeId
 * @param above1TypeId       - 站立格 typeId
 * @param above2TypeId       - 头顶格 typeId
 * @param adjacentWaterCount - 支撑块同层相邻水面数（≥1 才算钓鱼点）
 */
export function judgeStandFishingSpot(
  stand: Vec3,
  supportTypeId: string,
  above1TypeId: string,
  above2TypeId: string,
  adjacentWaterCount: number
): boolean {
  return judgeFishingSpot(supportTypeId, above1TypeId, above2TypeId) && adjacentWaterCount > 0;
}

/** 朝向容差（度，用户规格：身体朝向与目标水域方向偏差超过该值需要转身） */
export const YAW_TOLERANCE_DEG = 15;

/**
 * 计算 from 指向 to 的水平方向角（MC yaw 标准：0=南(+Z)、东=-90、北=±180）。
 * 公式：yaw = -atan2(dx, dz) 转度（东向 dx>0 → -90 ✓；南向 dz>0 → 0 ✓）。
 */
export function computeTargetYaw(from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return (-Math.atan2(dx, dz) * 180) / Math.PI;
}

/**
 * 朝向是否对齐：当前 yaw 与目标 yaw 的角度差（归一化到 [-180, 180]）≤ 容差。
 */
export function isYawAligned(currentYaw: number, targetYaw: number, tolerance: number = YAW_TOLERANCE_DEG): boolean {
  let diff = (targetYaw - currentYaw) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return Math.abs(diff) <= tolerance;
}

// ─── 战利品 diff（成功钓鱼后背包前后对比，含附魔） ──────

/** 战利品条目（钓到的东西，含附魔） */
export interface LootItem {
  /** 物品 typeId（如 minecraft:cod） */
  typeId: string;
  /** 数量 */
  count: number;
  /** 附魔列表（id: 附魔标识，level: 等级） */
  enchantments: { id: string; level: number }[];
}

/**
 * 物品指纹：typeId + 附魔编码（`typeId#enchId:lvl,...`）——同一物品不同附魔
 * 可区分（如带海之眷顾的鱼竿 vs 普通鱼竿），背包前后 diff 据此识别战利品。
 */
export function makeLootFingerprint(typeId: string, enchantments: readonly { id: string; level: number }[]): string {
  if (enchantments.length === 0) return typeId;
  const enchPart = enchantments.map((e) => `${e.id}:${e.level}`).join(",");
  return `${typeId}#${enchPart}`;
}

/**
 * 背包前后指纹 diff（core 纯函数，可单测）：after 中数量多于 before 的
 * 指纹 = 本次新增（战利品）。before/after 为「指纹 → 数量」映射（mc 层
 * 扫描背包构造）。
 *
 * @param before - 收竿前背包指纹计数
 * @param after  - 收竿后背包指纹计数
 * @returns 新增物品列表（按指纹解析 typeId/附魔）
 */
export function diffLoot(before: Record<string, number>, after: Record<string, number>): LootItem[] {
  const loot: LootItem[] = [];
  for (const [fingerprint, afterCount] of Object.entries(after)) {
    const beforeCount = before[fingerprint] ?? 0;
    const gained = afterCount - beforeCount;
    if (gained > 0) {
      const [typeId = fingerprint, enchPart] = fingerprint.split("#");
      const enchantments: { id: string; level: number }[] = [];
      if (enchPart) {
        for (const seg of enchPart.split(",")) {
          const [id = "", levelStr = ""] = seg.split(":");
          const level = parseInt(levelStr, 10);
          if (id && !isNaN(level) && level > 0) enchantments.push({ id, level });
        }
      }
      loot.push({ typeId, count: gained, enchantments });
    }
  }
  return loot;
}

// ─── 钓鱼结果类型（领域类型：fishOnce 与 AI 任务共用） ───

/** 钓鱼失败原因（offline/no-rod 可重试；landed/snagged 需换点；hook-lost 异常） */
export type FishingFailureReason =
  | "offline" // 假人不可用
  | "no-rod" // 无鱼竿（主手与热键栏都没有）
  | "landed" // 鱼钩勾中固体方块（落陆地，未入水）
  | "snagged" // 鱼钩勾中实体生物
  | "hook-lost" // 监听中鱼钩消失（异常）
  | "busy" // 已有进行中的钓鱼流程（防重入）
  | "error"; // 执行失败（可重试）

/** 背包状态（成功钓鱼后报告用） */
export interface BackpackInfo {
  /** 已占用格数（非空格） */
  usedSlots: number;
  /** 背包总格数 */
  totalSlots: number;
}

/** 一次钓鱼的结果：caught=上钩收竿（含战利品与背包状态） / timeout=45 秒无鱼超时收竿 / failed=失败+原因 */
export type FishingOutcome =
  | { kind: "caught"; loot: LootItem[]; backpack: BackpackInfo }
  | { kind: "timeout" }
  | { kind: "failed"; reason: FishingFailureReason };
