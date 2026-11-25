// ─── 命令坐标参数的类型 ───────────────────────────────────────────
//
// `CustomCommandParamType.Location` 的文档说它提供 `@minecraft/server.Location`,
// 但翻遍 `@minecraft/server` 2.1.0 ~ 2.11.0 的 `index.d.ts`,**没有 `Location` 这个
// 导出类** —— 只有 `LocationInUnloadedChunkError` / `DimensionLocation` 等。
// 也就是说这个参数类型在类型定义里是「有枚举、无配套类型」的半成品状态。
//
// 运行时的真实行为(与仓库内 `item-route` 模组一致):回调收到的是
// 一个 `{ x, y, z }` 形状的对象。
//   · 三个分量都是 number;
//   · **不带维度信息** —— 维度必须另外从执行者身上取;
//   · **不保证是整数** —— 玩家可以写 `100.7 64.2 -20.9`,取整要自己做。
//
// 因此这里显式声明成 `Vector3` 形状,而不是假装有个 `Location` 类可以 import。
// 取整统一交给各命令自己的几何层(如 `BoxGeometry.boxFromCorners` 内部用
// `Math.floor`),避免「有的命令 floor、有的命令 round」这种不一致。

import type { Vector3 } from "@minecraft/server";

/**
 * 命令 `Location` 参数在回调里实际收到的值。
 *
 * 语义上等价于 `Vector3`,单独起名是为了在代码里一眼看出「这是命令参数来的坐标,
 * 不是从实体/方块读出来的坐标」,便于排查取整与维度问题。
 */
export type CommandLocation = Vector3;

/**
 * 把命令收到的坐标取整到方块坐标。
 *
 * 用 `Math.floor` 而不是 `Math.round`:方块 (5, 5, 5) 占据 `[5, 6)` 的区间,
 * 因此 5.9 仍属于方块 5。负坐标下 `floor` 也是正确的(-0.1 → -1),
 * 而 `Math.trunc` 会错误地给出 0。
 */
export function toBlockCoordinate(location: CommandLocation): Vector3 {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}
