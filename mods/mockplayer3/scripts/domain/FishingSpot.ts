// ─── 钓点判定纯逻辑（domain 层，零 @minecraft，engine 只喂世界观测） ───
// 注：基岩版鱼线最长 32 格，查询半径 40 留浮漂入水偏移余量。
// 可稳定站立判定由 engine 传入（固体且非危险即视为可站）。

import type { Vec2, Vec3 } from "./Coords";
import { horizontalDistance } from "./Coords";

/** 水面方块（含流动水） */
export const WATER_BLOCK_IDS: readonly string[] = ["minecraft:water", "minecraft:flowing_water"];
/** 危险支撑黑名单：熔岩/火/岩浆块 */
export const DANGER_SUPPORT_IDS: readonly string[] = [
  "minecraft:magma_block",
  "minecraft:lava",
  "minecraft:flowing_lava",
  "minecraft:fire",
];
/** 抛/收竿主手位（必须经 slot 0） */
export const MAINHAND_SLOT = 0;
/** 自有鱼钩查询半径（格）：鱼线最长 32，40 留浮漂偏移余量 */
export const HOOK_QUERY_RADIUS = 40;
/** 点位占用半径（格）：半径内任何实体都算占用 */
export const SPOT_OCCUPY_RADIUS = 1;
/** 落点实体探测半径（getEntities 按实体中心算距离，放大即误判游鱼） */
export const PLACEMENT_ENTITY_RADIUS = 0.25;
/** 咬钩/战利品/缺因播报半径（格） */
export const NOTIFY_RADIUS = 7;
/** 寻点侧播报半径（格，独立于 NOTIFY_RADIUS） */
export const SPOT_NOTIFY_RADIUS = 16;
/** 瞄准延伸最大星级（格） */
export const AIM_MAX_LEVEL = 5;
/** 投竿 yaw 对齐容差（度） */
export const YAW_TOLERANCE_DEG = 15;

/** 钓点支撑块观测（engine 探块后喂入） */
export interface SupportProbe {
  id: string;
  air: boolean;
  liquid: boolean;
}

/** 支撑是否"安全实心"：非空气、非液体、不在危险黑名单 */
export function isSafeSupport(p: SupportProbe): boolean {
  if (p.air || p.liquid) return false;
  return !DANGER_SUPPORT_IDS.includes(p.id);
}

/**
 * 站位可钓判定：支撑安全实心 + 上方两格（站立格+头顶格）皆精确空气。
 * 注：cave_air 不算 air（假人高 2 格，上方空气必须 typeId==="minecraft:air"）。
 */
export function judgeStandSpot(
  support: SupportProbe,
  above1Id: string,
  above2Id: string,
  waterNeighborCount: number
): boolean {
  return (
    isSafeSupport(support) && above1Id === "minecraft:air" && above2Id === "minecraft:air" && waterNeighborCount > 0
  );
}

/** 瞄准结果：目标水面格 + 星级 */
export interface AimResult {
  target: Vec3;
  level: number;
}

/**
 * 从站位朝最近水面方向延伸求最远连续水面（星级=延伸格数，≤AIM_MAX_LEVEL）。
 * @param probeWater - 相对格是否水面（engine 闭包探块）
 * @param step - 单位步进方向（水平曼哈顿取最近水面、Math.sign 定向）
 */
export function extendAim(stand: Vec3, step: Vec2, probeWater: (p: Vec3) => boolean): AimResult | undefined {
  let last: Vec3 | undefined;
  for (let i = 1; i <= AIM_MAX_LEVEL; i++) {
    const p = { x: stand.x + step.x * i, y: stand.y, z: stand.z + step.y * i };
    if (!probeWater(p)) break;
    last = p;
  }
  return last ? { target: last, level: Math.round(Math.hypot(last.x - stand.x, last.z - stand.z)) } : undefined;
}

/** 候选钓点（含排序要素） */
export interface SpotCandidate {
  stand: Vec3;
  aim: AimResult;
  /** 到中心点平方距离（排序用） */
  distSqCenter: number;
}

/** 排序：星级降序，同星级距中心升序 */
export function sortSpotCandidates(spots: SpotCandidate[]): SpotCandidate[] {
  return [...spots].sort((a, b) => b.aim.level - a.aim.level || a.distSqCenter - b.distSqCenter);
}

// ─── 站位组装 ──────────────────────────────────────────────────

/** 水平 8 邻偏移 */
const ADJACENT_8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/** 组装期世界观测探针（engine 闭包喂入，domain 零 @minecraft） */
export interface StandProbe {
  /** 该格是否精确 minecraft:air（cave_air 也不算） */
  isAir(p: Vec3): boolean;
  /** 支撑块观测（undefined=读不到，该候选点不入选） */
  support(p: Vec3): SupportProbe | undefined;
}

/**
 * 支撑层相对水面层的偏移（两种偏移都收集）：0=岸与水面同层，+1=岸顶比水面高 1 格。
 * 同一水面格的 8 邻中至多一种偏移能成立，因此不会重复产出同位置候选点。
 * 组装期与认领时复核必须采用同一规则。
 */
const SUPPORT_LEVEL_OFFSETS: readonly number[] = [0, 1];

/**
 * 站位邻水观测（环查规则唯一真源）：以支撑格为中心查水平 8 邻水面，零命中再
 * 下探一层；组装期与认领时复核必须共用本实现。
 * @param cap - 计数上限，命中够数即停手（判据只问有没有；缺省 8=单层满计数）
 * @returns 邻水数（≤cap）
 */
export function countAdjacentWaters(support: Vec3, isWater: (p: Vec3) => boolean, cap = 8): number {
  let n = 0;
  for (const [dx, dz] of ADJACENT_8) {
    if (!isWater({ x: support.x + dx, y: support.y, z: support.z + dz })) continue;
    if (++n >= cap) return n;
  }
  if (n > 0) return n;
  for (const [dx, dz] of ADJACENT_8) {
    if (!isWater({ x: support.x + dx, y: support.y - 1, z: support.z + dz })) continue;
    if (++n >= cap) return n;
  }
  return n;
}

/**
 * 站位候选组装（几何口径不可改）：对每个水面格查水平 8 邻的支撑块（层见 SUPPORT_LEVEL_OFFSETS）。
 * 站位=支撑上方 1 格，须站位与头顶两格精确空气、支撑安全实心；全程相对水面自身那一层，不含绝对高度。
 * @param waterCells - 已筛过的水面格（正上方精确空气）
 * @param center - 距心（排序与可达筛基准，一般是假人当下站位）
 * @param probe - 空气/支撑观测（engine 闭包）
 * @param isWater - 水面层判定；兼作噪声前置过滤：支撑本身是水或位于水面上方即不入选
 * @param maxStands - 站位复核预算（个）：可达筛排在它之前，远点不占用复核预算
 * @param maxStandDist - 站位距心上限（格，缺省=不筛；传认领半径见 withinStandReach）
 * @returns 排序后的候选
 */
export function composeStandCandidates(
  waterCells: readonly Vec3[],
  center: Vec3,
  probe: StandProbe,
  isWater: (p: Vec3) => boolean,
  maxStands: number,
  maxStandDist?: number
): SpotCandidate[] {
  interface Entry {
    stand: Vec3;
    waters: Vec3[];
    usable: boolean;
  }
  const entries = new Map<string, Entry>();
  let judged = 0;
  outer: for (const cell of waterCells) {
    const cx = Math.floor(cell.x);
    const cy = Math.floor(cell.y);
    const cz = Math.floor(cell.z);
    for (const lift of SUPPORT_LEVEL_OFFSETS) {
      for (const [dx, dz] of ADJACENT_8) {
        // 支撑 = 水格 8 邻（可高一层），站位 = 支撑上方 1 格（唯一真源，勿改）
        const support = { x: cx + dx, y: cy + lift, z: cz + dz };
        // 水与水面正上方的空气柱都不可能是支撑，纯集合判挡掉海面噪声
        if (isWater(support) || isWater({ x: support.x, y: support.y - 1, z: support.z })) continue;
        const stand = { x: support.x, y: support.y + 1, z: support.z };
        const key = `${stand.x},${stand.y},${stand.z}`;
        const hit = entries.get(key);
        if (hit) {
          // 多个水面共享同一站位：全并进来（瞄准取最近者）
          if (hit.waters.some((w) => w.x === cx && w.y === cy && w.z === cz)) continue;
          hit.waters.push({ x: cx, y: cy, z: cz });
          continue;
        }
        // 可达筛（认领半径同判据）：不占复核预算
        if (maxStandDist !== undefined && !withinStandReach(center, stand, maxStandDist)) continue;
        if (judged >= maxStands) break outer;
        judged++;
        // 成本序：两格空气先判，最后才读支撑块
        const above1 = probe.isAir(stand) ? "minecraft:air" : "";
        const above2 = probe.isAir({ x: stand.x, y: stand.y + 1, z: stand.z }) ? "minecraft:air" : "";
        if (above1 === "" || above2 === "") {
          entries.set(key, { stand, waters: [{ x: cx, y: cy, z: cz }], usable: false });
          continue;
        }
        const sup = probe.support(support);
        // 邻水计数与认领时复核同一规则，观测源=已采水面集合（零探块）；cap=1 命中即止
        const waters = countAdjacentWaters(support, isWater, 1);
        entries.set(key, {
          stand,
          waters: [{ x: cx, y: cy, z: cz }],
          usable: sup !== undefined && judgeStandSpot(sup, above1, above2, waters),
        });
      }
    }
  }
  const spots: SpotCandidate[] = [];
  for (const entry of entries.values()) {
    if (!entry.usable) continue;
    const aim = aimFromWaters(entry.stand, entry.waters, isWater);
    if (!aim) continue;
    spots.push({
      stand: entry.stand,
      aim,
      distSqCenter: (entry.stand.x - center.x) ** 2 + (entry.stand.z - center.z) ** 2,
    });
  }
  return sortSpotCandidates(spots);
}

/**
 * 瞄准：取最近相邻水面定方向，沿该方向在水面层延伸连续水面至最长 AIM_MAX_LEVEL 格。
 * 注：延伸平面是水面格自己那一层（nearest.y），不是站位层（站位层全是空气）。
 */
export function aimFromWaters(
  stand: Vec3,
  waters: readonly Vec3[],
  isWater: (p: Vec3) => boolean
): AimResult | undefined {
  if (waters.length === 0) return undefined;
  let nearest = waters[0]!;
  let bestDist = Math.abs(nearest.x - stand.x) + Math.abs(nearest.z - stand.z);
  for (const w of waters) {
    const d = Math.abs(w.x - stand.x) + Math.abs(w.z - stand.z);
    if (d < bestDist) {
      bestDist = d;
      nearest = w;
    }
  }
  const step = { x: Math.sign(nearest.x - stand.x), y: Math.sign(nearest.z - stand.z) };
  if (step.x === 0 && step.y === 0) return { target: nearest, level: 1 }; // 方向异常防御
  return extendAim({ x: stand.x, y: nearest.y, z: stand.z }, step, isWater) ?? { target: nearest, level: 1 };
}

// ─── 流程调参常量 ──────────────────────────────────────────────

/** 选点距假人上限（格，只选自身 16 格内） */
export const FISH_PICK_MAX_DIST = 16;
/** 新点扫描半径（格，正方体半边长） */
export const FISH_SCAN_RADIUS = 16;
/** 扫描冷却（tick） */
export const FISH_SCAN_COOLDOWN_TICKS = 120;
/** 无可用点/无竿重查（tick） */
export const FISH_RECHECK_TICKS = 50;
/** 到位对齐判定（格，站立格中心容差） */
export const FISH_ALIGN_DIST = 0.8;
/** 微调失败容忍距离（格）：对齐失败但已够近仍可抛竿 */
export const FISH_ALIGN_FAIL_DIST = 3;
/** 播报节流（tick） */
export const FISH_NOTIFY_COOLDOWN_TICKS = 100;
/** 启动实体稳定等待（tick） */
export const FISH_INIT_TICKS = 20;
/** 同点连续抛竿失败触发钓点裁决的次数 */
export const FISH_SPOT_STRIKES = 3;
/** 扫描每帧探块预算（分帧迭代器） */
export const FISH_SCAN_BUDGET = 300;
/** 单轮认领的逐点再校验预算（点，对齐 domain/Pool DEFAULT_CLAIM_PROBES） */
export const FISH_CLAIM_PROBES = 6;
/** 连续"池非空却无一点可认领"轮数 → 清退陈旧点并强制重扫（防原地空转） */
export const FISH_STALE_ROUNDS = 3;
/** 一次钓点组装的站位复核预算（个）：每站位 ~3 次探块，大水体必须封顶（F-18） */
export const FISH_COMPOSE_MAX_STANDS = 256;
/** 诊断命令（mp:fishspot）的站位复核预算：放宽一档但仍封顶 */
export const FISH_DIAG_MAX_STANDS = FISH_COMPOSE_MAX_STANDS * 4;
/** 扫描 Y 向半径（格）：水面通常在假人层高附近，全 y 域分帧成本不可承受 */
export const FISH_SCAN_Y_RADIUS = 8;
/** 背包快满阈值（剩余空格 ≤ 该值 → 播报预警） */
export const FISH_BACKPACK_NEAR_FULL_GAP = 2;
/** 吸取节拍（tick）：能力每次唤醒按此间隔吸附半径内散件与经验球 */
export const FISH_SUCK_PULSE_TICKS = 5;
/** 站位格中心（导航/对齐基准） */
export function standCenter(stand: Vec3): Vec3 {
  return { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 };
}

/** 站位是否在认领半径内——组装筛/PICK 预筛/陈旧清退三处共用此唯一判据 */
export function withinStandReach(center: Vec3, stand: Vec3, maxDist = FISH_PICK_MAX_DIST): boolean {
  return horizontalDistance(center, standCenter(stand)) <= maxDist;
}

/** 站位竖直贴合容差（格）：±1 排除"同列上下方"假到位 */
export const FISH_STAND_Y_TOLERANCE = 1;

/**
 * 是否已站在该点位上（认领到点即当下站位 → 免寻路直接抛竿）。
 * 水平档与 ALIGN 微对齐同判据，竖直另收紧到 ±1。
 */
export function isAtStandSpot(
  location: Vec3,
  stand: Vec3,
  xzTolerance = FISH_ALIGN_DIST,
  yTolerance = FISH_STAND_Y_TOLERANCE
): boolean {
  const center = standCenter(stand);
  return horizontalDistance(location, center) <= xzTolerance && Math.abs(location.y - center.y) <= yTolerance;
}

/** 钓点池点位键（站位格全维唯一） */
export function fishingSpotKey(dimId: string, stand: Vec3): string {
  return `${dimId}:${stand.x},${stand.y},${stand.z}`;
}

/**
 * 落点判定：先判实体，勾中任何实体即 snagged（钩本体由调用方剔除）。
 * 无实体时：在水中=water，不在=landed。
 */
export function judgeHookPlacement(inWater: boolean, hasEntityNearby: boolean): "water" | "snagged" | "landed" {
  if (hasEntityNearby) return "snagged";
  return inWater ? "water" : "landed";
}

/** 钓鱼流程失败原因（timeout=无获不属失败） */
export type FishFailReason = "landed" | "snagged" | "hook-lost" | "no-rod" | "offline" | "error";

/**
 * 寻点扫描失败原因：no-water=范围内没有水面 / no-spot=有水面但无满足条件的钓鱼点
 * / error=扫描异常
 */
export type FindSpotsFailure = "no-water" | "no-spot" | "error";

/**
 * 寻找钓鱼点失败原因分类。
 * @param surfaceCount - 水面格数
 * @param spotCount - 钓点数
 * @param collectedOk - 采集是否可信（false=引擎异常，0 水面不是"附近没有水"）
 * @returns 失败原因；成功返回 undefined
 */
export function classifyFishingScan(
  surfaceCount: number,
  spotCount: number,
  collectedOk = true
): FindSpotsFailure | undefined {
  if (!collectedOk) return "error";
  if (surfaceCount === 0) return "no-water";
  if (spotCount === 0) return "no-spot";
  return undefined;
}

/** 失败原因 → 中文播报 */
export function fishFailureLabel(reason: FishFailReason): string {
  switch (reason) {
    case "landed":
      return "鱼钩勾中固体方块（落陆地），本次钓鱼失败";
    case "snagged":
      return "鱼钩勾中实体生物，本次钓鱼失败";
    case "hook-lost":
      return "鱼钩中途消失，本次钓鱼失败";
    case "no-rod":
      return "没有鱼竿";
    case "offline":
      return "假人不在线";
    default:
      return "执行失败";
  }
}

/**
 * 站位直读审计（engine 观测世界后填入）——组装末段的出池前校验与认领时复核共用
 * 同一次读、同一判据实现。除 verdict 外逐条记录原始观测，不成立时日志能指出塌在哪一条。
 */
export interface StandAudit {
  verdict: "ok" | "invalid" | "unreadable";
  /** 首条不成立/读不到的判据（verdict!=="ok" 时有值） */
  reason?: StandFailReason;
  /** 支撑格 typeId（读不到时缺省） */
  supportId?: string;
  /** 站位格 typeId */
  above1Id?: string;
  /** 头顶格 typeId */
  above2Id?: string;
  /** 邻水观测数（countAdjacentWaters：支撑层 8 邻，零命中再下探一层） */
  waters: number;
}

/** 站位判据失败细分（诊断口径，取值与 judgeStandSpot 的各判定条件一一对应） */
export type StandFailReason =
  | "support-unreadable"
  | "support-air"
  | "support-unsafe"
  | "above1-unreadable"
  | "above1-not-air"
  | "above2-unreadable"
  | "above2-not-air"
  | "no-water";

/** 站位判据的观测原语（engine 喂读块、单测喂体素字典——判据只有这一份） */
export interface StandObservation {
  /** 该格方块观测；undefined=读不到（未加载区块/越界） */
  block(p: Vec3): SupportProbe | undefined;
}

/**
 * 站位直读审计（认领时复核与组装末段校验共用的那一次读）。
 * 观测顺序=成本顺序：支撑/站位/头顶 3 读（任一读不到即 unreadable，瞬态不判死），
 * 邻水环查走 countAdjacentWaters，最后交 judgeStandSpot 唯一判据定案。
 * 注：环查读不到的格既不算水面也不报错——与组装期"集合中没有即非水"同一口径。
 */
export function auditStand(stand: Vec3, obs: StandObservation): StandAudit {
  const cell = { x: Math.floor(stand.x), y: Math.floor(stand.y), z: Math.floor(stand.z) };
  const supportCell = { x: cell.x, y: cell.y - 1, z: cell.z };
  const support = obs.block(supportCell);
  if (support === undefined) return { verdict: "unreadable", reason: "support-unreadable", waters: 0 };
  const above1 = obs.block(cell);
  if (above1 === undefined)
    return { verdict: "unreadable", reason: "above1-unreadable", supportId: support.id, waters: 0 };
  const above2 = obs.block({ x: cell.x, y: cell.y + 1, z: cell.z });
  if (above2 === undefined)
    return {
      verdict: "unreadable",
      reason: "above2-unreadable",
      supportId: support.id,
      above1Id: above1.id,
      waters: 0,
    };
  // 邻水环查与组装同规则（cap=1 命中即止）；直读"任意水"⊇ 组装的水面集合，
  // 组装期认定的点复核必然也认定（只有世界真的变了才会失效）
  const waters = countAdjacentWaters(
    supportCell,
    (p) => {
      const b = obs.block(p);
      return b !== undefined && WATER_BLOCK_IDS.includes(b.id);
    },
    1
  );
  const audit: StandAudit = {
    verdict: "ok",
    supportId: support.id,
    above1Id: above1.id,
    above2Id: above2.id,
    waters,
  };
  if (judgeStandSpot(support, above1.id, above2.id, waters)) return audit;
  audit.verdict = "invalid";
  audit.reason = standFailureReason(support, above1.id, above2.id, waters);
  return audit;
}

/** 归因：按 judgeStandSpot 各条件的顺序找出首条不成立的判据（判据本身仍只有 judgeStandSpot 一份） */
export function standFailureReason(
  support: SupportProbe,
  above1Id: string,
  above2Id: string,
  waterNeighborCount: number
): StandFailReason | undefined {
  if (!isSafeSupport(support)) return support.air ? "support-air" : "support-unsafe";
  if (above1Id !== "minecraft:air") return "above1-not-air";
  if (above2Id !== "minecraft:air") return "above2-not-air";
  if (waterNeighborCount <= 0) return "no-water";
  return undefined;
}

/** 站位不成立原因 → 中文 */
export function standAuditLabel(a: StandAudit): string {
  switch (a.reason) {
    case "support-unreadable":
      return "支撑方块读不到（区块未加载）";
    case "support-air":
      return "支撑是空气（脚下无方块）";
    case "support-unsafe":
      return `支撑非实心或危险（${a.supportId ?? "?"}）`;
    case "above1-unreadable":
      return "站位格读不到（区块未加载）";
    case "above1-not-air":
      return `站位格被占据（${a.above1Id ?? "?"}）`;
    case "above2-unreadable":
      return "头顶格读不到（区块未加载）";
    case "above2-not-air":
      return `头顶格被占据（${a.above2Id ?? "?"}）`;
    case "no-water":
      return "支撑层与其下一层的 8 邻都没有水面";
    default:
      return "站位判据不成立";
  }
}

/** 钓点池点位（候选 + 稳定键 + 成功率） */
export interface FishSpot extends SpotCandidate {
  key: string;
  /**
   * 成功率（%）：新点一律 FISH_RATE_DEFAULT，结构仍成立但连续抛竿失败的点逐档下调、
   * 钓上一尾逐档回升。它不是可用闸门（闸门是结构判据），而是同星级内部的优先序。
   */
  rate: number;
}

/** 成功率满档（新点/修好的点） */
export const FISH_RATE_DEFAULT = 100;
/** 成功率下限：只降档、不直接移除点位；是否移出钓点池只由结构判据决定 */
export const FISH_RATE_MIN = 0;
/** 成功率单次升降档（%） */
export const FISH_RATE_STEP = 25;

/** 失败降档（封底 FISH_RATE_MIN） */
export function decayRate(rate: number): number {
  return Math.max(FISH_RATE_MIN, rate - FISH_RATE_STEP);
}

/** 钓获回升一档（封顶 FISH_RATE_DEFAULT） */
export function recoverRate(rate: number): number {
  return Math.min(FISH_RATE_DEFAULT, rate + FISH_RATE_STEP);
}

/**
 * 钓点位次（池队列与入池排序共用的唯一真源）：星级高的在前，同星级成功率高的在前，
 * 再同则距中心近的在前
 */
export function rankFishSpots(a: FishSpot, b: FishSpot): number {
  return b.aim.level - a.aim.level || b.rate - a.rate || a.distSqCenter - b.distSqCenter;
}

/**
 * 站位邻水格采集（与 countAdjacentWaters 同一条环查规则，返回具体水面格）。
 * 修复钓点要用它重算星级——环查必须同一口径。
 */
export function adjacentWaterCells(stand: Vec3, isWater: (p: Vec3) => boolean): Vec3[] {
  const cell = { x: Math.floor(stand.x), y: Math.floor(stand.y), z: Math.floor(stand.z) };
  const support = { x: cell.x, y: cell.y - 1, z: cell.z };
  const found: Vec3[] = [];
  for (const [dx, dz] of ADJACENT_8) {
    const p = { x: support.x + dx, y: support.y, z: support.z + dz };
    if (isWater(p)) found.push(p);
  }
  if (found.length > 0) return found;
  for (const [dx, dz] of ADJACENT_8) {
    const p = { x: support.x + dx, y: support.y - 1, z: support.z + dz };
    if (isWater(p)) found.push(p);
  }
  return found;
}

/**
 * 钓点修复：以当下世界重算该站位的瞄准格与星级，判据与组装期同一份。
 * @param stand - 站位（修复只判断这块地方还是不是钓位）
 * @param isWater - 水面观测（调用方喂探块闭包）
 * @returns 新的瞄准（undefined=周围已无水，调用方应将其移出钓点池）
 */
export function repairSpotAim(stand: Vec3, isWater: (p: Vec3) => boolean): AimResult | undefined {
  return aimFromWaters(stand, adjacentWaterCells(stand, isWater), isWater);
}
