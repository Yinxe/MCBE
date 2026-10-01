// ─── 常加载抽象接口（统一创建/销毁配套） ─────
// 约束：指令创建的只能指令销毁，Manager 创建的只能 Manager 销毁
// 目的：消除 sim4.ts 中“命令创建却双域兜底销毁”的隐式耦合，改为显式配套

import type { Dimension, Vector3 } from "@minecraft/server";

export type TickingCreateResult = { ok: true } | { ok: false; reason: string };
export type TickingRemoveResult = { ok: true } | { ok: false; reason: string };

export interface TickingAreaProvider {
  /** 提供方标识，用于配对追踪 */
  readonly kind: "command:circle" | "manager:single";
  /**  human-readable 名称，用于日志 */
  readonly label: string;
  /** 创建（配套销毁必须用同一提供方，radius 仅 command:circle 有效） */
  create(center: Vector3, dimension: Dimension, name: string, radius?: number): Promise<TickingCreateResult>;
  /** 销毁（必须与 create 配套） */
  remove(name: string, dimension?: Dimension): Promise<TickingRemoveResult>;
  /** 是否存在（用于幂等/同步） */
  has(name: string): boolean;
  /** 同步内存镜像 ← 世界（worldLoad 时） */
  sync?(): void;
  /** 预估块数（用于日志/容量提示） */
  estimate?(): number;
}
