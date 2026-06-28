// ─── MockPlayer 入口 ─────────────────────────────────
// 职责：启动命令注册 + 恢复持久化 + 启动行为引擎 + 事件监听 + 玩家交互

import { world, system, Player, ItemUseAfterEvent, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";

import { registerAllCommands } from "./commands/index";
import { botRegistry, saveBotRecord, loadAllBotRecords } from "./features/persistence";
import { startTagBehaviors } from "./features/behavior";
import { onEntityDie, onPlayerSpawn, onPlayerJoin, onPlayerLeave } from "./features/events";
import { TAG_BOT } from "./features/tags";
import { showMainMenu, showOperationPanel } from "./ui/menu";
import { showTagManagement } from "./ui/tags";

// ─── 命令注册 ──────────────────────────────────────────

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
});

// ─── 世界加载：恢复持久化数据 + 启动行为引擎 ──────────

world.afterEvents.worldLoad.subscribe(() => {
  const loaded = loadAllBotRecords();
  for (const record of loaded) {
    record.online = false;
    record.death = false;
    record.entityId = undefined;
    botRegistry.set(record.name, record);
    saveBotRecord(record);
  }
  console.warn(`[MockPlayer] 从持久化恢复 ${botRegistry.size} 个模拟玩家记录`);

  startTagBehaviors();
});

// ─── 事件监听 ──────────────────────────────────────────

world.afterEvents.entityDie.subscribe(onEntityDie);
world.afterEvents.playerSpawn.subscribe(onPlayerSpawn);
world.afterEvents.playerJoin.subscribe(onPlayerJoin);
world.afterEvents.playerLeave.subscribe(onPlayerLeave);

// ─── 玩家交互 ──────────────────────────────────────────

/** 木棍使用 → 打开主菜单 */
world.afterEvents.itemUse.subscribe((event: ItemUseAfterEvent) => {
  const item = event.itemStack;
  if (!item || item.typeId !== "minecraft:stick") return;
  showMainMenu(event.source);
});

/** 空手右击/长按假人 → 取消默认交互并打开面板 */
world.beforeEvents.playerInteractWithEntity.subscribe((event: PlayerInteractWithEntityBeforeEvent) => {
  const { player, target, itemStack } = event;

  // 不是模拟玩家则不处理
  if (!target.hasTag(TAG_BOT.value)) return;

  // 手上有非空物品则不处理
  if (itemStack && itemStack.typeId !== "minecraft:air") return;

  // 取消默认交互行为
  event.cancel = true;

  // before 回调在 restricted mode，需要 system.run 延迟执行
  system.run(() => {
    if (player.isSneaking) {
      showTagManagement(player, (target as Player).name);
    } else {
      showOperationPanel(player, (target as Player).name);
    }
  });
});
