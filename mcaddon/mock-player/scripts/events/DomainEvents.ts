// ─── 领域事件（core 层） ────────────────────────────────
// 假人模块领域信号统一收口（宝库/认主/生命周期/行为/装备槽）：
//   宝库开箱     → 钥匙消耗 → 触发 vaultOpened（开箱成功，供通知/统计联动）
// ⚠️ 劫掠领域事件（raidStarted/raidVictory/raidPhase）已**内聚到劫掠任务**
//    （core/tasks/RaidTask.ts 的 RaidEvents 命名空间）——本文件不再持有。
// 订阅方通过信号解耦，不直接依赖任务内部实现。
// 事件负载只用可序列化的 string/number，不携带 mc 对象——保证 core 纯净。

import { EventSignal } from "./EventSignal";
import type { EquipSlotName } from "../rules/Types";

// ─── 宝库事件 ────────────────────────────────────────────

/** 宝库开箱成功事件：钥匙消耗并打开宝库 */
export interface VaultOpenedEvent {
  /** 假人名 */
  botName: string;
  /** 消耗的钥匙类型 ID */
  keyType: string;
  /** 剩余钥匙数量 */
  remaining: number;
}

/** 宝库开箱成功信号（⚠️ 预留：目前仅 VaultPorts 生产端触发，无订阅方，供通知/统计联动） */
export const vaultOpened = new EventSignal<VaultOpenedEvent>();

// ─── 三叉戟认主事件 ────────────────────────────────────
// 认主机制的所有动作（投掷标记/加载回退/上线夺回/UI 认主/下线回退）完成时触发，
// 供订阅方做通知/统计/联动（负载只用可序列化 string/number）。

/** 认主途径 */
export type TridentClaimVia = "spawn" | "load" | "rebind" | "ui" | "offline-fallback";

/** 三叉戟认主事件：某把三叉戟的 owner 被设置/重设 */
export interface TridentClaimedEvent {
  /** 三叉戟实体 ID */
  tridentId: string;
  /** 认主到谁（当前 owner） */
  claimedBy: string;
  /** 认主途径 */
  via: TridentClaimVia;
  /** 第一任主人（玩家或假人） */
  firstOwner?: string;
  /** 第二任主人（仅假人） */
  secondOwner?: string;
}

/** 三叉戟认主信号 */
export const tridentClaimed = new EventSignal<TridentClaimedEvent>();

/**
 * 三叉戟主人更替事件：第二任被覆盖复写时触发（1任→2任 或 2任→新2任）。
 * 第一任不可变，更替只发生在第二任。
 */
export interface TridentOwnerChangedEvent {
  /** 三叉戟实体 ID */
  tridentId: string;
  /** 第一任主人（不变） */
  firstOwner?: string;
  /** 更替前的第二任（undefined = 首次认领第二任） */
  previousSecondOwner?: string;
  /** 更替后的第二任 */
  newSecondOwner: string;
}

/** 三叉戟主人更替信号 */
export const tridentOwnerChanged = new EventSignal<TridentOwnerChangedEvent>();

// ─── 假人生命周期事件 ──────────────────────────────────
// 死亡/复活/上线/下线封装为领域事件：认主机制、劫掠续药等订阅驱动，
// 业务模块不再硬编码互相调用（负载只用可序列化 string/number）。

/** 假人上线事件：实体进入在线状态（加入世界 / 重生后实体重建） */
export interface BotOnlineEvent {
  botName: string;
}

/** 假人下线事件：主动下线 / 死亡下线 / 离开兜底 */
export interface BotOfflineEvent {
  botName: string;
}

/** 假人死亡事件：死亡标记落定时触发（自动重生仍触发，复活由 botRespawn 表达） */
export interface BotDeathEvent {
  botName: string;
  /** 死亡点坐标（可序列化） */
  position: { x: number; y: number; z: number };
  dimension: string;
}

/** 假人复活事件：死亡后重生（playerSpawn initialSpawn=false） */
export interface BotRespawnEvent {
  botName: string;
}

/** 假人上线信号 */
export const botOnline = new EventSignal<BotOnlineEvent>();

/** 假人下线信号 */
export const botOffline = new EventSignal<BotOfflineEvent>();

/** 假人死亡信号 */
export const botDeath = new EventSignal<BotDeathEvent>();

/** 假人复活信号 */
export const botRespawn = new EventSignal<BotRespawnEvent>();

// ─── 假人行为事件 ──────────────────────────────────────
// 假人成功执行动作时触发（主手切换/破坏方块/放置方块/使用物品/攻击实体），
// 供订阅方统计/通知/联动（负载只用可序列化 string/number）。

/** 主手切换事件：假人选中热栏槽位变化 */
export interface BotMainhandChangedEvent {
  botName: string;
  /** 新选中的热栏槽位（0-8） */
  slot: number;
  /** 新主手物品 ID（空手为 undefined） */
  itemId?: string;
}

/** 成功破坏方块事件 */
export interface BotBlockBrokenEvent {
  botName: string;
  blockTypeId: string;
  position: { x: number; y: number; z: number };
  dimension: string;
  /** 破坏后的物品（如有） */
  itemId?: string;
}

/** 成功放置方块事件 */
export interface BotBlockPlacedEvent {
  botName: string;
  blockTypeId: string;
  position: { x: number; y: number; z: number };
  dimension: string;
}

/** 成功使用物品事件（itemUse） */
export interface BotItemUsedEvent {
  botName: string;
  itemId: string;
}

/** 成功攻击实体事件（造成伤害） */
export interface BotEntityAttackedEvent {
  botName: string;
  /** 被攻击实体 typeId */
  targetTypeId: string;
  /** 造成的伤害 */
  damage: number;
}

// ─── 行为事件（预留） ──────────────────────────────────
// ⚠️ 以下 5 个信号目前只有生产端触发、无订阅方（git 历史中从未接入消费者）——
//    属于预留给未来联动/统计的功能性领域事件，非死代码，勿删。

/** 主手切换信号 */
export const botMainhandChanged = new EventSignal<BotMainhandChangedEvent>();

/** 破坏方块信号 */
export const botBlockBroken = new EventSignal<BotBlockBrokenEvent>();

/** 放置方块信号 */
export const botBlockPlaced = new EventSignal<BotBlockPlacedEvent>();

/** 使用物品信号 */
export const botItemUsed = new EventSignal<BotItemUsedEvent>();

/** 攻击实体信号 */
export const botEntityAttacked = new EventSignal<BotEntityAttackedEvent>();

// ─── 装备槽变化事件（槽位粒度） ────────────────────────
// MC 没有装备栏变化事件，自研领域事件：装备/副手写操作点与受伤时触发，
// 订阅方重读对应槽并持久化（快照对比，变化才写）。
// 槽位粒度：互换副手只触发 offhand；互换装备只触发 head/chest/legs/feet；
// 受伤触发全部 5 槽（不判断掉血——护甲吸收也算，装备耐久可能损耗）。

/** 装备槽变化触发来源 */
export type EquipChangeVia = "swap" | "equip" | "unequip" | "hurt" | "death";

/** 单个装备槽变化事件：该槽装备可能变化（互换/穿卸/受伤耐久），订阅方重读并保存 */
export interface BotEquipSlotChangedEvent {
  botName: string;
  /** 装备槽名（head/chest/legs/feet/offhand） */
  slot: EquipSlotName;
  /** 触发来源 */
  via: EquipChangeVia;
}

/** 装备槽变化信号 */
export const botEquipSlotChanged = new EventSignal<BotEquipSlotChangedEvent>();

// ─── 聚合导出 ──────────────────────────────────────────
// 领域事件统一走 BotEvents 命名空间（生命周期/认主/劫掠/行为全部信号）：
//   import { BotEvents } from ".../DomainEvents"（或 core barrel）
//   BotEvents.botOnline.subscribe(...)
// 个别信号如需直接引用仍可单独 import（信号与类型保持命名导出）。

/** 全部领域事件信号聚合 */
export const BotEvents = {
  // 宝库
  vaultOpened,
  // 认主
  tridentClaimed,
  tridentOwnerChanged,
  // 生命周期
  botOnline,
  botOffline,
  botDeath,
  botRespawn,
  // 行为
  botMainhandChanged,
  botBlockBroken,
  botBlockPlaced,
  botItemUsed,
  botEntityAttacked,
  // 装备槽变化
  botEquipSlotChanged,
};
