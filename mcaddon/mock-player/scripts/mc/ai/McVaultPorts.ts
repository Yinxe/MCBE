// ─── 宝库任务端口实现（mc/ai） ───────────────────────────
// VaultPorts 的 mc 适配：世界感知（getBlocks 扫描宝库）/ 导航（SimulatedPlayer
// navigateToLocation 协程）/ 开箱（交互 + 回读验证防假成功）/ 安全重连。
// 决策逻辑全部在 core/ai/VaultTask（可单测），本文件只做副作用。

import { system, world, Direction, BlockVolume, EquipmentSlot, type ItemStack, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { VaultInteractResult, VaultPorts, Vec3 } from "../../core/ai/VaultTask";
import { BOT_TAG } from "../../core/tags/BotTags";
import { workflowVaultOpened } from "../../core/events/WorkflowEvents";
import { botRegistry } from "../bootstrap/context";
import { lookAt } from "../adapters/PoseGateway";
import { safeReconnect } from "../features/pendingRespawn";

// ─── 常量 ────────────────────────────────────────────────

/** 扫描半径（格）：17³ = 4913 < getBlocks 体积上限 10000 */
const SCAN_RADIUS = 8;
/** 导航轮询间隔（tick） */
const NAVIGATE_POLL_TICKS = 10;
/** 导航超时（tick，≈15 秒） */
const NAVIGATE_TIMEOUT_TICKS = 300;
/** 到达判定距离（格） */
const ARRIVE_DISTANCE = 2.5;
/** 无钥匙通知节流（tick，≈10 秒） */
const NO_KEY_COOLDOWN_TICKS = 200;

const VAULT_TYPE_IDS = ["minecraft:vault", "minecraft:ominous_vault"];
const KEY_ITEMS = new Set(["minecraft:trial_key", "minecraft:ominous_trial_key"]);
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
    const held = getHeldItem(bot);
    return !!held && KEY_ITEMS.has(held.typeId);
  },

  scanVault(botName: string): Vec3 | undefined {
    const bot = getBot(botName);
    if (!bot) return undefined;
    const origin = bot.location;
    try {
      // 2.8.0 API：getBlocks(volume, filter)——BlockVolume + BlockFilter（includeTypes）
      const volume = new BlockVolume(
        { x: origin.x - SCAN_RADIUS, y: origin.y - SCAN_RADIUS, z: origin.z - SCAN_RADIUS },
        { x: origin.x + SCAN_RADIUS, y: origin.y + SCAN_RADIUS, z: origin.z + SCAN_RADIUS },
      );
      const result = bot.dimension.getBlocks(volume, { includeTypes: VAULT_TYPE_IDS });
      // 最近优先
      let best: Vec3 | undefined;
      let bestDist = Infinity;
      for (const loc of result.getBlockLocationIterator()) {
        const dist = horizontalDistance(origin, loc);
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
    // 目标 = 宝库旁可站立点（宝库是实心方块，从假人一侧接近偏移 1.5 格）
    const stand = standSpotNear(target, bot.location);
    if (horizontalDistance(bot.location, stand) <= ARRIVE_DISTANCE) return true;
    try {
      bot.stopMoving();
      const result = bot.navigateToLocation(stand, 1);
      if (!result.isFullPath) return false; // 无路径 → 放弃换下一个
    } catch {
      return false;
    }
    // 轮询等待到达；协程内自检查（离线/死亡/钥匙丢失 → 提前失败）
    const startTick = system.currentTick;
    while (true) {
      await waitTicks(NAVIGATE_POLL_TICKS);
      if (!vaultPorts.isBotAvailable(botName) || !vaultPorts.hasKey(botName)) return false;
      const current = getBot(botName);
      if (!current) return false;
      if (horizontalDistance(current.location, stand) <= ARRIVE_DISTANCE) return true;
      if (system.currentTick - startTick > NAVIGATE_TIMEOUT_TICKS) return false;
    }
  },

  interactVault(botName: string, target: Vec3): VaultInteractResult {
    const bot = getBot(botName);
    if (!bot) return "error";
    // 交互前记录钥匙信息（成功后钥匙会被消耗）
    const keyInfo = getHeldKeyInfo(bot);
    if (!keyInfo) return "error";

    // 面朝宝库（chunkload 模式可能不支持，降级不影响交互）
    try {
      lookAt(bot, { x: target.x, y: target.y + 0.5, z: target.z });
    } catch {
      /* 忽略 */
    }

    // 直接按方位交互宝库的面（不依赖 getBlockFromViewDirection 的朝向生效时机）
    const face = faceToward(bot.location, target);
    let success = false;
    try {
      success = bot.interactWithBlock({ x: target.x, y: target.y, z: target.z }, face);
    } catch {
      return "error";
    }
    if (!success) return "error";

    // 回读验证防"假成功"：interact 返回 true 但钥匙不消耗 = 宝库已对该账号开过
    const afterInfo = getHeldKeyInfo(bot);
    const consumed = afterInfo !== null && afterInfo.count < keyInfo.count;
    if (!consumed) return "not-consumed";

    // 钥匙已消耗 → 用回读的实际数量更新并发布事件
    keyInfo.count = afterInfo!.count;
    keyInfo.totalInInventory = afterInfo!.totalInInventory;
    workflowVaultOpened.trigger({ botName, keyType: keyInfo.typeId, remaining: keyInfo.count });
    return "consumed";
  },

  tryReconnect(botName: string): void {
    const record = botRegistry.get(botName);
    if (!record) return;
    // 黑板目标保留 → 重连完成后树继续同一宝库
    safeReconnect(record, {
      onOnline: (fresh, r) => notifyNearestPlayer(fresh, r, getHeldKeyInfo(fresh)),
    });
  },

  idle(botName: string): void {
    const bot = getBot(botName);
    if (!bot) return;
    if (!vaultPorts.hasKey(botName)) {
      tryNotifyNoKey(bot);
    }
    // 有钥匙但无宝库/扫描冷却中：安静等待（不刷屏）
  },
};

// ─── 工具函数 ────────────────────────────────────────────

function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(resolve, ticks);
  });
}

/** 水平距离（导航/到达判定用，忽略高度差） */
function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** 宝库旁可站立点：从假人一侧水平偏移 1.5 格（宝库实心，不能站进去） */
function standSpotNear(vault: Vec3, from: Vec3): Vec3 {
  const dx = from.x - vault.x;
  const dz = from.z - vault.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: vault.x + (dx / len) * 1.5, y: vault.y, z: vault.z + (dz / len) * 1.5 };
}

/** 计算交互宝库的哪个面（假人所在方位 → 宝库对应面） */
function faceToward(from: Vec3, to: Vec3): Direction {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? Direction.West : Direction.East;
  }
  return dz > 0 ? Direction.North : Direction.South;
}

function getHeldItem(bot: SimulatedPlayer): ItemStack | undefined {
  try {
    const equip = bot.getComponent("minecraft:equippable") as
      | { getEquipment: (slot: string) => ItemStack | undefined }
      | undefined;
    return equip?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

interface KeyInfo {
  typeId: string;
  label: string;
  count: number;
  totalInInventory: number;
}

/** 主手钥匙信息（含背包同种钥匙总数；主手武器格 = 热键栏格，避免重复计数） */
function getHeldKeyInfo(bot: SimulatedPlayer): KeyInfo | null {
  try {
    const equip = bot.getComponent("minecraft:equippable") as
      | { getEquipment: (slot: string) => ItemStack | undefined }
      | undefined;
    if (!equip) return null;

    const held = equip.getEquipment(EquipmentSlot.Mainhand);
    if (!held) return null;

    let totalInInventory = 0;
    const inv = bot.getComponent("minecraft:inventory") as
      | { container: { getItem: (slot: number) => ItemStack | undefined; size: number } }
      | undefined;
    if (inv?.container) {
      for (let i = 0; i < inv.container.size; i++) {
        const item = inv.container.getItem(i);
        if (item?.typeId === held.typeId) {
          totalInInventory += item.amount;
        }
      }
    }

    return {
      typeId: held.typeId,
      label: KEY_LABELS[held.typeId] ?? held.typeId.replace("minecraft:", ""),
      count: held.amount,
      totalInInventory,
    };
  } catch {
    return null;
  }
}

// ─── 无钥匙通知节流 ──────────────────────────────────────
// 避免每 tick 疯狂刷消息，同一个 bot 10 秒内只提醒一次

const noKeyNotifiedAt = new Map<string, number>();

function tryNotifyNoKey(bot: SimulatedPlayer): void {
  const now = system.currentTick;
  const last = noKeyNotifiedAt.get(bot.name) ?? 0;
  if (now - last < NO_KEY_COOLDOWN_TICKS) return;
  noKeyNotifiedAt.set(bot.name, now);

  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;
    for (const p of players) {
      if (p.name === bot.name) continue;
      const dist = horizontalDistance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    nearest?.sendMessage(
      `${color.playerName}[宝库] ${color.success}${bot.name} ${color.muted}手上没有钥匙，请放入钥匙到主手`,
    );
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 通知最近玩家开箱结果（含剩余钥匙数） */
function notifyNearestPlayer(bot: SimulatedPlayer, record: { name: string }, keyInfo: KeyInfo | null): void {
  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;
    for (const p of players) {
      if (p.name === record.name) continue;
      const dist = horizontalDistance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    if (!nearest) return;

    if (keyInfo) {
      nearest.sendMessage(
        `${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手中还有 ${color.info}${keyInfo.totalInInventory} ${color.playerName}${keyInfo.label}${color.muted}（手持 ${color.info}${keyInfo.count}${color.muted}）`,
      );
    } else {
      nearest.sendMessage(`${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手上没有钥匙，请放入钥匙到主手`);
    }
  } catch {
    /* 通知失败不影响主流程 */
  }
}
