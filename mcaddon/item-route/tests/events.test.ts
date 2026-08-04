import { test } from "node:test";
import assert from "node:assert/strict";
import { EventSignal } from "../scripts/core/events/EventSignal";
import { EventBus } from "../scripts/core/events/DomainEvents";

test("EventSignal: 订阅/触发/取消订阅", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  const cb = (e: { n: number }) => received.push(e.n);
  sig.subscribe(cb);
  sig.trigger({ n: 1 });
  sig.unsubscribe(cb);
  sig.trigger({ n: 2 });
  assert.deepEqual(received, [1]);
});

test("EventSignal: 同一回调只注册一次", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  const cb = (e: { n: number }) => received.push(e.n);
  sig.subscribe(cb);
  sig.subscribe(cb);
  sig.trigger({ n: 7 });
  assert.deepEqual(received, [7]);
});

test("EventSignal: 订阅者异常不影响其他订阅者", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  sig.subscribe(() => {
    throw new Error("boom");
  });
  sig.subscribe((e) => received.push(e.n));
  sig.trigger({ n: 3 });
  assert.deepEqual(received, [3]);
});

test("EventBus: 各领域事件独立派发", () => {
  const bus = new EventBus();
  const routed: string[] = [];
  bus.itemRouted.subscribe((e) => routed.push(`${e.from}->${e.to}:${e.amount}`));
  bus.itemRouted.trigger({
    type: "item-routed",
    warehouseId: "w1",
    from: "c1",
    to: "c2",
    itemId: "minecraft:stone",
    amount: 5,
  });
  bus.warning.trigger({ type: "warning", warehouseId: "w1", level: "yellow", containerId: "c1" });
  assert.deepEqual(routed, ["c1->c2:5"]);
});
