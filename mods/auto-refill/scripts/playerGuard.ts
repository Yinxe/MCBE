// ─── auto-refill 的玩家守卫绑定 ─────────────────────────────────────
//
// 共享库 `@mc-toolchain/mod-common` 只提供与 Player 类型无关的工厂（各模组钉的
// `@minecraft/server` 版本不同，`Player` 类型跨包不兼容）。本文件把**本模组**解析到的
// Player 类与 world 枚举绑进守卫。
//
// 假人判据为 `getGameMode()` 抛错/缺失/返回 undefined——跨任意假人模组成立，
// 不依赖 tag（第三方假人模组不保证打 `mockplayer:tag:bot`）。
import { Player, world } from "@minecraft/server";
import { createWorldPlayerGuard } from "@mc-toolchain/mod-common";

/** auto-refill 全模组共用的玩家守卫（真人/假人/坏句柄判别 + 安全访问） */
export const playerGuard = createWorldPlayerGuard<Player>(
  (p) => p instanceof Player,
  () => world.getPlayers(),
);
