// ── 组合根:装配服务、路由世界事件、注册命令 ──
import { system, world } from "@minecraft/server";
import { SoulController } from "./mc/controller";
import { registerAllCommands } from "./mc/commands";

const controller = new SoulController();

// 玩家加入:恢复灵魂出窍(加入早期实体可能未就绪,控制器内部轮询重试)
world.afterEvents.playerJoin.subscribe((event) => {
  controller.restoreOnJoin(event.playerId);
});

// 玩家离开:清理内存会话(锚点留在玩家身上,供重连恢复)
world.afterEvents.playerLeave.subscribe((event) => {
  controller.onPlayerLeave(event.playerId);
});

// 启动早期:注册自定义命令(必须在此阶段,之后注册会抛错)
system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry, controller);
});

// 世界就绪后再读世界动态属性并启动 tick 循环
system.run(() => {
  controller.start();
});
