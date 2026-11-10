// ─── 跟随规则（domain 纯逻辑） ──────────────────
// 距离带判定：10t 重发节拍、≤3 停走（每拍 stopMoving）、>128 断关系、目标解析不到断关系。
// 无滞回死区：每拍只看当下距离，不看上一拍的结论。

/** 重发节拍（tick） */
export const FOLLOW_TICK = 10;
/** 停走线：距离 ≤ 此值每拍 stopMoving（无滞回死区） */
export const FOLLOW_STOP_DIST = 3;
/** 超距断关系线：距离 > 此值解除跟随 */
export const FOLLOW_MAX_DIST = 128;

/** 距离带判定结果：stop=停走 / walk=寻路行走 / release=超距断关系 */
export type FollowVerdict = "stop" | "walk" | "release";

/**
 * 距离带判定：无滞回记忆，只按当次距离出结论。
 * @param dist - 假人与目标 3D 距离
 */
export function classifyFollowGap(dist: number): FollowVerdict {
  if (dist > FOLLOW_MAX_DIST) return "release";
  if (dist <= FOLLOW_STOP_DIST) return "stop";
  return "walk";
}
