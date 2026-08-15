// ─── core/service — 全局配置合并规则（边界条件） ───────

import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeStoredConfig } from "../scripts/service/ModConfigRules";
import { DEFAULT_QUOTA } from "../scripts/model/Types";

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
  assert.deepEqual(cfg, { defaultQuota: 3, quotas: { steve: 7 }, admins: ["Notch"] });
});