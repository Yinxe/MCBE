// ─── mockplayer3 入口（4-Phase 组合根） ────────────────────────────
// 只装配不实现。Phase1/3：startup 事件内注册测试维度与命令目录。
// Phase4：worldLoad 后 system.run 一拍装配——装置、对账、桥、时钟、调度器、通知。
import { system, world } from "@minecraft/server";
import { services, persistInventorySlot, persistEquipmentCheck, decideBotBlockClick } from "./Composition";
import { registerCommands } from "./interface/CmdKit";
import { ALL_COMMANDS } from "./interface/Commands";
import { installBridges } from "./engine/Bridges";
import { installNotify } from "./interface/Notify";
import { installClaimReport } from "./interface/ClaimReport";
import { onBotInteract, onTokenItemUse } from "./interface/Panels/Menu";
import { clock } from "./engine/Clock";
import { entityGateway } from "./engine/EntityGateway";
import { initTestField, registerTestDimension } from "./engine/Rig";
import { projectileTracker } from "./engine/ProjectileTracker";
import { tickingAreas } from "./engine/TickingAreas";
import { toolGuard } from "./engine/ToolGuard";

system.beforeEvents.startup.subscribe((event) => {
  registerTestDimension(event);
  registerCommands(event.customCommandRegistry, ALL_COMMANDS);
});

/** 装配只跑一次（worldLoad 与兜底双路径，不赌幂等） */
let booted = false;

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const rigReady = await initTestField();
  // 旧档迁移须在启动对账前：迁出记录以 v2 身份参与对账，迁入配置经 loadConfig 生效
  if (services.migrator.hasLegacyData()) {
    const rep = services.migrator.run();
    console.warn(
      rep.aborted
        ? `[mockplayer3] 旧档迁移中止: ${rep.aborted}`
        : `[mockplayer3] 旧档迁移: 检出 ${rep.found} 迁入 ${rep.migrated.length} 跳过 ${rep.skipped.length} 失败 ${rep.failures.length}` +
            ` 物品 ${rep.itemSlots.migrated} 格(弃 ${rep.itemSlots.dropped}) 清扫 ${rep.sweptItemKeys} 配置${rep.configMigrated ? "已迁入" : "无"}`
    );
    for (const f of rep.failures) console.warn(`[mockplayer3] 迁移失败 ${f.legacyName}: ${f.error}`);
    for (const n of rep.configNotices) console.warn(`[mockplayer3] 配置迁移报备: ${n}`);
    if (services.recordStore.loadConfig().debugLog) {
      for (const m of rep.migrated) for (const n of m.notices) console.warn(`[mockplayer3] 迁移报备 ${m.name}: ${n}`);
    }
  } else {
    console.info(
      `[mockplayer3] 旧档迁移检测：本包命名空间内无 mockplayer: 旧键（不执行；命名空间键总数 ${
        world.getDynamicPropertyIds().length
      }）`
    );
  }
  services.lifecycle.startupReconcile();
  // 清扫孤儿常加载区域：离线假人不需要区域，上线时重建
  tickingAreas.cleanupOrphans(services.runtime.liveAreaNames());
  installBridges({
    onEntityDie: (entityId, entityName) => services.lifecycle.handleDeath(entityId, entityName),
    onPlayerSpawn: (entityId, playerName, initialSpawn) =>
      services.lifecycle.handleSpawn(entityId, playerName, initialSpawn),
    onPlayerLeave: (playerName, playerId) => services.lifecycle.handleLeave(playerName, playerId),
    onPlayerJoin: (playerName) => services.lifecycle.handleJoin(playerName),
    onProjectileSpawn: (entityId) => {
      const entity = entityGateway.rawEntity(entityId);
      if (entity) projectileTracker.onProjectileSpawn(entity);
    },
    onProjectileLoad: (entityId) => {
      const entity = entityGateway.rawEntity(entityId);
      if (entity) projectileTracker.onProjectileLoad(entity);
    },
    onBotInventoryChanged: (botName, slot, item) => {
      const botId = entityGateway.botIdOfName(botName);
      if (botId === undefined) return;
      toolGuard.onInventoryChanged(botId, slot);
      persistInventorySlot(botId, slot);
      services.events.emit("botSlotChanged", { botId, name: botName, slot, item });
    },
    onBotHurt: (botName) => {
      // 受伤即装备五槽复查：护甲吸收也耗耐久
      const botId = entityGateway.botIdOfName(botName);
      if (botId === undefined) return;
      persistEquipmentCheck(botId);
    },
    onBotEffectAdded: (botName, typeId, amplifier) => {
      const botId = entityGateway.botIdOfName(botName);
      if (botId === undefined) return;
      services.events.emit("botEffectAdded", { botId, name: botName, typeId, amplifier });
    },
    // 信物右键 / 长按假人：真人限定与 cancel 在桥内，菜单分流归 interface
    onRealPlayerItemUse: (playerName, itemTypeId) => onTokenItemUse(playerName, itemTypeId),
    onBotInteract: (viewerName, botName) => onBotInteract(viewerName, botName),
    // 误点拦截：判定同步给结论，策略与状态在 Composition，桥只执行 cancel
    onBotBlockClick: decideBotBlockClick,
  });
  clock.start();
  installNotify();
  installClaimReport();
  services.scheduler.start();
  if (services.runtime.config.debugLog) {
    console.info(`[mockplayer3] 装配完成：装置=${rigReady} 记录=${services.runtime.records.size}`);
  }
}

// Phase4：worldLoad 之后再 system.run 一拍装配——事件回调内不碰世界读写，
// 装置/物品仓/寻路从这一拍起才成立。
world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => {
    void boot().catch((e: any) => console.error(`[mockplayer3] 装配异常: ${e?.message ?? e}`));
  });
});

// 兜底：脚本在已运行的世界中加载时 worldLoad 不再触发，最迟 10s 后照常装配。
system.runTimeout(() => {
  if (booted) return;
  console.warn("[mockplayer3] worldLoad 未触达（脚本在已运行世界中加载），兜底装配");
  system.run(() => {
    void boot().catch((e: any) => console.error(`[mockplayer3] 装配异常: ${e?.message ?? e}`));
  });
}, 200);
