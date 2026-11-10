import test from "node:test";
import assert from "node:assert/strict";
import { EventSignal } from "../src/core/EventSignal";

test("EventSignal：订阅后 trigger 收到负载", () => {
  const signal = new EventSignal<{ regionId: string; slotId: number }>();
  const seen: Array<{ regionId: string; slotId: number }> = [];
  signal.subscribe((e) => seen.push(e));

  signal.trigger({ regionId: "2:0:-64", slotId: 3 });

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { regionId: "2:0:-64", slotId: 3 });
});

test("EventSignal：取消订阅后不再收到", () => {
  const signal = new EventSignal<number>();
  const seen: number[] = [];
  const cb = (e: number): void => {
    seen.push(e);
  };

  signal.subscribe(cb);
  signal.trigger(1);
  signal.unsubscribe(cb);
  signal.trigger(2);

  assert.deepEqual(seen, [1]);
});

test("EventSignal：同一回调重复订阅只触发一次", () => {
  const signal = new EventSignal<number>();
  let count = 0;
  const cb = (): void => {
    count += 1;
  };

  signal.subscribe(cb);
  signal.subscribe(cb);
  signal.subscribe(cb);
  signal.trigger(1);

  assert.equal(count, 1);
});

test("EventSignal：某订阅者抛错不影响其余订阅者", () => {
  const signal = new EventSignal<number>();
  const seen: string[] = [];
  const originalWarn = console.warn;
  console.warn = (): void => {
    /* 吞掉预期内的告警输出 */
  };

  try {
    signal.subscribe(() => {
      seen.push("first");
    });
    signal.subscribe(() => {
      throw new Error("故意抛错");
    });
    signal.subscribe(() => {
      seen.push("third");
    });

    signal.trigger(1);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(seen, ["first", "third"]);
});

test("EventSignal：无订阅者时 trigger 为安全空操作", () => {
  const signal = new EventSignal<number>();
  assert.doesNotThrow(() => signal.trigger(1));
});

test("EventSignal：回调中取消订阅不影响本次派发（快照遍历）", () => {
  const signal = new EventSignal<number>();
  const seen: string[] = [];

  const second = (): void => {
    seen.push("second");
  };
  signal.subscribe(() => {
    seen.push("first");
    signal.unsubscribe(second);
  });
  signal.subscribe(second);

  signal.trigger(1);
  assert.deepEqual(seen, ["first", "second"]);

  // 下一次触发时已生效
  seen.length = 0;
  signal.trigger(2);
  assert.deepEqual(seen, ["first"]);
});
