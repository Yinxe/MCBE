import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore, MAX_TOTAL_BYTES, SAFE_ENVELOPE_LENGTH, fnv1a } from "../scripts/mc/storage/ShardStore";
import type { KeyValueStore } from "../scripts/core/storage/KeyValueStore";

/** 可枚举键的测试 KV（验证孤儿清理/覆盖写收缩） */
class TestKV implements KeyValueStore {
  private map = new Map<string, unknown>();
  read<T>(key: string): T | undefined { return this.map.get(key) as T | undefined; }
  write<T>(key: string, value: T): void { this.map.set(key, value); }
  remove(key: string): void { this.map.delete(key); }
  keys(): string[] { return [...this.map.keys()]; }
}

function makeStore(kv = new TestKV(), totalBytes = () => 0, safeLength = SAFE_ENVELOPE_LENGTH) {
  return { kv, store: new ShardStore(kv, totalBytes, safeLength) };
}

test("ShardStore: overwrite 小 payload 往返 + 覆盖写", () => {
  const { kv, store } = makeStore();
  store.write("a", { n: 1 }, "overwrite");
  assert.deepEqual(store.read("a"), { n: 1 });
  store.write("a", { n: 2 }, "overwrite");
  assert.deepEqual(store.read("a"), { n: 2 });
});

test("ShardStore: overwrite 超大 payload 自动分包 + 收缩清理", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000); // 小安全线强制分包
  const big = { items: Array.from({ length: 200 }, (_, i) => `item-${i}-${"x".repeat(40)}`) };
  assert.equal(store.write("idx", big, "overwrite"), true);
  assert.deepEqual(store.read("idx"), big);
  // 收缩后多余分片被清理
  store.write("idx", { items: ["small"] }, "overwrite");
  assert.deepEqual(store.read("idx"), { items: ["small"] });
  const leftover = kv.keys().filter((k) => k.startsWith("idx:data:"));
  assert.ok(leftover.length <= 1, `多余分片未清理: ${leftover}`);
});

test("ShardStore: 损坏检测（篡改内容 → undefined）", () => {
  const { kv, store } = makeStore();
  store.write("a", { n: 1 }, "overwrite");
  const key = kv.keys().find((k) => k.startsWith("a:")) as string;
  kv.write(key, JSON.stringify({ h: "deadbeef", v: "tampered" }));
  assert.equal(store.read("a"), undefined);
});

test("ShardStore: fnv1a 确定性", () => {
  assert.equal(fnv1a("hello"), fnv1a("hello"));
  assert.notEqual(fnv1a("hello"), fnv1a("hellp"));
  assert.match(fnv1a("hello"), /^[0-9a-f]{8}$/);
});

test("ShardStore: generation 世代切换 + 孤儿键清理", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000);
  // 300 项确保跨多片（1000 安全线下 max chunk=936，300*5≈1500B → 2 片）
  const big = { items: Array.from({ length: 300 }, (_, i) => `c${i}`) };
  store.write("meta", big, "generation");
  const gen1 = kv.keys().filter((k) => k.startsWith("meta:"));
  assert.ok(gen1.length > 2, "应分包为多键");
  store.write("meta", { items: ["new"] }, "generation");
  const gen2 = kv.keys().filter((k) => k.startsWith("meta:"));
  assert.deepEqual(store.read("meta"), { items: ["new"] });
  const oldKeys = gen2.filter((k) => k.includes(":1:"));
  assert.equal(oldKeys.length, 0, `旧世代键未清理: ${oldKeys}`); // 新世代 gen=1 后无残留
});

test("ShardStore: 1MB 预算拒绝写返回 false", () => {
  const { store } = makeStore(new TestKV(), () => MAX_TOTAL_BYTES);
  assert.equal(store.write("a", { n: 1 }, "overwrite"), false);
  assert.equal(store.read("a"), undefined);
});

test("ShardStore: remove 清理全部键", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000);
  store.write("a", { items: Array.from({ length: 50 }, (_, i) => `c${i}`) }, "generation");
  store.remove("a");
  assert.equal(store.read("a"), undefined);
  assert.equal(kv.keys().filter((k) => k.startsWith("a:")).length, 0);
});
test("ShardStore: 构造注入预算线（可配置总量）", () => {
  const store = new ShardStore(new TestKV(), () => 0, SAFE_ENVELOPE_LENGTH, 1000);
  assert.equal(store.write("a", { items: "x".repeat(2000) }, "overwrite"), false); // 超预算拒绝
  assert.equal(store.write("a", { n: 1 }, "overwrite"), true); // 小数据可写
  assert.deepEqual(store.read("a"), { n: 1 });
});
