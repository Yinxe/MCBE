// ─── 假人可见性规则测试（core/service/BotVisibility） ──
// 普通玩家只看自己的 + 无主的；管理员看全部。

import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleRecords } from "../scripts/service/BotVisibility";
import type { BotRecord } from "../scripts/rules/Types";
import { makeRecord } from "./helpers/factories";

function rec(name: string, owner?: string): BotRecord {
  const r = makeRecord(name);
  if (owner === undefined) {
    delete (r as Partial<BotRecord>).ownerName; // 无主
  } else {
    r.ownerName = owner;
  }
  return r;
}

test("管理员：看到全部假人（含他人/无主）", () => {
  const records = [rec("a", "Steve"), rec("b", "Alex"), rec("c")];
  const visible = visibleRecords(records, "Steve", true);
  assert.equal(visible.length, 3);
});

test("普通玩家：只看自己的 + 无主的", () => {
  const records = [rec("mine", "Steve"), rec("theirs", "Alex"), rec("nobody")];
  const visible = visibleRecords(records, "Steve", false);
  const names = visible.map((r) => r.name).sort();
  assert.deepEqual(names, ["mine", "nobody"]); // 自己的 + 无主；他人的不可见
});

test("无主假人全员可见（多玩家视角）", () => {
  const records = [rec("shared")];
  assert.equal(visibleRecords(records, "Steve", false).length, 1);
  assert.equal(visibleRecords(records, "Alex", false).length, 1);
});

test("空列表/全部他人：可见数为 0", () => {
  assert.equal(visibleRecords([], "Steve", false).length, 0);
  const records = [rec("a", "Alex")];
  assert.equal(visibleRecords(records, "Steve", false).length, 0);
});

test("可见性不修改原数组", () => {
  const records = [rec("mine", "Steve"), rec("theirs", "Alex")];
  visibleRecords(records, "Steve", false);
  assert.equal(records.length, 2); // 原数组不变（filter 返回新数组）
});
