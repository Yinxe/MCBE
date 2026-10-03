// ─── 版本兼容门禁（domain 纯逻辑） ──────────────────────────────
// 自定义维度 API（StartupEvent.dimensionRegistry.registerCustomDimension）
// 自 MIN_CUSTOM_DIMENSION_VERSION 起才提供：低于该版本的客户端拿到的是
// undefined，维度永远建不出来，物品仓与建档必然失败。
// 本模块只做纯判断与文案；探测与日志在 engine/Rig。

/** 自定义维度 API 首次可用的游戏版本 */
export const MIN_CUSTOM_DIMENSION_VERSION = "1.26.20";

/**
 * 维度不可用成因。
 * - api-missing：客户端脚本面没有该 API（版本过低）
 * - register-failed：注册调用抛错（引擎原文见 detail）
 * - not-loaded：注册过但当次载入不可见（/reload 后进入等）
 */
export type DimensionFailureKind = "api-missing" | "register-failed" | "not-loaded";

/** 维度不可用成因与引擎原文 */
export interface DimensionFailureInfo {
  kind: DimensionFailureKind;
  /** 引擎异常原文（无则 null） */
  detail: string | null;
}

/** 版本门禁要求的短句（拼进各条提示，避免版本号多处漂移） */
const VERSION_REQUIREMENT = `本包至少需要 ${MIN_CUSTOM_DIMENSION_VERSION}（世界需开启 Beta APIs）`;

/**
 * 维度不可用的玩家可见说明（不含色码，调用方自行着色）。
 * @param kind - 成因
 * @param detail - 引擎异常原文（可空）
 * @returns 中文说明
 */
export function dimensionFailureNotice(kind: DimensionFailureKind, detail: string | null): string {
  switch (kind) {
    case "api-missing":
      return `当前游戏版本不支持自定义维度，${VERSION_REQUIREMENT}；假人建档与物品仓无法使用`;
    case "register-failed":
      return `自定义维度注册失败，${VERSION_REQUIREMENT}${detail ? `；引擎原文：${detail}` : ""}`;
    case "not-loaded":
      return `自定义维度当次未载入${detail ? `（${detail}）` : ""}；若刚执行过 /reload，请完整重启世界`;
  }
}

/**
 * 存储不可用时的玩家可见原因。
 * 维度门禁结论优先（玩家能照着做），否则回落到注册异常原文，最后才是通用兜底。
 * @param dimension - 维度探测结果（可用为 null）
 * @param registerError - 木桶阵列注册异常原文（无则 null）
 * @returns 中文原因
 */
export function storageUnavailableReason(
  dimension: DimensionFailureInfo | null,
  registerError: string | null
): string {
  if (dimension) return dimensionFailureNotice(dimension.kind, dimension.detail);
  if (registerError) return `物品存储未就绪：${registerError}`;
  return "物品存储未就绪，稍后再试";
}
