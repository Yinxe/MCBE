// ─── 版本兼容（domain 纯逻辑） ──────────────────────────────────
// 自定义维度 API（StartupEvent.dimensionRegistry.registerCustomDimension）自
// MIN_CUSTOM_DIMENSION_VERSION 起才提供；更低的客户端该字段是 undefined，测试维度建不出来。
// 此时走兼容锚点：物品仓改存末地远点，假人改由模块级 spawnSimulatedPlayer 生成；
// 升级到支持版本后物品仓自动迁回测试维度。常加载能力由 TickingAreas 独立提供，
// 其 API（world.tickingAreaManager）自游戏 1.21.130 起存在——manifest 的 min_engine_version 不得低于它。
// 本模块只做纯判断与文案；探测与日志在 engine/Rig。

import type { Vec3 } from "./Coords";

/** 自定义维度 API 首次可用的游戏版本 */
export const MIN_CUSTOM_DIMENSION_VERSION = "1.26.20";

/** 测试维度 id（唯一真源：Rig.TEST_DIMENSION 与首选仓锚点都取自它） */
export const TEST_DIMENSION_ID = "mockplayer:test";

/** 物品仓锚点：维度 + 锚点坐标（所在区块即存储地址）+ 最底层木桶 Y */
export interface StorageAnchor {
  /** 完整维度 ID */
  dimension: string;
  /** 锚点坐标 */
  anchor: Vec3;
  /** 最底层木桶 Y（桶层自 baseY 向上 64 层） */
  baseY: number;
}

/**
 * 首选锚点：自定义测试维度 (16,0,16)，玩家不可达。
 * 维度名取 TEST_DIMENSION_ID——区域 id 含维度名，不一致就寻不到既有阵列。
 */
export const PRIMARY_STORAGE_ANCHOR: StorageAnchor = {
  dimension: TEST_DIMENSION_ID,
  anchor: { x: 16, y: 0, z: 16 },
  baseY: 0,
};

/** 兼容锚点：末地远点 (300000,0,300000)，测试维度不可用时的替身，玩家常规不可达 */
export const FALLBACK_STORAGE_ANCHOR: StorageAnchor = {
  dimension: "minecraft:the_end",
  anchor: { x: 300000, y: 0, z: 300000 },
  baseY: 0,
};

/**
 * 按测试维度可用性选择物品仓锚点。
 * @param dimensionAvailable - 测试维度当次可用（Rig.customDimensionAvailable 为真）
 * @returns 可用取首选锚点，否则取末地兼容锚点
 */
export function storageAnchorFor(dimensionAvailable: boolean): StorageAnchor {
  return dimensionAvailable ? PRIMARY_STORAGE_ANCHOR : FALLBACK_STORAGE_ANCHOR;
}

/**
 * 区域 id 是否属于测试维度（区域 id 形如 `维度短名:区块X:区块Z`）。
 * 用于把"仓在测试维度、当前版本读不到"与"仓区块只是这次没加载"区分开。
 * @param regionId - 存储区域 id
 * @returns 属于测试维度返回 true
 */
export function isTestDimensionRegion(regionId: string): boolean {
  return regionId.startsWith(`${TEST_DIMENSION_ID}:`);
}

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

/** 兼容模式说明（维度不可用时的实际行为；常加载与其余能力不依赖测试维度） */
const FALLBACK_NOTE =
  `已启用兼容模式：物品仓改存末地 ` +
  `(${FALLBACK_STORAGE_ANCHOR.anchor.x}, ${FALLBACK_STORAGE_ANCHOR.anchor.y}, ${FALLBACK_STORAGE_ANCHOR.anchor.z})` +
  `，假人改由模块级方式生成；/mp:test 传送测试维度不可用，升级后自动迁回测试维度`;

/**
 * 维度不可用的玩家可见说明（不含色码，调用方自行着色）。
 * @param kind - 成因
 * @param detail - 引擎异常原文（可空）
 * @returns 中文说明
 */
export function dimensionFailureNotice(kind: DimensionFailureKind, detail: string | null): string {
  switch (kind) {
    case "api-missing":
      return `当前游戏版本不支持自定义维度，${VERSION_REQUIREMENT}；${FALLBACK_NOTE}`;
    case "register-failed":
      return `自定义维度注册失败，${VERSION_REQUIREMENT}${detail ? `；引擎原文：${detail}` : ""}；${FALLBACK_NOTE}`;
    case "not-loaded":
      return `自定义维度当次未载入${detail ? `（${detail}）` : ""}；${FALLBACK_NOTE}；若刚执行过 /reload，请完整重启世界`;
  }
}

/**
 * 物品仓不可用时的玩家可见原因（当次锚点注册失败）。
 * 锚点按可用性二选一（不会两个都试），所以注册异常原文就是根因；
 * 当次未载入是可自解的临时态（重启世界即可），优先给出该提示，注册原文附在其后。
 * @param dimension - 维度探测结果（可用为 null）
 * @param registerError - 木桶阵列注册异常原文（无则 null）
 * @returns 中文原因
 */
export function storageUnavailableReason(dimension: DimensionFailureInfo | null, registerError: string | null): string {
  if (dimension?.kind === "not-loaded") {
    const tail = registerError ? `；物品仓注册失败：${registerError}` : "";
    return `${dimensionFailureNotice("not-loaded", dimension.detail)}${tail}`;
  }
  if (registerError) return `物品存储未就绪：${registerError}`;
  if (dimension) return `物品存储未就绪（${dimensionFailureNotice(dimension.kind, dimension.detail)}）`;
  return "物品存储未就绪，稍后再试";
}
