// ── 注册决策（纯逻辑，零 @minecraft 依赖） ────────────────────────────
// 多个模组注册到同一区域时，以"首个注册者"定下的布局为准：
//   - 世界已有该区域的持久化记录 → 采纳其 dimensionId 与 layout（后注册者传的 baseY 等被忽略）
//   - 全新区域 → 用传入参数创建（baseY 缺省 DEFAULT_BASE_Y；层数固定 MAX_LEVELS）
// 区域 ID 由"维度枚举 + 区块坐标"决定（不含 baseY）→ 同维度同区块必然共享同一记录/阵列，
// baseY 只是阵列在地表的高度锚点，首个注册者定下后共享。

import { MAX_LEVELS, type RegionLayout } from "./layout";
import type { PersistedRegion } from "./record";

/** 默认底层木桶 Y（末地虚空高度，避让末地主岛/黑曜石柱） */
export const DEFAULT_BASE_Y = 120;

/** 注册决策的输入（锚点已归块为区块坐标） */
export interface RegistrationInput {
  /** 本模组请求的完整维度 ID */
  dimensionId: string;
  /** 本模组请求的底层 Y（可选；仅全新区域生效） */
  baseY?: number;
}

/** 注册决策输出：生效的维度 + 布局 */
export interface RegistrationDecision {
  dimensionId: string;
  layout: RegionLayout;
}

/**
 * 注册决策：已有持久化记录 → 采纳其维度/布局；否则按传入参数新建（固定 64 层）。
 * 后注册者即便传了不同高度，也以首个注册者的布局为准（同区块共享不分裂）。
 */
export function resolveRegistration(
  persisted: PersistedRegion | undefined,
  input: RegistrationInput,
  chunk: { cx: number; cz: number }
): RegistrationDecision {
  const dimensionId = persisted?.dimensionId ?? input.dimensionId;
  const layout: RegionLayout = persisted?.layout ?? {
    chunkX: chunk.cx,
    chunkZ: chunk.cz,
    baseY: input.baseY ?? DEFAULT_BASE_Y,
    maxLevels: MAX_LEVELS,
  };
  return { dimensionId, layout };
}
