// ─── 工具领域服务（Facade） ────────────────────────────
// 耐久工具/武器的主手管理，只操作 ItemDomain.resolve() === 'tool' 的物品：
//   onPlayerHitBlock — 命中方块（挖掘开始、破坏前），策略链换入正确挖掘工具
//   onAttackEntity   — 攻击实体，武器策略换入武器（剑→斧→镐）
//   onToolBroke      — 工具耐久耗尽破碎，换入背包同类新工具
// 挖掘/武器决策皆为"只出决策、统一执行"，执行与日志收敛在本文件的 execute。

import { type Block, type Player } from "@minecraft/server";
import { InventoryService } from "./Inventory";
import { ToolDecisionPlanner, type ToolContext, type ToolDecision } from "./ToolStrategies";

export class ToolManager {
  /**
   * @param minerPlanner  挖掘工具决策链（精准采集 → 类别 → 默认不动）
   * @param weaponPlanner 战斗武器决策链（剑→斧→镐；用于 entityHitEntity）
   * @param playPop       换工具成功后的反馈音效（注入便于维护，默认 random.pop）
   */
  constructor(
    private readonly minerPlanner: ToolDecisionPlanner,
    private readonly weaponPlanner: ToolDecisionPlanner = new ToolDecisionPlanner([]),
    private readonly playPop: (player: Player) => void = (p) => p.playSound("random.pop"),
  ) {}

  /**
   * 命中方块（挖掘开始）→ 挖掘决策链出决策并执行。
   * @param player 目标玩家
   * @param block  正在挖掘（命中）的方块
   */
  onPlayerHitBlock(player: Player, block: Block): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const ctx: ToolContext = { player, block, inv };
    const decision = this.minerPlanner.decide(ctx);
    this.execute(player, inv, decision);
  }

  /**
   * 攻击实体 → 武器决策链出决策并执行（非武器主手换武器，已持武器不动）。
   * @param player 目标玩家
   */
  onAttackEntity(player: Player): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const ctx: ToolContext = { player, inv };
    const decision = this.weaponPlanner.decide(ctx);
    this.execute(player, inv, decision);
  }

  /**
   * 工具耐久耗尽破碎 → 从背包换入同类新工具（playerBreakBlock 入口）。
   * @param player        目标玩家
   * @param brokenTypeId  破碎工具的 typeId（itemStackBeforeBreak）
   */
  onToolBroke(player: Player, brokenTypeId: string): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const slot = inv.findEqualType(brokenTypeId, inv.mainhandSlot());
    if (slot === undefined) return;
    if (!inv.swapMainhand(slot)) return;
    this.playPop(player);
    console.warn(`[AutoRefill] 破碎补齐 ${player.name}: ${brokenTypeId} ← slot ${slot}`);
  }

  /** 统一执行决策：keep 记日志；swap 执行交换后记日志。 */
  private execute(player: Player, inv: InventoryService, decision: ToolDecision | null): void {
    if (!decision) return; // 无决策（方块无偏好 / 无适用策略）→ 不动
    if (decision.action === "keep") {
      console.warn(`[AutoRefill] ${decision.log}`);
      return;
    }
    if (!inv.swapMainhand(decision.slot)) return;
    this.playPop(player);
    console.warn(`[AutoRefill] ${decision.log}`);
  }
}