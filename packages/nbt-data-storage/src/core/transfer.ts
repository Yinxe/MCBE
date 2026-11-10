// ── 容器级安全传输（纯逻辑，零 @minecraft 依赖） ───────────────────────
// 把存储区域当作一个"超大容量容器"，提供与原版容器一致的**原子 transfer**：
//   transferIn  ：源容器槽 → 区域（存入）
//   transferOut ：区域槽 → 目标容器槽（取出）
// 语义：要么整体成功，要么保持原状（物品不丢、不重复进区域）。
// 物品在本模块中是不透明引用（unknown），具体读写由 mc 适配层通过 TransferPort 对接。
// 这样传输编排逻辑可脱离游戏，用 mock 端口直接 node 单测。

/** 传输失败原因（ok=false 时给出） */
export type TransferReason = "empty" | "full" | "io";

/** 传输结果：ok=true 时 slotId 为本次操作后的区域槽位 */
export interface TransferResult {
  ok: boolean;
  slotId?: number;
  reason?: TransferReason;
  /**
   * 兜底：回滚/重存也失败时**无法归位的物品**（原区域槽已清空、目标未写入）。
   * 调用方必须处置（如归还玩家/掉落地面），避免静默丢失——"物品绝不丢失"的最后防线。
   */
  dropped?: unknown;
}

/** 传输端口：把"物品"当作不透明引用搬移，由 mc 适配层用真实容器/木桶实现 */
export interface TransferPort {
  /** 读取源槽位物品（undefined = 空） */
  readSource(): unknown | undefined;
  /** 存入区域（成功返回 slotId；满/失败返回 null） */
  store(item: unknown): number | null;
  /** 从区域按 slotId 取走（undefined = 槽空） */
  take(slotId: number): unknown | undefined;
  /** 写入目标槽位（true = 成功） */
  writeDest(item: unknown): boolean;
  /** 清空源槽位（true = 成功） */
  clearSource(): boolean;
}

/**
 * 存入：源容器槽 → 区域。
 * - 源槽空 → fail "empty"（无副作用）
 * - 区域满 → fail "full"（源槽保持原样）
 * - 源槽清空失败 → 回滚（取回区域已存物品、尽力还原源槽），fail "io"；物品绝不丢失
 * - 回滚双重失败 → dropped 携带物品（调用方兜底处置）
 */
export function transferIn(port: TransferPort): TransferResult {
  const item = port.readSource();
  if (item === undefined) return { ok: false, reason: "empty" };
  const slotId = port.store(item);
  if (slotId === null) return { ok: false, reason: "full" };
  if (!port.clearSource()) {
    // 回滚：取回区域槽，尽力还原源槽；还原失败则重新存入区域防丢失
    const taken = port.take(slotId);
    if (taken !== undefined) {
      if (port.writeDest(taken)) return { ok: false, reason: "io" };
      if (port.store(taken) !== null) return { ok: false, reason: "io" }; // 源槽写不回 → 留在区域
      return { ok: false, reason: "io", dropped: taken }; // 重存也失败 → 交还调用方兜底
    }
    return { ok: false, reason: "io" };
  }
  return { ok: true, slotId };
}

/**
 * 取出：区域 slotId → 目标容器槽。
 * - 槽空 → fail "empty"
 * - 目标写失败 → 物品重新存回区域（新 slotId），fail；物品绝不丢失
 * - 重存也失败 → dropped 携带物品（调用方兜底处置）
 */
export function transferOut(port: TransferPort, slotId: number): TransferResult {
  const item = port.take(slotId);
  if (item === undefined) return { ok: false, reason: "empty" };
  if (port.writeDest(item)) return { ok: true };
  const restored = port.store(item);
  if (restored !== null) return { ok: false, slotId: restored, reason: "io" };
  return { ok: false, reason: "full", dropped: item }; // 重存失败：交还调用方兜底
}
