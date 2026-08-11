// ─── 挖掘防误触（纯逻辑，零 @minecraft 依赖，可 node 单测） ──
// 反"误拆"：空手/错误工具随手命中方块时，第一次"试探命中"不做工具切换，
// 给玩家一次取消机会（防把效率5镐秒切进建筑方块）；相同信号在窗口内
// 再出现一次，则确认是有意挖掘 → 允许切换。随后记录清除，下一次同信号
// 重新进入"首次拦截"循环。
//
// 防误触信号 = (玩家, 主手物品 typeId 或空串''，方块 typeId)；空手也算
// （主手无物品时以空串参与签名，同一玩家同一方块空手即相同信号）。
// 语义：
//   - 首次同信号 → 拦截切换，记录首次命中时刻
//   - 窗口内（默认 2.5 秒 = 50 tick）再出现相同信号 → 有意挖掘 → 放行并清记录
//   - 超过窗口（含过期清理后再来）→ 视为全新信号 → 再次拦截（防误触重置）
// 时间单位 tick 由调用方注入 system.currentTick，保证纯逻辑可测。

/** 防误触窗口（tick）：1 秒 = 20 tick，默认 2.5 秒 */
export const ANTI_TOUCH_WINDOW_TICKS = 50;

/** 信号键分隔符（typeId / 玩家 id 均不含该字符） */
const KEY_SEP = "|";

/**
 * 挖掘防误触守卫：决定本次"本会触发工具切换的命中"是否被拦截。
 * 无跨 tick 依赖、无外部 IO，仅维护 {信号 → 首次命中时刻} 的 Map，
 * 越界信号在每次判定时清理（Map 有界，不会无限增长）。
 */
export class AccidentalGuard {
  /** 信号键 → 首次命中时刻（tick） */
  private readonly signals = new Map<string, number>();

  /**
   * @param windowTicks 确认窗口（tick）。窗口内同信号二次命中→放行；缺省 2.5 秒。
   */
  constructor(private readonly windowTicks: number = ANTI_TOUCH_WINDOW_TICKS) {}

  /**
   * 判定是否拦截本次工具切换。
   * @param playerId   玩家标识（player.id）
   * @param itemTypeId 当前主手物品 typeId；空手传 undefined（参与信号签名，空手也算）
   * @param blockTypeId 被命中方块的 typeId
   * @param now        当前时刻（tick，注入便于纯逻辑单测）
   * @returns true = 拦截（防误触生效，不切换工具）；false = 放行（确认有意，允许切换）
   */
  shouldIntercept(playerId: string, itemTypeId: string | undefined, blockTypeId: string, now: number): boolean {
    this.prune(now);
    const key = playerId + KEY_SEP + (itemTypeId ?? "") + KEY_SEP + blockTypeId;
    const first = this.signals.get(key);
    if (first === undefined) {
      // 首次同信号 → 记录并拦截（防一次误触）
      this.signals.set(key, now);
      return true;
    }
    // 同信号在窗口内（prune 已移除过期项，故此处必在窗口内）再出现 → 有意挖掘 → 放行并清记录
    this.signals.delete(key);
    return false;
  }

  /** 清理超过窗口的信号（Map 有界：任何信号存活期不超过一个窗口） */
  private prune(now: number): void {
    for (const [key, ts] of this.signals) {
      if (now - ts > this.windowTicks) this.signals.delete(key);
    }
  }
}
