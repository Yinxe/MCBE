// ─── 表单取值解析的单元测试 ─────────────────────────────────────
//
// 覆盖两种 Bedrock 排布:非输入元素占用 formValues 下标 / 不占用。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValueField, parseModalValues, type FieldSpec } from "../src/formValues";

test("isValueField 只把四类输入控件算作取值字段", () => {
  assert.equal(isValueField("textField"), true);
  assert.equal(isValueField("dropdown"), true);
  assert.equal(isValueField("toggle"), true);
  assert.equal(isValueField("slider"), true);

  assert.equal(isValueField("label"), false);
  assert.equal(isValueField("divider"), false);
  assert.equal(isValueField("header"), false);
});

test("纯输入表单:下标一一对应", () => {
  const fields: FieldSpec[] = [
    { kind: "textField", name: "name" },
    { kind: "toggle", name: "pinned" },
  ];
  const values = parseModalValues(fields, ["家", true]);

  assert.deepEqual(values, { name: "家", pinned: true });
});

test("布局一:label 与 divider 占用下标时按原下标取", () => {
  const fields: FieldSpec[] = [
    { kind: "label", name: "info" },
    { kind: "divider", name: "_divider" },
    { kind: "textField", name: "name" },
    { kind: "toggle", name: "pinned" },
  ];
  // 游戏返回 4 个元素,前两个是 label/divider 的占位
  const values = parseModalValues(fields, ["", "", "家", true]);

  assert.deepEqual(values, { name: "家", pinned: true });
});

test("布局二:label 与 divider 不占下标时按值字段顺序取", () => {
  const fields: FieldSpec[] = [
    { kind: "label", name: "info" },
    { kind: "divider", name: "_divider" },
    { kind: "textField", name: "name" },
    { kind: "toggle", name: "pinned" },
  ];
  // 游戏只返回 2 个值
  const values = parseModalValues(fields, ["家", true]);

  assert.deepEqual(values, { name: "家", pinned: true });
});

test("两种布局解析出相同结果", () => {
  const fields: FieldSpec[] = [
    { kind: "label", name: "info" },
    { kind: "textField", name: "name" },
    { kind: "divider", name: "_divider" },
    { kind: "dropdown", name: "category" },
    { kind: "header", name: "_header" },
    { kind: "slider", name: "count" },
  ];

  const occupyAll = parseModalValues(fields, ["", "家", "", 2, "", 5]);
  const skipLayout = parseModalValues(fields, ["家", 2, 5]);

  assert.deepEqual(occupyAll, { name: "家", category: 2, count: 5 });
  assert.deepEqual(skipLayout, occupyAll);
});

test("取值个数与字段个数相同但全部是输入字段时不会被误判", () => {
  const fields: FieldSpec[] = [
    { kind: "textField", name: "a" },
    { kind: "textField", name: "b" },
  ];
  const values = parseModalValues(fields, ["x", "y"]);

  assert.deepEqual(values, { a: "x", b: "y" });
});

test("值缺失时对应字段为 undefined,不抛错", () => {
  const fields: FieldSpec[] = [
    { kind: "textField", name: "a" },
    { kind: "toggle", name: "b" },
  ];
  const values = parseModalValues(fields, ["x"]);

  assert.equal(values.a, "x");
  assert.equal(values.b, undefined);
});
