// ─── 宝库任务行为树测试（core/ai/VaultTask） ─────────────
// 决策语义验证（FakeVaultPorts 注入，树 tick 手动推进）：
//   扫描 → 寻路 → 开箱 → 重连（黑板目标保留 = 一直开同一个宝库）
//   无钥匙 → idle；无宝库 → 冷却重扫；宝库已开过 → 3 次放弃换目标；寻路失败 → 清目标。

import { test } from "node:test";
import assert from "node:assert/strict";

import { Blackboard, type AiContext } from "../scripts/core/ai";
import { createVaultTaskTree, type VaultInteractResult, type VaultPorts } from "../scripts/core/tasks/VaultTask";
import type { Vec3 } from "../scripts/core/model/Types";

const VAULT_POS: Vec3 = { x: 10, y: 64, z: 20 };

/** 可控测试端口：记录调用 + 可切换场景状态 */
class FakeVaultPorts implements VaultPorts {
  available = true;
  key = true;
  scanResult: Vec3 | undefined = VAULT_POS;
  distance = 10; // 默认远（触发寻路）
  navigateResult = true;
  interactResult: VaultInteractResult = "consumed";

  scanCalls = 0;
  navigateCalls = 0;
  interactCalls = 0;
  reconnectCalls = 0;
  idleCalls = 0;

  isBotAvailable(): boolean {
    return this.available;
  }
  hasKey(): boolean {
    return this.key;
  }
  scanVault(): Vec3 | undefined {
    this.scanCalls++;
    return this.scanResult;
  }
  distanceToTarget(): number {
    return this.distance;
  }
  async navigateToVault(): Promise<boolean> {
    this.navigateCalls++;
    return this.navigateResult;
  }
  interactVault(): VaultInteractResult {
    this.interactCalls++;
    return this.interactResult;
  }
  tryReconnect(): void {
    this.reconnectCalls++;
  }
  idle(): void {
    this.idleCalls++;
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

// ─── 完整闭环 ────────────────────────────────────────────

test("完整链：扫描 → 寻路 → 开箱消耗 → 重连（黑板目标保留 → 重连后继续同一宝库）", async () => {
  const { ports, bb, tick } = makeHarness();

  // 第一次 tick：无目标 → 扫描成功，写入黑板
  assert.equal(await tick(100), "success");
  assert.equal(ports.scanCalls, 1);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS);

  // 第二次 tick：距离远（10 > 2.5）→ 寻路成功
  assert.equal(await tick(110), "success");
  assert.equal(ports.navigateCalls, 1);
  assert.equal(ports.interactCalls, 0);

  // 第三次 tick：距离近（1 ≤ 2.5）→ 开箱消耗 → 重连
  ports.distance = 1;
  assert.equal(await tick(120), "success");
  assert.equal(ports.interactCalls, 1);
  assert.equal(ports.reconnectCalls, 1);
  // 黑板目标保留（重连后继续同一宝库）
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS);

  // 模拟重连完成（假人回归、距离又变远）→ 再次寻路到同一目标
  ports.distance = 10;
  assert.equal(await tick(130), "success");
  assert.equal(ports.navigateCalls, 2);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS); // 目标未换
});

// ─── 无钥匙 ──────────────────────────────────────────────

test("无钥匙：不扫描不开箱，走 idle", async () => {
  const { ports, tick } = makeHarness();
  ports.key = false;

  for (const t of [100, 110, 120]) {
    assert.equal(await tick(t), "success");
  }
  assert.equal(ports.scanCalls, 0);
  assert.equal(ports.interactCalls, 0);
  assert.equal(ports.idleCalls, 3);
});

// ─── 无宝库冷却重扫 ──────────────────────────────────────

test("无宝库：扫描失败 → 冷却 40 tick → 到期重扫", async () => {
  const { ports, tick } = makeHarness();
  ports.scanResult = undefined;

  assert.equal(await tick(100), "success");
  assert.equal(ports.scanCalls, 1);
  assert.equal(ports.idleCalls, 1);

  // 冷却期内不再扫描
  assert.equal(await tick(120), "success");
  assert.equal(ports.scanCalls, 1);
  assert.equal(ports.idleCalls, 2);

  // 到期重扫（tick 140 = 100 + 40）
  assert.equal(await tick(140), "success");
  assert.equal(ports.scanCalls, 2);
});

// ─── 宝库已开过（假成功免疫） ────────────────────────────

test("持续点击语义：interact 未消耗（宝库冷却/动画中）→ 冷却后继续点击，不放弃目标", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "not-consumed";

  assert.equal(await tick(100), "success"); // 首次：扫描写目标
  // 多次点击未消耗（每次间隔 20 tick 冷却）→ 目标始终保留
  for (const t of [120, 140, 160, 180]) {
    assert.equal(await tick(t), "success");
  }
  assert.equal(ports.interactCalls, 4);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS); // 不放弃目标
  assert.equal(ports.reconnectCalls, 0); // 未消耗不重连

  // 宝库冷却结束 → 点击真消耗 → 重连（同一目标）
  ports.interactResult = "consumed";
  assert.equal(await tick(200), "success");
  assert.equal(ports.interactCalls, 5);
  assert.equal(ports.reconnectCalls, 1);
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS); // 重连后目标保留
});

// ─── 寻路失败 ────────────────────────────────────────────

test("寻路失败：清目标 → 重扫（无可达宝库则进入冷却）", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.navigateResult = false;

  assert.equal(await tick(100), "success"); // 扫描
  assert.equal(ports.navigateCalls, 0);

  // 寻路失败且没有其他宝库（扫描也失败）→ 目标已清 + 扫描进入冷却
  ports.scanResult = undefined;
  assert.equal(await tick(110), "success");
  assert.equal(ports.navigateCalls, 1);
  assert.equal(bb.has("vaultTarget"), false); // 目标已清
  assert.equal(ports.scanCalls, 2); // 失败后立即重扫了一次

  // 冷却期内不重扫（不疯狂扫描）
  assert.equal(await tick(130), "success");
  assert.equal(ports.scanCalls, 2);
});

// ─── 交互异常 ────────────────────────────────────────────

test("宝库被拆：interact 返回 target-gone → 清目标重扫", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "target-gone";

  assert.equal(await tick(100), "success"); // 首次：扫描写目标
  // 交互 target-gone → 目标清 + 同 tick 内重扫（没有其他宝库 → 扫描失败）
  ports.scanResult = undefined;
  assert.equal(await tick(120), "success");
  assert.equal(bb.has("vaultTarget"), false); // 目标已清
  assert.equal(ports.scanCalls, 2); // 失败后立即重扫了一次

  // 扫描进入冷却（40 tick），不再疯狂重扫
  assert.equal(await tick(140), "success");
  assert.equal(ports.scanCalls, 2);

  // 冷却到期重扫 → 找到新宝库 → 重新开箱
  ports.scanResult = VAULT_POS;
  ports.interactResult = "consumed";
  assert.equal(await tick(180), "success");
  assert.deepEqual(bb.get<Vec3>("vaultTarget"), VAULT_POS);
  assert.equal(ports.scanCalls, 3);
});

test("交互异常：failure 后受交互冷却约束再重试", async () => {
  const { ports, bb, tick } = makeHarness();
  ports.distance = 1;
  ports.interactResult = "error";

  assert.equal(await tick(100), "success"); // 首次：扫描写目标
  // 第一次交互异常
  assert.equal(await tick(110), "success");
  assert.equal(ports.interactCalls, 1);
  assert.equal(bb.has("vaultTarget"), true); // 目标保留（重试不放弃）

  // 冷却期（20 tick）内不重试
  assert.equal(await tick(120), "success");
  assert.equal(ports.interactCalls, 1);

  // 冷却到期重试
  assert.equal(await tick(140), "success");
  assert.equal(ports.interactCalls, 2);
});
