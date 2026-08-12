// ─── 宝库模式 ──────────────────────────────────────────
// 用于持续开 Trial Chambers 宝库的场景：
// MC 宝库一个玩家只能开一次，假人的 registry 是账号表，spawn 生成不同躯体。
// 流程：检测钥匙 → 交互方块 → 成功 → 保存状态 → 下线 → 上线 → 继续
//
// 只有手持 trial_key（普通钥匙）或 ominous_trial_key（不详钥匙）时才与方块交互。
// 宝库模式封装为工作流（vaultWorkflow）：行为引擎（behavior.ts）每 10 tick
// 驱动 runVaultCycle；工作流提供生命周期（start/stop 管理标签）与事件（vault-opened）。

import { world, system, EquipmentSlot, type Player, ItemStack } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../core/model/Types";
import { TAG_VAULT_MODE } from "../../core/tags/BotTags";
import { EventSignal } from "../../core/events/EventSignal";
import type { Workflow, WorkflowEvent } from "../../core/service/Workflow";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { safeReconnect } from "./pendingRespawn";
import { color } from "@yinxe/toolkit";

/** 宝库工作流事件总线（供其他模块订阅联动） */
const vaultWorkflowEvents = new EventSignal<WorkflowEvent>();

/** 宝库工作流：钥匙开宝库 → 保存 → 重连 → 继续（行为引擎驱动，runVaultCycle） */
export const vaultWorkflow: Workflow = {
  name: "vault-mode",
  description: "宝库模式：手持钥匙开 Trial Chambers 宝库，成功后下线重连循环",
  events: vaultWorkflowEvents,

  init(): void {
    // 宝库周期由行为引擎（behavior.ts 标签驱动）调用 runVaultCycle，无需全局订阅
  },

  start(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record || record.tags.includes(TAG_VAULT_MODE.value)) return;
    record.tags.push(TAG_VAULT_MODE.value);
    saveCoordinator.saveRecord(record);
  },

  stop(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    record.tags = record.tags.filter((t) => t !== TAG_VAULT_MODE.value);
    saveCoordinator.saveRecord(record);
  },

  isRunning(botName?: string): boolean {
    if (!botName) return false;
    const record = botRegistry.get(botName);
    return !!record && record.tags.includes(TAG_VAULT_MODE.value) && record.online && !record.death;
  },
};

/** 发布宝库工作流事件 */
function emitVaultEvent(type: string, botName: string, data?: unknown): void {
  vaultWorkflowEvents.trigger({ workflow: "vault-mode", type, botName, data });
}

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

  // ── 交互成功 → 回读验证钥匙是否真实消耗 ──────────────
  // ⚠️ 防"假成功"无限重连循环：宝库已对该账号开过时 interactWithBlock 可能
  //    返回 true（动画成功）但钥匙不消耗——若仍走 safeReconnect，假人每 10 tick
  //    断开→重连一次，永不停止。回读主手确认钥匙确实 -1 才进入重连周期。
  const afterInfo = getHeldKeyInfo(bot);
  const consumed = afterInfo !== null && afterInfo.count < keyInfo.count;
  if (!consumed) {
    console.warn(`[MockPlayer] 宝库 ${record.name} 交互未消耗钥匙（宝库可能已开过），停止本轮`);
    notifyNearestPlayer(bot, record, null);
    return;
  }

  // ── 钥匙已消耗 → 用回读的实际数量更新计数 ────────────
  keyInfo.count = afterInfo!.count;
  keyInfo.totalInInventory = afterInfo!.totalInInventory;

  // 发布宝库工作流事件（开箱成功，供统计/通知联动）
  emitVaultEvent("vault-opened", record.name, { keyType: keyInfo.typeId, remaining: keyInfo.count });

  // ── 4. 下线 + 重新上线 ─────────────────────────────
  // 使用 safeReconnect：自动等待旧实体完全释放后再 spawn，
  // 成功后通过 onOnline 通知最近玩家。
  // ⚠️ 不再在此调用 saveFullState：钥匙消耗/背包变化已由
  //    playerInventoryItemChange 事件实时单格保存（物品）；位置/经验/记录
  //    由 safeReconnect → offlineBot 的下线保存兜底。
  safeReconnect(record, {
    onOnline: (fresh, r) => notifyNearestPlayer(fresh, r, keyInfo),
  });
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
        `${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手中还有 ${color.info}${keyInfo.totalInInventory} ${color.playerName}${keyInfo.label}${color.muted}（手持 ${color.info}${keyInfo.count}${color.muted}）`,
      );
    } else {
      nearest.sendMessage(`${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手上没有钥匙，请放入钥匙到主手`);
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
