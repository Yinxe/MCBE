// ─── 玩家名安全读取（读名三级兜底 + 安全在线枚举） ───
// `.name` bug 根因：`world.getAllPlayers()` 在某些时刻（模拟玩家进出/半初始化/异常玩家实体）
// 返回数组含 **undefined 项或字段不全**的 Player——裸 `.map(p => p.name)` 会 TypeError。
// mock-player 参考：位置玩家用官方 `world.getPlayers({ name })` 过滤查询，不裸枚举 `.name`；
// 且模拟玩家（SimulatedPlayer）的 `name`/`nameTag` 可能走实体层。统一取名字：
//   ① `Player.name`（真实玩家登录名，官方只读，最可靠）
//   ② `Player.playerName`（事件负载字段，个别上下文用）
//   ③ `Entity.nameTag`（模拟玩家/改名实体的显示名）
// 返回 string 或 undefined（三者皆非 string/空 → 视为不安全数据拒绝，调用方跳过）。
// 成员权限判定也统一经此取名：真实玩家与模拟玩家一律按可解析的名字匹配成员表。
import type { Player } from "@minecraft/server";

/** 可被取名的对象形状（真实 Player / SimulatedPlayer / 事件负载等） */
interface Nameable {
  name?: unknown;
  playerName?: unknown;
  nameTag?: unknown;
}

/** 玩家名三级兜底：name → playerName → nameTag（均需非空 string；否则 undefined=拒绝不安全数据）。
 * 每键逐次 try——半初始化实体属性访问可能抛错 → 视为拿不到名字，不向外抛。 */
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

/** 在线玩家枚举（名字安全版）：遍历 getAllPlayers，仅保留**取到可靠名字**的玩家名。
 * 用 playerNameOf 三级兜底 + try-catch → 半初始化/异常实体的项被拒，绝不让 `.map` 崩。 */
export function onlinePlayerNames(players: Iterable<Nameable | undefined | null>): string[] {
  const out: string[] = [];
  for (const p of players) {
    const name = playerNameOf(p);
    if (name !== undefined) out.push(name);
  }
  return out;
}

/** 安全枚举项：玩家对象 + 其**已解析**的名字（解析值，而不是裸 `p.name`——
 * 否则 name 兜底到 nameTag 的实体在后续代码读 `p.name` 仍是 undefined）。 */
export interface NamedPlayer {
  player: Player;
  name: string;
}

/**
 * 在线玩家安全枚举（真实 + 模拟玩家统一入口）：遍历 getAllPlayers，仅保留**取到可靠名字**的
 * 玩家，返回 { player, name }——name 已是解析结果，调用方成员权限/会话/HUD 一律用它，
 * 不再裸读 `p.name`。undefined/字段不全/半初始化的项被丢弃，杜绝 `.name` TypeError。
 */
export function namedPlayers(players: Iterable<Nameable | undefined | null>): NamedPlayer[] {
  const out: NamedPlayer[] = [];
  for (const p of players) {
    const name = playerNameOf(p);
    if (name === undefined) continue;
    out.push({ player: p as Player, name });
  }
  return out;
}