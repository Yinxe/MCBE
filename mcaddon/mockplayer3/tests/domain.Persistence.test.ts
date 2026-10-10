// ─── 持久化决策单测：SaveGate epoch 守卫不可绕过 / 记录校验 / 配置损坏回退 ───────────
import test from "node:test";
import assert from "node:assert/strict";

import {
  permitIncremental,
  permitCheckpoint,
  permitVaultRead,
  permitVaultTrust,
  touchesItems,
  shouldFlush,
  FLUSH_DEBOUNCE_TICKS,
} from "../scripts/domain/SavePolicy";
import { createRecord, validateRecord, isBotRecordShape } from "../scripts/domain/Record";
import type { BotRecord } from "../scripts/domain/Record";
import type { WorkMode } from "../scripts/domain/Record";
import { defaultEnabledModes } from "../scripts/domain/Catalog";
import {
  defaultConfig,
  mergeConfig,
  storedWorkModePolicy,
  WORK_MODE_POLICY_V_ALL_ON,
  WORK_MODE_POLICY_V_HEAVY_OFF,
} from "../scripts/domain/Config";

// ─── SaveGate 决策 ──

test("ADR-5：epoch<1 的一切增量写拒（空背包覆盖 = 永久丢数据，F-26）", () => {
  assert.deepEqual(permitIncremental("RESTORING", 0, ["inventory"]), { allow: false, blockedBy: "epoch" });
  assert.deepEqual(permitIncremental("SPAWNING", 0, ["home"]), { allow: false, blockedBy: "epoch" });
  assert.deepEqual(permitIncremental("OFFLINE", 0, ["home"]), { allow: false, blockedBy: "noSession" });
  assert.deepEqual(permitIncremental("REGISTERED", 0, ["experience"]), { allow: false, blockedBy: "noSession" });
});

test("冻结窗口：DYING 常规写挡（只放行死亡快照通道），恢复完成后放行", () => {
  assert.deepEqual(permitIncremental("DYING", 3, ["inventory"]), { allow: false, blockedBy: "frozen" });
  assert.deepEqual(permitIncremental("ACTIVE", 1, ["inventory"]), { allow: true });
  assert.deepEqual(permitIncremental("WORKING", 1, ["home", "experience"]), { allow: true });
});

test("关键点：offline/delete 要求 epoch≥1；death 特例此刻有什么存什么（F-27）", () => {
  assert.deepEqual(permitCheckpoint("ACTIVE", 2, "offline"), { allow: true });
  assert.deepEqual(permitCheckpoint("RESTORING", 0, "offline"), { allow: false, blockedBy: "epoch" });
  assert.deepEqual(permitCheckpoint("DYING", 0, "death"), { allow: true });
  assert.deepEqual(permitCheckpoint("WORKING", 5, "delete"), { allow: true });
});

test("touchesItems 分级与 debounce 冲刷判定", () => {
  assert.equal(touchesItems(["home", "equipment"]), true);
  assert.equal(touchesItems(["home", "switches"]), false);
  assert.equal(shouldFlush(200, 0, 1), true);
  assert.equal(shouldFlush(FLUSH_DEBOUNCE_TICKS - 1, 0, 2), false);
  assert.equal(shouldFlush(999, 0, 0), false);
});

test("物品仓可读裁决（缺53）：读不到≠没有——区块未加载即拒，绝不空背包上线", () => {
  // 锁：有绑定槽且区块未加载即拒读——读不到≠空，绝不允许空背包上线再覆盖回仓
  assert.deepEqual(permitVaultRead(true, false), { allow: false, blockedBy: "chunk-unloaded" });
  assert.deepEqual(permitVaultRead(true, true), { allow: true }, "区块已加载：照常读（含读出来确实为空）");
  assert.deepEqual(permitVaultRead(false, false), { allow: true }, "新假人零槽：没绑过，无需可读区块");

  // 滞留导出在内存时仓态落后于实体：按仓交付/写回会同物双发，一并改期
  assert.deepEqual(permitVaultTrust(true, false, true), { allow: false, blockedBy: "chunk-unloaded" });
  assert.deepEqual(permitVaultTrust(true, true, false), { allow: false, blockedBy: "chunk-unloaded" });
  assert.deepEqual(permitVaultTrust(false, true, true), { allow: true });
});

// ─── 记录 ──

function newRecord(): BotRecord {
  const { record, nameError } = createRecord({
    botId: 1,
    rawName: "$矿工",
    ownerKey: "阿新",
    home: { position: { x: 10, y: 64, z: -20 }, yaw: 90, pitch: -10 },
    dimensionId: "overworld",
    regionId: "mockplayer:test:1:1",
    now: 1000,
  });
  assert.equal(nameError, undefined);
  return record;
}

test("createRecord：旧 $ 前缀规范化、重生点随家点克隆、声明位默认", () => {
  const r = newRecord();
  assert.equal(r.name, "sim-矿工");
  assert.ok(r.respawnPoint);
  assert.deepEqual(r.respawnPoint!.position, r.home.position);
  assert.equal(r.respawnPoint!.dimensionId, "overworld");
  assert.equal(r.workMode, "none");
  assert.equal(r.declaredOnline, false);
  assert.equal(r.raidVictories, 0, "劫掠胜场从零起账（用户规格 2026-09-28 持久化）");
  assert.deepEqual(r.tags, []);
});

test("validateRecord：不变量边界（botId 正整数、动作节拍不入记录故不校验）", () => {
  const r = newRecord();
  assert.equal(validateRecord(r), undefined);
  r.botId = 0;
  assert.match(validateRecord(r)!, /botId/);
});

test("isBotRecordShape：坏 JSON/绑定表解析成功也拒入注册表（归档实测）", () => {
  assert.equal(isBotRecordShape(newRecord()), true);
  assert.equal(isBotRecordShape({ name: "sim-x" }), false, "缺 botId/tags/home 拒绝");
  assert.equal(isBotRecordShape(JSON.parse(JSON.stringify({ regionId: "r", inv: {}, equip: {} }))), false);
  assert.equal(isBotRecordShape(null), false);
});

// ─── 配置（损坏回退） ──

test("mergeConfig：非对象/损坏字段全量回退默认", () => {
  for (const bad of [undefined, null, "x", 42, [], true]) {
    assert.deepEqual(mergeConfig(bad), defaultConfig());
  }
});

test("mergeConfig：逐字段合并——合法覆盖、非法回退、未知键忽略", () => {
  const c = mergeConfig({
    quotas: { create: 9, online: "坏值", perPlayer: { 阿新: { create: 0, online: 1 }, 张三: "坏", 李四: {} } },
    workModePolicyVersion: WORK_MODE_POLICY_V_ALL_ON,
    workModeEnabled: { mine: false, 未知模式: true },
    adminKeys: ["老王", 5],
    tokenItem: { enabled: false },
    debugLog: "yes",
  });
  assert.equal(c.quotas.create, 9);
  assert.equal(c.quotas.online, 3, "非数值回退默认");
  assert.deepEqual(c.quotas.perPlayer["阿新"], { create: 0, online: 1 });
  assert.equal(c.quotas.perPlayer["张三"], undefined);
  assert.equal(c.quotas.perPlayer["李四"], undefined, "空覆盖不保留");
  assert.equal(c.workModeEnabled.mine, false, "带戳档管理员关过的照旧关");
  assert.equal(c.workModeEnabled.none, true, "缺字段按默认表补");
  assert.deepEqual(c.adminKeys, [], "数组含非 string → 整组回退默认 []");
  assert.equal(c.tokenItem.enabled, false);
  assert.equal(c.tokenItem.typeId, "minecraft:stick");
  assert.equal(c.debugLog, false, "非布尔回退");
});

test("mergeConfig：传送开关缺字段/非布尔回退默认开，显式 false 生效", () => {
  assert.equal(mergeConfig({}).teleportEnabled, true);
  assert.equal(mergeConfig({ teleportEnabled: false }).teleportEnabled, false);
  assert.equal(mergeConfig({ teleportEnabled: "yes" }).teleportEnabled, true);
});

test("启用表策略版本戳（缺59）：旧档整表重置一次，带戳档逐字保留", () => {
  const all = Object.keys(defaultEnabledModes()) as WorkMode[];
  // 旧策略档（无戳=heavy 默认关时代）：表里一片 false 分不清"默认关"还是"管理员关"，
  // 一律按新默认整表重置为全开，并在读出的对象上盖版本戳（面板一改就由 SaveGate 落盘）
  const legacy = mergeConfig({ workModeEnabled: { mine: true, fishing: false, raid: false } });
  assert.equal(legacy.workModePolicyVersion, WORK_MODE_POLICY_V_ALL_ON);
  for (const mode of all) assert.equal(legacy.workModeEnabled[mode], true, `${mode} 旧档重置为默认启用`);
  // 戳到位后，同一张表里的显式 false 就是管理员意图，永久保留
  const stamped = mergeConfig({
    workModePolicyVersion: WORK_MODE_POLICY_V_ALL_ON,
    workModeEnabled: { ...legacy.workModeEnabled, fishing: false },
  });
  assert.equal(stamped.workModeEnabled.fishing, false);
  assert.equal(stamped.workModeEnabled.mine, true);
  // 坏戳值按旧档解释（重置），不会把已全开的表又读成半开
  assert.equal(
    mergeConfig({ workModePolicyVersion: "坏", workModeEnabled: { mine: false } }).workModeEnabled.mine,
    true,
    "非数戳=v1，整表重置"
  );
  assert.equal(storedWorkModePolicy({}), WORK_MODE_POLICY_V_HEAVY_OFF, "无戳=v1");
  assert.equal(storedWorkModePolicy("坏"), WORK_MODE_POLICY_V_HEAVY_OFF);
});

test("mergeConfig：旧档 clickGuard 键作为未知键丢弃（已改为写死名单，不再是配置项）", () => {
  const merged = mergeConfig({ clickGuard: { gui: false, vault: true } }) as unknown as Record<string, unknown>;
  assert.equal(merged.clickGuard, undefined, "clickGuard 已从配置移除，旧键不落结果");
  assert.equal(merged.debugLog, false, "其余字段照常落默认");
});
