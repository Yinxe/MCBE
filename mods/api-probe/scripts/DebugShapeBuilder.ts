// ─── 盒子 → debug-utilities 形状集合 ─────────────────────────────
//
// 把 BoxGeometry 算出的盒子翻译成 `@minecraft/debug-utilities` 的线框形状:
//   1 个 DebugBox(盒体本身)
//   3 条 DebugLine(最小角的三色坐标轴)
//   1 个 DebugText(尺寸文字,始终朝向屏幕)
//
// 这里只构造对象、不调用 debugDrawer,因此失败点集中在「参数取值」,
// 与「往世界里塞形状」分开,便于单独核对每个字段。
//
// `DebugBox.bound` 到底是全尺寸还是半尺寸,官方只写了「bound 乘以 scale 得到最终盒子」,
// 没说 bound 本身的口径。因此 bound 一律填真实边长,把口径问题交给调用方的
// `sizeScale`:实测框大一倍就传 0.5,小一半就传 2 —— 与粒子版 `/apitest:box` 的
// `尺寸系数` 完全同一套约定,现场一次就能标定。

import { DebugBox, DebugLine, DebugText, type DebugShape } from "@minecraft/debug-utilities";
import { toNativeColor, type ColorComponents } from "./DebugColor";
import type { BoxShape } from "./BoxGeometry";
import { axisSegments, clampNumber, describeSize, labelPosition, type AxisName } from "./DebugShapeMath";

/** 默认存活秒数 */
export const DEFAULT_DURATION_SECONDS = 10;

/** 存活秒数上限 */
export const MAX_DURATION_SECONDS = 120;

/** 尺寸系数下限/上限 */
export const MIN_SIZE_SCALE = 0.05;
export const MAX_SIZE_SCALE = 4;

/** 盒体线框颜色:近白,在大多数背景上都读得出来 */
export const BOX_COLOR = { red: 1, green: 1, blue: 1 };

/** 三色坐标轴:X 红、Y 绿、Z 蓝 */
export const AXIS_COLORS: Readonly<Record<AxisName, ColorComponents>> = {
  x: { red: 1, green: 0.2, blue: 0.2 },
  y: { red: 0.2, green: 1, blue: 0.2 },
  z: { red: 0.2, green: 0.4, blue: 1 },
};

/** 构造参数 */
export interface BuildOptions {
  /** 存活秒数,默认 10 */
  durationSeconds?: number;
  /** 尺寸系数,默认 1;用于现场标定 `bound` 的口径 */
  sizeScale?: number;
  /** 盒体颜色,默认近白 */
  color?: ColorComponents;
  /** 是否画最小角的三色坐标轴,默认 true */
  withAxes?: boolean;
  /** 是否画尺寸文字,默认 true */
  withLabel?: boolean;
}

/**
 * 生成盒子对应的全部调试形状。
 *
 * 返回的每个形状都已设好 `color` 与 `timeLeft`(引擎侧的自动到期),
 * 调用方只需逐个 `debugDrawer.addShape()`。
 *
 * `timeLeft` 必须设:否则脚本被热重载或崩溃后形状会永久留在客户端。
 */
export function buildDebugShapes(shape: BoxShape, options: BuildOptions = {}): DebugShape[] {
  const duration = clampNumber(options.durationSeconds ?? DEFAULT_DURATION_SECONDS, 1, MAX_DURATION_SECONDS);
  const sizeScale = clampNumber(options.sizeScale ?? 1, MIN_SIZE_SCALE, MAX_SIZE_SCALE);
  const boxColor = options.color ?? BOX_COLOR;
  const shapes: DebugShape[] = [];

  const box = new DebugBox(shape.center);
  box.bound = { ...shape.size };
  box.scale = sizeScale;
  box.color = toNativeColor({ ...boxColor });
  box.timeLeft = duration;
  shapes.push(box);

  if (options.withAxes ?? true) {
    for (const segment of axisSegments(shape)) {
      const line = new DebugLine(segment.start, segment.end);
      line.color = toNativeColor({ ...AXIS_COLORS[segment.axis] });
      line.timeLeft = duration;
      shapes.push(line);
    }
  }

  if (options.withLabel ?? true) {
    const label = new DebugText(labelPosition(shape), describeSize(shape));
    label.color = toNativeColor({ ...boxColor });
    label.timeLeft = duration;
    shapes.push(label);
  }

  return shapes;
}
