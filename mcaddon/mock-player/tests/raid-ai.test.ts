// ─── 劫掠任务行为树测试（core/tasks/RaidTask） ─────────────
// 事件驱动黑板 + 树决策验证（FakeRaidPorts 注入，树 tick 手动推进）：
//   村庄英雄事件 → 胜利处理（计胜/叠加/移除）→ 自然喝下一瓶（闭环）
//   无药水 → idle 报 no-bottle；袭击中 → 等待静默（waiting）
//   胜利处理优先于喝瓶（Selector 抢占）；事件窗口过期不重复处理

import { test } from "node:test";
import assert from "node:assert/strict";

import { Blackboard, Status, type AiContext } from "../scripts/core/ai";
import {
  createRaidTaskTree, VICTORY_WINDOW_TICKS,
  type RaidDrinkResult, type RaidIdleReason, type RaidKnowledge, type RaidPorts,
} from "../scripts/core/tasks/RaidTask";

/** 可控测试端口：感知快照可切换 + 记录调用 */
class FakeRaidPorts implements RaidPorts {
  available = true;
  knowledge: RaidKnowledge = {
    effects: { badOmen: false, raidOmen: false, villageHero: false },
    bottles: 3,
    lastHeroEventTick: -Infinity,
  };
  drinkResult: RaidDrinkResult = "drunk";

  drinkCalls = 0;
  victoryCalls = 0;
  idleReasons: RaidIdleReason[] = [];

  isBotAvailable(): boolean {
    return this.available;
  }
  sense(): RaidKnowledge {
    return this.knowledge;
  }
  async drinkBottle(): Promise<RaidDrinkResult> {
    this.drinkCalls++;
    return this.drinkResult;
  }
  handleVictory(): void {
    this.victoryCalls++;
    this.knowledge.effects.villageHero = false; // 模拟：移除英雄效果后不再待处理
  }
  idle(_botName: string, reason: RaidIdleReason): void {
    this.idleReasons.push(reason);
  }
}

function makeHarness(ports = new FakeRaidPorts()): { ports: FakeRaidPorts; tick: (t: number) => Promise<Status> } {
  const tree = createRaidTaskTree(ports);
  const bb = new Blackboard();
  return {
    ports,
    tick: async (t: number): Promise<Status> => {
      const ctx: AiContext = { botName: "bot1", blackboard: bb, tick: t };
      return tree.tick(ctx);
    },
  };
}

// ─── 胜利 → 喝瓶闭环 ─────────────────────────────────────

test("闭环：村庄英雄事件 → 胜利处理 → 效果移除 → 下 tick 自然喝下一瓶", async () => {
  const { ports, tick } = makeHarness();

  // 英雄事件（effectAdd 已写 lastHeroEventTick）
  ports.knowledge.effects.villageHero = true;
  ports.knowledge.lastHeroEventTick = 100;

  // 胜利处理（handleVictory 复位效果）
  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.victoryCalls, 1);
  assert.equal(ports.drinkCalls, 0); // 本轮只处理胜利

  // 下 tick：无兆头 + 有药水 → 喝下一瓶（自然闭环，无需事件链驱动）
  assert.equal(await tick(110), Status.Success);
  assert.equal(ports.drinkCalls, 1);
  assert.equal(ports.victoryCalls, 1); // 不重复处理
});

// ─── 缺药水通知 ──────────────────────────────────────────

test("无药水：喝瓶条件不满足 → idle 报 no-bottle（节流在端口层）", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge.bottles = 0;

  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.drinkCalls, 0);
  assert.deepEqual(ports.idleReasons, ["no-bottle"]);
});

// ─── 袭击中静默等待 ──────────────────────────────────────

test("袭击中（不祥之兆）：等待静默（waiting 不通知），喝瓶被条件拦住", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge.effects.badOmen = true;

  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.drinkCalls, 0); // 有兆头不重复喝
  assert.deepEqual(ports.idleReasons, ["waiting"]); // 静默
});

// ─── Selector 抢占：胜利优先于喝瓶 ────────────────────────

test("抢占：袭击中获村庄英雄 → 胜利处理优先（不先喝瓶）", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge.effects.badOmen = true; // 袭击还在进行
  ports.knowledge.effects.villageHero = true;
  ports.knowledge.lastHeroEventTick = 100;

  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.victoryCalls, 1); // 胜利处理优先
  assert.equal(ports.drinkCalls, 0); // 未触发喝瓶
});

// ─── 事件窗口过期（防重复处理/事件丢失防御） ──────────────

test("事件窗口过期：英雄效果残留但事件时刻过久 → 不重复胜利处理（喝瓶前端口会清理残留）", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge.effects.villageHero = true;
  ports.knowledge.lastHeroEventTick = 100; // 事件早已发生

  // tick 200：距事件 100 tick > 窗口 20 → 胜利条件不满足
  assert.equal(await tick(200), Status.Success);
  assert.equal(ports.victoryCalls, 0); // 不重复处理
  assert.equal(ports.drinkCalls, 1); // 无兆头 → 走喝瓶（端口内会防御清理残留英雄）
  assert.equal(VICTORY_WINDOW_TICKS, 20); // 窗口 = 引擎周期 10 tick 的余量
});
