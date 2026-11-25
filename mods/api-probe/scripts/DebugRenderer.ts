// ─── 调试线框绘制:debugDrawer 的薄封装 ───────────────────────────
//
// `@minecraft/debug-utilities` 的 debugDrawer 是全局单例,`addShape` 之后形状由
// 引擎在客户端渲染 —— 不需要粒子、不需要资源包、不需要连接调试器。
//
// 三个已知引擎缺陷直接决定了这里的所有防御性写法(1.21.100 上实测):
//   · 同一个 shape 实例重复 addShape → 崩溃。因此「先 remove 再 add」而不是「直接 add」;
//   · 形状列表为空时调 removeAll() → 崩溃。因此没有登记在册的形状就不调;
//   · 绘制代码被注释掉后热重载 → 崩溃。因此所有登记集中在 activeShapes,
//     并且每个形状都设了 timeLeft,即使脚本被热重载掉也会自行到期。
//
// 注意这些是**原生层崩溃,不是 JS 异常**:try/catch 抓不到,游戏直接退出。
// 所以这里的防护只能是「不去触发」,不能靠兜底。
//
// 这些形状只存在于客户端渲染层:不写方块、不写动态属性、不进存档,
// 世界重载或脚本热重载后一律消失。

import { debugDrawer, type DebugShape } from "@minecraft/debug-utilities";
import type { BoxShape } from "./BoxGeometry";
import { buildDebugShapes, DEFAULT_DURATION_SECONDS, type BuildOptions } from "./DebugShapeBuilder";

/** 绘制结果:成功带回形状数量,失败带回原因 */
export type DrawResult = { ok: true; shapeCount: number } | { ok: false; reason: string };

/** 登记项:形状句柄 + 自行到期的时刻(毫秒时间戳) */
interface TrackedShape {
  shape: DebugShape;
  /** 到这个时刻之后引擎已自动移除该形状,句柄不可再碰 */
  expiresAt: number;
}

/** 当前仍然在世界上、由本模组绘制的形状 */
const activeShapes: TrackedShape[] = [];

/** 每个玩家最近一次绘制的形状(重复执行命令时先清掉旧的) */
const playerShapes = new Map<string, TrackedShape[]>();

/** 把秒数换成到期时间戳 */
function expiryOf(durationSeconds: number): number {
  return Date.now() + durationSeconds * 1000;
}

/**
 * 移除一组已登记的形状。
 *
 * 两条规则:**过期的不碰,未过期的逐个 remove**。
 *
 * - 过期的不碰:形状带 `timeLeft`,到期后引擎已自行移除,此时再调 `remove()`
 *   就是在操作已失效的原生句柄 —— 这是原生崩溃风险,`try/catch` 拦不住。
 *   因此按登记时算好的 `expiresAt` 直接丢弃句柄,只从账上划掉。
 * - 逐个 remove 而非 removeAll:后者会连带清掉其它插件画的形状,
 *   且在列表为空时会崩溃。
 */
export function removeShapes(tracked: readonly TrackedShape[]): void {
  const now = Date.now();
  for (const entry of tracked) {
    if (now < entry.expiresAt) {
      try {
        entry.shape.remove();
      } catch {
        // 即便抛出也只是 JS 异常,说明引擎已经不管这个形状了 —— 忽略即可
      }
    }
    const index = activeShapes.indexOf(entry);
    if (index >= 0) {
      activeShapes.splice(index, 1);
    }
  }
}

/** 清掉某玩家此前绘制的形状 */
export function clearPlayerShapes(playerId: string): void {
  const shapes = playerShapes.get(playerId);
  if (!shapes) return;
  removeShapes(shapes);
  playerShapes.delete(playerId);
}

/** 清掉本模组绘制的全部形状 */
export function clearAllShapes(): void {
  removeShapes([...activeShapes]);
  playerShapes.clear();
}

/**
 * 把一组已构造好的形状逐个加入世界,并登记到本模组的账上。
 *
 * 单个形状失败不影响其余(形状清单里的各项互不依赖),
 * 失败原因收集到 `failed` 里交给调用方展示。
 */
export function addShapes(
  playerId: string,
  shapes: readonly { shape: DebugShape; name: string }[],
  durationSeconds: number
): { drawn: string[]; failed: string[] } {
  const expiresAt = expiryOf(durationSeconds);
  const drawn: TrackedShape[] = [];
  const drawnNames: string[] = [];
  const failed: string[] = [];

  for (const { shape, name } of shapes) {
    try {
      debugDrawer.addShape(shape);
      const entry: TrackedShape = { shape, expiresAt };
      drawn.push(entry);
      drawnNames.push(name);
      activeShapes.push(entry);
    } catch (error) {
      failed.push(`${name}(${errorText(error)})`);
    }
  }

  if (drawn.length > 0) {
    // 与已有形状合并而不是覆盖:show 命令自己会先 clearPlayerShapes
    const previous = playerShapes.get(playerId) ?? [];
    playerShapes.set(playerId, [...previous, ...drawn]);
  }

  return { drawn: drawnNames, failed };
}

/**
 * 在世界上画一个框选盒子(盒体 + 三色轴 + 尺寸文字)。
 *
 * 已在安全上下文调用。失败转成可读原因,不抛异常。
 */
export function drawDebugBox(playerId: string, shape: BoxShape, options: BuildOptions = {}): DrawResult {
  // 先清旧的:既避免叠出多个盒子,也避开「同一实例重复 addShape」的崩溃
  clearPlayerShapes(playerId);

  let shapes: DebugShape[];
  try {
    shapes = buildDebugShapes(shape, options);
  } catch (error) {
    return { ok: false, reason: `构造调试形状失败:${errorText(error)}` };
  }

  const expiresAt = expiryOf(options.durationSeconds ?? DEFAULT_DURATION_SECONDS);
  const added: TrackedShape[] = [];
  try {
    for (const candidate of shapes) {
      debugDrawer.addShape(candidate);
      const entry: TrackedShape = { shape: candidate, expiresAt };
      added.push(entry);
      activeShapes.push(entry);
    }
  } catch (error) {
    // 部分成功时把已加进去的收回,不留半个盒子
    removeShapes(added);
    return { ok: false, reason: `绘制线框失败:${errorText(error)}` };
  }

  playerShapes.set(playerId, added);
  return { ok: true, shapeCount: added.length };
}

/** 把任意抛出物转成一句可读文本 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
