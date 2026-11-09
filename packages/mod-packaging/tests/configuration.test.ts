// ─── 打包配置校验的单元测试（纯逻辑，不加载游戏运行时） ──────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { getModuleName, resolvePackingConfigurationFrom, validatePackingKeys } from "../src/configuration";
import { DEFAULT_OUTPUT_DIRECTORY, DEFAULT_PACKING_MODE, type PackageJson } from "../src/types";

/** 构造一个只含必需字段的模组 package.json */
function makePackageJson(overrides: Partial<PackageJson> = {}): PackageJson {
  return {
    name: "@mc-toolchain/probe",
    version: "1.0.0",
    dependencies: { "@minecraft/server": "2.0.0" },
    ...overrides,
  };
}

test("getModuleName 去掉 npm scope", () => {
  assert.equal(getModuleName({ name: "@mc-toolchain/keepinventory", version: "0.0.1" }), "keepinventory");
  assert.equal(getModuleName({ name: "@mc-toolchain/auto-refill", version: "2.2.0" }), "auto-refill");
});

test("getModuleName 对无 scope 的包名原样返回", () => {
  assert.equal(getModuleName({ name: "auto-refill", version: "2.2.0" }), "auto-refill");
});

test("零配置时全部字段回落到默认值", () => {
  const configuration = resolvePackingConfigurationFrom(makePackageJson());
  assert.equal(configuration.mode, DEFAULT_PACKING_MODE);
  assert.equal(configuration.output, DEFAULT_OUTPUT_DIRECTORY);
  assert.deepEqual(configuration.minimumEngineVersion, [1, 21, 90]);
});

test("显式配置覆盖默认值", () => {
  const configuration = resolvePackingConfigurationFrom(
    makePackageJson({
      packing: { mode: "mcaddon", output: "out/custom", minimum_engine_version: [1, 21, 20] },
    })
  );
  assert.equal(configuration.mode, "mcaddon");
  assert.equal(configuration.output, "out/custom");
  assert.deepEqual(configuration.minimumEngineVersion, [1, 21, 20]);
});

test("packing 为空对象时仍回落默认值", () => {
  const configuration = resolvePackingConfigurationFrom(makePackageJson({ packing: {} }));
  assert.equal(configuration.mode, DEFAULT_PACKING_MODE);
  assert.equal(configuration.output, DEFAULT_OUTPUT_DIRECTORY);
});

test("未知 packing 字段报错并列出可用字段", () => {
  const packageJson = makePackageJson({
    packing: { minimum_engine_verison: [1, 21, 90] } as PackageJson["packing"],
  });
  assert.throws(
    () => resolvePackingConfigurationFrom(packageJson),
    /出现不支持的字段:minimum_engine_verison.*可用字段:mode、output、minimum_engine_version/
  );
});

test("validatePackingKeys 对合法字段不报错", () => {
  assert.doesNotThrow(() => validatePackingKeys({ mode: "auto", output: "dist/packages" }));
  assert.doesNotThrow(() => validatePackingKeys({}));
});

test("非法的 packing.mode 报错", () => {
  // 故意写入类型系统不允许的取值,验证运行期校验仍然拦住它。
  const packageJson = makePackageJson({ packing: { mode: "zip" } as unknown as PackageJson["packing"] });
  assert.throws(() => resolvePackingConfigurationFrom(packageJson), /packing\.mode 的取值 "zip" 不受支持/);
});
