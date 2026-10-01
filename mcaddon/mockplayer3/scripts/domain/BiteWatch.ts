// ─── 咬钩检测纯逻辑（domain） ────
// 滚动最高点参照：drop = maxY − y，> 阈值即咬钩；正常浮动（±0.1 内）不触发，慢速渐进下沉也能捕获。
// 状态由调用方（能力 ctx）持有。

/** 咬钩下沉阈值（格） */
export const BITE_DROP_THRESHOLD = 0.25;
/** 咬钩检测采样间隔（tick）——下沉窗口仅约 10t，采样必须密 */
export const BITE_CHECK_TICKS = 2;
/** 鱼钩入水稳定期（tick）：先沉后浮，稳定前坐标不可信（下沉会被误判咬钩） */
export const STABILIZE_TICKS = 25;
/** 无鱼超时（tick，45s） */
export const BITE_TIMEOUT_TICKS = 900;
/** 收竿后战利品入包引擎延迟等待（tick）：立即 diff 会漏 */
export const LOOT_SETTLE_TICKS = 3;

/** 咬钩跟踪状态（挂在 capability ctx / 流程局部，纯数据） */
export interface BiteState {
  /** 滚动最高点 y（上浮刷新） */
  maxY: number | undefined;
}

/** 初始状态 */
export function initBiteState(): BiteState {
  return { maxY: undefined };
}

/**
 * 喂一次采样，返回是否咬钩。
 * @param y - 鱼钩当前 y
 */
export function updateBiteTracker(state: BiteState, y: number): boolean {
  if (state.maxY === undefined || y > state.maxY) {
    state.maxY = y;
    return false;
  }
  return state.maxY - y > BITE_DROP_THRESHOLD;
}
