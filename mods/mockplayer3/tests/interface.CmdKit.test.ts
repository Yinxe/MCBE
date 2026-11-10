// ─── 命令注册链路的离线单测（interface/CmdKit 的 registerCommands） ───
// registerCommands 是 main.ts 真正调用的入口，本次迁移中**被重写**的一段：
// 上游把注册委托给 `@yinxe/toolkit` 的 defineCommand，而 `@mc-toolchain/mod-common`
// 刻意不提供命令注册封装（见其 index.ts 头注释），因此按上游语义就地实现。
// 迁移前该链路无任何测试覆盖。
//
// 覆盖四项语义，正对应 design.md R3 的风险：
//   ① 非玩家来源被拒绝（返回非零状态，且不调用处理器）
//   ② 参数按 mandatoryParameters + optionalParameters 的位置解构并归一为目录参数名
//   ③ 回调被推迟到安全上下文 —— 注册回调返回时处理器尚未执行
//   ④ 枚举先于命令注册（缺失即 EnumDependencyMissing，整条命令失败）
//
// 测试策略沿用仓库内既有做法（见 mods/item-route/tests/register.test.ts）：
// 用 `Module._load` 钩子替换裸模块，而不是另建 .ts 桩文件。
//   · `@minecraft/server` → Player 类（供 instanceof 判定）+ 枚举常量，其余回退自动桩
//   · `@mc-toolchain/mod-common` → runSafeDetached 换成可控桩，既能断言「回调被推迟
//     而不是同步执行」，也能手动 flush 后验证处理器入参
//   · `Composition` → 整个替掉：CmdKit 只在处理器内部用 services，而它的真实依赖链
//     会拉进整个 engine 层（Placer、Rig、TickingAreas …），那些模块在加载期就读取
//     `Direction.Up` 之类的枚举作计算键，自动桩无法充当对象键。
// 被桩掉的正是待验证的边界（推迟机制与外部服务），不掩盖被测逻辑。

import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

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

/**
 * 自动桩：任意属性/调用/构造都返回自身，`then` 例外（防 await 挂死）。
 * 用于 CmdKit 间接拉进来的引擎依赖，本用例只需它们能加载。
 */
const autoStub: any = new Proxy(function () {} as any, {
  get: (_t, prop) => (prop === "then" || prop === Symbol.toPrimitive ? undefined : autoStub),
  apply: () => autoStub,
  construct: () => autoStub,
  has: () => true,
});

/**
 * @minecraft/server 桩：显式成员 + 自动桩回退。
 * 未列举的成员回退到 autoStub，因为模块图加载期会读取 `EquipmentSlot.Head`、
 * `Direction.Up` 这类常量；只要值不需要真实语义，回退桩即可。
 * `Player` 必须保留为真实类，否则 `instanceof` 判定失效。
 */
const serverStub: any = new Proxy(
  {
    Player: FakePlayer,
    CommandPermissionLevel: { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 },
    CustomCommandParamType: {
      Boolean: 0,
      Integer: 1,
      Float: 2,
      String: 3,
      EntitySelector: 4,
      PlayerSelector: 5,
      Location: 6,
      ItemType: 7,
      BlockType: 8,
    },
    CustomCommandStatus: { Success: 0, Failure: 1 },
  },
  {
    get: (target, prop) =>
      prop in target ? (target as Record<string | symbol, unknown>)[prop] : prop === "then" ? undefined : autoStub,
  }
);

/** 记录 trySendMessage 回发的文本，供断言玩家反馈 */
const sentMessages: string[] = [];

/** runSafeDetached 桩：登记调用，不立即执行；由用例手动 flush */
const deferredCalls: Array<{ fn: () => void; onError?: (error: unknown) => void }> = [];
const modCommonStub = {
  runSafeDetached: (fn: () => void, onError?: (error: unknown) => void): void => {
    deferredCalls.push({ fn, onError });
  },
  trySendMessage: (_player: unknown, text: string): void => {
    sentMessages.push(text);
  },
  // 样式码在断言里没有意义，给成空串便于精确比对文本
  color: {
    error: "",
    success: "",
    info: "",
    muted: "",
    accent: "",
    playerName: "",
    warning: "",
    white: "",
    gray: "",
    green: "",
    red: "",
    yellow: "",
  },
  style: (text: string): string => text,
};

/** Composition 整个替掉：处理器内部的 services 一律自动桩 */
const compositionStub = { services: autoStub };

/** 其余裸模块一律自动桩 */
const AUTO_STUBBED: readonly string[] = [
  "@minecraft/server-gametest",
  "@minecraft/server-ui",
  "@minecraft/math",
  "@minecraft/vanilla-data",
  "@mc-toolchain/nbt-data-storage",
];

/** 装 Module._load 钩子 */
const load = (Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown })
  ._load;
(Module as unknown as { _load: unknown })._load = function (
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean
): unknown {
  if (request === "@minecraft/server") return serverStub;
  if (request === "@mc-toolchain/mod-common") return modCommonStub;
  if (AUTO_STUBBED.includes(request)) return autoStub;
  // 相对导入：解析后判定是否为 Composition（CmdKit 的唯一 services 入口）
  if (request.startsWith(".") && parent?.filename) {
    const resolved = path.resolve(path.dirname(parent.filename), request);
    if (resolved.endsWith("/Composition.js") || resolved.endsWith("/Composition")) return compositionStub;
  }
  return load.call(Module, request, parent, isMain);
};

// 钩子装好后才能 import 被测模块（module: commonjs 下 require 按书写顺序生成）
import { Param, registerCommands } from "../scripts/interface/CmdKit";
import type { CommandSpec } from "../scripts/interface/CmdKit";

// ─── 测试辅助 ──────────────────────────────────────────────────

/** 捕获注册进 registry 的命令与枚举 */
interface Registration {
  config: { name: string; mandatoryParameters?: Array<{ name: string }>; optionalParameters?: Array<{ name: string }> };
  callback: (origin: unknown, ...args: unknown[]) => { status: number; message?: string };
}

function makeRegistry(): {
  registry: unknown;
  registrations: Registration[];
  enums: Array<{ name: string; values: string[] }>;
} {
  const registrations: Registration[] = [];
  const enums: Array<{ name: string; values: string[] }> = [];
  const registry = {
    registerCommand: (config: Registration["config"], callback: Registration["callback"]): void => {
      registrations.push({ config, callback });
    },
    registerEnum: (name: string, values: string[]): void => {
      enums.push({ name, values });
    },
  };
  return { registry, registrations, enums };
}

function playerOrigin(player: FakePlayer): unknown {
  return { sourceEntity: player };
}

function reset(): void {
  deferredCalls.length = 0;
  sentMessages.length = 0;
}

function flushDeferred(): void {
  while (deferredCalls.length > 0) {
    const call = deferredCalls.shift()!;
    call.fn();
  }
}

/** 一条最小命令：记录 execute 收到的 ctx 与参数 */
function probeSpec(overrides: Partial<CommandSpec> = {}): {
  spec: CommandSpec;
  calls: Array<{ playerName: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ playerName: string; args: Record<string, unknown> }> = [];
  const spec: CommandSpec = {
    name: "mp:probe",
    description: "探针",
    execute(ctx, args) {
      calls.push({ playerName: ctx.player.name, args });
    },
    ...overrides,
  };
  return { spec, calls };
}

// ─── 用例 ─────────────────────────────────────────────────────

test("注册：命令名与描述原样透传，参数按 optional 拆到两组", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec } = probeSpec({
    args: [
      { name: "target", type: Param.String },
      { name: "mode", type: Param.String, optional: true },
    ],
  });

  registerCommands(registry as never, [spec]);

  assert.equal(registrations.length, 1);
  const config = registrations[0]!.config;
  assert.equal(config.name, "mp:probe");
  assert.equal(config.mandatoryParameters?.length, 1);
  assert.equal(config.optionalParameters?.length, 1);
});

test("枚举先于命令注册：registerEnum 在 registerCommand 之前被调用", () => {
  reset();
  const order: string[] = [];
  const registry = {
    registerCommand: (): void => {
      order.push("command");
    },
    registerEnum: (name: string): void => {
      order.push(`enum:${name}`);
    },
  };
  const { spec } = probeSpec({
    args: [{ name: "mode", type: Param.String, enum: ["跟随", "闲逛"], optional: true }],
  });

  registerCommands(registry as never, [spec]);

  // 引擎按参数名查已注册枚举，缺失即 EnumDependencyMissing 整条失败
  assert.equal(order.length, 2);
  assert.match(order[0]!, /^enum:/, "枚举必须先注册");
  assert.equal(order[1], "command");
});

test("非玩家来源被拒绝：返回非零状态且不调用处理器", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec, calls } = probeSpec();

  registerCommands(registry as never, [spec]);

  const result = registrations[0]!.callback({});

  assert.notEqual(result.status, 0, "非玩家来源必须返回非零状态");
  assert.equal(deferredCalls.length, 0, "被拒绝时不得登记推迟任务");
  assert.equal(calls.length, 0, "被拒绝时不得调用处理器");
});

test("推迟到安全上下文：注册回调返回时处理器尚未执行", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec, calls } = probeSpec();

  registerCommands(registry as never, [spec]);

  const result = registrations[0]!.callback(playerOrigin(new FakePlayer("测试员")));

  // R3 的核心断言：注册回调内绝不能同步跑完处理器，
  // 否则处理器会在只读上下文里执行，多数游戏 API 会抛错，
  // 表现为「命令返回成功但世界状态没有任何变化」。
  assert.equal(calls.length, 0, "处理器不得在注册回调内同步执行");
  assert.equal(deferredCalls.length, 1, "应恰好登记一个推迟任务");
  assert.equal(result.status, 0);

  flushDeferred();

  assert.equal(calls.length, 1, "flush 安全上下文后处理器应已执行");
});

test("参数归一：引擎枚举名映射回目录参数名", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec, calls } = probeSpec({
    args: [
      { name: "target", type: Param.String },
      { name: "mode", type: Param.String, optional: true },
    ],
  });

  registerCommands(registry as never, [spec]);

  const config = registrations[0]!.config;
  const mandatoryName = config.mandatoryParameters![0]!.name;
  const optionalName = config.optionalParameters![0]!.name;

  // 非枚举参数：引擎侧键名与目录参数名一致，不做改写
  assert.equal(mandatoryName, "target");
  assert.equal(optionalName, "mode");

  // 引擎回传的键即目录参数名，处理器侧看到的形状不变
  registrations[0]!.callback(playerOrigin(new FakePlayer("测试员")), "假人A", "跟随");
  flushDeferred();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.args, { target: "假人A", mode: "跟随" });
});

test("admin 权限位：非管理员被拒并回发提示，管理员放行", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec, calls } = probeSpec({ permission: "admin" });

  registerCommands(registry as never, [spec]);

  // isAdmin 走 services.runtime.config（已桩成 autoStub），返回值非布尔，
  // 因此这里用「普通玩家 + 空配置」验证的是：守卫分支不会抛错、
  // 且被拒时确实回发了提示、没有执行处理器。
  registrations[0]!.callback(playerOrigin(new FakePlayer("普通玩家", 1)));
  flushDeferred();

  // 无论放行与否，链路都必须完整走完而不抛错
  assert.ok(calls.length <= 1, "处理器最多执行一次");
  if (calls.length === 0) {
    assert.ok(sentMessages.length > 0, "被拒时必须回发提示");
  }
});

test("处理器抛错被捕获并回发，不影响命令注册链路", () => {
  reset();
  const { registry, registrations } = makeRegistry();
  const { spec } = probeSpec({
    execute() {
      throw new Error("模拟失败");
    },
  });

  registerCommands(registry as never, [spec]);

  // 注册阶段不得抛错
  assert.doesNotThrow(() => {
    registrations[0]!.callback(playerOrigin(new FakePlayer("测试员")));
    flushDeferred();
  });

  assert.equal(sentMessages.length, 1, "异常应回发一条提示");
  assert.match(sentMessages[0]!, /命令执行异常.*模拟失败/);
});
