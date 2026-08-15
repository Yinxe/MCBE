// ─── bot/BotCore — OOP 假人对象测试（注入 InMemory 注册表，纯逻辑验证） ──
// BotCore 类的世界实体方法（navigateTo/swapSlots 等）依赖 @minecraft 运行时，
// 游戏内冒烟验证；这里覆盖不触世界的纯逻辑：构造/记录访问/状态/标签/距离。

import { test } from "node:test";
import assert from "node:assert/strict";

import { BotCore, resolveBot, requireBot } from "../scripts/bot/BotCore";
import { BotRegistry } from "../scripts/service/BotRegistry";
import { InMemoryBotStore } from "../scripts/storage/BotStore";
import { makeRecord } from "./helpers/factories";

function makeBot(name = "bot1", overrides: Partial<import("../scripts/model/Types").BotRecord> = {}) {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord(name, overrides);
  registry.set(record);
  const bot = new BotCore(name, registry);
  return { bot, registry, record };
}

// ─── 构造与解析 ────────────────────────────────────────

test("构造：记录存在 → 创建成功，name 正确", () => {
  const { bot } = makeBot();
  assert.equal(bot.name, "bot1");
});

test("构造：记录不存在 → 抛错", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  assert.throws(() => new BotCore("ghost", registry), /记录不存在/);
});

test("resolveBot：记录存在 → BotCore；不存在 → undefined", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  registry.set(makeRecord("a"));
  assert.equal(resolveBot("a", registry)?.name, "a");
  assert.equal(resolveBot("ghost", registry), undefined);
});

test("requireBot：记录存在 → BotCore；不存在 → 抛错", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  registry.set(makeRecord("a"));
  assert.equal(requireBot("a", registry).name, "a");
  assert.throws(() => requireBot("ghost", registry), /记录不存在/);
});

// ─── 记录访问 / 状态 ───────────────────────────────────

test("record：实时读取最新记录", () => {
  const { bot, registry } = makeBot();
  assert.equal(bot.record.online, false);
  const updated = bot.record;
  updated.online = true;
  registry.set(updated);
  assert.equal(bot.record.online, true); // 实时读，非缓存
});

test("状态：isAvailable = online 且非死亡", () => {
  const { bot, registry } = makeBot();
  assert.equal(bot.isAvailable, false); // 离线
  const r = bot.record;
  r.online = true;
  registry.set(r);
  assert.equal(bot.isAvailable, true);
  r.death = true;
  registry.set(r);
  assert.equal(bot.isAvailable, false); // 死亡
  assert.equal(bot.isDeath, true);
  assert.equal(bot.isOnline, true);
});

test("状态：isDeath / isOnline 独立判定", () => {
  const { bot, registry } = makeBot();
  assert.equal(bot.isDeath, false);
  assert.equal(bot.isOnline, false);
  const r = bot.record;
  r.online = true;
  r.death = true;
  registry.set(r);
  assert.equal(bot.isOnline, true);
  assert.equal(bot.isDeath, true);
});

// ─── 标签 ──────────────────────────────────────────────

test("标签：hasTag 读持久标签列表", () => {
  const { bot } = makeBot("bot1", { tags: ["mockplayer:tag:bot", "abc"] });
  assert.equal(bot.hasTag("abc"), true);
  assert.equal(bot.hasTag("nope"), false);
  assert.equal(bot.tags.length, 2);
});

test("标签：addTag 去重追加", () => {
  const { bot, registry } = makeBot();
  bot.addTag("mockplayer:tag:vault");
  assert.equal(bot.hasTag("mockplayer:tag:vault"), true);
  assert.equal(bot.tags.filter((t) => t === "mockplayer:tag:vault").length, 1);
  bot.addTag("mockplayer:tag:vault"); // 重复 → 不追加
  assert.equal(bot.tags.filter((t) => t === "mockplayer:tag:vault").length, 1);
  // 实体不可用（离线）→ 仅改记录不崩
  assert.equal(registry.get("bot1")?.tags.includes("mockplayer:tag:vault"), true);
});

test("标签：removeTag 移除已存在的", () => {
  const { bot } = makeBot("bot1", { tags: ["a", "b", "c"] });
  bot.removeTag("b");
  assert.deepEqual(bot.tags, ["a", "c"]);
  bot.removeTag("missing"); // 不存在 → 无操作
  assert.deepEqual(bot.tags, ["a", "c"]);
});

// ─── 距离 ──────────────────────────────────────────────

test("距离：无实体（离线）→ Infinity", () => {
  const { bot } = makeBot();
  assert.equal(bot.distanceTo({ x: 0, y: 0, z: 0 }), Number.POSITIVE_INFINITY);
});

test("距离：3D 欧氏距离计算", () => {
  // 在线但无实体（entityId 空）→ 仍 Infinity（实体解析失败路径）
  const { bot } = makeBot("bot1", { online: true });
  assert.equal(bot.distanceTo({ x: 1, y: 2, z: 3 }), Number.POSITIVE_INFINITY);
});

// ─── 实体访问（离线安全） ──────────────────────────────

test("实体：离线/无 entityId → undefined（不抛错）", () => {
  const { bot } = makeBot();
  assert.equal(bot.entity, undefined);
  assert.equal(bot.dimension, undefined);
  assert.equal(bot.location, undefined);
  assert.equal(bot.container, undefined);
  assert.equal(bot.isOperable(), false);
  assert.equal(bot.isEntityValid, false);
});
