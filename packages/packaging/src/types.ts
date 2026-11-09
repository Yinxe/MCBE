// ─── 打包相关类型 ──────────────────────────────────────────────
// 仅类型与常量,不含任何逻辑,便于被纯逻辑模块与文件系统模块共同引用。

/** 打包模式 */
export type PackingMode = "auto" | "mcpack" | "mcaddon";

/** 包的类型 */
export type PackType = "behavior" | "resource";

/** 解析后的打包配置(全部字段都有默认值) */
export interface PackingConfiguration {
  /** 产物形态;`auto` 依据探测到的包数量自动决定 */
  mode: PackingMode;
  /** 产物输出目录(相对模组根目录) */
  output: string;
  /**
   * 最低游戏版本(三段数字)。
   *
   * 显式配置优先;缺省时由 `@minecraft/server` 依赖版本推导。
   */
  minimumEngineVersion: [number, number, number];
}

/** 探测/解析得到的包目录(绝对路径) */
export interface PackDirectories {
  behaviorPackDirectory?: string;
  resourcePackDirectory?: string;
}

/** `package.json` 中与打包相关的字段 */
export interface PackageJson {
  name: string;
  version: string;
  packing?: {
    mode?: PackingMode;
    output?: string;
    minimum_engine_version?: number[];
  };
  dependencies?: Record<string, string>;
}

/** 包清单中与类型判定相关的字段 */
export interface PackManifest {
  header: {
    uuid: string;
    version: number[];
    min_engine_version?: number[];
  };
  modules: Array<{
    type: string;
    version: number[];
  }>;
  dependencies?: Array<{
    uuid?: string;
    module_name?: string;
    version: number[] | string;
  }>;
}

/** 打包中间产物目录(相对模组根目录),用于暂存 mcaddon 内部的 mcpack */
export const INTERMEDIATE_PACKAGE_DIRECTORY = "temp/packs";

/** 默认打包模式 */
export const DEFAULT_PACKING_MODE: PackingMode = "auto";

/** 默认产物输出目录(相对模组根目录) */
export const DEFAULT_OUTPUT_DIRECTORY = "dist/packages";

/** 支持的打包模式 */
export const SUPPORTED_PACKING_MODES: readonly PackingMode[] = ["auto", "mcpack", "mcaddon"];

/** 行为包的官方顶层目录名;与 `mct` 模板一致,不可配置 */
export const BEHAVIOR_PACKS_DIRECTORY = "behavior_packs";

/** 资源包的官方顶层目录名;与 `mct` 模板一致,不可配置 */
export const RESOURCE_PACKS_DIRECTORY = "resource_packs";

/** 已被废弃的缩写目录名,出现时报错并提示改名 */
export const LEGACY_PACK_DIRECTORY_NAMES: Readonly<Record<string, string>> = {
  BP: BEHAVIOR_PACKS_DIRECTORY,
  RP: RESOURCE_PACKS_DIRECTORY,
};

/** `packing` 块支持的字段名;出现其它字段时报错,避免拼写错误被静默当成「未配置」 */
export const SUPPORTED_PACKING_KEYS: readonly string[] = ["mode", "output", "minimum_engine_version"];

/** 脚本 API 模块名,最低游戏版本的推导来源 */
export const SCRIPT_API_MODULE_NAME = "@minecraft/server";

/** 判定为行为包的模块类型 */
export const BEHAVIOR_PACK_MODULE_TYPES: ReadonlySet<string> = new Set(["data", "script"]);

/** 判定为资源包的模块类型 */
export const RESOURCE_PACK_MODULE_TYPE = "resources";
