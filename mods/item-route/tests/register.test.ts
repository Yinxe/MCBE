// ─── 命令注册封装回归测试（mc/commands/register + mc/auth/admin） ──────
// 这两处是本次迁移中**唯一被重写**的代码（上游 `@yinxe/toolkit` 的 defineCommand
// 与模组内 canManage 的替代实现），迁移前无任何测试覆盖。
//
// 测试策略：`register.ts` 依赖 `@minecraft/server`（仅类型声明、无 JS 入口）与
// `@mc-toolchain/mod-common`（TS 源，node 无法直接 require），因此用 `Module._load`
// 钩子在运行时替换这两个模块：
//   · `@minecraft/server` → 提供 `Player` 类（供 `instanceof` 判定）、`world` 桩与枚举常量
//   · `@mc-toolchain/mod-common` → `runSafeDetached` 换成可控的桩，
//     `createWorldPlayerGuard` 换成**语义等价的最小桩**（见下方 `stubGuard`），
//     既能断言“回调被推迟而不是同步执行”，也能验证假人/坏句柄分支确实被拦住
// 桩替代的正是待验证的边界，因此不掩盖被测算逻辑。
//
// 为什么不直接 import 真实守卫实现：守卫纯核在 `packages/mod-common/src/`，
// 跨包引入会越出本模组测试的 `rootDir`（TS6059）。守卫**自身**的语义已由
// `packages/mod-common/tests/player-guard.test.ts`（19 条）覆盖；本文件只验证
// `register.ts` 有没有正确**使用**守卫，因此桩只需与真实实现的关键判据一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// ─── 运行时模块桩 ──────────────────────────────────────────────
/** 桩 Player 类：`instanceof` 判定用它。
 *
 * 默认带齐守卫要求的 `id` / `dimension` / `location` 与可用的 `getGameMode()`，
 * 即“真人玩家”；构造时传 `simulated: true` 则让 `getGameMode()` 抛错，
 * 复刻假人在游戏里的真实表现。
 */
class FakePlayer {
  name: string;
  playerPermissionLevel: number;
  id: string;
  dimension: { id: string };
  location: { x: number; y: number; z: number };
  private readonly simulated: boolean;

  constructor(name: string, level = 1, options?: { simulated?: boolean; broken?: boolean }) {
    this.name = name;
    this.playerPermissionLevel = level;
    this.id = `id-${name}`;
    this.dimension = { id: "minecraft:overworld" };
    this.location = { x: 0, y: 64, z: 0 };
    this.simulated = options?.simulated === true;
    if (options?.broken === true) {
      // 半初始化实体：访问 `location` 即抛错
      Object.defineProperty(this, "location", {
        get() {
          throw new TypeError("cannot read property 'location' of undefined");
        },
      });
    }
  }

  getGameMode(): string {
    if (this.simulated) throw new Error("模拟玩家不支持 getGameMode");
    return "survival";
  }
}

const serverStub = {
  Player: FakePlayer,
  world: { getPlayers: (): unknown[] => [] },
  // 与 @minecraft/server 2.1.0 的实际取值一致（index.d.ts:304-307 / 2268-2290）
  CustomCommandStatus: { Success: 0, Failure: 1 },
  PlayerPermissionLevel: { Visitor: 0, Member: 1, Operator: 2 },
};

/** runSafeDetached 桩：记录调用，不立即执行回调 */
const deferredCalls: Array<{ fn: () => void; onError?: (error: unknown) => void }> = [];

/**
 * 与 mod-common `createPlayerGuard` 关键判据等价的最小桩。
 *
 * - `isUsablePlayer`：实例判定 + `id`/`dimension`/`location` 可读（半初始化实体访问即抛错）；
 * - `isSimulatedPlayer`：`getGameMode()` 抛错/缺失/返回 undefined；
 * - `playerNameOf`：`name` → `playerName` → `nameTag` 逐键 try 兜底。
 */
function stubGuard(isInstance: (p: unknown) => boolean): {
  isUsablePlayer(p: unknown): boolean;
  isSimulatedPlayer(p: unknown): boolean;
  playerNameOf(p: unknown): string | undefined;
  safePlayerCall<T>(p: unknown, fn: (player: never) => T): T | undefined;
} {
  const isUsablePlayer = (p: unknown): boolean => {
    if (p === undefined || p === null || !isInstance(p)) return false;
    try {
      const c = p as { id?: unknown; dimension?: unknown; location?: unknown };
      return typeof c.id === "string" && c.id.length > 0 && c.dimension !== undefined && c.location !== undefined;
    } catch {
      return false;
    }
  };
  const isSimulatedPlayer = (p: unknown): boolean => {
    if (!isUsablePlayer(p)) return false;
    try {
      const gm = (p as { getGameMode?: () => unknown }).getGameMode;
      if (typeof gm !== "function") return true;
      return (p as { getGameMode: () => unknown }).getGameMode() === undefined;
    } catch {
      return true;
    }
  };
  const playerNameOf = (p: unknown): string | undefined => {
    if (p === undefined || p === null) return undefined;
    const c = p as Record<string, unknown>;
    for (const key of ["name", "playerName", "nameTag"] as const) {
      try {
        const v = c[key];
        if (typeof v === "string" && v.length > 0) return v;
      } catch {
        continue;
      }
    }
    return undefined;
  };
  const safePlayerCall = <T>(p: unknown, fn: (player: never) => T): T | undefined => {
    if (!isUsablePlayer(p)) return undefined;
    try {
      return fn(p as never);
    } catch {
      return undefined;
    }
  };
  return { isUsablePlayer, isSimulatedPlayer, playerNameOf, safePlayerCall };
}

const modCommonStub = {
  runSafeDetached: (fn: () => void, onError?: (error: unknown) => void): void => {
    deferredCalls.push({ fn, onError });
  },
  createWorldPlayerGuard: (isInstance: (p: unknown) => boolean) => stubGuard(isInstance),
};

const moduleLoad = (Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown })
  ._load;
(Module as unknown as { _load: unknown })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  if (request === "@minecraft/server") return serverStub;
  if (request === "@mc-toolchain/mod-common") return modCommonStub;
  return moduleLoad.call(this as unknown, request, parent, isMain);
};

// 桩就位后再加载被测模块（CJS 在 require 时读取依赖）
import { registerPlayerCommand } from "../scripts/mc/commands/register";
import { canManage } from "../scripts/mc/auth/admin";
import type { CustomCommandOrigin, CustomCommandRegistry } from "@minecraft/server";

// ─── 测试辅助 ──────────────────────────────────────────────────
/** 捕获注册进 registry 的原生回调 */
interface Registration {
  config: unknown;
  callback: (origin: CustomCommandOrigin, ...args: unknown[]) => { status: number; message?: string };
}

function makeRegistry(): { registry: CustomCommandRegistry; registrations: Registration[] } {
  const registrations: Registration[] = [];
  const registry = {
    registerCommand: (config: unknown, callback: Registration["callback"]): void => {
      registrations.push({ config, callback });
    },
  } as unknown as CustomCommandRegistry;
  return { registry, registrations };
}

function playerOrigin(player: FakePlayer): CustomCommandOrigin {
  return { sourceEntity: player } as unknown as CustomCommandOrigin;
}

function resetDeferred(): void {
  deferredCalls.length = 0;
}

// ─── registerPlayerCommand ─────────────────────────────────────
test("registerPlayerCommand: 注册时原样透传 config 给 registry", () => {
  const { registry, registrations } = makeRegistry();
  const config = {
    name: "ir:test",
    description: "测试命令",
    cheatsRequired: false,
    permissionLevel: 0,
  };
  registerPlayerCommand(registry, config as never, () => {});
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0]?.config, config);
});

test("registerPlayerCommand: 非玩家来源 → 返回 Failure 且不推迟、不执行 handler", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  let handlerCalls = 0;
  registerPlayerCommand(registry, { name: "ir:t" } as never, () => {
    handlerCalls += 1;
  });

  // sourceEntity 与 initiator 都不是 Player（如命令方块 / 服务器控制台）
  const result = registrations[0]?.callback({} as unknown as CustomCommandOrigin);
  assert.equal(result?.status, serverStub.CustomCommandStatus.Failure);
  assert.equal(result?.message, "该命令只能由玩家执行");
  assert.equal(deferredCalls.length, 0, "非玩家来源不得推迟回调");
  assert.equal(handlerCalls, 0);
});

test("registerPlayerCommand: 玩家来源 → 返回 Success，handler 被推迟而非同步执行", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  const calls: string[] = [];
  registerPlayerCommand(registry, { name: "ir:t" } as never, () => {
    calls.push("handler");
  });

  const result = registrations[0]?.callback(playerOrigin(player));
  assert.equal(result?.status, serverStub.CustomCommandStatus.Success);
  // 关键：回调必须推迟到安全上下文——命令回调本身运行在只读上下文
  assert.equal(deferredCalls.length, 1, "必须经 runSafeDetached 推迟一次");
  assert.deepEqual(calls, [], "handler 不得在命令回调内同步执行");

  // 手动 flush，模拟安全上下文执行
  deferredCalls[0]?.fn();
  assert.deepEqual(calls, ["handler"]);
});

test("registerPlayerCommand: sourceEntity 缺失时回退到 initiator", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Steve");
  let seen: unknown;
  registerPlayerCommand(registry, { name: "ir:t" } as never, (ctx) => {
    seen = ctx.player;
  });

  const origin = { initiator: player } as unknown as CustomCommandOrigin;
  const result = registrations[0]?.callback(origin);
  assert.equal(result?.status, serverStub.CustomCommandStatus.Success);
  deferredCalls[0]?.fn();
  assert.equal(seen, player, "应从 origin.initiator 取到玩家");
});

test("registerPlayerCommand: sourceEntity 优先于 initiator", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const source = new FakePlayer("Source");
  const initiator = new FakePlayer("Initiator");
  let seen: unknown;
  registerPlayerCommand(registry, { name: "ir:t" } as never, (ctx) => {
    seen = ctx.player;
  });

  registrations[0]?.callback({ sourceEntity: source, initiator } as unknown as CustomCommandOrigin);
  deferredCalls[0]?.fn();
  assert.equal(seen, source, "sourceEntity 存在时不得使用 initiator");
});

test("registerPlayerCommand: 按 mandatory + optional 的 name 顺序解包参数", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seen: Record<string, unknown> | undefined;
  registerPlayerCommand(registry, {
    name: "ir:t",
    mandatoryParameters: [
      { name: "warehouse", type: 0 },
      { name: "amount", type: 1 },
    ],
    optionalParameters: [{ name: "mode", type: 0 }],
  } as never, (ctx) => {
    seen = ctx.params;
  });

  registrations[0]?.callback(playerOrigin(player), "主仓库", 42, "fast");
  deferredCalls[0]?.fn();
  assert.deepEqual(seen, { warehouse: "主仓库", amount: 42, mode: "fast" });
});

test("registerPlayerCommand: 可选参数省略时该键不出现（不写入 undefined）", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seen: Record<string, unknown> | undefined;
  registerPlayerCommand(registry, {
    name: "ir:t",
    mandatoryParameters: [{ name: "warehouse", type: 0 }],
    optionalParameters: [{ name: "mode", type: 0 }],
  } as never, (ctx) => {
    seen = ctx.params;
  });

  registrations[0]?.callback(playerOrigin(player), "主仓库");
  deferredCalls[0]?.fn();
  assert.deepEqual(seen, { warehouse: "主仓库" });
  assert.equal(Object.prototype.hasOwnProperty.call(seen, "mode"), false);
});

test("registerPlayerCommand: 超出声明参数个数的多余实参被忽略", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seen: Record<string, unknown> | undefined;
  registerPlayerCommand(registry, {
    name: "ir:t",
    mandatoryParameters: [{ name: "only", type: 0 }],
  } as never, (ctx) => {
    seen = ctx.params;
  });

  registrations[0]?.callback(playerOrigin(player), "a", "b", "c");
  deferredCalls[0]?.fn();
  assert.deepEqual(seen, { only: "a" });
});

test("registerPlayerCommand: 无参数命令 → params 为空对象", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seen: Record<string, unknown> | undefined;
  registerPlayerCommand(registry, { name: "ir:help" } as never, (ctx) => {
    seen = ctx.params;
  });

  registrations[0]?.callback(playerOrigin(player));
  deferredCalls[0]?.fn();
  assert.deepEqual(seen, {});
});

test("registerPlayerCommand: origin 原样传给 handler", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seen: unknown;
  registerPlayerCommand(registry, { name: "ir:t" } as never, (ctx) => {
    seen = ctx.origin;
  });

  const origin = playerOrigin(player);
  registrations[0]?.callback(origin);
  deferredCalls[0]?.fn();
  assert.equal(seen, origin);
});

test("registerPlayerCommand: 返回值语义与上游 defineCommand 一致（Success=0 / Failure=1）", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  registerPlayerCommand(registry, { name: "ir:t" } as never, () => {});

  const ok = registrations[0]?.callback(playerOrigin(player));
  assert.equal(ok?.status, 0);
  const fail = registrations[0]?.callback({} as unknown as CustomCommandOrigin);
  assert.equal(fail?.status, 1);
});

// ─── canManage ────────────────────────────────────────────────
test("canManage: 权限级别 >= Operator 才算管理员", () => {
  assert.equal(canManage(new FakePlayer("op", 2) as never), true);
  assert.equal(canManage(new FakePlayer("member", 1) as never), false);
  assert.equal(canManage(new FakePlayer("visitor", 0) as never), false);
});

test("canManage: 不因 op 标签放行（避免玩家自助提权）", () => {
  const tagged = new FakePlayer("tagged", 1);
  (tagged as unknown as { getTags: () => string[] }).getTags = () => ["op"];
  assert.equal(canManage(tagged as never), false);
});

test("canManage: 假人即使是 Operator 级别也返回 false", () => {
  // 假人不实现 getGameMode（抛错），不能当管理员——否则假人可被用来提权操作仓库
  assert.equal(canManage(new FakePlayer("bot", 2, { simulated: true }) as never), false);
});

test("canManage: 权限字段读取抛错的半初始化实体返回 false", () => {
  const broken = new FakePlayer("broken", 2);
  Object.defineProperty(broken, "playerPermissionLevel", {
    get() {
      throw new TypeError("半初始化实体");
    },
  });
  assert.equal(canManage(broken as never), false);
});

// ─── 假人 / 坏句柄守卫（游戏实测报错回归） ─────────────────────────────
// 实测背景：所有模组同时加载后召唤模拟玩家，报
// `TypeError: cannot read property 'location' of undefined`；
// 根因是命令回调推迟到下一 tick 后句柄可能已失效，而 handler 裸读了玩家属性。

test("registerPlayerCommand: 模拟玩家来源 → 不推迟、不执行 handler", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const fake = new FakePlayer("Bot", 1, { simulated: true });
  let handlerCalls = 0;
  registerPlayerCommand(registry, { name: "ir:t" } as never, () => {
    handlerCalls += 1;
  });

  const result = registrations[0]?.callback(playerOrigin(fake));
  assert.equal(result?.status, serverStub.CustomCommandStatus.Failure, "假人执行命令必须返回失败");
  assert.equal(deferredCalls.length, 0, "假人不得触发推迟回调");
  assert.equal(handlerCalls, 0);
});

test("registerPlayerCommand: 推迟期间句柄失效 → flush 后静默跳过，不抛错", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const broken = new FakePlayer("Ghost", 1, { broken: true });
  let handlerCalls = 0;
  registerPlayerCommand(registry, { name: "ir:t" } as never, () => {
    handlerCalls += 1;
  });

  // 注册时句柄还可读（守卫放行），推迟后才失效——复刻真实时序
  const result = registrations[0]?.callback(playerOrigin(broken));
  assert.equal(result?.status, serverStub.CustomCommandStatus.Success);
  assert.equal(deferredCalls.length, 1);
  assert.doesNotThrow(() => deferredCalls[0]?.fn(), "推迟回调内部不得向外抛错");
  assert.equal(handlerCalls, 0, "失效句柄不得进入 handler");
});

test("registerPlayerCommand: handler 收到的 playerName 已解析（不裸读 .name）", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("Alex");
  let seenName: string | undefined;
  registerPlayerCommand(registry, { name: "ir:t" } as never, (ctx) => {
    seenName = ctx.playerName;
  });

  registrations[0]?.callback(playerOrigin(player));
  deferredCalls[0]?.fn();
  assert.equal(seenName, "Alex");
});

test("registerPlayerCommand: .name 抛错时 playerName 回退到 nameTag", () => {
  resetDeferred();
  const { registry, registrations } = makeRegistry();
  const player = new FakePlayer("x");
  Object.defineProperty(player, "name", {
    get() {
      throw new TypeError("半初始化实体");
    },
  });
  (player as unknown as { nameTag: string }).nameTag = "FallbackName";
  let seenName: string | undefined;
  registerPlayerCommand(registry, { name: "ir:t" } as never, (ctx) => {
    seenName = ctx.playerName;
  });

  registrations[0]?.callback(playerOrigin(player));
  deferredCalls[0]?.fn();
  assert.equal(seenName, "FallbackName");
});
