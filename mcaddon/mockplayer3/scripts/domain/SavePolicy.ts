// ─── 保存策略纯逻辑（domain） ────────────────────────────────────
// SaveGate 的决策内核：代次守卫、冻结窗口、关键点直写、debounce 冲刷判定。
// engine 层 SaveGate 只执行这里给出的许可，守卫无法被调用方绕过。

import type { DirtyField } from "./Session";
import { isFrozen } from "./State";
import type { LifecycleState } from "./State";

/** 写许可判定结果 */
export interface WriteVerdict {
  allow: boolean;
  /** 拒写原因计数用（epoch=代次挡、frozen=冻结窗口挡） */
  blockedBy?: "epoch" | "frozen" | "noSession";
}

/** 物品相关脏字段（epoch<1 时最敏感：空背包覆盖=永久丢数据，F-26） */
const ITEM_FIELDS: ReadonlySet<DirtyField> = new Set(["inventory", "equipment"]);

/**
 * 增量标记/冲刷许可：
 * - 无会话（离线记录）：结构直写允许（saveRecord 通道），mark/flush 无意义 → 拒；
 * - SPAWNING/RESTORING（epoch<1）：一切物品字段写拒；
 * - DYING：冻结窗口只放行死亡快照通道（checkpoint death 由调用方带 kind）。
 * @param state - 会话当前态（无会话传 "OFFLINE"/"REGISTERED"）
 * @param epoch - 恢复代次
 * @param fields - 拟写脏集
 */
export function permitIncremental(state: LifecycleState, epoch: number, fields: DirtyField[]): WriteVerdict {
  if (!hasLiveSession(state)) return { allow: false, blockedBy: "noSession" };
  if (epoch < 1) return { allow: false, blockedBy: "epoch" };
  if (isFrozen(state)) return { allow: false, blockedBy: "frozen" };
  return { allow: true };
}

/**
 * 关键点全量写许可（offline/delete 快照）：要求 epoch≥1；
 * 死亡快照特例——"此刻有什么存什么"（F-27），epoch<1 也允许（空就存空，
 * 语义是实体当下持有物，不做全量覆盖）；未恢复完成的 offline 拒（防覆盖）。
 */
export function permitCheckpoint(
  state: LifecycleState,
  epoch: number,
  kind: "offline" | "death" | "delete"
): WriteVerdict {
  if (kind === "death") return { allow: true };
  if (epoch < 1) return { allow: false, blockedBy: "epoch" };
  return { allow: true };
}

/**
 * 记录结构直写许可（改配置/换模式/移主——非实体镜像字段，任何态可写；
 * 但"记录声称在线却无会话"时仅允许归一离线写入，由 engine 侧结合意图判定）。
 */
export function permitStructural(): WriteVerdict {
  return { allow: true };
}

/** 物品仓读取许可（判定内核；engine 只供给两条事实） */
export type VaultVerdict = { allow: true } | { allow: false; blockedBy: "chunk-unloaded" };

/**
 * 仓此刻可读吗——读不到 ≠ 没有：阵列区块未加载时逐格读全 undefined，
 * 若按空仓继续，假人空背包上线后下线会把空态反向覆盖回仓。
 * @param hasStoredSlots - 绑定表里有已绑槽位（新假人零槽→本来就没什么可读）
 * @param regionLoaded - 阵列区块已加载（engine 探针事实）
 */
export function permitVaultRead(hasStoredSlots: boolean, regionLoaded: boolean): VaultVerdict {
  if (hasStoredSlots && !regionLoaded) return { allow: false, blockedBy: "chunk-unloaded" };
  return { allow: true };
}

/**
 * 仓此刻可信吗（回收/取物前置）：有未落仓的滞留导出时仓态落后于实体最后全量态，
 * 按仓交付/写回会同物双发，一律改期。
 * @param hasPendingExport - 该假人有内存滞留的全量导出
 * @param hasStoredSlots - 见 permitVaultRead
 * @param regionLoaded - 见 permitVaultRead
 */
export function permitVaultTrust(
  hasPendingExport: boolean,
  hasStoredSlots: boolean,
  regionLoaded: boolean
): VaultVerdict {
  if (hasPendingExport) return { allow: false, blockedBy: "chunk-unloaded" };
  return permitVaultRead(hasStoredSlots, regionLoaded);
}

/** 是否有活跃会话（与 Session 存在性一致） */
function hasLiveSession(state: LifecycleState): boolean {
  return (
    state === "SPAWNING" || state === "RESTORING" || state === "ACTIVE" || state === "WORKING" || state === "DYING"
  );
}

/** 脏集是否含物品字段（拒写告警分级用） */
export function touchesItems(fields: DirtyField[]): boolean {
  return fields.some((f) => ITEM_FIELDS.has(f));
}

/** 增量冲刷 debounce（tick）= 200（10s） */
export const FLUSH_DEBOUNCE_TICKS = 200;

/**
 * debounce 冲刷判定：距上次冲刷 ≥ FLUSH_DEBOUNCE_TICKS 且有脏 → 冲。
 * @param now - 当前时钟 tick
 * @param lastFlushAt - 上次冲刷 tick（-∞ 初始）
 * @param dirtyCount - 脏字段数
 */
export function shouldFlush(now: number, lastFlushAt: number, dirtyCount: number): boolean {
  return dirtyCount > 0 && now - lastFlushAt >= FLUSH_DEBOUNCE_TICKS;
}
