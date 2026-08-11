// ─── 工具领域服务（Facade） ────────────────────────────
// 主手工具/武器的选择、耐久保护、破碎补齐，策略收敛到 ToolScorer 引擎：
//   onPlayerHitBlock — 命中方块（挖掘开始、破坏前）：构造能力候选池 →
//      偏好策略排序（默认省耐久不择优）→ 保持/换入正确工具；
//      挖掘防误触：本会切换时首次同信号先拦截（防误拆），窗口内二次才启用
//   onAttackEntity   — 攻击实体：武器域决策（已持任意武器不动；空/非武器按
//      被攻击实体偏好，如亡灵 → 亡灵杀手 > 锋利 > 默认剑斧重锤/三叉戟）
//   onToolBroke      — 工具耐久耗尽破碎（playerBreakBlock 末兜底）：换同类新工具
//   checkDurability  — 耐久保护（独立开关）：工具被使用后若耐久低于阈值，
//      未碎也提前收起、替换同 role 更耐久的同类（旧带精准则优先带精准）
// 挖掘/武器决策皆为"只出决策、统一执行"，执行与日志收敛在本文件的 execute。

import { system, type Block, type Player } from "@minecraft/server";
import { InventoryService } from "./Inventory";
import { buildReplacePool, isMineCapable, isUrgent, ToolSelector } from "./ToolScorer";
import { AccidentalGuard } from "./AccidentalGuard";
import { type PreferenceSpec, type RankableCandidate, type RankContext, type RankDecision } from "./types";
import { profile } from "./ToolProfile";
import { classify, wantsSilkTouch } from "./BlockClassifier";
import { lookupMineStrategy } from "./MinePreference";
import { lookupWeaponStrategy } from "./WeaponPreference";
import { resolve as resolveItemDomain } from "./ItemDomain";
import { type SettingsService } from "./Settings";
import { logger } from "./Logger";

/** 武器域候选（换入来源）：剑/斧/重锤/三叉戟（弓弩只用于"已持则不动"） */
function isWeaponSource(c: RankableCandidate): boolean {
  return c.role === "sword" || c.role === "axe" || c.role === "mace" || c.role === "trident";
}

export class ToolManager {
  /**
   * @param minerSelector  挖掘决策引擎（默认策略 frugal，方块偏好可覆盖）
   * @param weaponSelector 武器决策引擎（默认策略 weapon）
   * @param settings       全局设置（耐久保护开关 + 阈值、防误触开关）
   * @param playPop        换工具成功后的反馈音效（注入便于维护，默认 random.pop）
   * @param antiTouch      挖掘防误触守卫（首次错误工具命中不切，窗口内二次才启用）
   */
  constructor(
    private readonly minerSelector: ToolSelector,
    private readonly weaponSelector: ToolSelector,
    private readonly settings: SettingsService,
    private readonly playPop: (player: Player) => void = (p) => p.playSound("random.pop"),
    private readonly antiTouch: AccidentalGuard = new AccidentalGuard()
  ) {}

  /**
   * 命中方块（挖掘开始）→ 挖掘决策链出决策并执行。
   * 主手锁定/自定义 → 尊重玩家不动；能力候选池为空（无适用工具）→ 不动。
   * @param player 目标玩家
   * @param block  正在挖掘（命中）的方块
   */
  onPlayerHitBlock(player: Player, block: Block): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const mainhand = inv.readMainhand();
    if (mainhand && !inv.slotIsSwappable(mainhand)) {
      logger.info(`主手锁定/自定义 ${player.name}: ${mainhand.typeId} → 尊重不动`);
      return;
    }
    const requirement = classify(block);
    const wantsSilk = wantsSilkTouch(block);
    const pref = lookupMineStrategy(block.typeId); // 方块的两级偏好（如农作物→时运 / 树叶→精准锄>剪）
    const current = mainhand ? profile(mainhand, inv.mainhandSlot(), true) : undefined;
    const pool = this.buildMinePool(inv, requirement, wantsSilk, pref, current);
    const ctx: RankContext = {
      playerName: player.name,
      blockTypeId: block.typeId,
      blockRequirement: requirement,
      wantsSilk,
      domain: "mine",
    };
    const decision = this.minerSelector.decide(pool, ctx, pref);
    // 挖掘防误触（默认开）：本会触发切换时，第一次同信号（玩家·主手·方块）先拦截，
    // 防"空手/错工具随手命中把效率5镐秒切进建筑而误拆"；窗口 2.5s 内相同操作
    // 再命中一次 = 确认有意挖掘 → 放行切换。超过窗口 → 防误触重置。
    if (decision.action === "swap" && this.settings.isEnabled("antiTouch")) {
      const hand = mainhand ? mainhand.typeId : "空手";
      if (this.antiTouch.shouldIntercept(player.id, mainhand?.typeId, block.typeId, system.currentTick)) {
        logger.info(`防误触 ${player.name}: ${block.typeId}（${hand}）→ 已拦截切换，2.5 秒内再挖一次将启用`);
        return;
      }
    }
    this.execute(player, inv, decision);
  }

  /**
   * 攻击实体 → 武器决策：已持武器（含重锤/三叉戟/弓弩等"任意武器"）→ 不动。
   * 空手/非武器主手 → 按被攻击实体种类偏好换入武器库最优（默认剑→斧→重锤/三叉戟）。
   * @param player        目标玩家
   * @param entityTypeId  被攻击实体的 typeId（武器偏好查表用；无则默认策略）
   */
  onAttackEntity(player: Player, entityTypeId?: string): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const mainhand = inv.readMainhand();
    if (mainhand && !inv.slotIsSwappable(mainhand)) {
      logger.info(`主手锁定/自定义 ${player.name}: ${mainhand.typeId} → 尊重不动`);
      return;
    }
    if (mainhand && InventoryService.isWeapon(mainhand)) {
      logger.info(`已持武器 ${player.name}: ${mainhand.typeId} → 不动`);
      return;
    }
    const pool = inv.scanCandidates(isWeaponSource, inv.mainhandSlot());
    const ctx: RankContext = { playerName: player.name, domain: "weapon", entityTypeId };
    const decision = this.weaponSelector.decide(
      pool,
      ctx,
      entityTypeId ? lookupWeaponStrategy(entityTypeId) : undefined
    );
    this.execute(player, inv, decision);
  }

  /**
   * 工具耐久耗尽破碎 → 从背包换入同类新工具（playerBreakBlock 入口，末兜底）。
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
    logger.info(`破碎补齐 ${player.name}: ${brokenTypeId} ← slot ${slot}`);
  }

  /**
   * 耐久保护（独立开关）：工具被使用（挖掘/攻击）后评估主手耐久，
   * 低于阈值未碎也提前收起，替换同 role 更耐久且占比达标的同类工具。
   * 旧工具带精准采集 → 替换优先选带精准采集的同款（buildReplacePool 排序）。
   * 无合格同类（同 role 且更耐久）→ 保持不动，绝不降级。
   * @param player 目标玩家
   */
  checkDurability(player: Player): void {
    if (!this.settings.isEnabled("durability")) return;
    const inv = InventoryService.of(player);
    if (!inv) return;
    const mainhand = inv.readMainhand();
    if (!mainhand) return;
    if (resolveItemDomain(mainhand.typeId) !== "tool") return; // 只保护耐久工具/武器域
    const current = profile(mainhand, inv.mainhandSlot());
    if (!current) return;
    const threshold = this.settings.durabilityThreshold();
    const floor = this.settings.durabilityFloor(); // 绝对下限（占比阈值折算与它取较大值生效）
    if (!isUrgent(current, threshold, floor)) return; // 还健康 → 不动
    const bag = inv.scanCandidates((c) => c.role === current.role, inv.mainhandSlot());
    const target = buildReplacePool(current, bag, threshold);
    if (target === null) {
      logger.warn(`耐久低但无同类可替 ${player.name}: ${current.typeId} 剩余 ${current.durability} → 不动`);
      return;
    }
    if (!inv.swapMainhand(target.slot)) return;
    this.playPop(player);
    logger.info(
      `耐久保护 ${player.name}: ${current.typeId}（剩 ${current.durability}）← ${target.typeId} slot ${target.slot}`
    );
  }

  /** 构造挖掘能力候选池：达标且可换槽位 + 主手若达标以 isCurrent 入池。偏好（pref）影响跨类别附魔池与排除角色。 */
  private buildMinePool(
    inv: InventoryService,
    requirement: ReturnType<typeof classify>,
    wantsSilk: boolean,
    pref: PreferenceSpec | undefined,
    current: RankableCandidate | undefined
  ): RankableCandidate[] {
    const pool = inv.scanCandidates((c) => isMineCapable(c, requirement, wantsSilk, pref), inv.mainhandSlot());
    if (current && isMineCapable(current, requirement, wantsSilk, pref)) {
      pool.push(current); // 当前主手达标 → 作为 isCurrent 伪候选参与排序
    }
    return pool;
  }

  /** 统一执行决策：keep（无动作）记 debug；swap 执行交换后记 info。 */
  private execute(player: Player, inv: InventoryService, decision: RankDecision | null | undefined): void {
    if (!decision) return; // 无决策（方块无偏好 / 无适用策略）→ 不动
    if (decision.action === "keep") {
      logger.debug(`${decision.log}`); // 每次命中都会触发 → 无动作的保持用 debug 收敛
      return;
    }
    if (!inv.swapMainhand(decision.slot)) return;
    this.playPop(player);
    logger.info(`${decision.log}`);
  }
}
