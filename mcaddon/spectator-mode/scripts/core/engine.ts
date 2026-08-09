// ── 灵魂出窍状态机（纯逻辑，可 node 单测） ──

/** 灵魂阶段：范围内 / 容忍倒计时 */
export type SoulPhase = "in-range" | "tolerant";

export interface SoulTickResult {
  /** 当前阶段 */
  phase: SoulPhase;
  /** 是否位于最大距离内（容忍阶段视为超限） */
  inRange: boolean;
  /** 距离 / 最大距离 比例（钳到 [0,1]，超限=1） */
  ratio: number;
  /** 容忍阶段剩余毫秒（范围内恒 0） */
  remainingMs: number;
  /** 本 tick 是否触发强制回归（容忍倒计时耗尽） */
  forceReturn: boolean;
}

/**
 * 灵魂出窍状态机：
 * - 范围内（distance <= maxDistance）→ in-range，正常 HUD。
 * - 首次超限 → 进入容忍倒计时（tolerant）。
 *     - 倒计时期间回到范围内 → 取消容忍，恢复正常。
 *     - 倒计时耗尽 → forceReturn=true，复位回 in-range。
 * - distance 传 Infinity 表示跨维度，按超限处理。
 *
 * 无 @minecraft 依赖，纯 tick 推进，便于单测。
 */
export class SoulEngine {
  private phase: SoulPhase = "in-range";
  private remainingMs = 0;

  /** @param toleranceMs - 超出最大距离后的容忍倒计时时长（毫秒） */
  constructor(private readonly toleranceMs: number) {}

  /** 当前阶段 */
  getPhase(): SoulPhase {
    return this.phase;
  }

  /**
   * 推进状态机。
   *
   * @param distance   - 当前与灵魂锚点（真身）的距离（米）；Infinity 表示跨维度
   * @param maxDistance - 当前最大移动距离（米，由配置实时提供）
   * @param dtMs       - 本 tick 经过的时长（毫秒），用于倒计时扣减
   * @returns 本 tick 的结果
   */
  update(distance: number, maxDistance: number, dtMs: number): SoulTickResult {
    const exceeded = !Number.isFinite(distance) || distance > maxDistance;
    let forceReturn = false;

    if (this.phase === "tolerant") {
      if (!exceeded) {
        // 回到范围内 → 取消容忍，恢复正常
        this.phase = "in-range";
        this.remainingMs = 0;
      } else {
        this.remainingMs -= dtMs;
        if (this.remainingMs <= 0) {
          // 容忍耗尽 → 强制回归，状态复位（等下一次进入时重新倒计时）
          forceReturn = true;
          this.phase = "in-range";
          this.remainingMs = 0;
        }
      }
    } else if (exceeded) {
      // 首次超限 → 进入容忍倒计时
      this.phase = "tolerant";
      this.remainingMs = this.toleranceMs;
    }

    const denom = Math.max(0.001, maxDistance);
    const ratio = exceeded ? 1 : Math.min(1, distance / denom);
    return {
      phase: this.phase,
      inRange: !exceeded,
      ratio,
      remainingMs: Math.max(0, this.remainingMs),
      forceReturn,
    };
  }
}
