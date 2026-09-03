// ─── runtime — 跨假人共享记忆（SharedMemory） ──────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { SharedMemory } from "../scripts/runtime/SharedMemory";

test("SharedMemory：基本读写/存在/删除/清空", () => {
  const mem = new SharedMemory();
  assert.equal(mem.get("k"), undefined);
  mem.set("k", 42);
  assert.equal(mem.has("k"), true);
  assert.equal(mem.get<number>("k"), 42);
  assert.equal(mem.size, 1);
  mem.set("k", "updated"); // 覆盖
  assert.equal(mem.get<string>("k"), "updated");
  mem.delete("k");
  assert.equal(mem.has("k"), false);
  mem.set("a", 1);
  mem.set("b", 2);
  assert.equal(mem.size, 2);
  mem.clear();
  assert.equal(mem.size, 0);
});

test("SharedMemory：跨假人共享——一个实例写入，其他假人即可读取", () => {
  // 运行时语义：所有任务的 ctx.shared 指向同一个 SharedMemory 实例（全局单例）——
  // 模拟 botA 写入、botB（同一实例）读取
  const mem = new SharedMemory();
  mem.set("fishing:pool", [{ key: "minecraft:overworld@10,64,-4" }]);
  // botB 直接可读（同一实例）
  const pool = mem.get<Array<{ key: string }>>("fishing:pool");
  assert.equal(pool?.[0]?.key, "minecraft:overworld@10,64,-4");
});

test("SharedMemory：命名空间前缀键防碰撞", () => {
  const mem = new SharedMemory();
  mem.set("wander:lastSpot", "A");
  mem.set("mine:lastSpot", "B");
  assert.equal(mem.get("wander:lastSpot"), "A");
  assert.equal(mem.get("mine:lastSpot"), "B");
  assert.equal(mem.size, 2);
});

// ─── 过期机制（默认延长过期 renewing；fixed 定时；每秒扫描删除） ──

test("SharedMemory 过期：默认延长过期——到期由扫描删除", () => {
  const mem = new SharedMemory();
  mem.set("a", 1, 20); // ttl 20 tick（内部时钟 0 → 到期 20）
  assert.equal(mem.sweepExpired(10), 0); // 未到期，时钟 → 10
  assert.equal(mem.get("a"), 1);
  assert.equal(mem.sweepExpired(20), 1); // 到期 → 直接删除
  assert.equal(mem.get("a"), undefined);
  assert.equal(mem.size, 0);
});

test("SharedMemory 过期：延长过期——数据更新时重置到期（不提前失效）", () => {
  const mem = new SharedMemory();
  mem.set("a", 1, 20); // 到期 20
  mem.sweepExpired(10);
  mem.set("a", 2, 20); // 更新 → 延长（按时钟 10 → 到期 30）
  assert.equal(mem.get("a"), 2);
  assert.equal(mem.sweepExpired(25), 0); // 25 < 30 仍存活
  assert.equal(mem.get("a"), 2);
  assert.equal(mem.sweepExpired(30), 1); // 30 到期
  assert.equal(mem.get("a"), undefined);
});

test("SharedMemory 过期：定时过期 fixed——更新不延长（保持原始到期时刻）", () => {
  const mem = new SharedMemory();
  mem.set("a", 1, 20, "fixed"); // 到期 20
  mem.sweepExpired(10);
  mem.set("a", 2, 20, "fixed"); // 更新 → fixed 不延长（仍到期 20）
  assert.equal(mem.get("a"), 2);
  assert.equal(mem.sweepExpired(19), 0); // 19 < 20 存活
  assert.equal(mem.sweepExpired(20), 1); // 20 到期（未被延长到 30）
});

test("SharedMemory 过期：无 ttl 永久存活（不被扫描删除）", () => {
  const mem = new SharedMemory();
  mem.set("p", "keep"); // 无 ttl → 永不过期
  mem.sweepExpired(0);
  mem.sweepExpired(100000);
  assert.equal(mem.get("p"), "keep");
  assert.equal(mem.size, 1);
});

test("SharedMemory 过期：get 惰性兜底——过期键在读取时视为不存在", () => {
  const mem = new SharedMemory();
  mem.sweepExpired(5);
  mem.set("a", 1, 20); // 时钟 5 → 到期 25
  mem.sweepExpired(25); // 到达到期点（物理删除——惰性分支为防御冗余，行为一致）
  assert.equal(mem.get("a"), undefined);
});

test("SharedMemory 过期：has 与 size 只计存活键", () => {
  const mem = new SharedMemory();
  mem.set("live", 1, 100);
  mem.set("dead", 2, 10); // 时钟 0 → 到期 10
  mem.sweepExpired(15);
  assert.equal(mem.has("dead"), false);
  assert.equal(mem.has("live"), true);
  assert.equal(mem.size, 1);
});
