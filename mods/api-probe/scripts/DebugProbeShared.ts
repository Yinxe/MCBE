// ─── 探针共享设施:报告、读数、排布、容错 ────────────────────────
//
// 本模组的每条探针命令都遵循同一套输出约定,这样结果才能横向比对:
//   · 每一行报告同时进聊天栏与内容日志(console.log),便于现场看与事后翻;
//   · 报告只写「键 = 值」,不写叙述性文字,便于逐项核对;
//   · 属性写入一律做「写 → 读回」,并如实标出是否真的写进去了;
//   · 任何可能抛错的操作都经 `attempt` 包一层,把异常转成一行文本,
//     不让一条探针因为某个属性不可读就整体失败。
//
// 一个必须贯穿始终的区分:**属性写入成功 ≠ 渲染生效**。
// JS 侧的 setter 存下值不代表渲染器读了它。读数只能证明第一层,
// 第二层要靠 `DebugMotionProbe` 那种「改完盯着看」的探针。

import type { Player, Vector3 } from "@minecraft/server";
import type { DebugShape } from "@minecraft/debug-utilities";

/** 数字格式化:整数原样,小数保留三位 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/** 把任意值格式化成一行可读文本 */
export function formatValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === undefined) return "§8undefined";
  if (value === null) return "§8null";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, number>;
    if (typeof record.x === "number") {
      return `(${formatNumber(record.x)}, ${formatNumber(record.y)}, ${formatNumber(record.z)})`;
    }
    if (typeof record.red === "number") {
      // 运行时结构可能是 RGB(三分量)也可能是 RGBA(四分量),
      // 两者如实分别输出 —— 带不带 alpha 本身就是判定版本差异的证据
      const alpha = (record as { alpha?: number }).alpha;
      const base = `rgb(${formatNumber(record.red)}, ${formatNumber(record.green)}, ${formatNumber(record.blue)})`;
      return typeof alpha === "number"
        ? `rgba(${formatNumber(record.red)}, ${formatNumber(record.green)}, ${formatNumber(record.blue)}, ${formatNumber(alpha)})`
        : base;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** 一行「键 = 值」 */
export function kv(label: string, value: unknown): string {
  return `§7${label}§8=§f${formatValue(value)}`;
}

/** 一行小标题 */
export function heading(text: string): string {
  return `§b── ${text} ──`;
}

/** 一行结论 */
export function verdict(text: string): string {
  return `§a⇒ ${text}`;
}

/** 一行警告 */
export function warning(text: string): string {
  return `§c⚠ ${text}`;
}

/**
 * 输出一段报告:同时进聊天栏与控制台。
 *
 * 控制台那一份带玩家名与统一前缀,便于在内容日志里与其它插件区分。
 */
export function report(player: Player, lines: readonly string[]): void {
  for (const line of lines) {
    player.sendMessage(line);
  }
  console.log(`[api-probe][report] ${player.name}\n${lines.join("\n")}`);
}

/** 一次操作的结果:成功带回返回值,失败带回错误文本 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** 执行一次可能抛错的操作,把结果转成可读形式而不是让它冒泡 */
export function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** 把任意抛出物转成一句可读文本 */
export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** 把一次 attempt 的结果写成一行 */
export function attemptLine(label: string, result: Attempt<unknown>): string {
  return result.ok ? `${kv(label, result.value)} §a✓` : `${kv(label, "抛错")} §c${result.error}`;
}

/**
 * 读出形状当前可观测的全部状态。
 *
 * 每一项独立读取:某个属性不可读时只把那一项标成抛错,其余照常。
 * `hasDuration` / `totalTimeLeft` 是只读属性,单独列出来是为了对照
 * 「写了 timeLeft 之后引擎是否认为它有存活期」。
 */
export function readShapeState(shape: DebugShape): Record<string, Attempt<unknown>> {
  return {
    location: attempt(() => shape.location),
    rotation: attempt(() => shape.rotation),
    scale: attempt(() => shape.scale),
    color: attempt(() => shape.color),
    hasDuration: attempt(() => shape.hasDuration),
    timeLeft: attempt(() => shape.timeLeft),
    totalTimeLeft: attempt(() => shape.totalTimeLeft),
  };
}

/** 把形状状态摊成报告行 */
export function stateLines(shape: DebugShape, indent = "  "): string[] {
  const state = readShapeState(shape);
  return Object.entries(state).map(([label, result]) => `${indent}${attemptLine(label, result)}`);
}

/**
 * 在玩家面前排出一行等间距坐标,整排以视线正前方为中心。
 *
 * 用于并排摆放多个形状做视觉对比:只有并排且等间距,才能一眼看出
 * 「哪个更大、哪个偏了」。`forward` 是离眼睛的水平距离,`rise` 是抬高量。
 */
export function rowPositions(player: Player, count: number, spacing: number, forward = 4, rise = 1): Vector3[] {
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  // 视线可能有俯仰,取水平分量归一化,避免整排被抬高或压到地面以下
  const horizontal = Math.hypot(view.x, view.z) || 1;
  const forwardX = view.x / horizontal;
  const forwardZ = view.z / horizontal;
  // 右手方向 = 视线水平方向顺时针转 90°
  const rightX = -forwardZ;
  const rightZ = forwardX;

  const base: Vector3 = {
    x: head.x + forwardX * forward,
    y: head.y + rise,
    z: head.z + forwardZ * forward,
  };
  const offset = ((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, index) => {
    const lateral = index * spacing - offset;
    return { x: base.x + rightX * lateral, y: base.y, z: base.z + rightZ * lateral };
  });
}
