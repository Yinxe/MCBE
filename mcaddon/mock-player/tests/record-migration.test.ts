// ─── 记录归一化测试（core/service/RecordMigration） ─────
// 旧版本（≤1.1.48）记录缺失字段补默认值：ownerName 缺失语义 / 极端缺失防御。

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRecord, DEFAULT_RESPAWN } from "../scripts/core/service/RecordMigration";
import type { BotRecord } from "../scripts/core/model/Types";
import { makeRecord, makeState } from "./helpers/factories";

test("完整记录归一化：仅补缺失的 spawnMode（其余不动）", () => {
  const record = makeRecord("bot1"); // makeRecord 缺 spawnMode（旧版可选字段）
  const changed = normalizeRecord(record);
  assert.equal(changed, true);
  assert.equal(record.name, "bot1");
  assert.equal(record.experience.level, 0);
  assert.equal(record.spawnMode, "normal"); // 补齐默认
  assert.equal(record.ownerName, "Steve"); // 已有字段不动
});

test("旧版记录（1.1.34 时代，无 ownerName）归一化：ownerName 保持 undefined（无主语义）", () => {
  // 1.1.34 的记录结构：无 ownerName 字段
  const legacy = makeRecord("bot1");
  delete (legacy as Partial<BotRecord>).ownerName;
  normalizeRecord(legacy);
  assert.equal(legacy.ownerName, undefined); // ownerName 缺失不补（undefined 即默认语义）
  assert.equal(legacy.spawnMode, "normal"); // 仅补缺失的 spawnMode
});

test("极端缺失：experience/respawnPoint/tags 缺失补默认值", () => {
  const legacy = {
    name: "old",
    online: false,
    death: false,
    entityId: undefined,
    tags: undefined,
    isSneaking: undefined,
    lastPoint: undefined,
    respawnPoint: undefined,
    deathPoint: undefined,
    experience: undefined,
  } as unknown as BotRecord;

  const changed = normalizeRecord(legacy);
  assert.equal(changed, true);
  assert.deepEqual(legacy.tags, []);
  assert.equal(legacy.isSneaking, false);
  assert.equal(legacy.lastPoint, null);
  assert.deepEqual(legacy.respawnPoint, DEFAULT_RESPAWN);
  assert.equal(legacy.deathPoint, null);
  assert.deepEqual(legacy.experience, { level: 0, xpProgress: 0, totalXp: 0 });
  assert.equal(legacy.spawnMode, "normal");
});

test("自定义默认重生点（世界出生点）", () => {
  const legacy = { name: "x", respawnPoint: undefined } as unknown as BotRecord;
  const worldSpawn = makeState({ location: { x: 100, y: 70, z: -200 } });
  const changed = normalizeRecord(legacy, worldSpawn);
  assert.equal(changed, true);
  assert.deepEqual(legacy.respawnPoint, worldSpawn);
});

test("归一化幂等：第二次调用无改动", () => {
  const legacy = { name: "x", tags: undefined, experience: undefined } as unknown as BotRecord;
  normalizeRecord(legacy);
  const changed = normalizeRecord(legacy);
  assert.equal(changed, false);
});
