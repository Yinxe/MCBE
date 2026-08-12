// ─── 工作流领域事件测试（core/events/WorkflowEvents） ──
// 每个事件一个独立信号（不合并总线）：订阅/触发/负载传递/异常隔离/取消订阅。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BotWorkflowEvent,
  workflowRaidStarted,
  workflowRaidVictory,
  workflowVaultOpened,
  type WorkflowRaidStartedEvent,
  type WorkflowRaidVictoryEvent,
  type WorkflowVaultOpenedEvent,
} from "../scripts/core/events/WorkflowEvents";

test("BotWorkflowEvent 聚合：每个事件一个独立信号（非合并总线）", () => {
  // 各信号是独立实例，订阅互不串扰
  assert.notEqual(BotWorkflowEvent.raidStarted, BotWorkflowEvent.raidVictory);
  assert.notEqual(BotWorkflowEvent.raidVictory, BotWorkflowEvent.vaultOpened);
});

test("raidStarted：订阅/触发/负载传递", () => {
  const received: WorkflowRaidStartedEvent[] = [];
  BotWorkflowEvent.raidStarted.subscribe((e) => received.push(e));
  workflowRaidStarted.trigger({ botName: "bot1", amplifier: 2 });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { botName: "bot1", amplifier: 2 });
});

test("raidVictory：wins 负载传递", () => {
  const received: WorkflowRaidVictoryEvent[] = [];
  workflowRaidVictory.subscribe((e) => received.push(e));
  workflowRaidVictory.trigger({ botName: "bot1", wins: 5 });
  assert.equal(received[0]?.wins, 5);
});

test("vaultOpened：开箱事件负载", () => {
  const received: WorkflowVaultOpenedEvent[] = [];
  BotWorkflowEvent.vaultOpened.subscribe((e) => received.push(e));
  workflowVaultOpened.trigger({ botName: "bot1", keyType: "minecraft:trial_key", remaining: 3 });
  assert.equal(received.length, 1);
  assert.equal(received[0]?.keyType, "minecraft:trial_key");
  assert.equal(received[0]?.remaining, 3);
});

test("订阅者异常隔离：崩溃订阅者不影响其他订阅者", () => {
  const received: WorkflowRaidVictoryEvent[] = [];
  BotWorkflowEvent.raidVictory.subscribe(() => { throw new Error("boom"); });
  BotWorkflowEvent.raidVictory.subscribe((e) => received.push(e));
  workflowRaidVictory.trigger({ botName: "bot2", wins: 1 });
  assert.equal(received.length, 1); // 正常订阅者仍收到
});

test("取消订阅后不再收到事件", () => {
  let count = 0;
  const unsub = workflowVaultOpened.subscribe(() => count++);
  workflowVaultOpened.trigger({ botName: "a", keyType: "k", remaining: 0 });
  unsub();
  workflowVaultOpened.trigger({ botName: "a", keyType: "k", remaining: 0 });
  assert.equal(count, 1);
});
