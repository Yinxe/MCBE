// ─── 宝库任务端口实现（mc/ai） ───────────────────────────
// VaultPorts 的 mc 适配，对齐 dev 1.3.20 宝库规格（1.3.10~1.3.19 用户实测修复）：
//   - 扫描：半径 15、y clamp(-64,320)、allowUnloadedChunks=false，只扫
//     minecraft:vault（ominous 是 block state，不是独立方块）
//   - 站立点：**优先宝库正面**（cardinal_direction 反方向 1~2 格可站立）——
//     宝库开箱必须面对钥匙孔正面，侧面/背面点击是假成功；正面不可站再任意兜底
//   - 导航：零注视（lookAt 干扰 GameTest 导航）；到达判定 2 格；停滞判定
//     （距离无进展 200 tick → 放弃重扫）
//   - 交互：识别普通/不详 → 候选钥匙（普通=trial_key 优先+不详兜底 / 不详=仅
//     不详）→ ensureMainhand 换主手 slot 0 → **useItemInSlotOnBlock 右键使用**
//     优先（interactWithBlock 空手交互不消耗钥匙=假成功）→ 交互前记录**总量**
//     基准 → 回读总量<基准=真消耗；未消耗=宝库冷却/动画中 → 持续点击不放弃
//   - 朝向：lookAt 宝库中心 + **同步 lastPoint.lookTarget**（重连恢复姿态）
// 决策逻辑全部在 core/ai/VaultTask（可单测），本文件只做副作用。

import { system, world, Direction, BlockVolume, EquipmentSlot, type ItemStack, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { VaultInteractResult, VaultPorts, Vec3 } from "../../core/ai/VaultTask";
import { BOT_TAG } from "../../core/tags/BotTags";
import { workflowVaultOpened } from "../../core/events/WorkflowEvents";
import { botRegistry } from "../bootstrap/context";
import { lookAt } from "../adapters/PoseGateway";
import { safeReconnect, reconnectingBots } from "../features/pendingRespawn";

// ─── 常量 ────────────────────────────────────────────────

/** 扫描半径（格，以假人为中心的正方体半边长；用户规格 15） */
const SCAN_RADIUS = 15;
/** 导航轮询间隔（tick） */
const NAVIGATE_POLL_TICKS = 10;
/** 导航停滞判定（tick）：距离连续无进展超过该时长 → 放弃重扫（≈10 秒） */
const STALL_TICKS = 200;
/** 导航总超时（tick，≈30 秒，极端兜底） */
const NAVIGATE_TIMEOUT_TICKS = 600;
/** 到达判定距离（格）：假人可靠近宝库且 r < 2 */
const ARRIVE_DISTANCE = 2;
/** 视线命中判定最大距离（格） */
const VIEW_MAX_DIST = 8;
/** 通知节流（tick，≈10 秒） */
const NOTIFY_COOLDOWN_TICKS = 200;

/** 宝库方块 ID（普通/不详共用同一方块，block state ominous 区分） */
const VAULT_BLOCK = "minecraft:vault";
/** 钥匙类型（宝库类型识别后按优先级选） */
const KEY_CANDIDATES: Record<"normal" | "ominous", string[]> = {
  normal: ["minecraft:trial_key", "minecraft:ominous_trial_key"],
  ominous: ["minecraft:ominous_trial_key"],
};
const KEY_LABELS: Record<string, string> = {
  "minecraft:trial_key": "普通钥匙",
  "minecraft:ominous_trial_key": "不详钥匙",
};

// ─── 假人解析 ────────────────────────────────────────────

/** 从 registry 记录解析在线假人实体（守卫：记录/实体/标签/死亡） */
function getBot(botName: string): SimulatedPlayer | undefined {
  try {
    const record = botRegistry.get(botName);
    if (!record || !record.online || record.death || !record.entityId) return undefined;
    const entity = world.getEntity(record.entityId);
    if (!entity || !entity.hasTag(BOT_TAG)) return undefined;
    return entity as SimulatedPlayer;
  } catch {
    return undefined;
  }
}

// ─── 端口实现 ────────────────────────────────────────────

export const vaultPorts: VaultPorts = {
  isBotAvailable(botName: string): boolean {
    const record = botRegistry.get(botName);
    return !!record && record.online && !record.death;
  },

  hasKey(botName: string): boolean {
    const bot = getBot(botName);
    if (!bot) return false;
    // 背包有任一宝库钥匙（普通/不详均可；类型匹配在交互时按宝库类型处理）
    return countKeyTotal(bot) > 0;
  },

  scanVault(botName: string): Vec3 | undefined {
    const bot = getBot(botName);
    if (!bot) return undefined;
    const c = bot.location;
    try {
      // y 范围 clamp 到世界高度，allowUnloadedChunks=false（未加载区块等下一次重扫）
      const volume = new BlockVolume(
        {
          x: Math.floor(c.x) - SCAN_RADIUS,
          y: Math.max(-64, Math.floor(c.y) - SCAN_RADIUS),
          z: Math.floor(c.z) - SCAN_RADIUS,
        },
        {
          x: Math.floor(c.x) + SCAN_RADIUS,
          y: Math.min(320, Math.floor(c.y) + SCAN_RADIUS),
          z: Math.floor(c.z) + SCAN_RADIUS,
        },
      );
      const found = bot.dimension.getBlocks(volume, { includeTypes: [VAULT_BLOCK] }, false);
      // 最近优先
      let best: Vec3 | undefined;
      let bestDist = Infinity;
      for (const loc of found.getBlockLocationIterator()) {
        const dist = horizontalDistance(c, loc);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: loc.x, y: loc.y, z: loc.z };
        }
      }
      return best;
    } catch {
      return undefined;
    }
  },

  distanceToTarget(botName: string, target: Vec3): number {
    const bot = getBot(botName);
    if (!bot) return Infinity;
    return horizontalDistance(bot.location, target);
  },

  async navigateToVault(botName: string, target: Vec3): Promise<boolean> {
    const bot = getBot(botName);
    if (!bot) return false;
    // 站立点：优先宝库正面（面对钥匙孔），正面不可站再任意方向兜底
    const stand = pickStandSpot(bot, target);
    if (!stand) return false;
    const navTarget = { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 };
    if (distance3d(bot.location, navTarget) <= ARRIVE_DISTANCE) return true;
    try {
      bot.stopMoving();
      const result = bot.navigateToLocation(navTarget, 1);
      if (!result.isFullPath) return false; // 无路径 → 放弃换下一个
    } catch {
      return false;
    }
    // 轮询等待到达：停滞判定（距离无进展 STALL_TICKS）+ 总超时兜底；
    // 协程内自检查（离线/死亡/钥匙丢失 → 提前失败）
    const startTick = system.currentTick;
    let stallCount = 0;
    let lastDist = Infinity;
    while (true) {
      await waitTicks(NAVIGATE_POLL_TICKS);
      if (!vaultPorts.isBotAvailable(botName) || !vaultPorts.hasKey(botName)) return false;
      const current = getBot(botName);
      if (!current) return false;
      const dist = distance3d(current.location, navTarget);
      if (dist >= lastDist) {
        stallCount++;
        if (stallCount * NAVIGATE_POLL_TICKS >= STALL_TICKS) {
          console.info(`[MockPlayer] 宝库 ${botName} 导航停滞（${STALL_TICKS}tick 无进展），重扫`);
          return false;
        }
      } else {
        stallCount = 0;
      }
      lastDist = dist;
      if (dist <= ARRIVE_DISTANCE) return true;
      if (system.currentTick - startTick > NAVIGATE_TIMEOUT_TICKS) return false;
    }
  },

  interactVault(botName: string, target: Vec3): VaultInteractResult {
    const bot = getBot(botName);
    if (!bot) return "error";
    const record = botRegistry.get(botName);
    if (!record) return "error";
    // ⚠️ 重连进行中不交互（safeReconnect 异步生效前，避免二次点击消耗钥匙）
    if (reconnectingBots.has(botName)) return "error";

    // ── 1. 识别宝库类型（普通/不详：block state ominous）→ 候选钥匙 ──
    const vaultKind = readVaultKind(bot, target); // "normal" | "ominous" | undefined
    if (!vaultKind) {
      // 宝库被拆/读取失败 → 目标失效，通知后由树清目标重扫
      notifyNoKey(bot, record.name, "目标宝库已不存在，重新搜索附近宝库");
      return "target-gone";
    }
    const candidates = KEY_CANDIDATES[vaultKind];

    // ── 2. 按优先级确保主手（slot 0）是候选钥匙 ──
    // ⚠️ 玩家只需把钥匙放入背包，主手自动换（用户规格 1.3.19：主手固定 slot 0）
    const keyType = ensureMainhand(bot, candidates);
    if (!keyType) {
      const missing = candidates.length > 1 ? "普通钥匙或不详钥匙" : "不详钥匙";
      notifyNoKey(bot, record.name, `背包没有${missing}，请放入背包后重试`);
      return "error";
    }

    // ── 3. 持续注视宝库中心 + 同步 lastPoint.lookTarget（重连恢复朝向） ──
    const center = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    try {
      lookAt(bot, center);
      if (record.lastPoint) record.lastPoint.lookTarget = center;
    } catch {
      /* chunkload 模式可能不支持，降级不影响交互 */
    }

    // ── 4. 交互前记录钥匙总量基准（交互后记录已是消耗后的值 → 判定永不满足） ──
    const baseline = countKeyTotal(bot);

    // ── 5. 手持钥匙**使用**于宝库（右键使用 = useItemInSlotOnBlock；空手交互
    //       interactWithBlock 返回 true 但不触发开箱 = 假成功）──
    let ok = useItemOnVault(bot, target);
    if (!ok) {
      ok = interactBlock(bot, target);
    }
    if (!ok) {
      notify(bot, record.name, "使用钥匙开宝库未成功，请调整假人位置后重试");
      return "error";
    }

    // ── 6. 回读验证：钥匙真的被消耗了吗 ──
    // ⚠️ 持续点击语义（用户规格 1.3.19）：宝库冷却/出掉落动画中点击返回 true
    //    但钥匙不消耗（假成功）——未消耗 → 冷却后继续点击，不放弃目标
    const total = countKeyTotal(bot);
    if (total >= baseline) return "not-consumed";

    // 真消耗 → 发布领域事件 + **立即通知剩余钥匙数（下线前背包准确）**
    workflowVaultOpened.trigger({ botName, keyType, remaining: total });
    sendNearest(bot, record.name, `${color.success}开箱成功！${color.muted}剩余 ${color.info}${total} ${color.playerName}把钥匙${color.muted}，下线重连继续`);
    return "consumed";
  },

  tryReconnect(botName: string): void {
    const record = botRegistry.get(botName);
    if (!record) return;
    // 数量通知已在交互成功时发出（下线前背包准确）；重连后黑板目标保留 → 树继续同一宝库
    safeReconnect(record);
  },

  idle(botName: string): void {
    const bot = getBot(botName);
    if (!bot) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    if (countKeyTotal(bot) === 0) {
      notifyNoKey(bot, record.name, "背包没有宝库钥匙，请放入钥匙（普通/不详均可）");
      return;
    }
    // 有钥匙但无宝库/扫描冷却中：低频提示
    notifyNoKey(bot, record.name, "附近 15 格内没有宝库，请将假人带到宝库附近");
  },
};

// ─── 工具函数 ────────────────────────────────────────────

function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(resolve, ticks);
  });
}

/** 水平距离（扫描排序用） */
function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** 三维距离（到达判定用） */
function distance3d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ─── 站立点（优先宝库正面） ──────────────────────────────

/**
 * 站立点：**优先宝库正面**（cardinal_direction 反方向 1~2 格可站立）——宝库
 * 开箱必须面对钥匙孔正面使用钥匙（侧面/背面点击不消耗钥匙）；正面不可站再
 * 任意方向兜底。
 */
function pickStandSpot(bot: SimulatedPlayer, vault: Vec3): Vec3 | undefined {
  const facing = vaultFacing(bot, vault);
  if (facing) {
    for (const pos of frontStandCandidates(vault, facing)) {
      if (isStandable(bot, pos)) return pos;
    }
  }
  // 任意方向兜底：宝库旁 1~2 格可站立点（靠近假人一侧优先）
  for (const dist of [1, 2]) {
    const candidates = [
      { x: vault.x + dist, y: vault.y, z: vault.z },
      { x: vault.x - dist, y: vault.y, z: vault.z },
      { x: vault.x, y: vault.y, z: vault.z + dist },
      { x: vault.x, y: vault.y, z: vault.z - dist },
    ];
    for (const pos of candidates) {
      if (isStandable(bot, pos)) return pos;
    }
  }
  return undefined;
}

/** 宝库朝向（minecraft:cardinal_direction state；读取失败返回 undefined） */
function vaultFacing(bot: SimulatedPlayer, vault: Vec3): string | undefined {
  try {
    const block = bot.dimension.getBlock(vault);
    if (!block || block.typeId !== VAULT_BLOCK) return undefined;
    return block.permutation.getState("minecraft:cardinal_direction") as string | undefined;
  } catch {
    return undefined;
  }
}

/** 宝库正面站立点候选（朝向反方向 1~2 格：朝北 → 站南侧 z+1，面对钥匙孔） */
function frontStandCandidates(vault: Vec3, facing: string): Vec3[] {
  const dx = facing === "east" ? -1 : facing === "west" ? 1 : 0;
  const dz = facing === "north" ? 1 : facing === "south" ? -1 : 0;
  return [
    { x: vault.x + dx, y: vault.y, z: vault.z + dz },
    { x: vault.x + dx * 2, y: vault.y, z: vault.z + dz * 2 },
  ];
}

/** 该格可站立：格内空气 + 下方有支撑 */
function isStandable(bot: SimulatedPlayer, pos: Vec3): boolean {
  try {
    const here = bot.dimension.getBlock(pos);
    const below = bot.dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
    if (!here || !below) return false;
    return here.typeId === "minecraft:air" && below.typeId !== "minecraft:air";
  } catch {
    return false;
  }
}

/** 宝库类型（普通/不详） */
function readVaultKind(bot: SimulatedPlayer, vault: Vec3): "normal" | "ominous" | undefined {
  try {
    const block = bot.dimension.getBlock(vault);
    if (!block) return undefined;
    const ominous = block.permutation.getState("ominous") as boolean | undefined;
    return ominous ? "ominous" : "normal";
  } catch {
    return undefined;
  }
}

// ─── 钥匙操作 ────────────────────────────────────────────

/** 背包+主手钥匙总量（普通+不详之和，交互基准与判定权威） */
function countKeyTotal(bot: SimulatedPlayer): number {
  try {
    const inv = bot.getComponent("minecraft:inventory") as
      | { container: { getItem: (slot: number) => ItemStack | undefined; size: number } }
      | undefined;
    let total = 0;
    if (inv?.container) {
      for (let i = 0; i < inv.container.size; i++) {
        const item = inv.container.getItem(i);
        if (item?.typeId === "minecraft:trial_key" || item?.typeId === "minecraft:ominous_trial_key") {
          total += item.amount;
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** 确保主手（slot 0）为候选钥匙：已是 → 直接返回；否则从背包交换 + 选中 slot 0 */
function ensureMainhand(bot: SimulatedPlayer, candidates: string[]): string | undefined {
  try {
    const inv = bot.getComponent("minecraft:inventory") as
      | { container: { getItem: (slot: number) => ItemStack | undefined; swapItems: (a: number, b: number) => boolean; size: number } }
      | undefined;
    const container = inv?.container;
    if (!container) return undefined;
    const held = container.getItem(0);
    if (held && candidates.includes(held.typeId)) return held.typeId;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && candidates.includes(item.typeId)) {
        if (!container.swapItems(i, 0)) return undefined;
        bot.selectedSlotIndex = 0; // 主手 = slot 0（选中）
        return container.getItem(0)?.typeId ?? candidates[0];
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 手持钥匙右键使用于宝库（useItemInSlotOnBlock slot 0；视线命中的 face） */
function useItemOnVault(bot: SimulatedPlayer, target: Vec3): boolean {
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

/** 回退通道：interactWithBlock（空手交互；宝库开箱不消耗钥匙，仅兜底） */
function interactBlock(bot: SimulatedPlayer, target: Vec3): boolean {
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

// ─── 通知（节流） ────────────────────────────────────────
// 同一个 bot 10 秒内只提醒一次，避免每 tick 刷屏

const notifyAt = new Map<string, number>();

function notify(bot: SimulatedPlayer, botName: string, message: string): void {
  const now = system.currentTick;
  const last = notifyAt.get(botName) ?? 0;
  if (now - last < NOTIFY_COOLDOWN_TICKS) return;
  notifyAt.set(botName, now);
  sendNearest(bot, botName, message);
}

function notifyNoKey(bot: SimulatedPlayer, botName: string, message: string): void {
  notify(bot, botName, message);
}

/** 通知最近玩家（[宝库] 前缀 + 假人名 + 详情） */
function sendNearest(bot: SimulatedPlayer, botName: string, message: string): void {
  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;
    for (const p of players) {
      if (p.name === botName) continue;
      const dist = horizontalDistance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    nearest?.sendMessage(`${color.playerName}[宝库] ${color.success}${botName} ${color.muted}${message}`);
  } catch {
    /* 通知失败不影响主流程 */
  }
}
