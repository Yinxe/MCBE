// ─── core/events — 事件信号与领域事件 ─────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { EventSignal } from "../scripts/events/EventSignal";
import { BotEvents } from "../scripts/events/DomainEvents";
import { BotUiEvent } from "../scripts/events/UiEvents";

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

test("领域事件：vaultOpened 信号可触发并携带序列化负载（开箱成功通知/统计联动）", () => {
  const events: string[] = [];
  const off = BotEvents.vaultOpened.subscribe((e) => events.push(`${e.botName}:${e.keyType}:${e.remaining}`));

  BotEvents.vaultOpened.trigger({ botName: "bot1", keyType: "minecraft:trial_key", remaining: 3 });

  assert.deepEqual(events, ["bot1:minecraft:trial_key:3"]);
  off();
});

test("领域事件：三叉戟认主事件（各途径可触发）", () => {
  const events: string[] = [];
  const off = BotEvents.tridentClaimed.subscribe((e) => events.push(`${e.tridentId}:${e.claimedBy}:${e.via}`));

  BotEvents.tridentClaimed.trigger({ tridentId: "t1", claimedBy: "Steve", via: "spawn", firstOwner: "Steve" });
  BotEvents.tridentClaimed.trigger({ tridentId: "t1", claimedBy: "Steave", via: "load", firstOwner: "Steve", secondOwner: "bot1" });
  BotEvents.tridentClaimed.trigger({ tridentId: "t1", claimedBy: "bot1", via: "rebind", firstOwner: "Steve", secondOwner: "bot1" });
  BotEvents.tridentClaimed.trigger({ tridentId: "t2", claimedBy: "bot1", via: "ui", firstOwner: "Steve", secondOwner: "bot1" });
  BotEvents.tridentClaimed.trigger({ tridentId: "t2", claimedBy: "Steve", via: "offline-fallback", firstOwner: "Steve", secondOwner: "bot1" });

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
  const off = BotEvents.tridentOwnerChanged.subscribe((e) =>
    events.push(`${e.tridentId}:${e.firstOwner ?? "无"}:${e.previousSecondOwner ?? "无"}→${e.newSecondOwner}`)
  );

  // 首次认领第二任（1任→2任）
  BotEvents.tridentOwnerChanged.trigger({ tridentId: "t1", firstOwner: "Steve", newSecondOwner: "bot1" });
  // 更替第二任（2任→新2任）
  BotEvents.tridentOwnerChanged.trigger({ tridentId: "t1", firstOwner: "Steve", previousSecondOwner: "bot1", newSecondOwner: "bot2" });
  // 无第一任的异常数据
  BotEvents.tridentOwnerChanged.trigger({ tridentId: "t2", newSecondOwner: "bot1" });

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
  const off1 = BotEvents.botOnline.subscribe((e) => online.push(e.botName));
  const off2 = BotEvents.botOffline.subscribe((e) => offline.push(e.botName));
  const off3 = BotEvents.botDeath.subscribe((e) => death.push(`${e.botName}@${e.position.x},${e.position.y},${e.position.z}:${e.dimension}`));
  const off4 = BotEvents.botRespawn.subscribe((e) => respawn.push(e.botName));

  BotEvents.botOnline.trigger({ botName: "bot1" });
  BotEvents.botDeath.trigger({ botName: "bot1", position: { x: 10, y: 64, z: -5 }, dimension: "minecraft:overworld" });
  BotEvents.botRespawn.trigger({ botName: "bot1" });
  BotEvents.botOffline.trigger({ botName: "bot1" });

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
  const off1 = BotEvents.botMainhandChanged.subscribe((e) => mainhand.push(`${e.botName}:${e.slot}:${e.itemId ?? "空"}`));
  const off2 = BotEvents.botBlockBroken.subscribe((e) => broken.push(`${e.botName}:${e.blockTypeId}@${e.position.x},${e.position.y},${e.position.z}`));
  const off3 = BotEvents.botBlockPlaced.subscribe((e) => placed.push(`${e.botName}:${e.blockTypeId}`));
  const off4 = BotEvents.botItemUsed.subscribe((e) => used.push(`${e.botName}:${e.itemId}`));
  const off5 = BotEvents.botEntityAttacked.subscribe((e) => attacked.push(`${e.botName}→${e.targetTypeId}:${e.damage}`));

  BotEvents.botMainhandChanged.trigger({ botName: "bot1", slot: 5, itemId: "minecraft:diamond_sword" });
  BotEvents.botBlockBroken.trigger({ botName: "bot1", blockTypeId: "minecraft:stone", position: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld" });
  BotEvents.botBlockPlaced.trigger({ botName: "bot1", blockTypeId: "minecraft:cobblestone", position: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld" });
  BotEvents.botItemUsed.trigger({ botName: "bot1", itemId: "minecraft:milk_bucket" });
  BotEvents.botEntityAttacked.trigger({ botName: "bot1", targetTypeId: "minecraft:zombie", damage: 7 });

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

test("领域事件：假人移动事件（botMoved）可触发并携带序列化负载", () => {
  const events: string[] = [];
  const off = BotEvents.botMoved.subscribe((e) =>
    events.push(`${e.botName}@${e.position.x},${e.position.y},${e.position.z}:${e.dimension}:${e.rotation.x},${e.rotation.y}`)
  );

  BotEvents.botMoved.trigger({
    botName: "bot1",
    position: { x: 10.5, y: 64, z: -5 },
    dimension: "minecraft:overworld",
    rotation: { x: 0, y: 90 },
  });

  assert.deepEqual(events, ["bot1@10.5,64,-5:minecraft:overworld:0,90"]);
  off();
});

test("领域事件：botMoved 订阅者异常隔离（单个崩溃不影响其他订阅者）", () => {
  const received: string[] = [];
  BotEvents.botMoved.subscribe(() => { throw new Error("boom"); });
  const off = BotEvents.botMoved.subscribe((e) => received.push(e.botName));

  BotEvents.botMoved.trigger({ botName: "bot1", position: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld", rotation: { x: 0, y: 0 } });

  assert.deepEqual(received, ["bot1"]);
  off();
});

// ─── UiEvents（UI 领域事件：面板动作 + 行为菜单提交） ──

test("BotUiEvent.panelAction：发布动作 → 订阅方按 action 过滤执行，退订生效", () => {
  const actions: string[] = [];
  const off = BotUiEvent.panelAction.subscribe((e) => actions.push(`${e.playerId}:${e.botName}:${e.action}`));

  BotUiEvent.panelAction.trigger({ playerId: "p1", botName: "$矿工", action: "kill" });
  BotUiEvent.panelAction.trigger({ playerId: "p1", botName: "$矿工", action: "rename" });

  assert.deepEqual(actions, ["p1:$矿工:kill", "p1:$矿工:rename"]);

  off();
  BotUiEvent.panelAction.trigger({ playerId: "p1", botName: "$矿工", action: "delete" });
  assert.equal(actions.length, 2);
});

test("BotUiEvent.behaviorSubmitted：负载全字段可序列化 + 多订阅者独立接收", () => {
  const received: string[] = [];
  const off1 = BotUiEvent.behaviorSubmitted.subscribe((e) => received.push(`a:${e.botName}:${e.tags.length}`));
  const off2 = BotUiEvent.behaviorSubmitted.subscribe((e) => received.push(`b:${e.botName}:${e.workMode}:${e.follow}`));

  BotUiEvent.behaviorSubmitted.trigger({
    playerId: "p1",
    botName: "$矿工",
    sneaking: false,
    chunkload: true,
    follow: false,
    useItem: true,
    coexist: ["mockplayer:tag:respawn"],
    workMode: "raid",
    tags: ["mockplayer:tag:bot", "mockplayer:tag:respawn"],
  });

  assert.deepEqual(received, ["a:$矿工:2", "b:$矿工:raid:false"]);

  off1();
  off2();
});

test("BotUiEvent.behaviorSubmitted：订阅者异常隔离（单个崩溃不影响其他）", () => {
  const received: string[] = [];
  BotUiEvent.behaviorSubmitted.subscribe(() => { throw new Error("boom"); });
  const off = BotUiEvent.behaviorSubmitted.subscribe((e) => received.push(e.botName));

  BotUiEvent.behaviorSubmitted.trigger({
    playerId: "p1", botName: "$矿工", sneaking: false, chunkload: false, follow: false, useItem: false,
    coexist: [], workMode: "none", tags: ["mockplayer:tag:bot"],
  });

  assert.deepEqual(received, ["$矿工"]);
  off();
});