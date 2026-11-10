// ─── 宝库规则（domain 纯逻辑） ──
// 感知驱动决策：一次感知返回完整快照（钥匙分类 + 附近宝库近→远预排序），决策为纯函数，
// 世界副作用在 engine/TrialVaultOps。
// 优先不详宝库；普通宝库只能使用普通钥匙（不详不可替代）。
// 宝库开箱必须面对钥匙孔正面：从侧面/背面点击不会真的开箱。
// 站立点朝向计算在此为纯函数，可离线单测。
// 流程状态（VaultFlowState）挂 Runtime 按假人键控：开箱成功触发的重连会销毁会话，
// 目标必须存活到重连上线（持续开同一宝库）。

import type { Vec3 } from "./Coords";
import { distance3d, horizontalDistance } from "./Coords";

// ─── 感知快照 ────────────────────────────────────────────

/** 普通钥匙 typeId（宝库交互候选，主手换持用） */
export const TRIAL_KEY = "minecraft:trial_key";
/** 不详钥匙 typeId */
export const OMINOUS_TRIAL_KEY = "minecraft:ominous_trial_key";

/** 背包钥匙库存（分类统计） */
export interface KeyInventory {
  /** 普通钥匙数量 */
  trial: number;
  /** 不详钥匙数量 */
  ominous: number;
}

/** 附近宝库（按水平距离近 → 远排序；同类型才有可比性） */
export interface NearbyVaults {
  normal: Vec3[];
  ominous: Vec3[];
}

/** 感知快照：一次 sense 的完整世界状态，决策唯一输入 */
export interface VaultKnowledge {
  keys: KeyInventory;
  vaults: NearbyVaults;
  /** 感知时刻假人坐标（排序基准） */
  position: Vec3;
  /** 感知时假人所在维度 id（封锁表键并入：异维同坐标是两个不同宝库） */
  dimensionId?: string;
}

/** 开不了宝库的缺因（idle 通知用；判定在此、文案在能力层） */
export type VaultIdleReason = "no-key" | "no-vault" | "no-ominous-key" | "no-trial-key";

/** 目标选择结果 */
export interface VaultTargetSelection {
  target: Vec3;
  kind: "normal" | "ominous";
  /** 选定钥匙 typeId（交互时换主手 slot 0） */
  key: string;
}

/**
 * 开箱交互结果：
 *   consumed      钥匙真消耗（总量基准回读）
 *   not-consumed  点击成功但钥匙未消耗（宝库冷却/动画或站位未对正面，上层按连败换站位/封锁）
 *   no-key        主手换持失败（背包没有选定钥匙，通知放入后继续尝试）
 *   failed        两种右键通道都失败（调整位置重试，保留目标）
 *   target-gone   宝库被拆/被替换（清目标重扫，不对空气/错误方块交互）
 */
export type VaultInteractResult = "consumed" | "not-consumed" | "no-key" | "failed" | "target-gone";

// ─── 决策纯函数 ────────

/**
 * 目标选择：不详宝库+不详钥匙优先；普通宝库只接受普通钥匙；同类内近→远取
 * 第一个未被导航封锁的宝库（最近者不可达则改选次近的可达者）。
 * @param knowledge - 感知快照（列表已近→远排序）
 * @param blocked - 导航失败封锁表（键=vaultBlockKey 含维度；值仅作存在标记）；
 *   全部被封锁时返回 undefined，由上层清空封锁表自行解开
 * @returns 目标选择；无满足条件的目标返回 undefined
 */
export function selectVaultTarget(
  knowledge: VaultKnowledge,
  blocked: Record<string, string> = {}
): VaultTargetSelection | undefined {
  const open = (list: Vec3[]): Vec3[] =>
    list.filter((v) => blocked[vaultBlockKey(v, knowledge.dimensionId)] === undefined);
  const ominousVault = open(knowledge.vaults.ominous)[0];
  if (ominousVault && knowledge.keys.ominous > 0) {
    return { target: ominousVault, kind: "ominous", key: OMINOUS_TRIAL_KEY };
  }
  const normalVault = open(knowledge.vaults.normal)[0];
  if (normalVault && knowledge.keys.trial > 0) {
    return { target: normalVault, kind: "normal", key: TRIAL_KEY };
  }
  return undefined;
}

/**
 * 缺因诊断（idle 通知用）：两种宝库都有且有不详钥匙时必然选得出目标，不会走到 idle。
 * @param knowledge - 感知快照
 * @returns 缺因；选得出目标时 undefined
 */
export function diagnoseVaultIdle(knowledge: VaultKnowledge): VaultIdleReason | undefined {
  if (knowledge.keys.trial === 0 && knowledge.keys.ominous === 0) return "no-key";
  if (knowledge.vaults.normal.length === 0 && knowledge.vaults.ominous.length === 0) return "no-vault";
  if (knowledge.vaults.normal.length === 0 && knowledge.vaults.ominous.length > 0 && knowledge.keys.ominous === 0) {
    return "no-ominous-key";
  }
  if (knowledge.vaults.normal.length > 0 && knowledge.keys.trial === 0) {
    return "no-trial-key";
  }
  return undefined;
}

// ─── 站立点候选（纯数学） ──────────

/**
 * 宝库格子稳定键（dimensionId + x,y,z 取整；封锁表与流程状态都以它为键，重连后键不变，
 * 异维同坐标不共用一个键）。省略 dimensionId 时仅坐标键（站立点去重等单一维度语境）。
 */
export function vaultBlockKey(vault: Vec3, dimensionId?: string): string {
  const coords = `${Math.floor(vault.x)},${Math.floor(vault.y)},${Math.floor(vault.z)}`;
  return dimensionId === undefined ? coords : `${dimensionId}|${coords}`;
}

/**
 * 站立点择优：过滤可站立格并按离参考点近→远排序（正面优先序在前），
 * 全不可达返回空表。
 * @param candidates - 站立点候选（整数格，含重复位）
 * @param standable - 该格可站立判定（engine 注入读世界侧）
 * @param from - 参考点（假人当前坐标）
 */
export function orderStandCandidates(candidates: Vec3[], standable: (pos: Vec3) => boolean, from: Vec3): Vec3[] {
  const seen = new Set<string>();
  const usable: Vec3[] = [];
  for (const c of candidates) {
    const k = vaultBlockKey(c);
    if (seen.has(k) || !standable(c)) continue;
    seen.add(k);
    usable.push(c);
  }
  usable.sort((a, b) => horizontalDistance(from, a) - horizontalDistance(from, b));
  return usable;
}

/**
 * 正面站立点候选（朝向反方向 1~2 格：宝库朝北 → 站南侧 z+1，面对钥匙孔）。
 * @param vault - 宝库整数格坐标
 * @param facing - minecraft:cardinal_direction state 值
 */
export function frontStandCandidates(vault: Vec3, facing: string): Vec3[] {
  const dx = facing === "east" ? -1 : facing === "west" ? 1 : 0;
  const dz = facing === "north" ? 1 : facing === "south" ? -1 : 0;
  return [
    { x: vault.x + dx, y: vault.y, z: vault.z + dz },
    { x: vault.x + dx * 2, y: vault.y, z: vault.z + dz * 2 },
  ];
}

/** 任意方向兜底候选（宝库旁 1~2 格四向；1 格圈整体排在 2 格圈之前） */
export function fallbackStandCandidates(vault: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const dist of [1, 2]) {
    out.push(
      { x: vault.x + dist, y: vault.y, z: vault.z },
      { x: vault.x - dist, y: vault.y, z: vault.z },
      { x: vault.x, y: vault.y, z: vault.z + dist },
      { x: vault.x, y: vault.y, z: vault.z - dist }
    );
  }
  return out;
}

// ─── 近距可视免寻路判定 ──

/** 可视直交判定距离（格，三维直线距；"视线命中"验证在 engine 射线侧） */
export const VAULT_SIGHT_DISTANCE = 3;

/**
 * 假人是否已处在看得清目标宝库的近距内（三维距离 < VAULT_SIGHT_DISTANCE）。
 * 用 3D 而非水平距：垂直落差计入才不被水平近距骗过；完整跳寻路判定还需视线射线命中目标格。
 */
export function withinVaultSightDistance(from: Vec3, target: Vec3): boolean {
  return distance3d(from, target) < VAULT_SIGHT_DISTANCE;
}

// ─── 流程状态（Runtime 按假人键控，跨重连存活） ─────────

/** 宝库任务状态（重连销毁会话后仍保留目标） */
export interface VaultFlowState {
  /** 当前目标宝库坐标（undefined=无目标待感知） */
  target: Vec3 | undefined;
  /** 目标类型（normal|ominous） */
  targetKind: "normal" | "ominous" | undefined;
  /** 选定钥匙 typeId */
  targetKey: string | undefined;
  /** 最近一次感知快照（诊断缓存；当前流程无读者） */
  knowledge: VaultKnowledge | undefined;
  /** 上次交互尝试时刻（20t 交互冷却基准） */
  lastInteractAt: number;
  /** 节流通知解除时刻（200t 窗，全消息共窗） */
  notifyAt: number;
  /**
   * 点击成功但钥匙未消耗（not-consumed）的连击次数：达上限重新寻路换站位，
   * 再连败则封锁换库；开箱成功或重选目标时清零
   */
  missStreak: number;
  /** 开箱成功触发系统重连的时刻（0=不在重连等待；新会话 start 清零） */
  reconnectAt: number;
  /** 重连已发起标记：发起置真，仅重连落地（新会话 start）或等待超时后清除；置位期间不再二次发起 */
  reconnectIssued: boolean;
  /**
   * 导航失败封锁表（vaultBlockKey→存在标记，值本身不被读取）：不可达就换目标，不对同一点死磕；
   * 全封锁时能力层清空整表重新轮询
   */
  blocked: Record<string, string>;
}

/** 新建流程状态（首次进入宝库模式时惰性建） */
export function createVaultFlowState(): VaultFlowState {
  return {
    target: undefined,
    targetKind: undefined,
    targetKey: undefined,
    knowledge: undefined,
    lastInteractAt: 0,
    notifyAt: 0,
    missStreak: 0,
    reconnectAt: 0,
    reconnectIssued: false,
    blocked: {},
  };
}
