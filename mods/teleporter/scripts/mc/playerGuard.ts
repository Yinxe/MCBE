// ─── teleporter 的玩家守卫绑定 ──────────────────────────────────────
//
// 共享库 `@mc-toolchain/mod-common` 只提供与 Player 类型无关的工厂（各模组钉的
// `@minecraft/server` 版本不同，`Player` 类型跨包不兼容）。本文件把**本模组**解析到的
// Player 类与 world 枚举绑进守卫。
//
// 假人报错背景（游戏内实测）：模拟玩家召唤也触发 `playerSpawn`，且 `event.player`
// 可能是半初始化/坏句柄——`getComponent` of undefined 即由此而来。
import { Player, world } from "@minecraft/server";
import { createWorldPlayerGuard } from "@mc-toolchain/mod-common";

/** teleporter 全模组共用的玩家守卫（真人/假人/坏句柄判别 + 安全访问） */
export const playerGuard = createWorldPlayerGuard<Player>(
  (p) => p instanceof Player,
  () => world.getPlayers(),
);
