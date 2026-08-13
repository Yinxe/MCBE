// ─── 宝库任务行为树测试（core/tasks/VaultTask） ─────────────
// 感知驱动决策验证（FakeVaultPorts 注入，树 tick 手动推进）：
//   感知分类 → 目标选择（**优先不详宝库**）→ 寻路 → 开箱 → 重连（黑板保留）
//   缺因诊断（缺钥匙/缺宝库/缺不详钥匙）→ idle 通知精确原因
//   持续点击（未消耗不放弃）/ 宝库消失（target-gone 清目标重扫）

import { test } from "node:test";
import assert from "node:assert/strict";

import { Blackboard, Status, type AiContext } from "../scripts/core/ai";
import {
  createVaultTaskTree, OMINOUS_TRIAL_KEY, TRIAL_KEY,
  type VaultIdleReason, type VaultInteractResult, type VaultKnowledge, type VaultPorts,
} from "../scripts/core/tasks/VaultTask";
import type { Vec3 } from "../scripts/core/model/Types";

const NORMAL_VAULT: Vec3 = { x: 10, y: 64, z: 20 };
const OMINOUS_VAULT: Vec3 = { x: -10, y: 64, z: 20 };

/** 可控测试端口：感知快照可切换 + 记录调用 */
class FakeVaultPorts implements VaultPorts {
  available = true;
  knowledge: VaultKnowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [NORMAL_VAULT], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };
  distance = 10; // 默认远（触发寻路）
  navigateResult = true;
  interactResult: VaultInteractResult = "consumed";

  senseCalls = 0;
  navigateCalls = 0;
  interactCalls = 0;
  reconnectCalls = 0;
  idleReasons: VaultIdleReason[] = [];
  lastKeyType: string | undefined;

  isBotAvailable(): boolean {
    return this.available;
  }
  sense(): VaultKnowledge {
    this.senseCalls++;
    return this.knowledge;
  }
  distanceToTarget(): number {
    return this.distance;
  }
  async navigateToVault(): Promise<boolean> {
    this.navigateCalls++;
    return this.navigateResult;
  }
  interactVault(_botName: string, _target: Vec3, keyType: string): VaultInteractResult {
    this.interactCalls++;
    this.lastKeyType = keyType;
    return this.interactResult;
  }
  tryReconnect(): void {
    this.reconnectCalls++;
  }
  idle(_botName: string, reason: VaultIdleReason): void {
    this.idleReasons.push(reason);
  }
}

function makeHarness(ports = new FakeVaultPorts()): { ports: FakeVaultPorts; bb: Blackboard; tick: (t: number) => Promise<string> } {
  const tree = createVaultTaskTree(ports);
  const bb = new Blackboard();
  return {
    ports,
    bb,
    tick: async (t: number): Promise<string> => {
      const ctx: AiContext = { botName: "bot1", blackboard: bb, tick: t };
      return tree.tick(ctx);
    },
  };
}

// ─── 完整闭环（普通宝库） ─────────────────────────────────

test("完整链：感知 → 选普通宝库（普通钥匙）→ 寻路 → 开箱消耗 → 重连（黑板保留）", async () => {
  const { ports, bb, tick } = makeHarness();

  // 第一次 tick：无目标 → 感知 + 选目标（普通宝库，key=普通钥匙）
  assert.equal(await tick(100), Status.Success);
  assert.equal(ports.senseCalls, 1);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT);
  assert.equal(bb.get<string>("vaultTargetKey"), TRIAL_KEY);
  assert.equal(bb.get<"normal" | "ominous">("vaultTargetKind"), "normal");

  // 第二次 tick：距离远 → 寻路成功
  assert.equal(await tick(110), Status.Success);
  assert.equal(ports.navigateCalls, 1);
  assert.equal(ports.interactCalls, 0);

  // 第三次 tick：距离近 → 开箱消耗（选定钥匙类型）→ 重连
  ports.distance = 1;
  assert.equal(await tick(120), Status.Success);
  assert.equal(ports.interactCalls, 1);
  assert.equal(ports.lastKeyType, TRIAL_KEY);
  assert.equal(ports.reconnectCalls, 1);
  // 黑板目标保留（重连后继续同一宝库）
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT);

  // 模拟重连完成（距离又变远）→ 再次寻路到同一目标
  ports.distance = 10;
  assert.equal(await tick(130), Status.Success);
  assert.equal(ports.navigateCalls, 2);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT); // 目标未换
});

// ─── 优先不详宝库 ────────────────────────────────────────

test("优先不详宝库：有不详钥匙 + 两种宝库 → 选不详宝库（不详钥匙）", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.knowledge = {
    keys: { trial: 1, ominous: 1 },
    vaults: { normal: [NORMAL_VAULT], ominous: [OMINOUS_VAULT] },
    position: { x: 0, y: 0, z: 0 },
  };

  assert.equal(await tick(100), Status.Success);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), OMINOUS_VAULT); // 优先不详
  assert.equal(bb.get<string>("vaultTargetKey"), OMINOUS_TRIAL_KEY);
  assert.equal(bb.get<"normal" | "ominous">("vaultTargetKind"), "ominous");

  ports.distance = 1;
  assert.equal(await tick(120), Status.Success);
  assert.equal(ports.lastKeyType, OMINOUS_TRIAL_KEY);
  assert.equal(ports.reconnectCalls, 1);
});

test("不详钥匙兜底开普通宝库：只有不详钥匙 + 普通宝库 → 选普通宝库（不详钥匙）", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.knowledge = {
    keys: { trial: 0, ominous: 1 },
    vaults: { normal: [NORMAL_VAULT], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };

  assert.equal(await tick(100), Status.Success);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT);
  assert.equal(bb.get<string>("vaultTargetKey"), OMINOUS_TRIAL_KEY); // 不详钥匙兜底
});

// ─── 缺因诊断（开不了宝库的通知原因） ────────────────────

test("缺因：背包无任何钥匙 → idle 报 no-key（不感知不重扫）", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge = {
    keys: { trial: 0, ominous: 0 },
    vaults: { normal: [NORMAL_VAULT], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };

  assert.equal(await tick(100), Status.Success);
  assert.deepEqual(ports.idleReasons, ["no-key"]);
  assert.equal(ports.interactCalls, 0);
});

test("缺因：有钥匙但附近无宝库 → idle 报 no-vault", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };

  assert.equal(await tick(100), Status.Success);
  assert.deepEqual(ports.idleReasons, ["no-vault"]);
});

test("缺因：只有不详宝库 + 无不详钥匙 → idle 报 no-ominous-key（感知冷却后重试）", async () => {
  const { ports, tick } = makeHarness();
  ports.knowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [], ominous: [OMINOUS_VAULT] },
    position: { x: 0, y: 0, z: 0 },
  };

  assert.equal(await tick(100), Status.Success);
  assert.deepEqual(ports.idleReasons, ["no-ominous-key"]);
  assert.equal(ports.senseCalls, 1);

  // 冷却期（40 tick）内不重感知
  assert.equal(await tick(130), Status.Success);
  assert.equal(ports.senseCalls, 1);
  assert.equal(ports.idleReasons.length, 2); // 持续按原因提醒（节流在 mc 层）

  // 到期重感知
  assert.equal(await tick(140), Status.Success);
  assert.equal(ports.senseCalls, 2);
});

// ─── 持续点击（未消耗不放弃目标） ─────────────────────────

test("持续点击语义：interact 未消耗（宝库冷却/动画中）→ 冷却后继续点击，不放弃目标", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "not-consumed";

  assert.equal(await tick(100), Status.Success); // 感知选目标
  for (const t of [120, 140, 160, 180]) {
    assert.equal(await tick(t), Status.Success);
  }
  assert.equal(ports.interactCalls, 4);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT); // 不放弃目标
  assert.equal(ports.reconnectCalls, 0); // 未消耗不重连

  // 宝库冷却结束 → 点击真消耗 → 重连（同一目标）
  ports.interactResult = "consumed";
  assert.equal(await tick(200), Status.Success);
  assert.equal(ports.interactCalls, 5);
  assert.equal(ports.reconnectCalls, 1);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), NORMAL_VAULT); // 重连后目标保留
});

// ─── 目标失效（宝库被拆） ────────────────────────────────

test("宝库被拆：interact 返回 target-gone → 清目标重扫", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "target-gone";

  assert.equal(await tick(100), Status.Success); // 感知选目标
  // 交互 target-gone → 目标清 + 同 tick 内重扫（没有其他宝库 → 感知失败）
  ports.knowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };
  assert.equal(await tick(120), Status.Success);
  assert.equal(bb.has("vaultTarget"), false); // 目标已清
  assert.equal(ports.senseCalls, 2); // 失败后立即重感知了一次

  // 感知进入冷却（40 tick），不再疯狂重扫
  assert.equal(await tick(140), Status.Success);
  assert.equal(ports.senseCalls, 2);
});

// ─── 寻路失败 ────────────────────────────────────────────

test("寻路失败：清目标 → 重感知（无可达宝库则进入冷却）", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.navigateResult = false;

  assert.equal(await tick(100), Status.Success); // 感知选目标
  assert.equal(ports.navigateCalls, 0);

  // 寻路失败且没有其他宝库（感知也拿不到目标）→ 目标已清 + 感知进入冷却
  ports.knowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };
  assert.equal(await tick(110), Status.Success);
  assert.equal(ports.navigateCalls, 1);
  assert.equal(bb.has("vaultTarget"), false); // 目标已清
  assert.equal(ports.senseCalls, 2); // 失败后立即重感知了一次
});

// ─── 交互异常 ────────────────────────────────────────────

test("交互异常：failure 后受交互冷却约束再重试", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "error";

  assert.equal(await tick(100), Status.Success); // 感知选目标
  assert.equal(await tick(120), Status.Success); // 第一次交互异常（交互冷却 20tick：120-100 不足？首次无记录 → 放行）
  assert.equal(ports.interactCalls, 1);
  assert.equal(bb.has("vaultTarget"), true); // 目标保留（重试不放弃）

  // 冷却期（20 tick）内不重试
  assert.equal(await tick(130), Status.Success);
  assert.equal(ports.interactCalls, 1);

  // 冷却到期重试
  assert.equal(await tick(150), Status.Success);
  assert.equal(ports.interactCalls, 2);
});
