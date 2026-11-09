// ─── 版本解析与最低游戏版本推导的单元测试（纯逻辑，不加载游戏运行时） ──

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  findMinimumEngineVersion,
  normalizeScriptApiVersion,
  parseVersion,
  resolveMinimumEngineVersion,
  SCRIPT_API_VERSION_MAPPINGS,
} from "../src/versions";
import type { PackageJson } from "../src/types";

/** 屏蔽被测代码主动打印的告警,保持测试输出干净;同时返回捕获到的告警文本 */
function captureWarnings(run: () => void): string[] {
  const captured: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    captured.push(args.map((value) => String(value)).join(" "));
  };
  try {
    run();
  } finally {
    console.warn = original;
  }
  return captured;
}

test("parseVersion 解析三段版本号", () => {
  assert.deepEqual(parseVersion("0.0.1"), [0, 0, 1]);
  assert.deepEqual(parseVersion("2.2.0"), [2, 2, 0]);
  assert.deepEqual(parseVersion("1.21.90"), [1, 21, 90]);
});

test("parseVersion 带后缀时取前三段并告警", () => {
  let result: [number, number, number] | undefined;
  const warnings = captureWarnings(() => {
    result = parseVersion("0.0.1-beta.1");
  });
  assert.deepEqual(result, [0, 0, 1]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /beta\.1/);
});

test("parseVersion 无法解析时报错", () => {
  assert.throws(() => parseVersion("1.2"), /无法把 package\.json 的 version "1\.2" 解析为三段数字/);
  assert.throws(() => parseVersion("v1.2.3"), /无法把 package\.json 的 version/);
});

test("normalizeScriptApiVersion 剥离范围前缀", () => {
  assert.deepEqual(normalizeScriptApiVersion("2.0.0"), [2, 0, 0]);
  assert.deepEqual(normalizeScriptApiVersion("^2.0.0"), [2, 0, 0]);
  assert.deepEqual(normalizeScriptApiVersion("~2.0.0"), [2, 0, 0]);
  assert.deepEqual(normalizeScriptApiVersion(">=2.0.0"), [2, 0, 0]);
  assert.deepEqual(normalizeScriptApiVersion("  2.0.0  "), [2, 0, 0]);
});

test("normalizeScriptApiVersion 带后缀时取前三段并告警", () => {
  let result: [number, number, number] | undefined;
  const warnings = captureWarnings(() => {
    result = normalizeScriptApiVersion("^2.0.0-beta.3");
  });
  assert.deepEqual(result, [2, 0, 0]);
  assert.equal(warnings.length, 1);
});

test("normalizeScriptApiVersion 无法解析时报错并提示显式配置", () => {
  assert.throws(() => normalizeScriptApiVersion("latest"), /请.*显式指定最低游戏版本/);
});

test("compareVersions 逐段比较", () => {
  assert.ok(compareVersions([1, 21, 90], [1, 21, 90]) === 0);
  assert.ok(compareVersions([1, 21, 90], [1, 21, 100]) < 0);
  assert.ok(compareVersions([2, 0, 0], [1, 26, 60]) > 0);
});

test("findMinimumEngineVersion 命中映射表", () => {
  assert.deepEqual(findMinimumEngineVersion([2, 0, 0]), [1, 21, 90]);
  assert.deepEqual(findMinimumEngineVersion([1, 11, 0]), [1, 21, 0]);
});

test("findMinimumEngineVersion 补丁位差异落到同档", () => {
  assert.deepEqual(findMinimumEngineVersion([2, 0, 1]), [1, 21, 90]);
});

test("findMinimumEngineVersion 取不超过依赖版本的最大档位", () => {
  // 1.12.5 应落到 1.12.0 那一档,而不是 1.13.0
  assert.deepEqual(findMinimumEngineVersion([1, 12, 5]), [1, 21, 20]);
});

test("findMinimumEngineVersion 高于最高档时返回未收录", () => {
  const highest = SCRIPT_API_VERSION_MAPPINGS[0].scriptApiVersion;
  const [major, minor, patch] = parseVersion(highest);
  assert.equal(findMinimumEngineVersion([major, minor + 1, patch]), undefined);
});

test("findMinimumEngineVersion 低于最低档时返回未收录", () => {
  assert.equal(findMinimumEngineVersion([1, 10, 0]), undefined);
});

test("resolveMinimumEngineVersion 显式配置优先于推导", () => {
  const packageJson: PackageJson = {
    name: "@mc-toolchain/probe",
    version: "1.0.0",
    packing: { minimum_engine_version: [1, 21, 90] },
    dependencies: { "@minecraft/server": "2.0.0" },
  };
  assert.deepEqual(resolveMinimumEngineVersion(packageJson), [1, 21, 90]);
});

test("resolveMinimumEngineVersion 显式配置与依赖推导不同时以显式为准", () => {
  const packageJson: PackageJson = {
    name: "@mc-toolchain/probe",
    version: "1.0.0",
    packing: { minimum_engine_version: [1, 21, 20] },
    dependencies: { "@minecraft/server": "2.0.0" },
  };
  assert.deepEqual(resolveMinimumEngineVersion(packageJson), [1, 21, 20]);
});

test("resolveMinimumEngineVersion 缺省时由依赖版本推导", () => {
  const packageJson: PackageJson = {
    name: "@mc-toolchain/probe",
    version: "1.0.0",
    dependencies: { "@minecraft/server": "2.0.0" },
  };
  assert.deepEqual(resolveMinimumEngineVersion(packageJson), [1, 21, 90]);
});

test("resolveMinimumEngineVersion 非法显式配置报错", () => {
  const cases: number[][] = [[1, 21], [1, 21, 90, 0], [1, 21, -1], [1, 21, 90.5]];
  for (const value of cases) {
    const packageJson: PackageJson = {
      name: "@mc-toolchain/probe",
      version: "1.0.0",
      packing: { minimum_engine_version: value },
    };
    assert.throws(() => resolveMinimumEngineVersion(packageJson), /minimum_engine_version 的取值 .* 不合法/);
  }
});

test("resolveMinimumEngineVersion 既无配置也无依赖时报错", () => {
  const packageJson: PackageJson = { name: "@mc-toolchain/probe", version: "1.0.0" };
  assert.throws(() => resolveMinimumEngineVersion(packageJson), /没有 @minecraft\/server 依赖/);
});

test("resolveMinimumEngineVersion 依赖版本未收录时报错并列出已知版本", () => {
  const packageJson: PackageJson = {
    name: "@mc-toolchain/probe",
    version: "1.0.0",
    dependencies: { "@minecraft/server": "9.9.9" },
  };
  assert.throws(() => resolveMinimumEngineVersion(packageJson), /不在版本映射表中/);
});
