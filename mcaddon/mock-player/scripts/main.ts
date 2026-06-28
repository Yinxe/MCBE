// ─── MockPlayer 入口 ─────────────────────────────────
// 职责：启动命令注册 + 恢复持久化 + 启动行为引擎 + 事件监听

import { world, system } from "@minecraft/server";

import { registerAllCommands } from "./commands/index";
import { botRegistry, saveBotRecord, loadAllBotRecords } from "./features/persistence";
import { startTagBehaviors } from "./features/behavior";
import { onEntityDie, onPlayerSpawn, onPlayerJoin, onPlayerLeave } from "./features/events";

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
