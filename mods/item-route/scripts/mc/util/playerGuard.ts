// ─── item-route 的玩家守卫绑定 ───────────────────────────────────────
//
// 共享库 `@mc-toolchain/mod-common` 只提供与 Player 类型无关的工厂（各模组钉的
// `@minecraft/server` 版本不同，`Player` 类型跨包不兼容）。本文件把**本模组**解析到的
// Player 类与 world 枚举绑进守卫，供全模组统一使用。
//
// 单独成文件（而非塞进 util/playerName.ts）的原因：`util/playerName.ts` 要能被
// `node --test` 直接加载，不能有 `@minecraft/server` 的顶层 import。
import { Player, world } from "@minecraft/server";
import { createWorldPlayerGuard } from "@mc-toolchain/mod-common";

/** item-route 全模组共用的玩家守卫（真人/假人/坏句柄判别 + 安全访问） */
export const playerGuard = createWorldPlayerGuard<Player>(
  (p) => p instanceof Player,
  () => world.getPlayers(),
);
