// ─── 玩家对象守卫（共享库侧绑定） ─────────────────────────────────────
//
// 判别与安全访问的实现在 `playerGuardCore.ts`（纯核，可单测）。
//
// ⚠️ 为什么不在这里直接 `import { Player, world }`：
// 本仓各模组钉的 `@minecraft/server` 版本不同（teleporter 2.3.0 / item-route 2.1.0 /
// mockplayer3 2.8.0 / 根 devDependency 2.0.0），npm workspace 会让每个包解析到**自己**
// 的那份声明，`Player` 类型跨包不兼容。若共享库在返回值里泄漏自己的 `Player`，
// 模组侧会报 "Type 'Player' is missing the following properties from type 'Player'"。
//
// 因此共享库只提供**与 Player 类型无关**的工厂：模组在自己的代码里调用
// `createWorldPlayerGuard(p => p instanceof Player, () => world.getPlayers())`，
// 拿到绑好自己 Player 类型的守卫集。这样版本漂移不会再引发跨包类型冲突。
import { createPlayerGuard, createWorldPlayerGuard } from "./playerGuardCore";

export { createPlayerGuard, createWorldPlayerGuard };
export type {
  GuardedPlayer,
  InstanceCheck,
  NamedPlayer,
  PlayerGuard,
} from "./playerGuardCore";
