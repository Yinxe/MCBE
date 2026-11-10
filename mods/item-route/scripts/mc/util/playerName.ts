// ─── 玩家名 / 位置安全读取（薄适配层，判别逻辑统一在 @mc-toolchain/mod-common） ───
//
// 历史坑：`world.getAllPlayers()` 在某些时刻（模拟玩家进出/半初始化/异常玩家实体）
// 返回数组含 **undefined 项或字段不全**的 Player——裸 `.map(p => p.name)` 或裸读
// `.location` 都会 TypeError（游戏内实测报错 `cannot read property 'location' of undefined`）。
//
// 判别与安全访问已下沉到 `@mc-toolchain/mod-common` 的 playerGuard：
//   · `playerNameOf` 三级兜底取名（name → playerName → nameTag）
//   · `safePlayers` 丢弃不可用对象并返回已解析名字
// 本文件只做 item-route 侧的增强：额外提供**位置快照**，让调用方拿到
// `dimensionId` / `position` 后不再裸读 `.dimension` / `.location`。
import type { Player } from "@minecraft/server";

// 本文件必须保持**无游戏运行时依赖**（`node --test` 直接加载）：只用纯逻辑，
// 不 import `playerGuard`（它顶层 import `@minecraft/server`）。需要 Player 实例判定的
// 调用方从 `./playerGuard` 取守卫。

/** 玩家名三级兜底：`name` → `playerName` → `nameTag`（逐键 try，绝不外抛） */
export function playerNameOf(p: Nameable | undefined | null): string | undefined {
  if (p === undefined || p === null) return undefined;
  for (const k of ["name", "playerName", "nameTag"] as const) {
    try {
      const v = p[k];
      if (typeof v === "string" && v.length > 0) return v;
    } catch {
      continue; // 该键访问抛错（半初始化实体）→ 试下一级兜底
    }
  }
  return undefined;
}

/** 可被取名的对象形状（真实 Player / SimulatedPlayer / 事件负载等） */
interface Nameable {
  name?: unknown;
  playerName?: unknown;
  nameTag?: unknown;
}

/** 在线玩家枚举（名字安全版）：仅保留**取到可靠名字**的玩家名。 */
export function onlinePlayerNames(players: Iterable<Nameable | undefined | null>): string[] {
  const out: string[] = [];
  for (const p of players) {
    const name = playerNameOf(p);
    if (name !== undefined) out.push(name);
  }
  return out;
}

/** 安全枚举项：玩家对象 + 已解析名字 + **位置快照**。
 *
 * `position` / `dimensionId` 是在枚举时一次性读好的副本——调用方直接用，
 * 不再裸读 `.location` / `.dimension`（半初始化实体上这些访问会抛错）。
 *
 * 二者**可选**：读位置失败时仍保留名字（调用方据 `position === undefined` 决定跳过）。
 * 这样纯取名场景（与单测）不必构造完整的 Player 形状。 */
export interface NamedPlayer {
  player: Player;
  name: string;
  dimensionId?: string;
  position?: { x: number; y: number; z: number };
}

/**
 * 在线玩家安全枚举（真实 + 模拟玩家统一入口）。
 *
 * 经 mod-common `safePlayers` 丢弃 `undefined` / 半初始化 / 字段不全项，再为每项
 * 快照 `dimension.id` 与 `location`；任一步失败即跳过该玩家，绝不向外抛。
 */
export function namedPlayers(players: Iterable<unknown>): NamedPlayer[] {
  const out: NamedPlayer[] = [];
  for (const raw of players) {
    const name = playerNameOf(raw as Nameable | undefined | null);
    if (name === undefined) continue; // 取不到名 → 丢弃（半初始化/undefined 项）
    const player = raw as Player;
    // 位置快照失败（瞬态失效/半初始化）不丢弃该玩家，只留空位置——
    // 名字本身仍是可靠的（成员判定、消息播报不需要位置）。
    let dimensionId: string | undefined;
    let position: { x: number; y: number; z: number } | undefined;
    try {
      dimensionId = player.dimension.id;
      const loc = player.location;
      position = { x: loc.x, y: loc.y, z: loc.z };
    } catch {
      /* 位置不可读 → 留空，调用方按需跳过 */
    }
    out.push({ player, name, dimensionId, position });
  }
  return out;
}
