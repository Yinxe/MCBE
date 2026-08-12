// ── 区域分配元数据（纯逻辑，零 @minecraft 依赖） ────────────────────────
// 真实占用以世界（木桶实物）为准；元数据只记一件全局事实：
//   - barrelCount：已物化的木桶总数（真正 setBlockType 建新桶时 +1；空桶常驻不回收）
// 空槽**不做任何登记**（旧 v2 的"空洞池"已废弃，见 AGENTS.md）：
//   - 分配时按"桶水位"（每层一条 DP：该层已物化桶的占用计数数组，见 put.ts）
//     快速定位未满桶，桶内空槽**探测容器真值**——计数只是过滤，真值兜底；
//   - 因此单值持久化体量从"每层 6912 个 ID"降为"每层 256 个计数"，
//     从根上规避 DynamicProperty 单值 32KB 上限（无需分片）。
//
// ⚠️ ID 语义恒定：解码按 27 槽/桶（BARREL_SLOTS），"每桶可用槽数"
// （usablePerBarrel）只跳过桶内索引 ≥ 上限的候选——已存物品的 ID 永不漂移。
//
// 元数据是软状态（可被世界真值自愈）：meta 丢失时重新计数，
// put 侧的世界占用检查会跳过已被占用的槽位，不会覆盖他人物品。

/** 区域分配元数据（可 JSON 持久化；桶水位按层独立持久化，不在本结构内） */
export interface RegionMeta {
  readonly v: 3;
  /** 已物化的木桶数（每次真正 setBlockType 建新桶 +1；空桶常驻不回收） */
  barrelCount: number;
}

/** 新建空元数据 */
export function createRegionMeta(): RegionMeta {
  return { v: 3, barrelCount: 0 };
}

/**
 * 把任意来源的 meta 归一化为 v3（兼容 v2 旧记录：洞池时代读取迁移，
 * 空洞信息丢弃——空槽不再登记，桶水位由巡检对齐/真值探测兜底，物品安全不受影响）。
 * 非法 → undefined。
 */
export function normalizeMeta(raw: unknown): RegionMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const meta = raw as Record<string, unknown>;
  if (meta.v === 3) {
    if (Number.isInteger(meta.barrelCount) && (meta.barrelCount as number) >= 0) {
      return { v: 3, barrelCount: meta.barrelCount as number };
    }
    return undefined;
  }
  if (meta.v === 2) {
    const barrelCount =
      Number.isInteger(meta.barrelCount) && (meta.barrelCount as number) >= 0 ? (meta.barrelCount as number) : 0;
    return { v: 3, barrelCount };
  }
  return undefined;
}