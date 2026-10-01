// ─── 物品槽指纹（domain 纯函数） ───────────────────────────────────
// 上线导入前后与导入回读的对账基元：仓内容 → 实体 → 摘要比对。
// ItemStack 本体留在 engine 层，应用/域只见摘要（typeId+amount）。

/** 槽位摘要（空位=null；typeId 含命名空间原文，占位物品由 engine 侧归一为 null） */
export interface SlotDigest {
  typeId: string;
  amount: number;
}

/** 期望/实际序列等长比对，返回不一致的下标列表（回读判定复用） */
export function mismatchedSlots(expected: (SlotDigest | null)[], actual: (SlotDigest | null)[]): number[] {
  const out: number[] = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i] ?? null;
    const a = actual[i] ?? null;
    if ((e?.typeId ?? "") !== (a?.typeId ?? "") || (e?.amount ?? 0) !== (a?.amount ?? 0)) out.push(i);
  }
  return out;
}

/** 序列指纹串（日志/快照对比用；空位以 "-" 占位） */
export function digestKey(items: (SlotDigest | null)[]): string {
  return items.map((it) => (it ? `${it.typeId}|${it.amount}` : "-")).join(";");
}

/** 战利品指纹：含附魔集合（同物品不同附魔可区分）；无附魔即裸 typeId，集合内排序保稳定 */
export function lootFingerprint(typeId: string, enchantments: readonly { id: string; level: number }[]): string {
  if (enchantments.length === 0) return typeId;
  const ench = enchantments
    .map((e) => `${e.id}:${e.level}`)
    .sort()
    .join(",");
  return `${typeId}#${ench}`;
}

/** 计数差异：after 相对 before 的正增量（收竿后按前后两次快照做 diff 的回退路径） */
export function diffLootCounts(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(after)) {
    const delta = count - (before[key] ?? 0);
    if (delta > 0) out[key] = delta;
  }
  return out;
}
