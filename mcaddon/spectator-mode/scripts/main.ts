// ── 旁观模式入口 ──
// 事件 + 命令（Phase 3）+ 延迟启动（Phase 4：读取世界 DP 后再起 tick 循环）
import { system, world } from "@minecraft/server";
import { SoulController } from "./mc/controller";
import { registerAllCommands } from "./mc/commands";

const controller = new SoulController();

// 玩家加入：内部轮询到实体后 → 极限模式警告 / 恢复灵魂出窍会话 / 回归本体
world.afterEvents.playerJoin.subscribe(({ playerId }) => {
  controller.restoreOnJoin(playerId);
});

// 玩家离开：按 id 清理内存会话（锚点留玩家身上，供重连恢复）
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  controller.onPlayerLeave(playerId);
});

// 命令注册（Phase 3）
system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry, controller);
});

// 延迟启动：读配置 + 启动 tick 循环（Phase 4：世界完全加载后再触碰动态属性）
system.run(() => {
  controller.start();
});
