// ─── 按钮式菜单的按钮下标映射测试 ───────────────────────────────
//
// ActionFormBuilder 依赖 @minecraft/server-ui 与 @minecraft/server,无法在纯
// Node 下构造。本测试只覆盖其中不依赖游戏的映射规则:装饰行不占按钮下标,
// 按钮按下标顺序与添加顺序一致。

import { test } from "node:test";
import assert from "node:assert/strict";

/** 与 ActionFormBuilder 内部一致的「按钮序号 → 回调」映射。 */
function collectCallbacks(
  entries: Array<{ kind: "button" | "divider" | "label" | "header"; callback?: () => void }>,
): Array<() => void> {
  const callbacks: Array<() => void> = [];
  for (const entry of entries) {
    if (entry.kind !== "button") continue;
    callbacks.push(entry.callback ?? (() => undefined));
  }
  return callbacks;
}

test("装饰行不进入按钮下标映射", () => {
  const calls: string[] = [];
  const entries: Array<{ kind: "button" | "divider" | "label" | "header"; callback?: () => void }> = [
    { kind: "header" },
    { kind: "divider" },
    { kind: "button", callback: () => calls.push("传送") },
    { kind: "divider" },
    { kind: "button", callback: () => calls.push("管理") },
    { kind: "label" },
    { kind: "button", callback: () => calls.push("新建") },
  ];

  const callbacks = collectCallbacks(entries);
  assert.equal(callbacks.length, 3, "三个按钮只产生三个回调槽位");

  callbacks[1]!();
  assert.deepEqual(calls, ["管理"], "第二个按钮对应 selection 1");
});

test("按钮顺序决定 selection 下标", () => {
  const calls: string[] = [];
  const entries: Array<{ kind: "button" | "divider" | "label" | "header"; callback?: () => void }> = [
    { kind: "button", callback: () => calls.push("A") },
    { kind: "button", callback: () => calls.push("B") },
    { kind: "button", callback: () => calls.push("C") },
  ];

  const callbacks = collectCallbacks(entries);
  callbacks.forEach((cb) => cb());
  assert.deepEqual(calls, ["A", "B", "C"]);
});

test("没有回调的按钮占位但不报错", () => {
  const entries: Array<{ kind: "button" | "divider" | "label" | "header"; callback?: () => void }> = [
    { kind: "button" },
    { kind: "button", callback: () => undefined },
  ];

  const callbacks = collectCallbacks(entries);
  assert.equal(callbacks.length, 2);
  assert.doesNotThrow(() => callbacks[0]!());
});
