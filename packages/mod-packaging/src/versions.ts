// ─── 版本解析与最低游戏版本推导（纯逻辑，零文件系统依赖，可 node 单测） ──
// 本模块只处理字符串与数字,不读写任何文件,因此可脱离游戏与构建环境单独测试。

import { SCRIPT_API_MODULE_NAME, type PackageJson } from "./types";

/** 「脚本 API 版本 → 最低游戏版本」映射表条目 */
export interface ScriptApiVersionMapping {
  /** `@minecraft/server` 的版本 */
  scriptApiVersion: string;
  /** 该脚本 API 版本可用所需的最低游戏版本 */
  minimumEngineVersion: [number, number, number];
}

/**
 * 「`@minecraft/server` 版本 → 最低游戏版本」映射表,按脚本 API 版本降序。
 *
 * Minecraft 官方不提供该对应关系的机器可读数据(脚本 API 包、`mct` 数据目录、
 * `bedrock-samples` 的 `version.json` 都不含对方版本),因此只能静态维护。
 * 数据来源与逐条验证方式见 `docs/research/minecraft-server-api-versions.md`。
 *
 * 注意:该对应关系由「同批发布」推断而来,并非严格的版本公式——例如 1.12.0 与
 * 1.13.0 同日发布,分属 1.21.20 与 1.21.30。新增条目时务必对照该文档核实。
 */
export const SCRIPT_API_VERSION_MAPPINGS: readonly ScriptApiVersionMapping[] = [
  { scriptApiVersion: "2.11.0", minimumEngineVersion: [1, 26, 60] },
  { scriptApiVersion: "2.10.0", minimumEngineVersion: [1, 26, 50] },
  { scriptApiVersion: "2.9.0", minimumEngineVersion: [1, 26, 40] },
  { scriptApiVersion: "2.8.0", minimumEngineVersion: [1, 26, 30] },
  { scriptApiVersion: "2.7.0", minimumEngineVersion: [1, 26, 20] },
  { scriptApiVersion: "2.6.0", minimumEngineVersion: [1, 26, 10] },
  { scriptApiVersion: "2.5.0", minimumEngineVersion: [1, 26, 0] },
  { scriptApiVersion: "2.4.0", minimumEngineVersion: [1, 21, 130] },
  { scriptApiVersion: "2.3.0", minimumEngineVersion: [1, 21, 120] },
  { scriptApiVersion: "2.2.0", minimumEngineVersion: [1, 21, 110] },
  { scriptApiVersion: "2.1.0", minimumEngineVersion: [1, 21, 100] },
  { scriptApiVersion: "2.0.0", minimumEngineVersion: [1, 21, 90] },
  { scriptApiVersion: "1.19.0", minimumEngineVersion: [1, 21, 80] },
  { scriptApiVersion: "1.18.0", minimumEngineVersion: [1, 21, 70] },
  { scriptApiVersion: "1.17.0", minimumEngineVersion: [1, 21, 60] },
  { scriptApiVersion: "1.16.0", minimumEngineVersion: [1, 21, 50] },
  { scriptApiVersion: "1.15.0", minimumEngineVersion: [1, 21, 40] },
  { scriptApiVersion: "1.14.0", minimumEngineVersion: [1, 21, 30] },
  { scriptApiVersion: "1.13.0", minimumEngineVersion: [1, 21, 30] },
  { scriptApiVersion: "1.12.0", minimumEngineVersion: [1, 21, 20] },
  { scriptApiVersion: "1.11.0", minimumEngineVersion: [1, 21, 0] },
];

/**
 * 把 `package.json#version` 解析为 `[major, minor, patch]`。
 *
 * 仅接受三段数字;带预发布/构建后缀(如 `0.0.1-beta.1`)时取前三段并告警,
 * 无法解析为三段数字时报错。
 */
export function parseVersion(version: string): [number, number, number] {
  const matched = /^(\d+)\.(\d+)\.(\d+)([-+].*)?$/.exec(version);
  if (!matched) {
    throw new Error(`无法把 package.json 的 version "${version}" 解析为三段数字(major.minor.patch),打包中止。`);
  }
  if (matched[4]) {
    console.warn(
      `[packaging] version "${version}" 含后缀 "${matched[4]}",仅取前三段 ${matched[1]}.${matched[2]}.${matched[3]}。`
    );
  }
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/**
 * 把脚本 API 依赖版本规范化为三段数字。
 *
 * 依赖声明可能带范围前缀(`^2.0.0`、`~2.0.0`、`>=2.0.0`)或预发布后缀,
 * 这里去掉前缀、取前三段;带后缀时取前三段并告警。无法解析时报错。
 */
export function normalizeScriptApiVersion(dependencyVersion: string): [number, number, number] {
  const withoutRangePrefix = dependencyVersion.trim().replace(/^[\^~>=<\s]+/, "");
  const matched = /^(\d+)\.(\d+)\.(\d+)([-+].*)?$/.exec(withoutRangePrefix);
  if (!matched) {
    throw new Error(
      `无法把 ${SCRIPT_API_MODULE_NAME} 的依赖版本 "${dependencyVersion}" 解析为三段数字,` +
        `请在 package.json 的 packing.minimum_engine_version 中显式指定最低游戏版本。`
    );
  }
  if (matched[4]) {
    console.warn(
      `[packaging] ${SCRIPT_API_MODULE_NAME} 依赖版本 "${dependencyVersion}" 含后缀 "${matched[4]}",` +
        `仅取前三段 ${matched[1]}.${matched[2]}.${matched[3]}。`
    );
  }
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/** 逐段按数值比较两个三段版本号:返回负数表示左小,0 表示相等,正数表示左大 */
export function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

/**
 * 在映射表中查找给定脚本 API 版本对应的最低游戏版本。
 *
 * 查找语义为「取不超过该依赖版本的最大脚本 API 版本」对应档位,
 * 使依赖写 `2.0.1` 这类补丁位差异也能落到 `2.0.0` 那一档。
 *
 * 但超出表中已覆盖区间时返回 `undefined`——**不得**把高于最高档的版本
 * 钳到最高档:那会让未收录的新版本(如 3.0.0)静默得到一个看似合理的旧值,
 * 产出版本声明偏低的行为包。低于最低档同样视为未收录。
 */
export function findMinimumEngineVersion(
  scriptApiVersion: [number, number, number]
): [number, number, number] | undefined {
  let matched: [number, number, number] | undefined;
  let matchedApiVersion: [number, number, number] | undefined;
  for (const mapping of SCRIPT_API_VERSION_MAPPINGS) {
    const candidate = parseVersion(mapping.scriptApiVersion);
    if (compareVersions(candidate, scriptApiVersion) <= 0) {
      if (!matchedApiVersion || compareVersions(candidate, matchedApiVersion) > 0) {
        matched = mapping.minimumEngineVersion;
        matchedApiVersion = candidate;
      }
    }
  }
  if (!matchedApiVersion) {
    return undefined;
  }
  // 依赖版本高于表中最高档说明尚未收录,不能沿用最高档的值。
  const highestMappedVersion = SCRIPT_API_VERSION_MAPPINGS.map((mapping) =>
    parseVersion(mapping.scriptApiVersion)
  ).reduce((highest, candidate) => (compareVersions(candidate, highest) > 0 ? candidate : highest));
  if (compareVersions(scriptApiVersion, highestMappedVersion) > 0) {
    return undefined;
  }
  return matched;
}

/**
 * 解析最低游戏版本:显式配置优先,缺省时由 `@minecraft/server` 依赖版本推导。
 *
 * 两者都不可用时抛错并指明原因,不猜测、不回落到固定值——错误的
 * `min_engine_version` 只会在低版本客户端加载后才暴露,属于用户侧故障。
 */
export function resolveMinimumEngineVersion(packageJson: PackageJson): [number, number, number] {
  const explicitValue = packageJson.packing?.minimum_engine_version;
  if (explicitValue !== undefined) {
    if (
      !Array.isArray(explicitValue) ||
      explicitValue.length !== 3 ||
      !explicitValue.every((part) => Number.isInteger(part) && part >= 0)
    ) {
      throw new Error(
        `packing.minimum_engine_version 的取值 ${JSON.stringify(explicitValue)} 不合法,` +
          `应形如 [1, 21, 90] 的三段非负整数数组。`
      );
    }
    return [explicitValue[0], explicitValue[1], explicitValue[2]] as [number, number, number];
  }

  const dependencyVersion = packageJson.dependencies?.[SCRIPT_API_MODULE_NAME];
  if (!dependencyVersion) {
    throw new Error(
      `未配置 packing.minimum_engine_version,且 package.json 中没有 ${SCRIPT_API_MODULE_NAME} 依赖,` +
        `无法推导最低游戏版本。请显式配置 packing.minimum_engine_version,如 [1, 21, 90]。`
    );
  }

  const scriptApiVersion = normalizeScriptApiVersion(dependencyVersion);
  const derived = findMinimumEngineVersion(scriptApiVersion);
  if (!derived) {
    const knownVersions = SCRIPT_API_VERSION_MAPPINGS.map((mapping) => mapping.scriptApiVersion).join("、");
    throw new Error(
      `${SCRIPT_API_MODULE_NAME} 依赖版本 ${scriptApiVersion.join(".")} 不在版本映射表中,` +
        `无法推导最低游戏版本。请显式配置 packing.minimum_engine_version,` +
        `或把该版本补进 @mc-toolchain/mod-packaging 的 src/versions.ts 映射表(当前收录:${knownVersions})。`
    );
  }
  return derived;
}
