// ─── 工具/武器选择引擎（纯逻辑，零 @minecraft 依赖，可 node 单测） ──
// 把"这块/这刀用什么，或要不要换"抽象成三层：
//   候选（RankableCandidate 特征向量）→ 策略（CandidateScorer 打分排序）
//   → 决策（ToolSelector：双层 fallback + 无适用→保持）。
// 内置策略：
//   frugal（默认·省耐久不择优，等价旧 SilkTouch+Category 行为）
//   quality（品质优先，会升级）/ durability（耐久优先）/ silk（精准采集优先）
//   efficiency（效率优先）/ priority（目标优先级序列）
//   weapon（默认武器域：剑→斧→重锤/三叉戟）
//   smite（亡灵杀手优先）/ sharpness（锋利优先）——武器域实体偏好用
// 策略只出"排序"，"保持 or 交换"统一由【当前主手作为 isCurrent 候选是否排第 0】决定：
//   frugal 给主手特权→达标就保持；quality 不给特权→背包有更高品质就升级。
// 双层 fallback：
//   垂直（策略未注册 / 抛错）→ 跳过；横向（rank 返回 null，如 silk 策略但无带精准
//   工具）→ 走下一条；链尾落到默认策略；默认策略也表达不了 → 保持。
// 耐久保护（buildReplacePool / isUrgent）：工具低于阈值未碎时提前换上同 role、
//   严格更耐久、达标占比的同类型工具（旧带精准则优先带精准的），不必等到破碎。

import {
  type RankableCandidate,
  type RankContext,
  type RankDecision,
  type StrategyPref,
  type ToolCategory,
  type WeaponClass,
} from "./types";

// ─── 角色判定（typeId → 工具/武器类别） ────────────────

/**
 * 解析 typeId 所属角色；非工具/武器（方块、食物、杂物）返回 undefined。
 * @param typeId 物品类型 ID
 */
export function roleOf(typeId: string): ToolCategory | WeaponClass | undefined {
  if (!typeId.startsWith("minecraft:")) return undefined;
  const id = typeId.slice("minecraft:".length);
  if (id === "shears") return "shears";
  if (id.endsWith("_pickaxe")) return "pickaxe";
  if (id.endsWith("_axe")) return "axe";
  if (id.endsWith("_shovel")) return "shovel";
  if (id.endsWith("_hoe")) return "hoe";
  if (id.endsWith("_sword")) return "sword";
  if (id === "mace") return "mace"; // 重锤
  if (id === "trident") return "trident";
  if (id === "bow") return "bow";
  if (id === "crossbow") return "crossbow";
  return undefined;
}

/** 是否为武器角色的角色（用于"已持武器则不切换"的域判断） */
export function isWeaponRole(role: string): boolean {
  return (
    role === "sword" ||
    role === "mace" ||
    role === "axe" ||
    role === "pickaxe" ||
    role === "trident" ||
    role === "bow" ||
    role === "crossbow"
  );
}

// ─── 达标判定（纯函数，替代对 ItemStack 的 matchesTarget） ─

/**
 * 候选是否满足单个工具目标（类别 + 可选最低品质 + 可选精准采集）。
 * @param c 候选特征
 * @param t 工具目标
 */
export function matchesTargetProfile(
  c: RankableCandidate,
  t: { category: ToolCategory; minTier?: number; silk?: boolean }
): boolean {
  if (c.role !== t.category) return false;
  if (t.minTier !== undefined && c.tier < t.minTier) return false;
  if (t.silk && !c.silk) return false;
  return true;
}

/**
 * 候选是否为该方块的"能力候选"。
 * 精准采集方块（wantsSilk，跨类别只能产出本体）→ 只看是否带精准采集；
 * 其余 → 匹配任一个工具目标（含最低品质/精准要求）。
 * @param c        候选特征
 * @param req      类别识别结果（可能为空）
 * @param wantsSilk 方块是否推荐精准采集
 */
export function isMineCapable(
  c: RankableCandidate,
  req: { targets: readonly { category: ToolCategory; minTier?: number; silk?: boolean }[] } | undefined,
  wantsSilk: boolean | undefined
): boolean {
  if (wantsSilk) return c.silk;
  if (req) return req.targets.some((t) => matchesTargetProfile(c, t));
  return false;
}

// ─── 策略契约与内置策略 ────────────────────────────────

/** 工具选择策略契约；rank 返回按偏好降序的候选，null 表示"本策略表达不了偏好 → 交给 fallback" */
export interface CandidateScorer {
  readonly name: string;
  rank(candidates: readonly RankableCandidate[], ctx: RankContext): readonly RankableCandidate[] | null;
}

/** 排序：品质降序 → 耐久占比降序 */
function byTierRatioDesc(a: RankableCandidate, b: RankableCandidate): number {
  return b.tier - a.tier || b.durabilityRatio - a.durabilityRatio;
}

/** 排序：耐久占比降序 → 品质降序 */
function byRatioTierDesc(a: RankableCandidate, b: RankableCandidate): number {
  return b.durabilityRatio - a.durabilityRatio || b.tier - a.tier;
}

/** 排序：效率降序 → 品质降序 → 耐久占比降序 */
function byEffTierRatioDesc(a: RankableCandidate, b: RankableCandidate): number {
  return b.efficiency - a.efficiency || b.tier - a.tier || b.durabilityRatio - a.durabilityRatio;
}

/** 候选在 targets 优先级序列中的分组下标（首个命中的目标；无命中为 Infinity） */
function targetGroupIndex(c: RankableCandidate, ctx: RankContext): number {
  const req = ctx.blockRequirement;
  if (!req) return ctx.wantsSilk ? (c.silk ? 0 : 1) : 0;
  for (let i = 0; i < req.targets.length; i++) {
    if (matchesTargetProfile(c, req.targets[i]!)) return i;
  }
  return Number.POSITIVE_INFINITY;
}

/** 挖掘域通用排序：目标优先级 → 品质 → 耐久占比 */
function mineSort(ctx: RankContext): (a: RankableCandidate, b: RankableCandidate) => number {
  return (a, b) => targetGroupIndex(a, ctx) - targetGroupIndex(b, ctx) || byTierRatioDesc(a, b);
}

/**
 * 省耐久策略（默认）：当前主手达标（在池内）→ 保持，不择优升级、尊重玩家
 * 省钻石耐久的自主选择；否则按目标优先级 → 品质 → 耐久换入。等价旧
 * SilkTouchStrategy + CategoryStrategy 的组合行为。
 */
class FrugalScorer implements CandidateScorer {
  readonly name = "frugal";

  rank(candidates: readonly RankableCandidate[], ctx: RankContext): readonly RankableCandidate[] | null {
    if (candidates.some((c) => c.isCurrent)) {
      const current = candidates.find((c) => c.isCurrent) as RankableCandidate;
      return [current, ...[...candidates].filter((c) => c !== current).sort(mineSort(ctx))];
    }
    return [...candidates].sort(mineSort(ctx));
  }
}

/** 品质优先策略：背包有更高品质的达标工具就升级换入（不给主手特权） */
class QualityScorer implements CandidateScorer {
  readonly name = "quality";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    return [...candidates].sort(byTierRatioDesc);
  }
}

/** 耐久优先策略：优先剩余耐久占比最高的工具（占比相同取更高品质） */
class DurabilityScorer implements CandidateScorer {
  readonly name = "durability";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    return [...candidates].sort(byRatioTierDesc);
  }
}

/**
 * 精准采集优先策略：带精准采集的工具排前（组内按品质/耐久），无任何带精准
 * 采集工具 → 表达不了偏好，返回 null 交给 fallback（如落到默认省耐久策略）。
 */
class SilkScorer implements CandidateScorer {
  readonly name = "silk";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    const withSilk = candidates.filter((c) => c.silk);
    if (withSilk.length === 0) return null;
    return [...withSilk.sort(byTierRatioDesc), ...[...candidates].filter((c) => !c.silk).sort(byTierRatioDesc)];
  }
}

/** 效率优先策略：效率附魔越高的工具越优先（组内品质/耐久）；全员无效率附魔 → null */
class EfficiencyScorer implements CandidateScorer {
  readonly name = "efficiency";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    if (candidates.every((c) => c.efficiency === 0)) return null;
    return [...candidates].sort(byEffTierRatioDesc);
  }
}

/** 目标优先级策略：严格按 targets 顺序取目标（不给主手特权），用于显式偏好列表 */
class PriorityScorer implements CandidateScorer {
  readonly name = "priority";

  rank(candidates: readonly RankableCandidate[], ctx: RankContext): readonly RankableCandidate[] | null {
    return [...candidates].sort(mineSort(ctx));
  }
}

/** 武器排序用武器类别优先级：剑 → 斧 →（重锤/三叉戟 平等兜底）；未列角色一律末位 */
const WEAPON_CLASS_ORDER: Readonly<Record<string, number>> = {
  sword: 0,
  axe: 1,
  mace: 2,
  trident: 2,
};

/** 武器类别组下标；未列出（如自定义角色）→ 末位 */
function weaponClassGroup(role: string): number {
  return WEAPON_CLASS_ORDER[role] ?? 9;
}

/** 武器默认策略（武器域）：已持武器（在池内）→ 保持；否则剑 → 斧 → 重锤/三叉戟（组内品质/耐久） */
class WeaponScorer implements CandidateScorer {
  readonly name = "weapon";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    const sorted = [...candidates].sort(
      (a, b) => weaponClassGroup(a.role) - weaponClassGroup(b.role) || byTierRatioDesc(a, b)
    );
    if (candidates.some((c) => c.isCurrent)) {
      const current = candidates.find((c) => c.isCurrent) as RankableCandidate;
      return [current, ...[...sorted].filter((c) => c !== current)];
    }
    return sorted;
  }
}

/** 亡灵杀手优先策略（武器域偏好）：亡灵杀手等级最高者优先，其次锋利，再默认。全员无亡灵杀手 → null（fallback） */
class SmiteScorer implements CandidateScorer {
  readonly name = "smite";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    if (candidates.every((c) => c.smite === 0)) return null;
    return [...candidates].sort(
      (a, b) =>
        b.smite - a.smite ||
        b.sharpness - a.sharpness ||
        weaponClassGroup(a.role) - weaponClassGroup(b.role) ||
        byTierRatioDesc(a, b)
    );
  }
}

/** 锋利优先策略（武器域偏好）：锋利等级最高者优先，再默认。全员无锋利 → null（fallback） */
class SharpnessScorer implements CandidateScorer {
  readonly name = "sharpness";

  rank(candidates: readonly RankableCandidate[]): readonly RankableCandidate[] | null {
    if (candidates.every((c) => c.sharpness === 0)) return null;
    return [...candidates].sort(
      (a, b) =>
        b.sharpness - a.sharpness || weaponClassGroup(a.role) - weaponClassGroup(b.role) || byTierRatioDesc(a, b)
    );
  }
}

/** 构建内置策略注册表（策略名 → 打分排序器） */
export function createDefaultScorers(): ReadonlyMap<string, CandidateScorer> {
  return new Map(
    [
      new FrugalScorer(),
      new QualityScorer(),
      new DurabilityScorer(),
      new SilkScorer(),
      new EfficiencyScorer(),
      new PriorityScorer(),
      new WeaponScorer(),
      new SmiteScorer(),
      new SharpnessScorer(),
    ].map((s) => [s.name, s] as const)
  );
}

// ─── 决策引擎（双层 fallback + 无适用→保持） ─────────────

/**
 * 工具/武器决策引擎：对候选池出"保持/交换"决策。
 * 候选池由适配层（ToolManager）构造：已按能力过滤 + 可换（跳过锁定槽），
 * 且当前主手若能力达标则以 isCurrent 伪候选入池。
 */
export class ToolSelector {
  /** @param scorers       策略注册表（策略名 → scorer） */
  constructor(
    private readonly scorers: ReadonlyMap<string, CandidateScorer>,
    private readonly defaultStrategy: "frugal" | "weapon" = "frugal"
  ) {}

  /**
   * 对给定候选池出决策。
   * @param pool   能力候选池（含可选的 isCurrent 主手伪候选）
   * @param ctx    决策上下文
   * @param pref   方块偏好（指定策略名 + 纵向 fallback 链）；缺省用默认策略
   */
  decide(pool: readonly RankableCandidate[], ctx: RankContext, pref?: StrategyPref | null): RankDecision {
    if (pool.length === 0) {
      return {
        action: "keep",
        log: `无适用工具 ${ctx.playerName}${ctx.blockTypeId !== undefined ? `: ${ctx.blockTypeId}` : ""} → 不动`,
      };
    }
    const base = ctx.domain === "weapon" ? "weapon" : this.defaultStrategy;
    const chain = pref ? [pref.strategy, ...(pref.fallbackChain ?? []), base] : [base];
    const seen = new Set<string>();
    for (const name of chain) {
      if (seen.has(name)) continue; // 防重（多级 fallback 落回同一策略）
      seen.add(name);
      const scorer = this.scorers.get(name);
      if (!scorer) continue; // 垂直 fallback：策略未注册 → 走下一级
      let ranked: readonly RankableCandidate[] | null;
      try {
        ranked = scorer.rank(pool, ctx);
      } catch {
        ranked = null;
      }
      if (ranked === null || ranked.length === 0) continue; // 横向 fallback：策略表达不了偏好
      const top = ranked[0] as RankableCandidate;
      if (top.isCurrent) {
        return { action: "keep", log: `工具已正确 ${ctx.playerName}: ${top.typeId} → 不动` };
      }
      return {
        action: "swap",
        slot: top.slot,
        log: `换工具 ${ctx.playerName}: ${ctx.blockTypeId ?? "武器"} ${top.typeId} ← slot ${top.slot}`,
      };
    }
    return { action: "keep", log: `无策略适用 ${ctx.playerName} → 不动` };
  }
}

// ─── 耐久保护（低于阈值未碎提前收起） ───────────────────

/** 剩余耐久的绝对下限（低于该值即紧急，兜住低耐久上限的工具如木工具） */
export const ABS_DURABILITY_FLOOR = 16;

/**
 * 工具是否达到"紧急"，需要提前收起换同类。
 * @param c         当前主手工具特征
 * @param threshold 剩余耐久占比阈值（0..1）
 * @param absFloor  剩余耐久绝对下限
 */
export function isUrgent(c: RankableCandidate, threshold: number, absFloor: number = ABS_DURABILITY_FLOOR): boolean {
  return c.durabilityRatio < threshold || c.durability < absFloor;
}

/**
 * 从同 role 候选里挑替换对象（耐久保护用，纯逻辑）。
 * 规则：严格更耐久（remaining > 旧工具）且占比达标 → 才入选；
 * 排序：同 typeId → 同精准采集属性 → 品质 → 耐久（旧带精准则优先带精准的同款，避免降级属性）。
 * @param old       当前旧工具（入池但会被筛掉）
 * @param candidates 同 role 的候选池（含锁定槽之外的全部同 role 工具）
 * @param threshold 替换对象的最低占比（不够"充足"的候选不入选）
 * @returns 最优替换对象；无合格候选返回 null（保持不动，不降级）
 */
export function buildReplacePool(
  old: RankableCandidate,
  candidates: readonly RankableCandidate[],
  threshold: number
): RankableCandidate | null {
  const valid = candidates
    .filter(
      (c) =>
        c.slot !== old.slot && c.role === old.role && c.durability > old.durability && c.durabilityRatio >= threshold
    )
    .sort((a, b) => {
      const typeDiff = (a.typeId === old.typeId ? 0 : 1) - (b.typeId === old.typeId ? 0 : 1);
      if (typeDiff !== 0) return typeDiff;
      const silkDiff = (a.silk === old.silk ? 0 : 1) - (b.silk === old.silk ? 0 : 1);
      if (silkDiff !== 0) return silkDiff;
      return byTierRatioDesc(a, b);
    });
  return valid[0] ?? null;
}
