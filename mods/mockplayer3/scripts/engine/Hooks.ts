// ─── 原子副作用外发缝（报脏/领域事件的唯一出口） ────────────────────
// engine 不 import application：原子成功后的报脏与领域事件经本缝外发，
// Composition 装配期注册实现，未注册时静默。
// F-10：装备槽变化无原生事件，由本缝补偿外发；回调同步且必须短（F-18），异常隔离。

import type { EquipSlotName } from "../domain/Record";

/** 投掷物认主事件负载（三叉戟双任模型；假人记 botId，真人归属为 undefined） */
export interface ClaimInfo {
  entityId: string;
  typeId: string;
  /** 认主为现任的假人（真人认领 undefined——名字即第一任） */
  botId: number | undefined;
  claimedBy: string;
  firstOwner?: string;
  /** 覆盖复写前的第二任（UI 认主 victim 汇报用） */
  previousSecond?: string;
  via: "spawn" | "load" | "rebind" | "offline-fallback" | "ui";
}

export interface AtomicHooks {
  /** 假人背包内容已变（主手/装备/容器搬运成功后调用——落盘脏标记源） */
  onInventoryChanged(botId: number): void;
  /** 装备槽写入成功回读后（领域事件 botEquipSlotChanged，见 F-10） */
  onEquipChanged(botId: number, slot: EquipSlotName): void;
  /** 投掷物认主/绑定变化（tracker 与 UI 认主统一出口） */
  onProjectileClaimed(info: ClaimInfo): void;
  /** 工具保护触发（换械/收损完成——应用层落盘+播报） */
  onToolGuardFired(botId: number, message: string): void;
  /** 定点挖掘遇需工具的方块但背包无合适工具（已徒手继续——应用层报警给主人） */
  onMiningNoTool(botId: number, toolLabel: string): void;
}

const NOOP: AtomicHooks = {
  onInventoryChanged: () => {},
  onEquipChanged: () => {},
  onProjectileClaimed: () => {},
  onToolGuardFired: () => {},
  onMiningNoTool: () => {},
};

let current: AtomicHooks = NOOP;

/** 装配期注册（Composition 唯一调用点；部分覆盖以已注册者为底） */
export function setAtomicHooks(next: Partial<AtomicHooks>): void {
  current = { ...current, ...next };
}

/** 恢复静默（测试/卸载用） */
export function clearAtomicHooks(): void {
  current = NOOP;
}

function safe(fn: (h: AtomicHooks) => void, label: string): void {
  try {
    fn(current);
  } catch (e: any) {
    console.error(`[mockplayer3] 原子钩子异常 ${label}: ${e?.message ?? e}`);
  }
}

export function inventoryChanged(botId: number): void {
  safe((h) => h.onInventoryChanged(botId), "inventoryChanged");
}

export function equipChanged(botId: number, slot: EquipSlotName): void {
  safe((h) => h.onEquipChanged(botId, slot), "equipChanged");
}

export function projectileClaimed(info: ClaimInfo): void {
  safe((h) => h.onProjectileClaimed(info), "projectileClaimed");
}

export function toolGuardFired(botId: number, message: string): void {
  safe((h) => h.onToolGuardFired(botId, message), "toolGuardFired");
}

export function miningNoToolFired(botId: number, toolLabel: string): void {
  safe((h) => h.onMiningNoTool(botId, toolLabel), "miningNoToolFired");
}
