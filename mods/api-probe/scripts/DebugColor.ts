// ─── 颜色:跨版本构造原生颜色对象 ─────────────────────────────────
//
// 这里解决一个真实踩到的坑,也是本模组最典型的价值:
//
//   · 安装的**类型定义**(`@minecraft/debug-utilities@1.0.0-beta.1.21.100-stable`)
//     说 `DebugShape.color` 是 `RGB` —— 只有 red / green / blue;
//   · 但**运行时**报错:
//       native setter cannot be assigned null or undefined interface property
//       ['alpha'] expected number (failed parsing interface to function return value)
//     说明引擎侧的结构体要 `alpha`。
//
// 原因在 manifest 的版本写法:`"version": "1.0.0-beta"` 会被解析成
// **引擎当前携带的 beta 版本**,而不是我们钉的类型定义版本。类型定义停在
// 1.21.100,引擎却可能更新到 1.26.x —— 那一版起 `color` 就是 `RGBA` 了。
//
// 所以结论是:**不能只按类型定义构造颜色对象**。`RGBA extends RGB`,
// 因此「总是带上 alpha」是两版都接受的超集写法;老引擎多收一个未知字段
// 会被忽略,新引擎则正是它要的。
//
// 这个文件保持纯函数(不 import `@minecraft/*`),以便 `node --test` 直接跑。

/** 颜色分量。`alpha` 可省,构造原生对象时会补齐 */
export interface ColorComponents {
  red: number;
  green: number;
  blue: number;
  /** 不透明度,0 全透明、1 全不透明。省略时按 1 处理 */
  alpha?: number;
}

/** 默认不透明度:全不透明。线框本来就该看得见 */
export const ALPHA_OPAQUE = 1;

/**
 * 补齐 `alpha`,得到一个四分量颜色对象。
 *
 * 总是返回新对象(浅拷贝),避免调用方后续改动污染常量。
 * 传入的 `alpha` 原样保留;只做「缺失则补 1」,不做夹取 ——
 * 夹取行为本身是该引擎的实现细节,应由探针实测而不是这里替它决定。
 */
export function toNativeColor(color: ColorComponents, fallbackAlpha: number = ALPHA_OPAQUE): Required<ColorComponents> {
  return {
    red: color.red,
    green: color.green,
    blue: color.blue,
    alpha: color.alpha ?? fallbackAlpha,
  };
}

/**
 * 从读回的颜色对象里取出 alpha。
 *
 * 老引擎读回的是三分量对象,`alpha` 为 `undefined`;新引擎会给出数值。
 * 这个差异正好用来判定运行时到底是哪一版,所以如实返回而不是补默认值。
 */
export function alphaOf(color: unknown): number | undefined {
  if (typeof color !== "object" || color === null) return undefined;
  const alpha = (color as { alpha?: unknown }).alpha;
  return typeof alpha === "number" ? alpha : undefined;
}

/** 颜色是否带 alpha 分量(即运行时是否为新版 RGBA 结构) */
export function hasAlpha(color: unknown): boolean {
  return alphaOf(color) !== undefined;
}

/** 把颜色格式化成一行文本,带 alpha 时一并写出 */
export function describeColor(color: ColorComponents): string {
  const alpha = color.alpha;
  const base = `rgb(${color.red}, ${color.green}, ${color.blue})`;
  return alpha === undefined ? base : `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}
