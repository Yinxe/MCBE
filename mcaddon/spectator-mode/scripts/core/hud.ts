// ── 灵魂出窍 HUD 文案（actionBar，纯函数可单测） ──
// 设计：
// - 范围内：`灵魂出窍 · [███░░░░] 12.5m / 30m`
//   进度条按距离比例填充，已用段由绿→红渐变，空段为深灰实心块占位（不用空格）。
// - 容忍区：`灵魂出窍 · 超出！ [████████] 35.0m / 30m 4s 后强制回归`
//   实心深红警示条 + 红色倒计时。
import { OVER_DISTANCE_COLOR, rangeColor } from "./colors";

export interface SoulHudState {
  /** 是否在最大距离内（容忍阶段视为超限） */
  inRange: boolean;
  /** 当前与真身的距离（米）；跨维度时为 Infinity */
  dist: number;
  /** 最大移动距离（米） */
  maxDistance: number;
  /** 容忍阶段剩余毫秒 */
  remainingMs: number;
}

/** 进度条格数 */
const BAR_CELLS = 8;

/** 钳制到 [0,1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 构建距离进度条：已用段按段序着色（绿→红），空段深灰实心块占位 */
function buildRangeBar(ratio: number): string {
  const filled = Math.round(clamp01(ratio) * BAR_CELLS);
  let s = "";
  for (let i = 0; i < BAR_CELLS; i++) {
    s += i < filled ? rangeColor((i + 1) / BAR_CELLS) + "█" : "§8█";
  }
  return s + "§r";
}

/** 构建超出警示条：满格深红实心 */
function buildOverBar(): string {
  return OVER_DISTANCE_COLOR + "█".repeat(BAR_CELLS) + "§r";
}

/**
 * 组装 actionBar 文本（含 § 颜色码）。
 * @param state - HUD 状态
 * @returns 渲染文本
 */
export function buildSoulHud(state: SoulHudState): string {
  const distText = Number.isFinite(state.dist) ? state.dist.toFixed(1) : "∞";
  const maxText = state.maxDistance.toFixed(0);

  if (state.inRange) {
    const ratio = state.dist / Math.max(0.001, state.maxDistance);
    const code = rangeColor(ratio);
    return `§l灵魂出窍§r §7·§r ${buildRangeBar(ratio)} ${code}${distText}m§r §7/ ${maxText}m`;
  }

  const seconds = Math.max(0, Math.ceil(state.remainingMs / 1000));
  return `§l灵魂出窍§r §4超出！§r ${buildOverBar()} ${OVER_DISTANCE_COLOR}${distText}m§r §7/ ${maxText}m §c${seconds}s 后强制回归§r`;
}
