// ─── 能力共享件 ────────────────────────────────────────────────────
// 1. CapabilityHost：能力回"空闲"的唯一出口（通知主人 + change none，不伪装等待）。
// 2. 能力私有状态一律挂 session.capability.data 的自身命名空间键，能力是全局单例。

/** 能力自动停机出口（前提缺失 → 通知 + 归空闲；实现在装配层，避免能力↔Modes 环） */
export interface CapabilityHost {
  /**
   * @param botId - 假人身份
   * @param reason - 中文原因（通知文案 + 诊断）
   */
  autoStop(botId: number, reason: string): void;
  /** 解除跟随关系（record.followTarget 写穿保存；只停能力不清关系会在下次上线时重新挂上而复活） */
  releaseFollow(botId: number): void;
}

/** data 命名空间取还能力上下文（首取即挂；类型由能力自己声明） */
export function ctxOf<T extends object>(data: Record<string, unknown>, ns: string, seed: () => T): T {
  let ctx = data[ns] as T | undefined;
  if (ctx === undefined) {
    ctx = seed();
    data[ns] = ctx;
  }
  return ctx;
}
