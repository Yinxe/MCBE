// ─── core/events — 事件信号与领域事件 ─────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { EventSignal } from "../scripts/core/events/EventSignal";
import {
  raidStarted, raidVictory, tridentClaimed, tridentOwnerChanged,
  botOnline, botOffline, botDeath, botRespawn,
  botMainhandChanged, botBlockBroken, botBlockPlaced, botItemUsed, botEntityAttacked,
} from "../scripts/core/events/DomainEvents";

test("EventSignal：订阅/触发/退订", () => {
  const signal = new EventSignal<number>();
  const received: number[] = [];
  const unsubscribe = signal.subscribe((v) => received.push(v));
  signal.trigger(1);
  signal.trigger(2);
  unsubscribe();
  signal.trigger(3);
  assert.deepEqual(received, [1, 2]);
});

test("EventSignal：多个订阅者互不干扰", () => {
  const signal = new EventSignal<string>();
  const a: string[] = [];
  const b: string[] = [];
  signal.subscribe((v) => a.push(v));
  signal.subscribe((v) => b.push(v));
  signal.trigger("x");
  assert.deepEqual(a, ["x"]);
  assert.deepEqual(b, ["x"]);
});

test("EventSignal：订阅者异常隔离（不影响其他订阅者）", () => {
  const signal = new EventSignal<number>();
  const received: number[] = [];
  signal.subscribe(() => { throw new Error("boom"); });
  signal.subscribe((v) => received.push(v));
  assert.doesNotThrow(() => signal.trigger(1));
  assert.deepEqual(received, [1]);
});

test("EventSignal：同回调重复订阅去重（Set 语义）", () => {
  const signal = new EventSignal<number>();
  let count = 0;
  const cb = () => { count++; };
  signal.subscribe(cb);
  signal.subscribe(cb);
  signal.trigger(1);
  assert.equal(count, 1);
});

test("领域事件：raidStarted/raidVictory 信号可触发并携带序列化负载", () => {
  const started: string[] = [];
  const victory: string[] = [];
  const off1 = raidStarted.subscribe((e) => started.push(`${e.botName}:${e.amplifier}`));
  const off2 = raidVictory.subscribe((e) => victory.push(`${e.botName}:${e.amplifier}`));

  raidStarted.trigger({ botName: "bot1", amplifier: 2 });
  raidVictory.trigger({ botName: "bot1", amplifier: 1 });

  assert.deepEqual(started, ["bot1:2"]);
  assert.deepEqual(victory, ["bot1:1"]);

  off1();
  off2();
});

test("领域事件：三叉戟认主事件（各途径可触发）", () => {
  const events: string[] = [];
  const off = tridentClaimed.subscribe((e) => events.push(`${e.tridentId}:${e.claimedBy}:${e.via}`));

  tridentClaimed.trigger({ tridentId: "t1", claimedBy: "Steve", via: "spawn", firstOwner: "Steve" });
  tridentClaimed.trigger({ tridentId: "t1", claimedBy: "Steave", via: "load", firstOwner: "Steve", secondOwner: "bot1" });
  tridentClaimed.trigger({ tridentId: "t1", claimedBy: "bot1", via: "rebind", firstOwner: "Steve", secondOwner: "bot1" });
  tridentClaimed.trigger({ tridentId: "t2", claimedBy: "bot1", via: "ui", firstOwner: "Steve", secondOwner: "bot1" });
  tridentClaimed.trigger({ tridentId: "t2", claimedBy: "Steve", via: "offline-fallback", firstOwner: "Steve", secondOwner: "bot1" });

  assert.deepEqual(events, [
    "t1:Steve:spawn",
    "t1:Steave:load",
    "t1:bot1:rebind",
    "t2:bot1:ui",
    "t2:Steve:offline-fallback",
  ]);

  off();
});

test("领域事件：三叉戟主人更替事件（第二任覆盖复写）", () => {
  const events: string[] = [];
  const off = tridentOwnerChanged.subscribe((e) =>
    events.push(`${e.tridentId}:${e.firstOwner ?? "无"}:${e.previousSecondOwner ?? "无"}→${e.newSecondOwner}`)
  );

  // 首次认领第二任（1任→2任）
  tridentOwnerChanged.trigger({ tridentId: "t1", firstOwner: "Steve", newSecondOwner: "bot1" });
  // 更替第二任（2任→新2任）
  tridentOwnerChanged.trigger({ tridentId: "t1", firstOwner: "Steve", previousSecondOwner: "bot1", newSecondOwner: "bot2" });
  // 无第一任的异常数据
  tridentOwnerChanged.trigger({ tridentId: "t2", newSecondOwner: "bot1" });

  assert.deepEqual(events, [
    "t1:Steve:无→bot1",
    "t1:Steve:bot1→bot2",
    "t2:无:无→bot1",
  ]);

  off();
});

test("领域事件：假人生命周期（上线/下线/死亡/复活）可触发并携带序列化负载", () => {
  const online: string[] = [];
  const offline: string[] = [];
  const death: string[] = [];
  const respawn: string[] = [];
  const off1 = botOnline.subscribe((e) => online.push(e.botName));
  const off2 = botOffline.subscribe((e) => offline.push(e.botName));
  const off3 = botDeath.subscribe((e) => death.push(`${e.botName}@${e.position.x},${e.position.y},${e.position.z}:${e.dimension}`));
  const off4 = botRespawn.subscribe((e) => respawn.push(e.botName));

  botOnline.trigger({ botName: "bot1" });
  botDeath.trigger({ botName: "bot1", position: { x: 10, y: 64, z: -5 }, dimension: "minecraft:overworld" });
  botRespawn.trigger({ botName: "bot1" });
  botOffline.trigger({ botName: "bot1" });

  assert.deepEqual(online, ["bot1"]);
  assert.deepEqual(offline, ["bot1"]);
  assert.deepEqual(death, ["bot1@10,64,-5:minecraft:overworld"]);
  assert.deepEqual(respawn, ["bot1"]);

  off1();
  off2();
  off3();
  off4();
});

test("领域事件：假人行为事件（主手切换/破坏/放置/使用/攻击）可触发", () => {
  const mainhand: string[] = [];
  const broken: string[] = [];
  const placed: string[] = [];
  const used: string[] = [];
  const attacked: string[] = [];
  const off1 = botMainhandChanged.subscribe((e) => mainhand.push(`${e.botName}:${e.slot}:${e.itemId ?? "空"}`));
  const off2 = botBlockBroken.subscribe((e) => broken.push(`${e.botName}:${e.blockTypeId}@${e.position.x},${e.position.y},${e.position.z}`));
  const off3 = botBlockPlaced.subscribe((e) => placed.push(`${e.botName}:${e.blockTypeId}`));
  const off4 = botItemUsed.subscribe((e) => used.push(`${e.botName}:${e.itemId}`));
  const off5 = botEntityAttacked.subscribe((e) => attacked.push(`${e.botName}→${e.targetTypeId}:${e.damage}`));

  botMainhandChanged.trigger({ botName: "bot1", slot: 5, itemId: "minecraft:diamond_sword" });
  botBlockBroken.trigger({ botName: "bot1", blockTypeId: "minecraft:stone", position: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld" });
  botBlockPlaced.trigger({ botName: "bot1", blockTypeId: "minecraft:cobblestone", position: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld" });
  botItemUsed.trigger({ botName: "bot1", itemId: "minecraft:milk_bucket" });
  botEntityAttacked.trigger({ botName: "bot1", targetTypeId: "minecraft:zombie", damage: 7 });

  assert.deepEqual(mainhand, ["bot1:5:minecraft:diamond_sword"]);
  assert.deepEqual(broken, ["bot1:minecraft:stone@1,2,3"]);
  assert.deepEqual(placed, ["bot1:minecraft:cobblestone"]);
  assert.deepEqual(used, ["bot1:minecraft:milk_bucket"]);
  assert.deepEqual(attacked, ["bot1→minecraft:zombie:7"]);

  off1();
  off2();
  off3();
  off4();
  off5();
});