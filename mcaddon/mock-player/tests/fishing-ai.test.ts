// ─── 钓鱼任务行为树测试（core/tasks/FishingTask） ───────
// FakeFishingPorts 注入，树 tick 手动推进（沿 vault-ai.test.ts 模式）：
//   闭环：感知选点 → 寻路 → 就位 → 三检查 → fishOnce → 原地继续钓
//   跳过：钓鱼中 → 分支 1 直接跳过（不重复触发）
//   换点：landed/snagged → 下一候选（senseCalls 不增）；占用 → 实时跳过
//   缺因：no-rod/no-water/no-spot → idle 诊断序列
//   防抖：候选耗尽重扫 Cooldown 40 tick

import { test } from "node:test";
import assert from "node:assert/strict";

import { Blackboard, Status, type AiContext } from "../scripts/core/ai";
import { createFishingTaskTree, type FishingIdleReason, type FishingKnowledge, type FishingPorts } from "../scripts/core/tasks/FishingTask";
import type { FishingOutcome, FishingSpot } from "../scripts/core/tasks/FishingRules";
import type { Vec3 } from "../scripts/core/model/Types";

// ─── 测试数据 ────────────────────────────────────────────

const SPOT_A: FishingSpot = {
  stand: { x: 10, y: 4, z: 10 },
  support: { x: 10, y: 3, z: 10 },
  waters: [{ x: 10, y: 3, z: 9 }],
  aim: { target: { x: 10, y: 3, z: 9 }, level: 3 },
};
const SPOT_B: FishingSpot = {
  stand: { x: 20, y: 4, z: 20 },
  support: { x: 20, y: 3, z: 20 },
  waters: [{ x: 20, y: 3, z: 19 }],
  aim: { target: { x: 20, y: 3, z: 19 }, level: 5 },
};
const CAUGHT: FishingOutcome = { kind: "caught", loot: [{ typeId: "minecraft:cod", count: 1, enchantments: [] }], backpack: { usedSlots: 1, totalSlots: 36 } };

// ─── Fake 端口（可控结果 + 记录调用） ────────────────────

class FakeFishingPorts implements FishingPorts {
  available = true;
  rodAvailable = true; // 实时鱼竿判定（无鱼竿 → 不寻路不扫描）
  fishing = false; // isFishing（鱼钩存在性）
  onHere = false; // 当前位置是钓鱼点
  current: FishingSpot | undefined = undefined; // currentSpot
  knowledge: FishingKnowledge = { hasRod: true, spots: [SPOT_A], position: { x: 0, y: 0, z: 0 } };
  distance = 10; // 距目标站立格中心
  navigateResult = true;
  ensureResult = true;
  usable = true; // isSpotUsable 默认全部可用；可用 unusableStands 按点位控制
  unusableStands = new Set<string>(); // 被占用/失效的站立格（key: x,y,z）
  outcome: FishingOutcome = CAUGHT;

  senseCalls = 0;
  navigateCalls = 0;
  ensureCalls = 0;
  fishOnceCalls = 0;
  retractHookCalls = 0;
  idleReasons: FishingIdleReason[] = [];
  lastStand: Vec3 | undefined;

  isBotAvailable(): boolean {
    return this.available;
  }
  hasRod(): boolean {
    return this.rodAvailable;
  }
  isOnFishingSpot(): boolean {
    return this.onHere;
  }
  currentSpot(): FishingSpot | undefined {
    return this.current;
  }
  sense(): FishingKnowledge {
    this.senseCalls++;
    return this.knowledge;
  }
  distanceToSpot(): number {
    return this.distance;
  }
  async navigateToSpot(_b: string, stand: Vec3): Promise<boolean> {
    this.navigateCalls++;
    this.lastStand = stand;
    return this.navigateResult;
  }
  isAligned(): boolean {
    return true;
  }
  async ensureAimed(): Promise<boolean> {
    this.ensureCalls++;
    return this.ensureResult;
  }
  isSpotUsable(_b: string, stand: Vec3): boolean {
    return this.usable && !this.unusableStands.has(`${stand.x},${stand.y},${stand.z}`);
  }
  isFishing(): boolean {
    return this.fishing;
  }
  async fishOnce(): Promise<FishingOutcome> {
    this.fishOnceCalls++;
    return this.outcome;
  }
  async retractHook(): Promise<void> {
    this.retractHookCalls++;
    this.fishing = false; // 模拟收掉残留钩
  }
  idle(_b: string, reason: FishingIdleReason): void {
    this.idleReasons.push(reason);
  }
}

function makeHarness(ports = new FakeFishingPorts()) {
  const tree = createFishingTaskTree(ports);
  const bb = new Blackboard();
  return {
    ports,
    bb,
    tick: async (t: number): Promise<Status> => {
      const ctx: AiContext = { botName: "bot1", blackboard: bb, tick: t };
      return tree.tick(ctx);
    },
  };
}

// ─── 场景测试 ────────────────────────────────────────────

test("无鱼竿：不寻路不扫描，直接 idle no-rod（用户规格）", async () => {
  const h = makeHarness();
  h.ports.rodAvailable = false; // 没给鱼竿
  const status = await h.tick(100);
  assert.equal(status, Status.Success);
  assert.equal(h.ports.senseCalls, 0); // 不扫描
  assert.equal(h.ports.navigateCalls, 0); // 不寻路
  assert.equal(h.ports.fishOnceCalls, 0); // 不交互
  assert.deepEqual(h.ports.idleReasons, ["no-rod"]);
  // 给鱼竿后恢复正常流程
  h.ports.rodAvailable = true;
  assert.equal(await h.tick(110), Status.Success);
  assert.equal(h.ports.senseCalls, 1); // 开始扫描
});

test("钓鱼中直接跳过：不重复触发钓鱼能力（无堆积）", async () => {
  const h = makeHarness();
  h.ports.fishing = true; // 鱼钩在 = 钓鱼中（树 tick 时 = 异常残留）
  const status = await h.tick(100);
  assert.equal(status, Status.Success); // 分支 1 skip
  assert.equal(h.ports.fishOnceCalls, 0);
  assert.equal(h.ports.senseCalls, 0);
  assert.equal(h.ports.navigateCalls, 0);
});

test("鱼钩残留自愈：skip 收掉残留钩后恢复正常流程", async () => {
  const h = makeHarness();
  h.ports.fishing = true; // 残留钩（fishOnce 未在跑）
  assert.equal(await h.tick(100), Status.Success); // skip → retractHook
  assert.equal(h.ports.retractHookCalls, 1);
  assert.equal(h.ports.fishing, false); // 钩已收掉
  // 下 tick 恢复正常：感知选点 → 钓鱼
  assert.equal(await h.tick(110), Status.Success);
  assert.equal(await h.tick(120), Status.Success); // 就位（distance 默认 10 → navigate？）
  assert.equal(h.ports.fishOnceCalls, 0);
});

test("正常闭环：感知选点 → 寻路 → 就位 → 三检查 → 钓鱼成功 → 原地继续钓", async () => {
  const h = makeHarness();
  // ① 无目标 → 感知 + 选点（A）
  assert.equal(await h.tick(100), Status.Success);
  assert.equal(h.ports.senseCalls, 1);
  assert.equal(h.ports.navigateCalls, 0);
  // ② 未就位（distance=10）→ 寻路
  assert.equal(await h.tick(110), Status.Success);
  assert.equal(h.ports.navigateCalls, 1);
  assert.deepEqual(h.ports.lastStand, SPOT_A.stand);
  // ③ 就位（distance=0）→ 三检查 → 钓鱼成功
  h.ports.distance = 0;
  assert.equal(await h.tick(120), Status.Success);
  assert.equal(h.ports.ensureCalls, 1);
  assert.equal(h.ports.fishOnceCalls, 1);
  // ④ 持续钓鱼：下 tick 原地再钓（senseCalls 不增）
  assert.equal(await h.tick(130), Status.Success);
  assert.equal(h.ports.fishOnceCalls, 2);
  assert.equal(h.ports.senseCalls, 1); // 候选未耗尽不重扫
});

test("当前位置就是钓鱼点：useHere 直接用（零扫描）", async () => {
  const h = makeHarness();
  h.ports.onHere = true;
  h.ports.current = SPOT_A;
  h.ports.distance = 0;
  // ① useHere 写入目标（不感知）
  assert.equal(await h.tick(100), Status.Success);
  assert.equal(h.ports.senseCalls, 0);
  // ② 下 tick 就位 → 直接钓鱼
  assert.equal(await h.tick(110), Status.Success);
  assert.equal(h.ports.fishOnceCalls, 1);
});

test("点位被实体占用：validateSpot 清点换候选（不重扫）", async () => {
  const h = makeHarness();
  h.ports.distance = 0;
  h.ports.knowledge.spots = [SPOT_A, SPOT_B];
  // 选点（A）→ 就位 → 钓鱼
  assert.equal(await h.tick(100), Status.Success);
  assert.equal(await h.tick(110), Status.Success);
  assert.equal(h.ports.fishOnceCalls, 1);
  // 点位被实体占用（其他实体站进来）→ validateSpot 清点 → 换候选 B（B 可用）
  h.ports.unusableStands.add("10,4,10"); // A 被占用
  assert.equal(await h.tick(120), Status.Success); // 清点 + 换候选
  assert.equal(h.ports.senseCalls, 1); // 候选未耗尽（B 在列表），不重扫
  h.ports.distance = 10; // B 未就位 → 寻路
  assert.equal(await h.tick(130), Status.Success);
  assert.equal(h.ports.navigateCalls, 1);
  assert.deepEqual(h.ports.lastStand, SPOT_B.stand);
});

test("pickSpot 实时占用：候选被占跳过换下一个", async () => {
  const h = makeHarness();
  h.ports.knowledge.spots = [SPOT_A, SPOT_B];
  h.ports.unusableStands.add("10,4,10"); // A 被占用，B 可用
  assert.equal(await h.tick(100), Status.Success); // sense + pickSpot → 选 B
  h.ports.distance = 10;
  assert.equal(await h.tick(110), Status.Success);
  assert.deepEqual(h.ports.lastStand, SPOT_B.stand); // 跳过 A 选中 B
});

test("钓鱼失败 landed：换下一候选（senseCalls 不增）", async () => {
  const h = makeHarness();
  h.ports.knowledge.spots = [SPOT_A, SPOT_B];
  h.ports.distance = 0;
  assert.equal(await h.tick(100), Status.Success); // 选 A
  h.ports.outcome = { kind: "failed", reason: "landed" };
  assert.equal(await h.tick(110), Status.Success); // doFishing 失败 → 清点
  h.ports.distance = 10; // B 未就位（换候选后走寻路）
  assert.equal(await h.tick(120), Status.Success); // 换候选 B（不重扫）
  assert.equal(h.ports.senseCalls, 1);
  assert.equal(await h.tick(130), Status.Success);
  assert.deepEqual(h.ports.lastStand, SPOT_B.stand); // 换到 B
});

test("钓鱼超时：原地重抛（继续钓）", async () => {
  const h = makeHarness();
  h.ports.distance = 0;
  assert.equal(await h.tick(100), Status.Success);
  h.ports.outcome = { kind: "timeout" };
  assert.equal(await h.tick(110), Status.Success); // timeout → Success 重抛
  assert.equal(await h.tick(120), Status.Success);
  assert.equal(h.ports.fishOnceCalls, 2);
});

test("无鱼竿缺因：no-rod 诊断 + idle 通知", async () => {
  const h = makeHarness();
  h.ports.knowledge = { hasRod: false, spots: [], position: { x: 0, y: 0, z: 0 } };
  assert.equal(await h.tick(100), Status.Success); // sense 无候选 → pickSpot 失败 → idle
  assert.equal(h.ports.idleReasons.length, 1);
  assert.equal(h.ports.idleReasons[0], "no-rod");
});

test("缺因优先级：no-water > no-spot（感知失败原因）", async () => {
  const h = makeHarness();
  h.ports.knowledge = { hasRod: true, spots: [], reason: "no-water", position: { x: 0, y: 0, z: 0 } };
  assert.equal(await h.tick(100), Status.Success);
  assert.equal(h.ports.idleReasons[h.ports.idleReasons.length - 1], "no-water");

  const h2 = makeHarness();
  h2.ports.knowledge = { hasRod: true, spots: [], reason: "no-spot", position: { x: 0, y: 0, z: 0 } };
  assert.equal(await h2.tick(100), Status.Success);
  assert.equal(h2.ports.idleReasons[h2.ports.idleReasons.length - 1], "no-spot");
});

test("候选耗尽重扫：Cooldown 40 tick 防抖（冷却期内不重扫）", async () => {
  const h = makeHarness();
  h.ports.knowledge = { hasRod: true, spots: [], position: { x: 0, y: 0, z: 0 } };
  assert.equal(await h.tick(100), Status.Success); // 第一次 sense
  assert.equal(h.ports.senseCalls, 1);
  // 冷却期内（40 tick）：分支 5 短路失败，不重扫
  for (let t = 110; t <= 130; t += 10) {
    await h.tick(t);
  }
  assert.equal(h.ports.senseCalls, 1);
  // 冷却结束（40 tick 后）→ 重扫
  assert.equal(await h.tick(150), Status.Success);
  assert.equal(h.ports.senseCalls, 2);
});

test("寻路失败：清点换候选", async () => {
  const h = makeHarness();
  h.ports.knowledge.spots = [SPOT_A, SPOT_B];
  assert.equal(await h.tick(100), Status.Success); // 选 A
  h.ports.navigateResult = false;
  assert.equal(await h.tick(110), Status.Success); // 寻路失败 → 清点
  assert.equal(await h.tick(120), Status.Success); // 换候选 B
  h.ports.navigateResult = true;
  h.ports.distance = 10;
  assert.equal(await h.tick(130), Status.Success);
  assert.deepEqual(h.ports.lastStand, SPOT_B.stand);
});
