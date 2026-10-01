// ─── 宝库世界操作（感知/导航/开箱交互） ────────────────────────────
// 感知：±15 格立方 getBlocks 一次采宝库，逐块读 ominous state 分类；
//   分类必须验 typeId——宝库被替换后 getBlock 仍返回方块，只读 state 会对错误方块卡死。
// 站立点：宝库正面 1~2 格优先（cardinal_direction 反方向；侧面/背面点击不会真的开箱），四向兜底环；
//   可站=格内 air＋下方非 air，候选按离假人近→远逐个试航。
// 导航：途中禁 lookAt（干扰导航），发起前验目标方块存在；到达以离宝库 ≤2 判（停半路也算到位）；
//   不进 Mover——其"静止+位置不变"判据与"距离≤2/无进展 200t"不同源；
//   10t 轮询，600t 全程预算（换候选不重置）。
// 交互：换持钥匙→记两种钥匙总量基准→右键使用优先→回读总量变少才判真消耗（详见函数级注释）。
// 结果只回纯数据，文案/节流在能力层。

import { BlockVolume, Direction, system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import type { Vec3 } from "../domain/Coords";
import { distance3d, horizontalDistance } from "../domain/Coords";
import type { CancelToken } from "../domain/Cancellation";
import type { KeyInventory, NearbyVaults, VaultInteractResult, VaultKnowledge } from "../domain/VaultRules";
import {
  OMINOUS_TRIAL_KEY,
  TRIAL_KEY,
  fallbackStandCandidates,
  frontStandCandidates,
  orderStandCandidates,
} from "../domain/VaultRules";
import { botOf, botValid, inventoryContainer, rayHit, sleepTicks } from "./Atomic";
import { botClickGuard } from "./ClickGuard";

/** 宝库方块 ID（普通/不详共用，block state "ominous" 区分） */
const VAULT_BLOCK = "minecraft:vault";
/** 扫描半径（格，以假人为中心的正方体半边长） */
const SCAN_RADIUS = 15;
/** 导航轮询间隔（tick） */
const NAVIGATE_POLL_TICKS = 10;
/** 导航停滞判定（tick）：距离连续无进展超过该时长 → 放弃重扫（≈10 秒） */
const NAVIGATE_STALL_TICKS = 200;
/** 导航总超时（tick，≈30 秒极端兜底） */
const NAVIGATE_TIMEOUT_TICKS = 600;
/** 到达判定距离（格）：假人可靠近宝库且 distance3d < 2 */
const ARRIVE_DISTANCE = 2;
/** 视线命中判定最大距离（格） */
const VIEW_MAX_DIST = 8;

/** 开箱交互回传（结果枚举 + 消耗后钥匙总量——成功播报数据源） */
export interface VaultInteractOutcome {
  result: VaultInteractResult;
  /** 两种钥匙总量（consumed 时=消耗后的准确剩余；其余为回读参考） */
  remaining: number;
}

// ─── 感知 ────────────────────────────────────────────────

/** 一次完整感知：背包钥匙分类 + 附近宝库分类（异常回空快照，不抛穿） */
export function vaultSense(botId: number): VaultKnowledge | undefined {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return undefined;
  try {
    const l = bot.location;
    const position: Vec3 = { x: l.x, y: l.y, z: l.z };
    return { keys: scanKeys(bot), vaults: scanVaults(bot, position), position, dimensionId: bot.dimension.id };
  } catch {
    return undefined;
  }
}

/** 背包钥匙分类统计（普通/不详各多少） */
function scanKeys(bot: SimulatedPlayer): KeyInventory {
  const keys: KeyInventory = { trial: 0, ominous: 0 };
  const container = inventoryContainer(bot);
  if (!container) return keys;
  try {
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item?.typeId === TRIAL_KEY) keys.trial += item.amount;
      else if (item?.typeId === OMINOUS_TRIAL_KEY) keys.ominous += item.amount;
    }
  } catch {
    /* 感知失败返回已计部分 */
  }
  return keys;
}

/** 附近宝库分类扫描（普通/不详，按水平距离近 → 远排序） */
function scanVaults(bot: SimulatedPlayer, origin: Vec3): NearbyVaults {
  const vaults: NearbyVaults = { normal: [], ominous: [] };
  try {
    // y clamp 到世界高度；未加载区块的宝库 getBlocks 天然采不到（等下一次重扫）
    const volume = new BlockVolume(
      {
        x: Math.floor(origin.x) - SCAN_RADIUS,
        y: Math.max(-64, Math.floor(origin.y) - SCAN_RADIUS),
        z: Math.floor(origin.z) - SCAN_RADIUS,
      },
      {
        x: Math.floor(origin.x) + SCAN_RADIUS,
        y: Math.min(320, Math.floor(origin.y) + SCAN_RADIUS),
        z: Math.floor(origin.z) + SCAN_RADIUS,
      }
    );
    const found = bot.dimension.getBlocks(volume, { includeTypes: [VAULT_BLOCK] });
    for (const loc of found.getBlockLocationIterator()) {
      const kind = readVaultKindIn(bot.dimension, loc);
      const pos: Vec3 = { x: loc.x, y: loc.y, z: loc.z };
      if (kind === "ominous") vaults.ominous.push(pos);
      else if (kind === "normal") vaults.normal.push(pos);
      // kind undefined（typeId 验证失败/瞬态）→ 跳过
    }
  } catch {
    /* 感知失败返回已计部分 */
  }
  const byDist = (a: Vec3, b: Vec3): number => horizontalDistance(origin, a) - horizontalDistance(origin, b);
  vaults.normal.sort(byDist);
  vaults.ominous.sort(byDist);
  return vaults;
}

// ─── 导航（自检查取消条件，永不抛穿） ───────

/**
 * 寻路到宝库旁最近可达站位：站立候选=正面优先序经可站过滤后按离假人近→远
 * 逐个试航（正面被实体挡死自动绕近环）；到达以离宝库本身距离判定——任一候选
 * 在途已靠进 ARRIVE 半径即到位（终点阻塞停半路也判成功）。
 * 全候选试航失败（无路径/停滞/超时轮转）才 false（上层封锁该宝库换点重扫）；
 * 离线/目标被拆/取消 → false。
 */
export async function vaultNavigate(botId: number, target: Vec3, token?: CancelToken): Promise<boolean> {
  try {
    const first = botOf(botId);
    if (!first || !botValid(first)) return false;
    // 目标方块被拆/被替换 → 直接放弃（不导航到空气）
    if (!isVaultBlockIn(first.dimension, target)) return false;
    // 已在宝库附近 → 直接进交互（不再寻路）
    if (distance3d(first.location, target) <= ARRIVE_DISTANCE) return true;
    const standables = standCandidatesOf(first, target);
    if (standables.length === 0) return false; // 四周全实心/悬空——不可达换点
    const startTick = system.currentTick;
    let deadline = startTick + NAVIGATE_TIMEOUT_TICKS; // 全程预算（换候选不重置）
    for (const stand of standables) {
      if (token?.cancelled) return false;
      const current = botOf(botId);
      if (!current || !botValid(current)) return false;
      if (!isVaultBlockIn(current.dimension, target)) return false; // 换航间隙宝库被拆
      if (distance3d(current.location, target) <= ARRIVE_DISTANCE) return true;
      const navTarget: Vec3 = { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 };
      try {
        current.stopMoving();
        if (!current.navigateToLocation(navTarget, 1).isFullPath) continue; // 该点无路径→试下一候选
      } catch {
        continue;
      }
      const arrived = await watchApproach(botId, target, navTarget, deadline, token);
      if (arrived) return true;
      if (token?.cancelled) return false;
      if (system.currentTick >= deadline) return false;
      // 停滞/该点未达而预算未尽 → 试下一候选（半路进度保留，引擎从当前位续走）
    }
    return false;
  } catch {
    return false;
  }
}

/** 单候选监听协程：10t 轮询，到达=离宝库或离站位 ≤ARRIVE；停滞（离站位距离无进展）即报 */
async function watchApproach(
  botId: number,
  vault: Vec3,
  navTarget: Vec3,
  deadline: number,
  token?: CancelToken
): Promise<boolean> {
  let stallCount = 0;
  let lastDist = Infinity;
  for (;;) {
    await sleepTicks(NAVIGATE_POLL_TICKS, token);
    if (token?.cancelled) return false;
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    if (!isVaultBlockIn(bot.dimension, vault)) return false; // 导航途中宝库被拆
    const dist = distance3d(bot.location, navTarget);
    if (dist <= ARRIVE_DISTANCE || distance3d(bot.location, vault) <= ARRIVE_DISTANCE) return true;
    if (dist >= lastDist) {
      stallCount++;
      if (stallCount * NAVIGATE_POLL_TICKS >= NAVIGATE_STALL_TICKS) return false;
    } else {
      stallCount = 0;
    }
    lastDist = dist;
    if (system.currentTick >= deadline) return false;
  }
}

// ─── 交互（主手换持 + 右键使用 + 总量基准回读） ─────────

/**
 * 开箱一次交互尝试。前置（目标验证/主手/注视/基准）全部内联，回读验证消耗
 * ——点击返回 true 但钥匙未消耗，说明这次并未真正开成（宝库在冷却或动画中），
 * 上层冷却后继续点击（不放弃目标，也不判定宝库已经开过）。
 */
export function vaultInteract(botId: number, target: Vec3, keyType: string): VaultInteractOutcome {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return { result: "failed", remaining: 0 };

  // 验证目标仍是宝库方块（被拆/被替换 → target-gone 防对空气交互）
  let kind: "normal" | "ominous" | undefined;
  try {
    kind = readVaultKindIn(bot.dimension, target);
  } catch {
    kind = undefined;
  }
  if (!kind) return { result: "target-gone", remaining: 0 };

  // 主手（slot 0）换持选定钥匙（swapItems → 手动双写降级；钥匙在背包即可，
  // 主手自动换）
  if (!ensureMainhand(bot, keyType)) return { result: "no-key", remaining: 0 };

  // 交互前记录两种钥匙总量基准（交互后读到的已是消耗后的值）
  const baseline = countKeyTotal(bot);

  // 手持钥匙使用于宝库（右键使用=useItemInSlotOnBlock；失败退空手
  // interactWithBlock 兜底——不消耗钥匙但覆盖个别版本的引擎差异）
  botClickGuard.grant(botId); // 宝库开箱是能力自发交互，许可期内不误拦
  let ok = useKeyOnVault(bot, target);
  if (!ok) ok = interactVaultFallback(bot, target);
  if (!ok) return { result: "failed", remaining: baseline };

  // 回读验证：钥匙真的被消耗了吗
  const total = countKeyTotal(bot);
  if (total >= baseline) return { result: "not-consumed", remaining: total };
  return { result: "consumed", remaining: total };
}

// ─── 视线命中（近距可视免寻路闸的"看得见"侧） ──

/**
 * 假人当前视线是否正命中目标宝库格（rayHit 命中块 floor 坐标与 target 同格
 * 且 typeId 仍是宝库）。纯判定零副作用；读取失败/未命中 → false（上层照常
 * 寻路，绝不因误判跳过导航后对不准）。
 */
export function vaultInSight(botId: number, target: Vec3): boolean {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return false;
  const hit = rayHit(bot, VIEW_MAX_DIST);
  if (!hit || hit.id !== VAULT_BLOCK) return false;
  return (
    hit.location.x === Math.floor(target.x) &&
    hit.location.y === Math.floor(target.y) &&
    hit.location.z === Math.floor(target.z)
  );
}

// ─── 方块读取 ────────────────────────────────────────────

/** 目标坐标是否仍是宝库方块（被拆/被替换 → false） */
function isVaultBlockIn(dim: SimulatedPlayer["dimension"], pos: Vec3): boolean {
  try {
    const block = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    return !!block && block.typeId === VAULT_BLOCK;
  } catch {
    return false;
  }
}

/**
 * 宝库类型（普通/不详）。必须验证 typeId（见文件头注释）；失败 undefined
 * → 上层走 target-gone 清目标重扫。
 */
function readVaultKindIn(dim: SimulatedPlayer["dimension"], pos: Vec3): "normal" | "ominous" | undefined {
  try {
    const block = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    if (!block || block.typeId !== VAULT_BLOCK) return undefined;
    const ominous = block.permutation.getState("ominous") as boolean | undefined;
    return ominous ? "ominous" : "normal";
  } catch {
    return undefined;
  }
}

/** 宝库朝向（minecraft:cardinal_direction state；读取失败 undefined → 直接兜底环） */
function vaultFacing(bot: SimulatedPlayer, vault: Vec3): string | undefined {
  try {
    const block = bot.dimension.getBlock({ x: vault.x, y: vault.y, z: vault.z });
    if (!block || block.typeId !== VAULT_BLOCK) return undefined;
    return block.permutation.getState("minecraft:cardinal_direction") as string | undefined;
  } catch {
    return undefined;
  }
}

// ─── 站立点（正面优先候选 → 离假人最近可达序） ──────────

/** 可站立候选全表（正面 1~2 格 + 四向兜底环，可站过滤后离假人近→远；
 * 域择优 orderStandCandidates 的世界读侧接线） */
function standCandidatesOf(bot: SimulatedPlayer, vault: Vec3): Vec3[] {
  const facing = vaultFacing(bot, vault);
  const candidates = facing
    ? [...frontStandCandidates(vault, facing), ...fallbackStandCandidates(vault)]
    : fallbackStandCandidates(vault);
  const l = bot.location;
  return orderStandCandidates(candidates, (pos) => isStandable(bot, pos), { x: l.x, y: l.y, z: l.z });
}

/** 该格可站立：格内严格 minecraft:air（cave_air 不算）+ 下方有支撑 */
function isStandable(bot: SimulatedPlayer, pos: Vec3): boolean {
  try {
    const here = bot.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
    const below = bot.dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
    if (!here || !below) return false;
    return here.typeId === "minecraft:air" && below.typeId !== "minecraft:air";
  } catch {
    return false;
  }
}

// ─── 钥匙操作 ────────────────────────────────────────────

/** 背包两种钥匙总量（普通+不详之和，交互基准与消耗判定权威） */
function countKeyTotal(bot: SimulatedPlayer): number {
  const container = inventoryContainer(bot);
  if (!container) return 0;
  try {
    let total = 0;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item?.typeId === TRIAL_KEY || item?.typeId === OMINOUS_TRIAL_KEY) total += item.amount;
    }
    return total;
  } catch {
    return 0;
  }
}

/** 容器写侧结构化替身（2.8.0 的 setItem/swapItems 返回值按布尔成功语义用） */
interface WriteableContainer {
  getItem(slot: number): { typeId: string; amount: number } | undefined;
  setItem(slot: number, item?: unknown): boolean;
  swapItems(a: number, b: number): boolean;
  size: number;
}

/**
 * 确保主手（slot 0）为选定钥匙，三级降级：已是 → true；swapItems(i,0)；
 * 失败 → 手动双写（读两槽 → setItem 互写，防丢物品；第二步失败回滚 slot0，
 * 回滚也失败即返回 false，绝不留下两格各一份钥匙）。全失败 false。
 */
function ensureMainhand(bot: SimulatedPlayer, keyType: string): boolean {
  const container = inventoryContainer(bot) as unknown as WriteableContainer | undefined;
  if (!container) return false;
  try {
    const held = container.getItem(0);
    if (held?.typeId === keyType) {
      selectMainhand(bot);
      return true;
    }
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item || item.typeId !== keyType) continue;
      try {
        if (container.swapItems(i, 0)) {
          selectMainhand(bot);
          return container.getItem(0)?.typeId === keyType;
        }
      } catch {
        /* 落到手动双写 */
      }
      // 双写顺序：先钥匙入 slot0、成功再原 slot0 内容回 i。
      // setItem(0,钥匙) 成功而 setItem(i,原物) 失败时 i 仍是钥匙、0 也是钥匙——
      // 必须回滚 slot0（置回原物/清空）才能试下一槽；回滚也失败则不换持、返回 false。
      const slot0 = container.getItem(0);
      let movedIn = false;
      try {
        movedIn = container.setItem(0, item);
      } catch {
        movedIn = false;
      }
      if (!movedIn) continue;
      let returned = false;
      try {
        returned = container.setItem(i, slot0);
      } catch {
        returned = false;
      }
      if (!returned) {
        let restored = false;
        try {
          restored = container.setItem(0, slot0);
        } catch {
          restored = false;
        }
        if (!restored) {
          console.warn(`[mockplayer3] 宝库换持回滚失败 bot=${bot.name}，钥匙留原位不换持`);
          return false;
        }
        continue;
      }
      selectMainhand(bot);
      return container.getItem(0)?.typeId === keyType;
    }
    return false;
  } catch {
    return false;
  }
}

/** 选中主手位（slot 0，主手固定口径） */
function selectMainhand(bot: SimulatedPlayer): void {
  try {
    bot.selectedSlotIndex = 0;
  } catch {
    /* 瞬态失效——交互发起后自有回读验证兜底 */
  }
}

/** 手持钥匙右键使用于宝库（useItemInSlotOnBlock slot 0；视线命中面优先） */
function useKeyOnVault(bot: SimulatedPlayer, target: Vec3): boolean {
  let face: Direction = Direction.Down;
  try {
    const hit = bot.getBlockFromViewDirection({ maxDistance: VIEW_MAX_DIST });
    if (hit) face = hit.face;
  } catch {
    /* 视线读取失败用兜底面 */
  }
  try {
    return bot.useItemInSlotOnBlock(0, { x: target.x, y: target.y, z: target.z }, face);
  } catch {
    return false;
  }
}

/** 回退通道：空手 interactWithBlock（宝库开箱通常不消耗钥匙，仅兜底通道） */
function interactVaultFallback(bot: SimulatedPlayer, target: Vec3): boolean {
  const dx = target.x - bot.location.x;
  const dz = target.z - bot.location.z;
  let face: Direction = Direction.Down;
  if (Math.abs(dx) > Math.abs(dz)) {
    face = dx > 0 ? Direction.West : Direction.East;
  } else if (dz !== 0) {
    face = dz > 0 ? Direction.North : Direction.South;
  }
  try {
    return bot.interactWithBlock({ x: target.x, y: target.y, z: target.z }, face);
  } catch {
    return false;
  }
}
