// ─── 包间依赖方向校正（纯逻辑，零文件系统依赖，可 node 单测） ──────────
// 基岩版的包依赖是单向的:行为包可以依赖资源包(启用行为包时游戏自动挂上资源包),
// 反过来资源包依赖行为包没有任何意义。本模块只处理清单的 dependencies 数组,
// 不读写文件,因此可脱离游戏与构建环境单独测试。

import type { PackManifest } from "./types";

/** 清单中的单个依赖项(包依赖或脚本模块依赖) */
export type PackDependency = NonNullable<PackManifest["dependencies"]>[number];

/** 判定依赖项是否指向指定包的 UUID(不区分大小写,缺失 uuid 的脚本模块依赖恒为否) */
function isDependencyOn(dependency: PackDependency, packUuid: string): boolean {
  return typeof dependency.uuid === "string" && dependency.uuid.toLowerCase() === packUuid.toLowerCase();
}

/**
 * 让依赖列表包含对指定包的依赖,并把其 `version` 同步为目标版本。
 *
 * 已有该包的依赖项时就地改版本(保留 `name` 等其余字段);没有时追加一项。
 * `appended` 表示是否为新追加,供调用方决定是否打印日志。
 */
export function ensurePackDependency(
  dependencies: PackDependency[],
  packUuid: string,
  version: number[]
): { dependencies: PackDependency[]; appended: boolean } {
  const existing = dependencies.find((dependency) => isDependencyOn(dependency, packUuid));
  if (existing) {
    existing.version = [...version];
    return { dependencies, appended: false };
  }
  return { dependencies: [...dependencies, { uuid: packUuid, version: [...version] }], appended: true };
}

/**
 * 删除依赖列表中指向指定包的依赖项。
 *
 * 用于清理反方向的依赖(资源包依赖行为包):这类依赖不会让游戏自动挂载任何东西,
 * 却会让资源包在行为包缺失时报「缺少依赖」。`removed` 表示是否真的删掉了条目。
 */
export function removePackDependency(
  dependencies: PackDependency[],
  packUuid: string
): { dependencies: PackDependency[]; removed: boolean } {
  const kept = dependencies.filter((dependency) => !isDependencyOn(dependency, packUuid));
  return { dependencies: kept, removed: kept.length !== dependencies.length };
}

/** 方向校正的结果;`undefined` 表示该字段应当整个去掉 */
export interface PackDependencyDirectionResult {
  behaviorDependencies: PackDependency[];
  resourceDependencies: PackDependency[] | undefined;
  /** 行为包是否新补了依赖 */
  appended: boolean;
  /** 资源包是否被删掉了反向依赖 */
  removed: boolean;
}

/**
 * 把两包之间的依赖方向校正为「行为包 → 资源包」。
 *
 * 基岩版的包依赖是单向的:行为包声明对资源包的依赖后,启用行为包时游戏会自动
 * 挂上资源包并在缺失时提示玩家;反方向的依赖没有任何加载效果,只会在行为包缺失时
 * 让资源包报「缺少依赖」,因此一律删除。
 *
 * 资源包的依赖被删空时返回 `undefined`,由调用方去掉整个 `dependencies` 字段,
 * 而不是留下无意义的空数组。
 */
export function reconcilePackDependencyDirection(
  behaviorUuid: string,
  resourceUuid: string,
  behaviorDependencies: PackDependency[],
  resourceDependencies: PackDependency[],
  version: number[]
): PackDependencyDirectionResult {
  const ensured = ensurePackDependency(behaviorDependencies, resourceUuid, version);
  const removed = removePackDependency(resourceDependencies, behaviorUuid);
  return {
    behaviorDependencies: ensured.dependencies,
    resourceDependencies: removed.dependencies.length > 0 ? removed.dependencies : undefined,
    appended: ensured.appended,
    removed: removed.removed,
  };
}
