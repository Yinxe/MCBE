// ─── 生命周期状态机（domain 纯逻辑） ───────────────────────
// 唯一权威"假人现在处于什么阶段"；僵尸态（death=true&&online=true）在本表下不可表示。
// 非法迁移按幂等 no-op 处理（不抛错）；每种状态的操作许可由表驱动。

/** 生命周期状态（DELETED 为终态，仅短暂存在——记录随即移除） */
export type LifecycleState =
  "REGISTERED" | "SPAWNING" | "RESTORING" | "ACTIVE" | "WORKING" | "DYING" | "OFFLINE" | "DELETED";

/** 生命周期意图（管线的对外入口枚举） */
export type LifecycleIntent =
  | "online"
  | "offline"
  | "death"
  | "respawn"
  | "spawned"
  | "restored"
  | "startWork"
  | "stopWork"
  | "delete"
  | "abortSpawn";

/** 迁移结果：目标状态 + 是否幂等无操作 */
export interface TransitResult {
  next: LifecycleState;
  /** true=意图对当前态无意义（如 OFFLINE 再 offline），调用方按幂等成功处理 */
  noop: boolean;
}

// ─── 迁移表 ──

/**
 * 迁移表：state → intent → next。缺项即非法（幂等 no-op 保持原态）。
 * DYING 双分支：respawn 回 RESTORING（换实体恢复）；offline 转离线死亡。
 * ACTIVE⇄WORKING 由 startWork/stopWork 驱动，不改变其余语义。
 */
const TRANSITIONS: Readonly<Record<LifecycleState, Partial<Record<LifecycleIntent, LifecycleState>>>> = {
  REGISTERED: { online: "SPAWNING", delete: "DELETED" },
  SPAWNING: { spawned: "RESTORING", abortSpawn: "OFFLINE", death: "DYING" },
  RESTORING: { restored: "ACTIVE", abortSpawn: "OFFLINE", death: "DYING" },
  ACTIVE: { startWork: "WORKING", offline: "OFFLINE", death: "DYING", delete: "DELETED" },
  WORKING: { stopWork: "ACTIVE", offline: "OFFLINE", death: "DYING", delete: "DELETED" },
  DYING: { respawn: "RESTORING", offline: "OFFLINE", delete: "DELETED" },
  OFFLINE: { online: "SPAWNING", delete: "DELETED" },
  DELETED: {},
};

/**
 * 状态迁移判定（纯函数）。
 * @param from - 当前态
 * @param intent - 意图
 * @returns 目标态与 noop 标记；noop=true 时 from 原样保持
 */
export function transit(from: LifecycleState, intent: LifecycleIntent): TransitResult {
  const next = TRANSITIONS[from][intent];
  return next ? { next, noop: false } : { next: from, noop: true };
}

/** 是否存在会话（Session 存在的充要条件） */
export function hasSession(state: LifecycleState): boolean {
  return (
    state === "SPAWNING" || state === "RESTORING" || state === "ACTIVE" || state === "WORKING" || state === "DYING"
  );
}

/** 是否实体应存在于世界（SPAWNING 起实体可能已出现） */
export function mayHaveEntity(state: LifecycleState): boolean {
  return (
    state === "SPAWNING" || state === "RESTORING" || state === "ACTIVE" || state === "WORKING" || state === "DYING"
  );
}

/** 冻结窗口：DYING 快照完成前与 RESTORING 恢复期，SaveGate 挡常规写 */
export function isFrozen(state: LifecycleState): boolean {
  return state === "DYING" || state === "RESTORING";
}

/** 能力可运行态（调度器只驱动 WORKING 会话） */
export function canTickCapability(state: LifecycleState): boolean {
  return state === "WORKING";
}

/** 是否接受再入 online（幂等判断：SPAWNING/RESTORING 期间返回"上线中"） */
export function isOnlineInFlight(state: LifecycleState): boolean {
  return state === "SPAWNING" || state === "RESTORING";
}

/** 记录持久化映射：状态 → 旧语义布尔（仅迁移器/展示用；运行逻辑禁止还原成布尔组合） */
export function stateFlags(state: LifecycleState): { online: boolean; death: boolean } {
  switch (state) {
    case "REGISTERED":
    case "OFFLINE":
      return { online: false, death: false };
    case "DYING":
      return { online: true, death: true };
    case "DELETED":
      return { online: false, death: false };
    default:
      return { online: true, death: false };
  }
}

// ─── 启动对账（对账而非信任） ───────────────────────────

/** 对账输入（只取判定所需标志，纯函数不碰记录本体） */
export interface StartupClaim {
  botId: number;
  declaredOnline: boolean;
  deathMark: boolean;
}

/** 对账输出：归一后的持久化声明（重启点不再有在线语义，一律落离线） */
export interface StartupVerdict {
  botId: number;
  /** 回写记录的在线声明（重启恒 false） */
  declaredOnline: boolean;
  /** 回写记录的死亡标注（原样保留） */
  deathMark: boolean;
}

/**
 * worldLoad 全量对账：引擎假人不跨重启存活，落盘的"在线声明"在重启点必为残留，
 * 一律归一为离线（宁离线不假在线）；死亡标注是事实记录，原样保留。不再有自动上线候选。
 * @param claims - 全部记录的对账输入
 */
export function reconcileStartup(claims: StartupClaim[]): StartupVerdict[] {
  return claims.map(({ botId, deathMark }) => ({ botId, declaredOnline: false, deathMark }));
}
