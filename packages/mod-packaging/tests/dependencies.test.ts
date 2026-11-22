// ─── 包间依赖方向校正的单元测试（纯逻辑，不加载游戏运行时） ──────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensurePackDependency,
  reconcilePackDependencyDirection,
  removePackDependency,
  type PackDependency,
} from "../src/dependencies";

const RESOURCE_PACK_UUID = "1bc7314d-ae1c-4b79-8015-de48a030b605";
const BEHAVIOR_PACK_UUID = "746aab1e-dd00-4f24-bdbb-42bc411a3003";

/** 构造一个脚本模块依赖，用来验证不会把它误当作包依赖 */
function scriptDependency(): PackDependency {
  return { module_name: "@minecraft/server", version: [2, 1, 0] };
}

test("ensurePackDependency 追加缺失的资源包依赖", () => {
  const { dependencies, appended } = ensurePackDependency([scriptDependency()], RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.equal(appended, true);
  assert.equal(dependencies.length, 2);
  assert.deepEqual(dependencies[1], { uuid: RESOURCE_PACK_UUID, version: [0, 1, 21] });
  // 原有的脚本模块依赖保持不动
  assert.deepEqual(dependencies[0], scriptDependency());
});

test("ensurePackDependency 已存在时就地改版本而不重复追加", () => {
  const existing: PackDependency = { uuid: RESOURCE_PACK_UUID, version: [0, 1, 20] };
  const { dependencies, appended } = ensurePackDependency([existing], RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.equal(appended, false);
  assert.equal(dependencies.length, 1);
  assert.deepEqual(dependencies[0].version, [0, 1, 21]);
});

test("ensurePackDependency 保留依赖项上的其余字段", () => {
  const existing: PackDependency & { name: string } = {
    uuid: RESOURCE_PACK_UUID,
    name: "物品路由",
    version: [0, 1, 20],
  };
  const { dependencies } = ensurePackDependency([existing], RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.equal((dependencies[0] as PackDependency & { name?: string }).name, "物品路由");
});

test("ensurePackDependency 的 UUID 比较不区分大小写", () => {
  const existing: PackDependency = { uuid: RESOURCE_PACK_UUID.toUpperCase(), version: [0, 1, 20] };
  const { dependencies, appended } = ensurePackDependency([existing], RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.equal(appended, false);
  assert.equal(dependencies.length, 1);
});

test("ensurePackDependency 不改动脚本模块依赖的版本", () => {
  const { dependencies } = ensurePackDependency([scriptDependency()], RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.deepEqual(dependencies[0].version, [2, 1, 0]);
});

test("ensurePackDependency 返回新数组，不修改入参", () => {
  const input: PackDependency[] = [];
  const { dependencies } = ensurePackDependency(input, RESOURCE_PACK_UUID, [0, 1, 21]);
  assert.equal(input.length, 0);
  assert.equal(dependencies.length, 1);
});

test("removePackDependency 删除反方向的行为包依赖", () => {
  const { dependencies, removed } = removePackDependency(
    [{ uuid: BEHAVIOR_PACK_UUID, version: [0, 1, 21] }, scriptDependency()],
    BEHAVIOR_PACK_UUID
  );
  assert.equal(removed, true);
  assert.equal(dependencies.length, 1);
  assert.deepEqual(dependencies[0], scriptDependency());
});

test("removePackDependency 没有该依赖时报告未删除", () => {
  const { dependencies, removed } = removePackDependency([scriptDependency()], BEHAVIOR_PACK_UUID);
  assert.equal(removed, false);
  assert.equal(dependencies.length, 1);
});

test("removePackDependency 的 UUID 比较不区分大小写", () => {
  const { removed } = removePackDependency(
    [{ uuid: BEHAVIOR_PACK_UUID.toUpperCase(), version: [0, 1, 21] }],
    BEHAVIOR_PACK_UUID
  );
  assert.equal(removed, true);
});

test("依赖方向校正后行为包依赖资源包、资源包不依赖行为包", () => {
  // 复现修复前的错误状态：资源包依赖行为包，行为包没有依赖
  const behaviorDependencies: PackDependency[] = [scriptDependency()];
  const resourceDependencies: PackDependency[] = [{ uuid: BEHAVIOR_PACK_UUID, version: [0, 1, 20] }];

  const result = reconcilePackDependencyDirection(
    BEHAVIOR_PACK_UUID,
    RESOURCE_PACK_UUID,
    behaviorDependencies,
    resourceDependencies,
    [0, 1, 21]
  );

  assert.deepEqual(
    result.behaviorDependencies.map((dependency) => dependency.uuid ?? dependency.module_name),
    ["@minecraft/server", RESOURCE_PACK_UUID]
  );
  assert.equal(result.appended, true);
  assert.equal(result.removed, true);
  // 资源包的依赖被删空，调用方应整个去掉该字段
  assert.equal(result.resourceDependencies, undefined);
});

test("依赖方向已正确时不产生变更", () => {
  const result = reconcilePackDependencyDirection(
    BEHAVIOR_PACK_UUID,
    RESOURCE_PACK_UUID,
    [{ uuid: RESOURCE_PACK_UUID, version: [0, 1, 21] }],
    [],
    [0, 1, 21]
  );
  assert.equal(result.appended, false);
  assert.equal(result.removed, false);
  assert.equal(result.resourceDependencies, undefined);
});

test("资源包还留着其它依赖时保留该字段", () => {
  const other: PackDependency = { uuid: "00000000-0000-0000-0000-0000000000ff", version: [1, 0, 0] };
  const result = reconcilePackDependencyDirection(
    BEHAVIOR_PACK_UUID,
    RESOURCE_PACK_UUID,
    [],
    [{ uuid: BEHAVIOR_PACK_UUID, version: [0, 1, 20] }, other],
    [0, 1, 21]
  );
  assert.deepEqual(result.resourceDependencies, [other]);
});

test("依赖方向校正把行为包的资源包依赖版本同步为目标版本", () => {
  const result = reconcilePackDependencyDirection(
    BEHAVIOR_PACK_UUID,
    RESOURCE_PACK_UUID,
    [{ uuid: RESOURCE_PACK_UUID, version: [0, 1, 20] }],
    [],
    [0, 1, 21]
  );
  assert.deepEqual(result.behaviorDependencies[0].version, [0, 1, 21]);
  assert.equal(result.appended, false);
});
