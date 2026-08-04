# EventSignal 自定义事件订阅触发机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@yinxe/toolkit` 中实现参考 MCBE 原生事件机制（`world.afterEvents.xxx.subscribe / unsubscribe` 模式）的纯自定义事件订阅触发类。

**Architecture:** 两个纯 TS 类：`EventSignal<T>`（仅通知）与 `CancelableEventSignal<T>`（订阅者可置 `event.cancel = true` 取消本次触发）。内部用 `Set` 维护订阅者实现去重，快照数组遍历保证回调中增删订阅安全，try-catch 包裹每个订阅者实现异常隔离。每个事件独立定义（一个 interface = 事件属性）并独立持有 signal 实例，不引入 EventBus / 全局单例。

**Tech Stack:** TypeScript 5.0.2（target es6 / lib es2017 兼容 addon 运行时），node 24 直接运行行为测试。事件类不依赖 `@minecraft/server`，可在 node 环境独立编译测试。

**Spec:** `docs/superpowers/specs/2026-08-04-event-signal-design.md`

---

### Task 1: 行为测试（先红）

**Files:**
- Create: `packages/toolkit/test/EventSignal.test.ts`

- [ ] **Step 1: 写行为测试**

`packages/toolkit/test/EventSignal.test.ts` 全文：

```typescript
// 行为测试：不依赖 @minecraft/server，node 直接运行（tsc 编译后执行）。
// 运行方式见实现计划 Task 2 Step 2。
import { EventSignal, CancelableEventSignal } from "../src/events/EventSignal";

// ─── 迷你断言（无外部依赖） ─────────────────────────────
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.warn(`✗ ${name}:`, e);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: 期望 ${String(expected)}，实际 ${String(actual)}`);
  }
}
function assertDeepEqual(actual: number[], expected: number[], msg: string): void {
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${msg}: 期望 [${expected.join(",")}]，实际 [${actual.join(",")}]`);
  }
}

// ─── 事件定义示例 ──────────────────────────────────────
interface PlayerJoinEvent {
  playerId: string;
  playerName: string;
}
interface ItemUseEvent {
  playerId: string;
  itemTypeId: string;
}

// ─── EventSignal：订阅 / 取消订阅 / 触发 ────────────────
test("订阅后 trigger 收到事件", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  let received: PlayerJoinEvent | undefined;
  signal.subscribe((e) => {
    received = e;
  });
  signal.trigger({ playerId: "x", playerName: "Alice" });
  assert(!!received, "应收到事件");
  assertEqual(received!.playerName, "Alice", "payload 应透传");
});

test("无订阅者时 trigger 安全空操作", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  assert((() => {
    try {
      signal.trigger({ playerId: "x", playerName: "A" });
      return true;
    } catch {
      return false;
    }
  })(), "无订阅者 trigger 不应抛错");
});

test("unsubscribe 后不再收到", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  let count = 0;
  const cb = () => {
    count++;
  };
  signal.subscribe(cb);
  signal.unsubscribe(cb);
  signal.trigger({ playerId: "x", playerName: "A" });
  assertEqual(count, 0, "取消订阅后不应触发");
});

test("同一回调重复 subscribe 只触发一次", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  let count = 0;
  const cb = () => {
    count++;
  };
  signal.subscribe(cb);
  signal.subscribe(cb);
  signal.trigger({ playerId: "x", playerName: "A" });
  assertEqual(count, 1, "重复订阅应去重");
});

test("订阅者抛异常不影响其他订阅者", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  let count = 0;
  signal.subscribe(() => {
    throw new Error("boom");
  });
  signal.subscribe(() => {
    count++;
  });
  signal.trigger({ playerId: "x", playerName: "A" });
  assertEqual(count, 1, "异常订阅者不应阻断后续订阅者");
});

test("回调中 subscribe/unsubscribe 安全（快照遍历）", () => {
  const signal = new EventSignal<PlayerJoinEvent>();
  const events: number[] = [];
  const late = () => {
    events.push(2);
  };
  signal.subscribe(() => {
    events.push(0);
    signal.subscribe(late);
  });
  signal.subscribe(() => {
    events.push(1);
    signal.unsubscribe(late);
  });
  signal.trigger({ playerId: "x", playerName: "A" });
  signal.trigger({ playerId: "x", playerName: "B" });
  assertDeepEqual(events, [0, 1, 0, 1], "回调中增删订阅不应影响派发");
});

// ─── CancelableEventSignal：可取消事件 ──────────────────
test("可取消事件：cancel 后 trigger 返回 false", () => {
  const signal = new CancelableEventSignal<ItemUseEvent>();
  signal.subscribe((e) => {
    e.cancel = true;
  });
  const ok = signal.trigger({ playerId: "x", itemTypeId: "minecraft:bedrock" });
  assertEqual(ok, false, "取消后应返回 false");
});

test("可取消事件：未取消返回 true", () => {
  const signal = new CancelableEventSignal<ItemUseEvent>();
  signal.subscribe(() => {
    /* 不取消 */
  });
  const ok = signal.trigger({ playerId: "x", itemTypeId: "minecraft:stone" });
  assertEqual(ok, true, "未取消应返回 true");
});

test("可取消事件：所有订阅者都会收到（忠实 MCBE）", () => {
  const signal = new CancelableEventSignal<ItemUseEvent>();
  let count = 0;
  signal.subscribe(() => {
    count++;
  });
  signal.subscribe((e) => {
    e.cancel = true;
    count++;
  });
  signal.subscribe(() => {
    count++;
  });
  signal.trigger({ playerId: "x", itemTypeId: "minecraft:bedrock" });
  assertEqual(count, 3, "cancel 后其余订阅者仍应收到");
});

test("可取消事件：浅拷贝不污染原始数据", () => {
  const signal = new CancelableEventSignal<ItemUseEvent>();
  signal.subscribe((e) => {
    e.cancel = true;
  });
  const data: ItemUseEvent = { playerId: "x", itemTypeId: "minecraft:bedrock" };
  signal.trigger(data);
  assertEqual((data as { cancel?: boolean }).cancel, undefined, "原始数据不应被写入 cancel");
});

test("可取消事件：unsubscribe 后不再收到", () => {
  const signal = new CancelableEventSignal<ItemUseEvent>();
  let count = 0;
  const cb = () => {
    count++;
  };
  signal.subscribe(cb);
  signal.unsubscribe(cb);
  signal.trigger({ playerId: "x", itemTypeId: "minecraft:bedrock" });
  assertEqual(count, 0, "取消订阅后不应触发");
});

// ─── 汇总 ──────────────────────────────────────────────
if (failures.length > 0) {
  console.warn(`[events] ${failures.length} 个用例失败: ${failures.join(", ")}`);
  throw new Error("存在失败的用例");
} else {
  console.log("[events] 全部用例通过");
}
```

- [ ] **Step 2: 运行测试，确认失败（红）**

Run（在仓库根目录）：

```bash
mcaddon/mock-player/node_modules/.bin/tsc --strict --target es6 --lib es2017,dom --module commonjs --outDir /tmp/events-test packages/toolkit/src/events/EventSignal.ts packages/toolkit/test/EventSignal.test.ts && node /tmp/events-test/test/EventSignal.test.js
```

Expected: tsc 报错 `Cannot find module '../src/events/EventSignal'`（源码尚未创建），命令失败。

### Task 2: 实现 EventSignal（转绿）

**Files:**
- Create: `packages/toolkit/src/events/EventSignal.ts`

- [ ] **Step 1: 写实现**

`packages/toolkit/src/events/EventSignal.ts` 全文：

```typescript
// ─── 自定义事件订阅触发机制 ──────────────────────────────
// 参考 MCBE 原生事件机制（world.afterEvents.xxx.subscribe / unsubscribe），
// 为 addon 内部模块间解耦通信提供纯自定义事件：
//   - 每个事件独立定义（一个 interface = 事件属性），各自持有独立 signal 实例
//   - 三个操作：subscribe（订阅）/ unsubscribe（取消订阅）/ trigger（触发）
//   - CancelableEventSignal：订阅者可置 event.cancel = true 取消本次触发
// 不依赖 @minecraft/server，可在 node 环境直接编译测试。

type EventCallback<T> = (event: T) => void;

/**
 * 普通事件信号：仅通知，订阅者不可取消。
 * 同一回调重复订阅只注册一次；订阅者异常不影响其他订阅者；
 * 回调中 subscribe / unsubscribe 安全（快照遍历）。
 */
export class EventSignal<T> {
  private callbacks = new Set<EventCallback<T>>();

  /** 订阅事件；同一回调重复订阅只注册一次 */
  subscribe(callback: EventCallback<T>): void {
    this.callbacks.add(callback);
  }

  /** 取消订阅；未注册的回调静默忽略 */
  unsubscribe(callback: EventCallback<T>): void {
    this.callbacks.delete(callback);
  }

  /** 同步触发事件，派发给所有订阅者；无订阅者时安全空操作 */
  trigger(event: T): void {
    // 快照遍历：回调中 subscribe / unsubscribe 不影响本次派发
    for (const callback of [...this.callbacks]) {
      try {
        callback(event);
      } catch (e) {
        console.warn("[events] 订阅者回调异常:", e);
      }
    }
  }
}

/** 可取消事件的派发对象：事件属性 + cancel 标志 */
export type CancelableEvent<T> = T & { cancel: boolean };

/**
 * 可取消事件信号：订阅者可置 event.cancel = true 取消本次触发。
 * 所有订阅者都会收到事件（忠实 MCBE beforeEvents 语义），
 * trigger 返回本次触发是否被取消（false = 已取消）。
 */
export class CancelableEventSignal<T> {
  private callbacks = new Set<EventCallback<CancelableEvent<T>>>();

  /** 订阅事件；同一回调重复订阅只注册一次 */
  subscribe(callback: EventCallback<CancelableEvent<T>>): void {
    this.callbacks.add(callback);
  }

  /** 取消订阅；未注册的回调静默忽略 */
  unsubscribe(callback: EventCallback<CancelableEvent<T>>): void {
    this.callbacks.delete(callback);
  }

  /**
   * 同步触发事件。内部构造浅拷贝 { ...event, cancel: false } 派发，
   * 不污染原始数据；任一订阅者置 cancel = true 则返回 false。
   */
  trigger(event: T): boolean {
    const cancelable: CancelableEvent<T> = { ...event, cancel: false };
    for (const callback of [...this.callbacks]) {
      try {
        callback(cancelable);
      } catch (e) {
        console.warn("[events] 订阅者回调异常:", e);
      }
    }
    return !cancelable.cancel;
  }
}
```

- [ ] **Step 2: 运行测试，确认通过（绿）**

Run（仓库根目录，与 Task 1 Step 2 相同命令）：

```bash
mcaddon/mock-player/node_modules/.bin/tsc --strict --target es6 --lib es2017,dom --module commonjs --outDir /tmp/events-test packages/toolkit/src/events/EventSignal.ts packages/toolkit/test/EventSignal.test.ts && node /tmp/events-test/test/EventSignal.test.js
```

Expected: 11 行 `✓ ...` 输出 + 最后一行 `[events] 全部用例通过`，exit 0。

### Task 3: 导出接线 + 类型检查

**Files:**
- Create: `packages/toolkit/src/events/index.ts`
- Modify: `packages/toolkit/src/index.ts:5`（command 导出行之后追加一行）

- [ ] **Step 1: 创建 `packages/toolkit/src/events/index.ts`**

```typescript
// ─── 自定义事件订阅触发机制 ──────────────────────────────
export {
  EventSignal,
  CancelableEventSignal,
  type CancelableEvent,
} from "./EventSignal";
```

- [ ] **Step 2: 修改 `packages/toolkit/src/index.ts`**

在 `export { defineCommand, type CommandContext } from "./command";` 之后追加：

```typescript
export { EventSignal, CancelableEventSignal, type CancelableEvent } from "./events";
```

- [ ] **Step 3: 类型检查 + 回归测试**

Run：

```bash
mcaddon/mock-player/node_modules/.bin/tsc --noEmit --strict --target es6 --lib es2017,dom --module commonjs packages/toolkit/src/events/EventSignal.ts packages/toolkit/src/events/index.ts packages/toolkit/test/EventSignal.test.ts
```

Expected: 无输出，exit 0。

再跑一次行为测试（Task 2 Step 2 命令），Expected: 全部用例通过。

### Task 4: README 文档

**Files:**
- Modify: `packages/toolkit/README.md`（`### src/command/...` 一节之前插入新小节）

- [ ] **Step 1: 在 README.md 的「公共 API」部分插入 events 小节**

在 `### src/command/index.ts — 自定义命令封装` 小节之前插入：

```markdown
### `src/events/` — 自定义事件订阅触发机制

参考 MCBE 原生事件机制（`world.afterEvents.xxx.subscribe / unsubscribe`），为 addon 内部模块间解耦通信提供纯自定义事件。

- **`EventSignal<T>` 类**：订阅 / 取消订阅 / 触发
  - `.subscribe(callback)` 订阅，`.unsubscribe(callback)` 取消订阅（同一回调引用），`.trigger(event)` 同步派发
  - 同一回调重复订阅只注册一次（去重）；订阅者异常隔离（`[events] 订阅者回调异常` 日志，不影响其他订阅者）；快照遍历（回调中增删订阅安全）
  - 无订阅者时 `trigger` 为安全空操作
- **`CancelableEventSignal<T>` 类**：可取消事件（MCBE beforeEvents 语义）
  - 订阅者收到 `T & { cancel: boolean }`，可置 `e.cancel = true`；`trigger` 返回是否被取消
  - 所有订阅者都会收到事件；内部浅拷贝派发，不污染原始数据
- 每个事件独立定义（一个 interface = 事件属性），各自持有 signal 实例，不引入事件总线 / 全局单例
- 不依赖 `@minecraft/server`，可在 node 环境直接测试（见 `test/EventSignal.test.ts`）

```typescript
import { EventSignal, CancelableEventSignal } from "@yinxe/toolkit";

interface PlayerJoinEvent {
  playerId: string;
  playerName: string;
}

// 每个事件一个独立 signal 实例
const playerJoin = new EventSignal<PlayerJoinEvent>();
playerJoin.subscribe((e) => console.warn(`[demo] ${e.playerName} 加入`));
playerJoin.trigger({ playerId: "x", playerName: "Alice" });

interface ItemUseEvent {
  playerId: string;
  itemTypeId: string;
}

const itemUse = new CancelableEventSignal<ItemUseEvent>();
itemUse.subscribe((e) => {
  if (e.itemTypeId === "minecraft:bedrock") e.cancel = true;
});
const ok = itemUse.trigger({ playerId: "x", itemTypeId: "minecraft:bedrock" }); // false
```
```

- [ ] **Step 2: 确认 README 无嵌套代码块错乱**

注意上面 README 插入内容包含 3 个反引号包裹的示例代码块，写入时确保内部代码块用 ```typescript 且不提前闭合外层结构。

### Task 5: 清理 + 提交

**Files:**
- 无需修改源码

- [ ] **Step 1: 清理临时产物并最终验证**

Run：

```bash
rm -rf /tmp/events-test
mcaddon/mock-player/node_modules/.bin/tsc --strict --target es6 --lib es2017,dom --module commonjs --outDir /tmp/events-test packages/toolkit/src/events/EventSignal.ts packages/toolkit/test/EventSignal.test.ts && node /tmp/events-test/test/EventSignal.test.js
```

Expected: 全部用例通过，exit 0。

- [ ] **Step 2: 提交**

```bash
git add packages/toolkit/src/events/EventSignal.ts packages/toolkit/src/events/index.ts packages/toolkit/src/index.ts packages/toolkit/test/EventSignal.test.ts packages/toolkit/README.md
git commit -m "toolkit: 新增自定义事件订阅触发机制（EventSignal / CancelableEventSignal）"
```

Expected: 提交成功，`git log --oneline -1` 显示新提交。
