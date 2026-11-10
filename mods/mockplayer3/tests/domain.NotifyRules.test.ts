// ─── 通知分级 domain 测试：门限判定/持久化兜底/档位标记 ────────────
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFY_SETTING,
  NOTIFY_LEVELS,
  decorateNotify,
  isDefaultNotifySetting,
  isNotifyLevel,
  parseNotifySetting,
  shouldSendNotify,
} from "../scripts/domain/NotifyRules";

test("shouldSendNotify：总开关关闭时任何档都不发", () => {
  for (const minLevel of NOTIFY_LEVELS) {
    for (const level of NOTIFY_LEVELS) {
      assert.equal(shouldSendNotify({ enabled: false, minLevel }, level), false);
    }
  }
});

test("shouldSendNotify：只放行不低于门限的档", () => {
  const s = { enabled: true, minLevel: "warn" as const };
  assert.equal(shouldSendNotify(s, "debug"), false);
  assert.equal(shouldSendNotify(s, "info"), false);
  assert.equal(shouldSendNotify(s, "warn"), true);
  assert.equal(shouldSendNotify(s, "error"), true);
});

test("shouldSendNotify：门限 debug 时全放行；门限 error 时只放行 error", () => {
  for (const level of NOTIFY_LEVELS) assert.equal(shouldSendNotify({ enabled: true, minLevel: "debug" }, level), true);
  assert.equal(shouldSendNotify({ enabled: true, minLevel: "error" }, "warn"), false);
  assert.equal(shouldSendNotify({ enabled: true, minLevel: "error" }, "error"), true);
});

test("parseNotifySetting：缺失/形状不符逐字段回退缺省", () => {
  assert.deepEqual(parseNotifySetting(undefined), { ...DEFAULT_NOTIFY_SETTING });
  assert.deepEqual(parseNotifySetting("x"), { ...DEFAULT_NOTIFY_SETTING });
  assert.deepEqual(parseNotifySetting({ enabled: "yes", minLevel: "trace" }), { ...DEFAULT_NOTIFY_SETTING });
  assert.deepEqual(parseNotifySetting({ minLevel: "error" }), { enabled: true, minLevel: "error" });
  assert.deepEqual(parseNotifySetting({ enabled: false }), { enabled: false, minLevel: "info" });
});

test("isNotifyLevel/isDefaultNotifySetting 守卫", () => {
  assert.equal(isNotifyLevel("warn"), true);
  assert.equal(isNotifyLevel("notice"), false);
  assert.equal(isNotifyLevel(undefined), false);
  assert.equal(isDefaultNotifySetting({ ...DEFAULT_NOTIFY_SETTING }), true);
  assert.equal(isDefaultNotifySetting({ enabled: true, minLevel: "debug" }), false);
});

test("decorateNotify：彩色档位标记前置且正文原样保留", () => {
  const line = decorateNotify("warn", "§ex 文本");
  assert.ok(line.startsWith("§6[警告]"), line);
  assert.ok(line.endsWith("§ex 文本"), line);
  assert.ok(decorateNotify("error", "t").startsWith("§c[错误]"));
  assert.ok(decorateNotify("debug", "t").startsWith("§7[调试]"));
  assert.ok(decorateNotify("info", "t").startsWith("§b[信息]"));
});
