// ─── 宝库模式 ──────────────────────────────────────────
// 用于持续开 Trial Chambers 宝库的场景：
// MC 宝库一个玩家只能开一次，假人的 registry 是账号表，spawn 生成不同躯体。
// 流程：检测钥匙 → 交互方块 → 成功 → 保存状态 → 下线 → 上线 → 继续
//
// 只有手持 trial_key（普通钥匙）或 ominous_trial_key（不详钥匙）时才与方块交互。

import { world, system, EquipmentSlot, type Player, ItemStack } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { offlineBot } from "./offlineBot";
import { onlineBot } from "./onlineBot";
import { botRegistry } from "./core/persistence";
import { saveBotFullState } from "./saveState";

// ─── 可用的宝库钥匙 ──────────────────────────────────

const KEY_ITEMS = new Set(["minecraft:trial_key", "minecraft:ominous_trial_key"]);

const KEY_LABELS: Record<string, string> = {
  "minecraft:trial_key": "普通钥匙",
  "minecraft:ominous_trial_key": "不详钥匙",
};

// ─── 无钥匙通知节流 ──────────────────────────────────
// 避免每 10 tick 疯狂刷消息，同一个 bot 10 秒内只提醒一次
const noKeyNotifiedAt = new Map<string, number>();
const NO_KEY_COOLDOWN = 200; // 200 tick ≈ 10 秒

function tryNotifyNoKey(bot: SimulatedPlayer, record: BotRecord): void {
  const now = system.currentTick;
  const last = noKeyNotifiedAt.get(record.name) ?? 0;
  if (now - last < NO_KEY_COOLDOWN) return;
  noKeyNotifiedAt.set(record.name, now);
  notifyNearestPlayer(bot, record, null);
}

/**
 * 执行一次宝库交互周期。
 * 由 behavior.ts 的宝库模式 interval 每 10 tick 调用。
 *
 * 流程：
 *   1. 检查主手是否为钥匙 → 否，跳过
 *   2. 获取面前的方块 → 尝试 interactWithBlock
 *   3. 失败 → 下次重试
 *   4. 成功 → 保存全量状态 → offlineBot → onlineBot → 通知
 *
 * @param bot    - 当前假人实体
 * @param record - 假人记录
 */
export function runVaultCycle(bot: SimulatedPlayer, record: BotRecord): void {
  // ── 1. 检查是否手持钥匙 ────────────────────────────
  const heldItem = getHeldItem(bot);
  if (!heldItem || !KEY_ITEMS.has(heldItem.typeId)) {
    tryNotifyNoKey(bot, record);
    return;
  }

  // ── 2. 交互前先记录钥匙信息（交互成功后钥匙会被消耗） ──
  const keyInfo = getHeldKeyInfo(bot);
  if (!keyInfo) return; // 理论上不会走到这里，因为第1步已经检查过

  // ── 3. 获取面前的方块 → 交互 ───────────────────────
  const hit = bot.getBlockFromViewDirection({ maxDistance: 4 });
  if (!hit) return;

  let success = false;
  try {
    success = bot.interactWithBlock(hit.block.location, hit.face);
  } catch {
    return; // 交互异常（方块不存在、范围外等），下次重试
  }

  if (!success) return;

  // ── 交互成功 → 消耗了一把钥匙，调整计数 ────────────
  keyInfo.totalInInventory = Math.max(0, keyInfo.totalInInventory - 1);
  keyInfo.count = Math.max(0, keyInfo.count - 1);

  // ── 4. 保存状态 + 下线 + 重新上线 ───────────────────
  saveBotFullState(bot, record);
  offlineBot(record);

  system.runTimeout(() => {
    try {
      const fresh = onlineBot(record);
      notifyNearestPlayer(fresh, record, keyInfo);
    } catch (e: any) {
      console.warn(`[MockPlayer] 宝库模式上线失败 ${record.name}: ${e?.message ?? e}`);
      record.online = false;
      record.entityId = undefined;
      botRegistry.set(record.name, record);
    }
  }, 5);
}

// ─── 主手物品 ───────────────────────────────────────

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

// ─── 钥匙信息 ────────────────────────────────────────

interface KeyInfo {
  typeId: string;
  label: string;
  count: number;
  totalInInventory: number;
}

function getHeldKeyInfo(bot: SimulatedPlayer): KeyInfo | null {
  try {
    const equip = bot.getComponent("minecraft:equippable") as
      | { getEquipment: (slot: string) => ItemStack | undefined }
      | undefined;
    if (!equip) return null;

    const held = equip.getEquipment(EquipmentSlot.Mainhand);
    if (!held) return null;

    // 统计背包中同种钥匙总数
    // ⚠️ getEquipment 的主手武器格 = inventory container 的热键栏格，是同一个物品
    //    所以不能 held.amount + 容器遍历（会重复计数）
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

// ─── 通知最近的玩家 ─────────────────────────────────

function notifyNearestPlayer(bot: SimulatedPlayer, record: BotRecord, keyInfo: KeyInfo | null): void {
  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;

    for (const p of players) {
      if (p.name === record.name) continue;
      const dist = distance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }

    if (!nearest) return;

    if (keyInfo) {
      nearest.sendMessage(
        `§e[宝库] §a${record.name} §7手中还有 §f${keyInfo.totalInInventory} §e${keyInfo.label}§7（手持 §f${keyInfo.count}§7）`,
      );
    } else {
      nearest.sendMessage(`§e[宝库] §a${record.name} §7手上没有钥匙，请放入钥匙到主手`);
    }
  } catch {
    // 通知失败不影响主流程
  }
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
