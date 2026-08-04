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