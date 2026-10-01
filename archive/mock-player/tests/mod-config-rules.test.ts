// ─── core/service — 全局配置合并规则（边界条件） ───────

import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeStoredConfig } from "../scripts/service/ModConfigRules";
import { DEFAULT_QUOTA } from "../scripts/rules/Types";

test("从未保存（undefined）返回默认配置", () => {
  const cfg = mergeStoredConfig(undefined);
  assert.equal(cfg.defaultQuota, DEFAULT_QUOTA);
  assert.deepEqual(cfg.quotas, {});
  assert.deepEqual(cfg.admins, []);
});

test("损坏 JSON → 全部回退默认", () => {
  const cfg = mergeStoredConfig("{broken json!!");
  assert.equal(cfg.defaultQuota, DEFAULT_QUOTA);
  assert.deepEqual(cfg.quotas, {});
  assert.deepEqual(cfg.admins, []);
});

test("非对象 JSON（null/数组/字符串）→ 回退默认", () => {
  assert.equal(mergeStoredConfig("null").defaultQuota, DEFAULT_QUOTA);
  assert.equal(mergeStoredConfig('["a"]').defaultQuota, DEFAULT_QUOTA);
  assert.equal(mergeStoredConfig('"hello"').defaultQuota, DEFAULT_QUOTA);
});

test("部分字段：只存 defaultQuota，其余默认", () => {
  const cfg = mergeStoredConfig(JSON.stringify({ defaultQuota: 8 }));
  assert.equal(cfg.defaultQuota, 8);
  assert.deepEqual(cfg.quotas, {});
  assert.deepEqual(cfg.admins, []);
});

test("非法 defaultQuota（字符串/NaN/负数/小数）→ 归一化或回退", () => {
  assert.equal(mergeStoredConfig(JSON.stringify({ defaultQuota: "5" })).defaultQuota, DEFAULT_QUOTA);
  assert.equal(mergeStoredConfig(JSON.stringify({ defaultQuota: NaN })).defaultQuota, DEFAULT_QUOTA);
  assert.equal(mergeStoredConfig(JSON.stringify({ defaultQuota: -3 })).defaultQuota, 0); // 负数归一化 0
  assert.equal(mergeStoredConfig(JSON.stringify({ defaultQuota: 2.7 })).defaultQuota, 2); // 小数向下取整
  assert.equal(mergeStoredConfig(JSON.stringify({ defaultQuota: Infinity })).defaultQuota, DEFAULT_QUOTA);
});

test("非法 quotas（数组/字符串/null）→ 空对象", () => {
  assert.deepEqual(mergeStoredConfig(JSON.stringify({ quotas: ["a"] })).quotas, {});
  assert.deepEqual(mergeStoredConfig(JSON.stringify({ quotas: "x" })).quotas, {});
  assert.deepEqual(mergeStoredConfig(JSON.stringify({ quotas: null })).quotas, {});
});

test("quotas 逐条过滤：只保留 玩家名 → 非负整数", () => {
  const cfg = mergeStoredConfig(JSON.stringify({
    quotas: {
      steve: 10,
      alex: -5,        // 负数 → 归一化 0
      charlie: "7",    // 字符串 → 丢弃
      dave: 3.5,       // 小数 → 取整 3
      eve: NaN,        // NaN → 丢弃
    },
  }));
  assert.deepEqual(cfg.quotas, { steve: 10, alex: 0, dave: 3 });
});

test("admins 过滤：只保留非空字符串", () => {
  const cfg = mergeStoredConfig(JSON.stringify({
    admins: ["Notch", "", "   ", 42, null, "Steve"],
  }));
  assert.deepEqual(cfg.admins, ["Notch", "Steve"]);
});

test("完整配置往返无损", () => {
  const saved = JSON.stringify({ defaultQuota: 3, quotas: { steve: 7 }, admins: ["Notch"] });
  const cfg = mergeStoredConfig(saved);
  assert.deepEqual(cfg, { defaultQuota: 3, quotas: { steve: 7 }, admins: ["Notch"], autoOnlineOnRestart: true, ownerOfflineAutoOffline: false, enabledWorkModes: {}, menuTriggerItemId: "minecraft:stick", safeCooldownSeconds: 1, defaultOnlineQuota: 3, onlineQuotas: {}, auxTickingRadius: 4 });
});

test("新增配置默认：autoOnlineOnRestart=true, ownerOfflineAutoOffline=false", () => {
  const cfg = mergeStoredConfig(undefined);
  assert.equal(cfg.autoOnlineOnRestart, true);
  assert.equal(cfg.ownerOfflineAutoOffline, false);
});

test("新增配置布尔过滤：非法值回退默认", () => {
  assert.equal(mergeStoredConfig(JSON.stringify({ autoOnlineOnRestart: "yes" })).autoOnlineOnRestart, true);
  assert.equal(mergeStoredConfig(JSON.stringify({ autoOnlineOnRestart: 1 })).autoOnlineOnRestart, true);
  assert.equal(mergeStoredConfig(JSON.stringify({ ownerOfflineAutoOffline: null })).ownerOfflineAutoOffline, false);
  const cfg = mergeStoredConfig(JSON.stringify({ autoOnlineOnRestart: false, ownerOfflineAutoOffline: true }));
  assert.equal(cfg.autoOnlineOnRestart, false);
  assert.equal(cfg.ownerOfflineAutoOffline, true);
});

test("新增配置往返无损", () => {
  const saved = JSON.stringify({ defaultQuota: 3, quotas: {}, admins: [], autoOnlineOnRestart: false, ownerOfflineAutoOffline: true });
  const cfg = mergeStoredConfig(saved);
  assert.equal(cfg.autoOnlineOnRestart, false);
  assert.equal(cfg.ownerOfflineAutoOffline, true);
});

test("触发信物默认：menuTriggerItemId=minecraft:stick", () => {
  const cfg = mergeStoredConfig(undefined);
  assert.equal(cfg.menuTriggerItemId, "minecraft:stick");
});

test("触发信物过滤：非法值回退默认，null 保留", () => {
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: "minecraft:stick" })).menuTriggerItemId, "minecraft:stick");
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: null })).menuTriggerItemId, null);
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: "minecraft:diamond_sword" })).menuTriggerItemId, "minecraft:stick"); // 非预设列表回退
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: "" })).menuTriggerItemId, "minecraft:stick");
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: 123 })).menuTriggerItemId, "minecraft:stick");
});

test("触发信物往返无损：null 与预设值", () => {
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: null })).menuTriggerItemId, null);
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: "minecraft:wooden_hoe" })).menuTriggerItemId, "minecraft:wooden_hoe");
  assert.equal(mergeStoredConfig(JSON.stringify({ menuTriggerItemId: "minecraft:feather" })).menuTriggerItemId, "minecraft:feather");
});

test("auxTickingRadius: 仅 0/4/6/8 合法，其余回退默认4", () => {
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: 0 })).auxTickingRadius, 0);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: 4 })).auxTickingRadius, 4);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: 6 })).auxTickingRadius, 6);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: 8 })).auxTickingRadius, 8);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: 5 })).auxTickingRadius, 4);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: "4" })).auxTickingRadius, 4);
  assert.equal(mergeStoredConfig(JSON.stringify({ auxTickingRadius: null })).auxTickingRadius, 4);
  assert.equal(mergeStoredConfig(JSON.stringify({})).auxTickingRadius, 4);
});
