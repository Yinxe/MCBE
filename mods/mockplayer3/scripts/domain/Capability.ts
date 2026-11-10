// ─── 能力契约（domain 纯类型） ────────────────────────────
// 能力自身无实例态：私有状态全挂 session.capability。
// tick 必须同步、短、无 await（F-18）；等待唯一表达 = nextWakeAt。

import type { LeaseKind, LeaseMode } from "./Leases";
import type { Session } from "./Session";

/** 能力启动前的租约需求声明（调度器据此预检） */
export interface LeaseRequest {
  kind: LeaseKind;
  mode?: LeaseMode;
}

/** 工作模式能力（每种 WorkMode 一个实现类，注册进 application/Modes 目录） */
export interface Capability {
  readonly id: import("./Record").WorkMode;
  /** 声明需要的租约资源（Modes 拉起前据此预检） */
  requires(session: Session): LeaseRequest[];
  /** 拉起：初始化 session.capability；前置不满足返回中文原因拒绝启动 */
  start(session: Session, now: number): string | undefined;
  /** 时钟驱动（仅 now ≥ capability.phase.nextWakeAt 时被调；同步短小，F-18） */
  tick(session: Session, now: number): void;
  /** 卸载：释放租约、恢复现场（幂等） */
  stop(session: Session, now: number): void;
}
