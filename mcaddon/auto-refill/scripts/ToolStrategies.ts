// ─── 工具选择策略（Strategy + Chain of Responsibility） ─
// 把"这块方块该用什么工具 / 要不要换"建模为可插拔策略：
//   - SilkTouchStrategy  ：方块需精准采集 → 换上任意带精准采集的工具
//   - CategoryStrategy   ：方块需某类别（含最低品质）→ 换入达标工具
//   - 默认               ：两者都不适用 → 不动（链尾自动保持）
// ToolDecisionPlanner 按序执行策略链，首个返回非 null（可决策）者胜出，
// 精准采集始终优先于类别判断，与既有行为一致。
// 策略只做"决策"（换成哪个槽位 / 保持），执行与日志交给 ToolManager。

import { type Block, type Player } from "@minecraft/server";
import { classify, wantsSilkTouch } from "./BlockClassifier";
import { InventoryService } from "./Inventory";

/** 策略执行的上下文（由一个已构造的背包端口 + 可选的目标方块组成） */
export interface ToolContext {
  readonly player: Player;
  readonly inv: InventoryService;
  /** 挖掘上下文的方块（武器切换等无方块场景不提供） */
  readonly block?: Block;
}

/** 决策结果：换成指定槽位 / 保持（中缀路径 + 可给玩家看的日志文案） */
export type ToolDecision =
  | { action: "keep"; log: string }
  | { action: "swap"; slot: number; log: string };

/** 工具选择策略契约；plan 返回 null 表示"本策略不适用"，交给下一条 */
export interface ToolStrategy {
  readonly name: string;
  plan(ctx: ToolContext): ToolDecision | null;
}

/**
 * 精准采集策略：玻璃/片/冰/萤石等无工具类别、但需精准采集的方块。
 * 主手已带精准采集 / 锁定·自定义物品 / 背包无精准采集工具 → 保持；
 * 否则换入背包最优的精准采集工具。
 */
export class SilkTouchStrategy implements ToolStrategy {
  readonly name = "silk";

  plan(ctx: ToolContext): ToolDecision | null {
    const block = ctx.block;
    if (block === undefined) return null; // 无方块（武器等场景）→ 不适用
    const { player, inv } = ctx;
    if (!wantsSilkTouch(block)) return null; // 非精准采集方块 → 交给下一条
    const typeId = block.typeId;
    const mainhandSlot = inv.mainhandSlot();
    const mainhand = inv.readMainhand();

    console.warn(`[AutoRefill] 识别[silk] ${player.name}: ${typeId} → 精准采集`);

    if (mainhand && InventoryService.hasSilkTouch(mainhand)) {
      return { action: "keep", log: `已用精准采集 ${player.name}: ${typeId} 用 ${mainhand.typeId} → 不动` };
    }
    if (mainhand && !inv.slotIsSwappable(mainhand)) {
      return { action: "keep", log: `主手锁定/自定义 ${player.name}: ${mainhand.typeId} → 尊重不动` };
    }
    const best = inv.findSilkTouch(mainhandSlot);
    if (!best) {
      return { action: "keep", log: `背包无精准采集工具 ${player.name}: ${typeId} → 不动` };
    }
    return { action: "swap", slot: best.slot, log: `换精准采集工具 ${player.name}: ${typeId} ← slot ${best.slot} (tier ${best.tier})` };
  }
}

/**
 * 类别策略：方块对应某挖掘类别（含最低品质，如 obsidian 需钻镐+）。
 * 主手类别正确且品质达标 → 保持（不择优，尊重玩家省耐久）；
 * 品质不足（铁挖钻石块）→ 换品质达标的同类；背包无达标 → 不降级。
 */
export class CategoryStrategy implements ToolStrategy {
  readonly name = "category";

  plan(ctx: ToolContext): ToolDecision | null {
    const block = ctx.block;
    if (block === undefined) return null; // 无方块（武器等场景）→ 不适用
    const { player, inv } = ctx;
    const req = classify(block);
    if (!req) return null; // 无工具偏好 → 交给链尾（默认不动）
    const typeId = block.typeId;
    const mainhandSlot = inv.mainhandSlot();
    const mainhand = inv.readMainhand();

    const desc = req.targets
      .map((t) => `${t.category}${t.silk ? "·精准" : ""}${t.minTier !== undefined ? `≥${t.minTier}` : ""}`)
      .join(" > ");
    console.warn(`[AutoRefill] 识别[${req.path}] ${player.name}: ${typeId} → ${desc}`);

    // 主手命中任一目标 → 正确，保持（不择优，尊重玩家省耐久）
    if (mainhand && req.targets.some((t) => InventoryService.matchesTarget(mainhand, t))) {
      return { action: "keep", log: `工具已正确 ${player.name}: ${typeId} 用 ${mainhand.typeId} → 不动` };
    }

    // 锁定槽/自定义物品 → 尊重玩家，不换
    if (mainhand && !inv.slotIsSwappable(mainhand)) {
      return { action: "keep", log: `主手锁定/自定义 ${player.name}: ${mainhand.typeId} → 尊重不动` };
    }

    // 主手类别对但缺品质/精准（首目标）→ 提示后继续找达标工具
    const first = req.targets[0];
    if (mainhand && first !== undefined && InventoryService.isVanillaToolOf(mainhand, first.category)) {
      console.warn(`[AutoRefill] 品质不足 ${player.name}: ${typeId} 需 ${desc}，当前 ${mainhand.typeId}`);
    } else if (!mainhand) {
      console.warn(`[AutoRefill] 空手挖 ${player.name}: ${typeId} 需 ${desc}`);
    }

    // 按优先级换入第一个有货且达标的目标工具
    for (const target of req.targets) {
      const best = inv.findByTarget(target, mainhandSlot);
      if (best) {
        return { action: "swap", slot: best.slot, log: `换工具 ${player.name}: ${typeId} ${target.category}${target.silk ? "·精准" : ""} ← slot ${best.slot} (tier ${best.tier})` };
      }
    }
    return { action: "keep", log: `无达标工具 ${player.name}: ${typeId} 需 ${desc} → 不动` };
  }
}

/**
 * 武器策略：玩家攻击实体（entityHitEntity）时，若主手非武器则换上
 * 背包最优武器（剑 → 斧 → 镐 依次优先）。
 * 已持武器 / 锁定·自定义主手 / 背包无任何武器 → 保持不动。
 */
export class WeaponPriorityStrategy implements ToolStrategy {
  readonly name = "weapon";

  plan({ player, inv }: ToolContext): ToolDecision | null {
    const mainhandSlot = inv.mainhandSlot();
    const mainhand = inv.readMainhand();

    // 已持近战武器（剑/斧/镐/三叉戟/弓弩）→ 尊重玩家选择，不动
    if (mainhand && InventoryService.isWeapon(mainhand)) {
      return { action: "keep", log: `已持武器 ${player.name}: ${mainhand.typeId} → 不动` };
    }
    // 锁定槽/自定义物品 → 尊重玩家，不换
    if (mainhand && !inv.slotIsSwappable(mainhand)) {
      return { action: "keep", log: `主手锁定/自定义 ${player.name}: ${mainhand.typeId} → 尊重不动` };
    }
    // 背包无任何武器（剑/斧/镐都没有）→ 不动
    const best = inv.findBestWeapon(mainhandSlot);
    if (!best) return { action: "keep", log: `背包无武器 ${player.name} → 不动` };

    return { action: "swap", slot: best.slot, log: `切武器 ${player.name}: ← slot ${best.slot} (tier ${best.tier})` };
  }
}

/** 决策链：按序执行策略，首个可决策者胜出；全部不适用则返回 null（默认不动）。 */
export class ToolDecisionPlanner {
  constructor(private readonly strategies: readonly ToolStrategy[]) {}

  /**
   * 对给定上下文出工具决策。
   * @param ctx 策略上下文
   * @returns 决策；无任何策略适用（方块无偏好）返回 null
   */
  decide(ctx: ToolContext): ToolDecision | null {
    for (const strategy of this.strategies) {
      const decision = strategy.plan(ctx);
      if (decision !== null) return decision;
    }
    return null;
  }
}