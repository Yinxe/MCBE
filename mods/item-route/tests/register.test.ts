// ─── 命令注册封装回归测试（mc/commands/register + mc/auth/admin） ──────
// 这两处是本次迁移中**唯一被重写**的代码（上游 `@yinxe/toolkit` 的 defineCommand
// 与模组内 canManage 的替代实现），迁移前无任何测试覆盖。
//
// 测试策略：`register.ts` 依赖 `@minecraft/server`（仅类型声明、无 JS 入口）与
// `@mc-toolchain/mod-common`（TS 源，node 无法直接 require），因此用 `Module._load`
// 钩子在运行时替换这两个模块：
//   · `@minecraft/server` → 提供 `Player` 类（供 `instanceof` 判定）与枚举常量
//   · `@mc-toolchain/mod-common` → `runSafeDetached` 换成可控的桩，
//     既能断言"回调被推迟而不是同步执行"，也能手动 flush 后验证 handler 入参
// 桩替代的正是待验证的边界，因此不掩盖被测算逻辑。
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// ─── 运行时模块桩 ──────────────────────────────────────────────
/** 桩 Player 类：`instanceof` 判定用它 */
class FakePlayer {
  name: string;
  playerPermissionLevel: number;
  constructor(name: string, level = 1) {
    this.name = name;
    this.playerPermissionLevel = level;
  }
}

const serverStub = {
  Player: FakePlayer,
  // 与 @minecraft/server 2.1.0 的实际取值一致（index.d.ts:304-307 / 2268-2290）
  CustomCommandStatus: { Success: 0, Failure: 1 },
  PlayerPermissionLevel: { Visitor: 0, Member: 1, Operator: 2 },
};

/** runSafeDetached 桩：记录调用，不立即执行回调 */
const deferredCalls: Array<{ fn: () => void; onError?: (error: unknown) => void }> = [];
const modCommonStub = {
  runSafeDetached: (fn: () => void, onError?: (error: unknown) => void): void => {
    deferredCalls.push({ fn, onError });
  },
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
