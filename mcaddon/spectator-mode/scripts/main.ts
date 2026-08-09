import { world } from "@minecraft/server";

// 旁观模式 — 项目骨架占位（暂无业务逻辑）
world.afterEvents.worldLoad.subscribe(() => {
  console.warn("[spectator-mode] loaded (scaffold placeholder)");
});
