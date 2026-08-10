// ── 距离比例 → § 颜色码（绿 → 红，纯函数） ──

interface ColorStop {
  /** 比例阈值 0..1（达到该比例启用该颜色） */
  threshold: number;
  /** § 颜色码 */
  code: string;
}

/** 由绿到红的色阶：绿 → 黄 → 金 → 红（距离越大越红） */
const RANGE_STOPS: readonly ColorStop[] = [
  { threshold: 0.0, code: "§a" },
  { threshold: 0.4, code: "§e" },
  { threshold: 0.7, code: "§6" },
  { threshold: 0.9, code: "§c" },
];

/** 超出最大距离（容忍区）的颜色：深红 */
export const OVER_DISTANCE_COLOR = "§4";

/**
 * 距离 / 最大距离的比例 → 颜色码。
 * ratio 会先钳制到 [0, 1]。
 *
 * @param ratio - 当前距离占最大距离的比例
 * @returns § 颜色码
 */
export function rangeColor(ratio: number): string {
  const r = Math.min(1, Math.max(0, ratio));
  let code = RANGE_STOPS[0]!.code;
  for (const stop of RANGE_STOPS) {
    if (r >= stop.threshold) code = stop.code;
  }
  return code;
}
