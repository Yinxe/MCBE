// ─── GraphicsProbeMath 单测:server-graphics 探针的纯函数层 ──────────
//
// 这一层要钉住四件事:
//   1. 关键帧表的排序(0.25/0.5 这类非整数键在 JS 里按插入序枚举)
//   2. 单值 vs 关键帧表的判定(类型上是联合类型,运行时靠键判断)
//   3. 时间点翻译(只认四个标准点,其它如实说「自定义」)
//   4. Vibrant Visuals 判定(非 Deferred 时必须说「读数不可信」)

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SKY_KEYFRAME_COLORS,
  SOLID_SKY_COLOR,
  TIME_OF_DAY,
  describeSetReset,
  describeSetterArgument,
  describeTimeOfDay,
  isKeyframeTable,
  sortedKeyframes,
  vibrantVisualsVerdict,
} from "../lib/scripts/GraphicsProbeMath.js";

test("关键帧按时间升序排列", () => {
  // 故意用乱序插入,验证排序确实生效
  const frames = { 0.75: { red: 1, green: 0, blue: 0 }, 0: { red: 0, green: 1, blue: 0 } };
  const times = sortedKeyframes(frames).map((f) => f.time);
  assert.deepEqual(times, [0, 0.75]);
});

test("标准四个时间点齐全且有序", () => {
  const times = sortedKeyframes(SKY_KEYFRAME_COLORS).map((f) => f.time);
  assert.deepEqual(times, [0, 0.25, 0.5, 0.75]);
});

test("时间点翻译成时段名", () => {
  assert.match(describeTimeOfDay(TIME_OF_DAY.noon), /正午/);
  assert.match(describeTimeOfDay(TIME_OF_DAY.sunset), /日落/);
  assert.match(describeTimeOfDay(TIME_OF_DAY.midnight), /午夜/);
  assert.match(describeTimeOfDay(TIME_OF_DAY.sunrise), /日出/);
});

test("非标准时间点如实说自定义", () => {
  assert.match(describeTimeOfDay(0.1), /自定义/);
  assert.match(describeTimeOfDay(0.1), /0\.1/);
});

test("识别关键帧表", () => {
  assert.equal(isKeyframeTable(SKY_KEYFRAME_COLORS), true);
  assert.equal(isKeyframeTable({ 0: 1, 0.5: 2 }), true);
});

test("单色不被误判为关键帧表", () => {
  // 颜色对象也是对象,但键是 red/green/blue,不能当关键帧
  assert.equal(isKeyframeTable(SOLID_SKY_COLOR), false);
  assert.equal(isKeyframeTable({ red: 1, green: 0, blue: 0 }), false);
});

test("空对象与非对象都不是关键帧表", () => {
  assert.equal(isKeyframeTable({}), false);
  assert.equal(isKeyframeTable(null), false);
  assert.equal(isKeyframeTable(0.5), false);
  assert.equal(isKeyframeTable("abc"), false);
});

test("描述关键帧表参数形态", () => {
  const text = describeSetterArgument(SKY_KEYFRAME_COLORS);
  assert.match(text, /关键帧表/);
  assert.match(text, /4 个时间点/);
});

test("描述单色与单值参数形态", () => {
  assert.match(describeSetterArgument(SOLID_SKY_COLOR), /单色/);
  assert.match(describeSetterArgument(0.5), /单值/);
});

test("Deferred 模式判定为可下结论", () => {
  const verdict = vibrantVisualsVerdict("Deferred");
  assert.equal(verdict.conclusive, true);
});

test("非 Deferred 模式判定为不可下结论", () => {
  // 这是本探针最重要的一条:非 Deferred 时读数只证明调用成功
  for (const mode of ["Fancy", "Simple", "RayTraced"]) {
    const verdict = vibrantVisualsVerdict(mode);
    assert.equal(verdict.conclusive, false, `${mode} 应判为不可下结论`);
    assert.match(verdict.message, /不证明/);
  }
});

test("读不到图形模式时如实说不知道", () => {
  const verdict = vibrantVisualsVerdict(undefined);
  assert.equal(verdict.conclusive, false);
  assert.match(verdict.message, /无法读取/);
});

test("set/reset 四种组合各有结论", () => {
  assert.match(describeSetReset({ setOk: true, resetOk: true }), /均成功/);
  assert.match(describeSetReset({ setOk: true, resetOk: false }), /残留/);
  assert.match(describeSetReset({ setOk: false, resetOk: true }), /参数范围/);
  assert.match(describeSetReset({ setOk: false, resetOk: false }), /均抛错/);
});
