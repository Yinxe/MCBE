// ─── 宝库 domain 纯逻辑单测：目标选择优先级 / 四分支缺因诊断 / 正面站立点数学 / 最近可达择优 ──
// 锁：普通宝库只接受普通钥匙（不详不可替代）。
// 站位取 cardinal_direction 反方向（从侧面/背面点击看似成功但实际不开箱）。
import test from "node:test";
import assert from "node:assert/strict";

import {
  createVaultFlowState,
  diagnoseVaultIdle,
  fallbackStandCandidates,
  frontStandCandidates,
  OMINOUS_TRIAL_KEY,
  orderStandCandidates,
  selectVaultTarget,
  TRIAL_KEY,
  vaultBlockKey,
  VAULT_SIGHT_DISTANCE,
  withinVaultSightDistance,
  type VaultKnowledge,
} from "../scripts/domain/VaultRules";
import type { Vec3 } from "../scripts/domain/Coords";

function knowledge(
  keys: { trial: number; ominous: number },
  vaults: { normal?: number[]; ominous?: number[] } = {}
): VaultKnowledge {
  const toList = (ys: number[] | undefined) => (ys ?? []).map((y) => ({ x: 10, y, z: 10 }));
  return {
    keys,
    vaults: { normal: toList(vaults.normal), ominous: toList(vaults.ominous) },
    position: { x: 0, y: 0, z: 0 },
  };
}

test("selectVaultTarget：优先不详宝库（有不详钥匙时），列表 [0] 即最近", () => {
  const k = knowledge({ trial: 3, ominous: 1 }, { normal: [1], ominous: [2] });
  const sel = selectVaultTarget(k);
  assert.equal(sel?.kind, "ominous");
  assert.equal(sel?.key, OMINOUS_TRIAL_KEY);
  assert.deepEqual(sel?.target, { x: 10, y: 2, z: 10 });
});

test("selectVaultTarget：普通宝库只认普通钥匙（不详不可替代，用户规格 1.1.59）", () => {
  // 只有普通宝库 + 只有不详钥匙 → 选不出（普通钥匙数=0）
  assert.equal(selectVaultTarget(knowledge({ trial: 0, ominous: 5 }, { normal: [1] })), undefined);
  // 只有普通宝库 + 有普通钥匙 → 普通目标
  const sel = selectVaultTarget(knowledge({ trial: 1, ominous: 0 }, { normal: [7] }));
  assert.equal(sel?.kind, "normal");
  assert.equal(sel?.key, TRIAL_KEY);
});

test("selectVaultTarget：有不详钥匙但只有普通宝库 → 仍走普通钥匙分支", () => {
  const sel = selectVaultTarget(knowledge({ trial: 2, ominous: 2 }, { normal: [1] }));
  assert.equal(sel?.kind, "normal");
  assert.equal(sel?.key, TRIAL_KEY);
});

test("selectVaultTarget：无钥匙或无宝库一律选不出", () => {
  assert.equal(selectVaultTarget(knowledge({ trial: 0, ominous: 0 }, { normal: [1], ominous: [1] })), undefined);
  assert.equal(selectVaultTarget(knowledge({ trial: 1, ominous: 1 }, {})), undefined);
});

test("diagnoseVaultIdle：四缺因精确分流（判定顺序=归档口径）", () => {
  assert.equal(diagnoseVaultIdle(knowledge({ trial: 0, ominous: 0 }, { normal: [1] })), "no-key"); // 无钥匙先于缺宝库判定
  assert.equal(diagnoseVaultIdle(knowledge({ trial: 1, ominous: 0 }, {})), "no-vault"); // 有钥匙无宝库
  assert.equal(diagnoseVaultIdle(knowledge({ trial: 5, ominous: 0 }, { ominous: [1] })), "no-ominous-key"); // 只有不详宝库、缺不详钥匙
  assert.equal(diagnoseVaultIdle(knowledge({ trial: 0, ominous: 1 }, { normal: [1] })), "no-trial-key"); // 有普通宝库、缺普通钥匙
  assert.equal(diagnoseVaultIdle(knowledge({ trial: 1, ominous: 0 }, { normal: [1] })), undefined); // 选得出 → 不会 idle
});

test("frontStandCandidates：朝向反方向 1~2 格（面对钥匙孔正面）", () => {
  const v = { x: 0, y: 0, z: 0 };
  // 宝库朝北 → 站南侧（z+）
  assert.deepEqual(frontStandCandidates(v, "north"), [
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 2 },
  ]);
  // 宝库朝南 → 站北侧（z-）
  assert.deepEqual(frontStandCandidates(v, "south")[0], { x: 0, y: 0, z: -1 });
  // 宝库朝东 → 站西侧（x-）
  assert.deepEqual(frontStandCandidates(v, "east")[0], { x: -1, y: 0, z: 0 });
  // 宝库朝西 → 站东侧（x+）
  assert.deepEqual(frontStandCandidates(v, "west")[0], { x: 1, y: 0, z: 0 });
  // 未知朝向 → 原地两点（无位移意义，交由上层兜底环——不抛错即可）
  assert.equal(frontStandCandidates(v, "?").length, 2);
});

test("fallbackStandCandidates：近环（1 格四向）先于远环（2 格四向）", () => {
  const list = fallbackStandCandidates({ x: 5, y: 64, z: 7 });
  assert.equal(list.length, 8);
  assert.deepEqual(list.slice(0, 4), [
    { x: 6, y: 64, z: 7 },
    { x: 4, y: 64, z: 7 },
    { x: 5, y: 64, z: 8 },
    { x: 5, y: 64, z: 6 },
  ]);
  assert.deepEqual(list[4], { x: 7, y: 64, z: 7 });
  // 同层 y（站立点与宝库同高）
  assert.ok(list.every((p) => p.y === 64));
});

test("createVaultFlowState：空白板（目标未定/冷却与节流归零/封锁表空）", () => {
  const st = createVaultFlowState();
  assert.equal(st.target, undefined);
  assert.equal(st.knowledge, undefined);
  assert.equal(st.lastInteractAt, 0);
  assert.equal(st.notifyAt, 0);
  assert.equal(st.reconnectAt, 0);
  assert.deepEqual(st.blocked, {});
});

// ─── 近距可视免寻路闸 ──

test("withinVaultSightDistance：3D<3 判近（垂直落差计入），恰 3 判远", () => {
  assert.equal(VAULT_SIGHT_DISTANCE, 3);
  const vault: Vec3 = { x: 10, y: 64, z: 10 };
  // 平层站旁边（脚位按格计）→ 近
  assert.equal(withinVaultSightDistance({ x: 11.5, y: 64, z: 10 }, vault), true);
  // 水平只差 2 但宝库在楼上（落差 2.5 → 3D≈3.2）→ 判远，不误跳寻路
  assert.equal(withinVaultSightDistance({ x: 12, y: 61.5, z: 10 }, vault), false);
  // 恰在阈值上（distance3d = 3）→ 判远（严格 <）
  assert.equal(withinVaultSightDistance({ x: 13, y: 64, z: 10 }, vault), false);
  assert.equal(withinVaultSightDistance({ x: 12.9, y: 64, z: 10 }, vault), true);
});

// ─── 最近可达择优 ──

test("vaultBlockKey：向下取整稳定键（同格浮点/负坐标同键）", () => {
  assert.equal(vaultBlockKey({ x: 3, y: -4, z: 5 }), "3,-4,5");
  assert.equal(vaultBlockKey({ x: 3.7, y: -4.2, z: 5.5 }), "3,-5,5");
});

test("selectVaultTarget：封锁表让位——最近不可达换次近可达，同类内生效", () => {
  const near: Vec3 = { x: 10, y: 64, z: 10 };
  const far: Vec3 = { x: 30, y: 64, z: 10 };
  // 感知契约：列表近→远预排序（scanVaults 侧保证）
  const k: VaultKnowledge = {
    keys: { trial: 1, ominous: 0 },
    vaults: { normal: [near, far], ominous: [] },
    position: { x: 0, y: 0, z: 0 },
  };
  // 无封锁 → 最近
  assert.deepEqual(selectVaultTarget(k)?.target, near);
  // 最近者被导航失败封锁 → 改选距离次近的
  assert.deepEqual(selectVaultTarget(k, { [vaultBlockKey(near)]: "normal" })?.target, far);
  // 全封锁 → 选不出（上层整表自解轮询）
  assert.equal(selectVaultTarget(k, { [vaultBlockKey(near)]: "normal", [vaultBlockKey(far)]: "normal" }), undefined);
  // 不详优先分支同样跳过封锁位
  k.vaults.ominous = [near, far];
  k.keys.ominous = 1;
  assert.deepEqual(selectVaultTarget(k, { [vaultBlockKey(near)]: "ominous" })?.target, far);
});

test("orderStandCandidates：可站过滤+去重+离参考点近→远（正面被挡绕近环）", () => {
  const vault: Vec3 = { x: 0, y: 64, z: 0 };
  const standableAll = () => true;
  // 假人在宝库东侧 → 东向候选最近先出（不再死守正面序）
  const all = orderStandCandidates(
    [...frontStandCandidates(vault, "north"), ...fallbackStandCandidates(vault)],
    standableAll,
    { x: 5, y: 64, z: 0 }
  );
  assert.deepEqual(all[0], { x: 2, y: 64, z: 0 });
  assert.equal(all.length, 8, "正面 2 点与兜底环重合位去重（10 候选 → 8  unique 格）");
  // 正面近格不可站 → 退到其余可站点；全不可站 → 空表（上层换宝库）
  const onlyFrontBlocked = orderStandCandidates([vault, { x: 1, y: 64, z: 0 }], (p) => p.x === 1, vault);
  assert.deepEqual(onlyFrontBlocked, [{ x: 1, y: 64, z: 0 }]);
  assert.deepEqual(
    orderStandCandidates(fallbackStandCandidates(vault), () => false, vault),
    []
  );
});
