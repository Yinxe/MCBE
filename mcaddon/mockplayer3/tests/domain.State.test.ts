// ─── 状态机 + 启动对账单测：迁移表全枚举 ───────────────
import test from "node:test";
import assert from "node:assert/strict";

import {
  transit,
  hasSession,
  mayHaveEntity,
  isFrozen,
  canTickCapability,
  isOnlineInFlight,
  reconcileStartup,
} from "../scripts/domain/State";
import type { LifecycleIntent, LifecycleState } from "../scripts/domain/State";

const STATES: LifecycleState[] = [
  "REGISTERED",
  "SPAWNING",
  "RESTORING",
  "ACTIVE",
  "WORKING",
  "DYING",
  "OFFLINE",
  "DELETED",
];
const INTENTS: LifecycleIntent[] = [
  "online",
  "offline",
  "death",
  "respawn",
  "spawned",
  "restored",
  "startWork",
  "stopWork",
  "delete",
  "abortSpawn",
];

// 期望迁移表：枚举合法边，表外一律幂等 no-op
const EXPECTED: Partial<Record<LifecycleState, Partial<Record<LifecycleIntent, LifecycleState>>>> = {
  REGISTERED: { online: "SPAWNING", delete: "DELETED" },
  SPAWNING: { spawned: "RESTORING", abortSpawn: "OFFLINE", death: "DYING" },
  RESTORING: { restored: "ACTIVE", abortSpawn: "OFFLINE", death: "DYING" },
  ACTIVE: { startWork: "WORKING", offline: "OFFLINE", death: "DYING", delete: "DELETED" },
  WORKING: { stopWork: "ACTIVE", offline: "OFFLINE", death: "DYING", delete: "DELETED" },
  DYING: { respawn: "RESTORING", offline: "OFFLINE", delete: "DELETED" },
  OFFLINE: { online: "SPAWNING", delete: "DELETED" },
  DELETED: {},
};

test("状态机：全态×全意图枚举，合法边精确命中、表外幂等 no-op", () => {
  for (const from of STATES) {
    for (const intent of INTENTS) {
      const want = EXPECTED[from]?.[intent];
      const got = transit(from, intent);
      if (want) {
        assert.equal(got.noop, false, `${from}+${intent} 应合法`);
        assert.equal(got.next, want, `${from}+${intent} → ${want}`);
      } else {
        assert.equal(got.noop, true, `${from}+${intent} 应 no-op`);
        assert.equal(got.next, from, `${from}+${intent} 保持原态`);
      }
    }
  }
});

test("状态机：DELETED 终态对所有意图 no-op（记录移除竞态防护）", () => {
  for (const intent of INTENTS) {
    assert.deepEqual(transit("DELETED", intent), { next: "DELETED", noop: true });
  }
});

test("状态谓词：会话/实体/冻结/再入判定与 01 章 §3/§4 一致", () => {
  for (const s of STATES) {
    assert.equal(hasSession(s), mayHaveEntity(s), `${s}：会话存在与实体可能存在同步`);
  }
  assert.deepEqual(STATES.filter(hasSession), ["SPAWNING", "RESTORING", "ACTIVE", "WORKING", "DYING"]);
  assert.equal(isFrozen("DYING"), true);
  assert.equal(isFrozen("RESTORING"), true);
  assert.equal(isFrozen("ACTIVE"), false);
  assert.equal(canTickCapability("WORKING"), true);
  assert.equal(canTickCapability("ACTIVE"), false);
  assert.equal(isOnlineInFlight("SPAWNING"), true);
  assert.equal(isOnlineInFlight("RESTORING"), true);
  assert.equal(isOnlineInFlight("ACTIVE"), false);
});

test("启动对账：残留在线声明一律归一为离线，死亡标注原样保留", () => {
  const claims = [
    { botId: 1, declaredOnline: false, deathMark: false }, // 离线原样
    { botId: 2, declaredOnline: true, deathMark: true }, // 在线死亡→离线保留死亡标注
    { botId: 3, declaredOnline: true, deathMark: false }, // 在线存活→离线
  ];
  const verdicts = reconcileStartup(claims);
  assert.deepEqual(verdicts, [
    { botId: 1, declaredOnline: false, deathMark: false },
    { botId: 2, declaredOnline: false, deathMark: true },
    { botId: 3, declaredOnline: false, deathMark: false },
  ]);
});
