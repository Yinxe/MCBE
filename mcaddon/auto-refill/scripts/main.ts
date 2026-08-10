// ─── 组装根（Composition Root） ────────────────────────
// 只做两件事：实例化服务、把世界事件路由到领域服务。不含任何业务逻辑。
//
// 事件 → 领域路由（受 SettingsService 开关约束）：
//   entityHitBlock  → ToolManager（挖掘核对，破坏前换正确挖掘工具）·工具替换
//   entityHitEntity → ToolManager（攻击实体，非武器换武器；随后耐久保护）·武器替换+耐久
//   playerBreakBlock → ToolManager（工具破碎换同类 / 未碎但耐久过低提前收起）·工具替换+耐久
//   itemUse 家族（使用物品）     → RefillManager（按使用后主手状态判断）·物品补充
// 管理员菜单：/ar:menu（GameDirectors 权限）在 Settings.ts / AdminMenu.ts。
//
// 冲突化解：工具切换/武器切换/耐久保护换主手后，连带触发的"使用"事件也被路由到
// RefillManager——它识别到主手既非 undefined 也非副作用残留，判定为
// "其他（切换已发生）"并忽略，从而不撤销 ToolManager 刚换上的物品。

import { system, world, type Entity } from "@minecraft/server";
import { PlayerPolicy } from "./PlayerPolicy";
import { createDefaultScorers, ToolSelector } from "./ToolScorer";
import { ToolManager } from "./ToolManager";
import { RefillManager } from "./RefillManager";
import { SettingsService } from "./Settings";
import { registerAdminMenu } from "./AdminMenu";
import { logger } from "./Logger";

// ── 组装服务 ──────────────────────────────────────────
const policy = new PlayerPolicy();
const settings = new SettingsService();
// 共享一份策略注册表：挖掘默认省耐久不择优（frugal），武器默认剑→斧→镐（weapon）
const scorers = createDefaultScorers();
const toolManager = new ToolManager(new ToolSelector(scorers, "frugal"), new ToolSelector(scorers, "weapon"), settings);
const refillManager = new RefillManager();

// 配置：世界加载后从动态属性恢复开关（DP 读取需世界就绪）；注册 /ar:menu
system.run(() => settings.load());
registerAdminMenu(settings);

// ── 事件 → 领域路由 ───────────────────────────────────

/**
 * 命中方块（挖掘开始、破坏前）→ 工具核对换入正确工具
 * after 事件、正常上下文：hitBlock 方块对象还在，可走标签层（含最低品质）。
 * entityTypes 过滤只收玩家的命中，无需给工具挂自定义组件（不动原版物品）。
 */
world.afterEvents.entityHitBlock.subscribe(
  (event) => {
    const player = policy.asPlayer(event.damagingEntity);
    if (!player) return;
    if (!settings.isEnabled("tool")) return; // 工具替换开关关 → 不处理
    logger.debug(`hitBlock ${player.name}: ${event.hitBlockPermutation.type.id}`);
    try {
      toolManager.onPlayerHitBlock(player, event.hitBlock);
    } catch (e) {
      logger.error(`tool manager failed ${player.name}: ${e}`);
    }
  },
  { entityTypes: ["minecraft:player"] }
);

/**
 * 攻击实体（击中其他实体）→ 武器切换 + 耐久保护
 * 武器切换：非武器主手换入武器（剑→斧→镐）；已持武器 / 锁定·自定义 / 背包无武器 → 不动。
 * 随后独立评估主手耐久：武器或工具低于阈值时提前替换同类（受 durability 开关约束）。
 * entityTypes 过滤只收玩家的攻击。
 */
world.afterEvents.entityHitEntity.subscribe(
  (event) => {
    const player = policy.asPlayer(event.damagingEntity);
    if (!player) return;
    if (settings.isEnabled("weapon")) {
      try {
        toolManager.onAttackEntity(player, event.hitEntity.typeId);
      } catch (e) {
        logger.error(`weapon switch failed ${player.name}: ${e}`);
      }
    }
    // 耐久保护独立于武器替换开关
    try {
      toolManager.checkDurability(player);
    } catch (e) {
      logger.error(`durability guard failed ${player.name}: ${e}`);
    }
  },
  { entityTypes: ["minecraft:player"] }
);

/**
 * "使用物品"事件路由：交给 RefillManager 按"使用后主手状态"判断是否补货。
 *   完全消耗（主手 undefined）→ 补同类；副作用残留 → 补 + 堆叠；
 *   其他（工具切换已换主手等）→ RefillManager 内部忽略。
 * @param typeId 被使用物品的类型
 * @param source 事件来源实体（玩家）
 */
function routeConsumption(typeId: string | undefined, source: Entity | undefined): void {
  if (!typeId) return;
  if (!settings.isEnabled("refill")) return; // 物品补充开关关 → 不处理
  const player = policy.asPlayer(source);
  if (!player) return;
  refillManager.onConsumed(player, typeId);
}

/** 物品使用完毕 — 食物/药水等消耗品用完；蓄力物放满（使用事件并不消耗工具） */
world.afterEvents.itemCompleteUse.subscribe((event) => routeConsumption(event.itemStack?.typeId, event.source));
/** 提前释放蓄力物品 — 弓/弩/三叉戟蓄力时提前松开 */
world.afterEvents.itemReleaseUse.subscribe((event) => routeConsumption(event.itemStack?.typeId, event.source));
/** 使用物品 — 放置方块/盾牌/钓鱼竿/打火石等 */
world.afterEvents.itemUse.subscribe((event) => routeConsumption(event.itemStack?.typeId, event.source));
/** 对方块使用物品 — 锄地/锹土/骨粉等（2.0.0 中替代已移除的 itemUseOn） */
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const usedType = event.beforeItemStack?.typeId ?? event.itemStack?.typeId;
  routeConsumption(usedType, event.player);
});

/**
 * 方块破碎 — 工具处理（工具替换域 + 耐久保护域）
 *   itemStackAfterBreak 为空（工具碎掉）→ 换入同类新工具（tool 开关约束）；
 *   工具未碎 → 评估耐久，低于阈值未碎也提前收起替换同类（durability 开关约束）。
 */
world.afterEvents.playerBreakBlock.subscribe((event) => {
  if (event.itemStackBeforeBreak === undefined) return;
  const player = policy.asPlayer(event.player);
  if (!player) return;
  // 工具替换域：破碎 → 补同类
  if (settings.isEnabled("tool") && event.itemStackAfterBreak === undefined) {
    try {
      toolManager.onToolBroke(player, event.itemStackBeforeBreak.typeId);
    } catch (e) {
      logger.error(`tool broke replace failed ${player.name}: ${e}`);
    }
  }
  // 耐久保护域（独立开关）：未碎但耐久过低 → 提前收起替换同类
  try {
    toolManager.checkDurability(player);
  } catch (e) {
    logger.error(`durability guard failed ${player.name}: ${e}`);
  }
});
