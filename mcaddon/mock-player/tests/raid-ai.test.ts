// ─── 劫掠任务行为树测试（core/tasks/RaidTask） ─────────────
// 事件驱动黑板 + 树决策验证（FakeRaidPorts 注入，树 tick 手动推进）：
//   村庄英雄事件 → 胜利处理（计胜/叠加/移除）→ 自然喝下一瓶（闭环）
//   无药水 → idle 报 no-bottle；袭击中 → 等待静默（waiting）
//   胜利处理优先于喝瓶（Selector 抢占）；事件窗口过期不重复处理
//   劫掠领域事件（RaidEvents）内聚信号；阶段状态（无波次估算）

import { test } from "node:test";
import assert from "node:assert/strict";

import { Blackboard, Status, type AiContext } from "../scripts/core/ai";
import {
  createRaidTaskTree, VICTORY_WINDOW_TICKS, initialRaidPhaseState,
  raidStarted, raidVictory, raidPhase,
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

// ─── 启动喝瓶 → 周期等待 → 胜利后喝下一瓶（闭环） ────────

test("闭环：启动喝第一瓶 → 周期等待（兆头消失也不重复喝）→ 胜利 → 清标记 → 喝下一瓶", async () => {
  const { ports, tick } = makeHarness();

  // 启动（黑板空）：无兆头 + 有药水 → 喝第一瓶
  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.drinkCalls, 1);

  // 喝瓶后获得不祥之兆（袭击酝酿）→ 不喝
  ports.knowledge.effects.badOmen = true;
  assert.equal(await tick(110), Status.Success);
  assert.equal(ports.drinkCalls, 1);

  // ⚠️ 核心修复：兆头过期消失（袭击未触发/被打断）→ 周期等待中，**不重复喝**
  ports.knowledge.effects.badOmen = false;
  assert.equal(await tick(120), Status.Success);
  assert.equal(await tick(130), Status.Success);
  assert.equal(ports.drinkCalls, 1); // 修复前会反复喝第 2 瓶
  assert.ok(ports.idleReasons.every((r) => r === "waiting")); // 静默等待（不通知无药水）

  // 袭击胜利：村庄英雄事件 → 胜利处理（清周期标记）
  ports.knowledge.effects.villageHero = true;
  ports.knowledge.lastHeroEventTick = 140;
  assert.equal(await tick(140), Status.Success);
  assert.equal(ports.victoryCalls, 1);
  assert.equal(ports.drinkCalls, 1); // 本轮只处理胜利

  // 下 tick：胜利处理完成 → 自然喝下一瓶
  assert.equal(await tick(150), Status.Success);
  assert.equal(ports.drinkCalls, 2); // 胜利后才喝第 2 瓶
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

// ─── 阶段状态（事件驱动，无波次估算） ────────────────────

test("阶段状态：初始 idle；initialRaidPhaseState 返回基础状态", () => {
  const s = initialRaidPhaseState();
  assert.equal(s.phase, "idle");
});

// ─── 劫掠领域事件（内聚 RaidEvents） ─────────────────────

test("RaidEvents：raidStarted/raidVictory/raidPhase 信号可触发并携带序列化负载", () => {
  const started: string[] = [];
  const victory: string[] = [];
  const phases: string[] = [];
  const off1 = raidStarted.subscribe((e) => started.push(`${e.botName}:${e.amplifier}`));
  const off2 = raidVictory.subscribe((e) => victory.push(`${e.botName}:${e.amplifier}`));
  const off3 = raidPhase.subscribe((e) => phases.push(`${e.botName}:${e.phase}:${e.detail}`));

  raidStarted.trigger({ botName: "bot1", amplifier: 2 });
  raidVictory.trigger({ botName: "bot1", amplifier: 1 });
  raidPhase.trigger({ botName: "bot1", phase: "started", detail: "袭击完全开始！" });

  assert.deepEqual(started, ["bot1:2"]);
  assert.deepEqual(victory, ["bot1:1"]);
  assert.deepEqual(phases, ["bot1:started:袭击完全开始！"]);

  off1();
  off2();
  off3();
});
