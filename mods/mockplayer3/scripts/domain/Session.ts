// ─── Session：会话数据结构（domain 纯部分） ──────────────────────
// 一次在线期间的"此刻"：实体句柄信息、租约表、能力上下文、保存代次。
// Session 只在 application 层创建/销毁；本文件提供纯数据形状与判定。
// 实体引用本身在 engine 层（EntityGateway 按 botId 解析，domain 不持句柄）。

import { LeaseTable } from "./Leases";
import type { LifecycleState } from "./State";
import type { WorkMode } from "./Record";

/** 脏字段枚举（增量保存标记） */
export type DirtyField = "home" | "experience" | "effects" | "switches" | "inventory" | "equipment";

/** 能力相位（等待的唯一表达 = 阶段 + 下一次唤起时刻） */
export interface CapabilityPhase {
  /** 阶段名（能力自定义，如 "SCAN"/"AIM"/"DIG"/"COOLDOWN"） */
  name: string;
  /** 下一次被调度器唤起的最小 tick（now < nextWakeAt 时不回调） */
  nextWakeAt: number;
}

/**
 * 能力上下文（能力自身无实例态——私有状态全挂这里，会话亡上下文亡）。
 * data 由能力自持形状；调度器与 Session 不解释其内容。
 */
export interface CapabilityContext {
  mode: WorkMode;
  phase: CapabilityPhase;
  data: Record<string, unknown>;
}

/** 待异步释放资源（如 disconnect 后的名字票据） */
export interface PendingRelease {
  kind: "nameTicket";
  /** 释放判定的截止时刻（超期后仲裁按实测世界实体为准） */
  readyAtTick: number;
}

/** 一次上线会话（建立→销毁） */
export class Session {
  /** 本次上线唯一 ID（实体事件对账凭此匹配） */
  readonly sessionId: string;
  readonly botId: number;
  /** 恢复代次：0=未完成恢复（SaveGate 拒一切物品/状态写）；≥1 提交后放行 */
  epoch = 0;
  /** 实体 id（解析/对账后写入；换实体重生时更新并重验 sessionId） */
  entityId: string | null = null;
  readonly leases = new LeaseTable();
  capability: CapabilityContext | null = null;
  readonly dirty = new Set<DirtyField>();
  readonly pendingReleases: PendingRelease[] = [];
  /** 当前态缓存（State 权威在 lifecycle，这里只做快速判定与诊断） */
  state: LifecycleState = "SPAWNING";
  /** 上线建立时刻（时钟 tick，跟随/节流类基准） */
  readonly startedAtTick: number;

  constructor(botId: number, sessionId: string, nowTick: number) {
    this.botId = botId;
    this.sessionId = sessionId;
    this.startedAtTick = nowTick;
  }

  /** 标记脏字段（仅 ACTIVE/WORKING 语义由管线把关，这里只记录） */
  mark(fields: DirtyField[]): void {
    for (const f of fields) this.dirty.add(f);
  }

  /** 取出并清空脏集（SaveGate 冲刷用） */
  takeDirty(): DirtyField[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }
}

/**
 * 池/扫描标归属键 → botId。归属键是会话键 `s<botId>#<序号>`（一次上线一个、永不复用），
 * 以免前世未归还的占用堵死下一世的认领闸门；botId 编在键的首段，供诊断和清理时反查。
 * @returns 键属于哪个假人（非本格式=undefined）
 */
export function ownerBotId(key: string): number | undefined {
  const m = /^s(\d+)#/.exec(key);
  if (!m) return undefined;
  const botId = Number(m[1]);
  return Number.isSafeInteger(botId) ? botId : undefined;
}
