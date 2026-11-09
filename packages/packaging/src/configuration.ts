// ─── 打包配置读取与校验 ────────────────────────────────────────
// 配置全部来自模组 package.json:包名与版本为必需来源,packing 块整体可选。

import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_PACKING_MODE,
  SUPPORTED_PACKING_KEYS,
  SUPPORTED_PACKING_MODES,
  type PackageJson,
  type PackingConfiguration,
} from "./types";
import { resolveMinimumEngineVersion } from "./versions";

/** 读取模组的 `package.json` */
export function readPackageJson(projectRoot: string): PackageJson {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`找不到模组的 package.json:${packageJsonPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch (error) {
    throw new Error(`无法解析模组的 package.json ${packageJsonPath}:${String(error)}`);
  }
}

/** 取模组名:去掉 npm scope 后的包名 */
export function getModuleName(packageJson: PackageJson): string {
  const segments = packageJson.name.split("/");
  return segments[segments.length - 1];
}

/** 校验 `packing` 块只包含受支持的字段,避免拼写错误被静默忽略 */
export function validatePackingKeys(packing: NonNullable<PackageJson["packing"]>): void {
  const unknownKeys = Object.keys(packing).filter((key) => !SUPPORTED_PACKING_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `package.json 的 packing 中出现不支持的字段:${unknownKeys.join("、")}。` +
        `可用字段:${SUPPORTED_PACKING_KEYS.join("、")}。`
    );
  }
}

/**
 * 校验 `packing` 配置并回落到默认值。
 *
 * 与 `resolvePackingConfiguration` 分离,便于在没有文件系统的情况下直接测试
 * 「未知字段报错」「非法 mode 报错」「缺省回落」这三条纯逻辑行为。
 */
export function resolvePackingConfigurationFrom(packageJson: PackageJson): PackingConfiguration {
  const packing = packageJson.packing ?? {};
  validatePackingKeys(packing);
  const mode = packing.mode ?? DEFAULT_PACKING_MODE;
  if (!SUPPORTED_PACKING_MODES.includes(mode)) {
    throw new Error(`packing.mode 的取值 "${mode}" 不受支持,只接受:${SUPPORTED_PACKING_MODES.join("、")}。`);
  }
  return {
    mode,
    output: packing.output ?? DEFAULT_OUTPUT_DIRECTORY,
    minimumEngineVersion: resolveMinimumEngineVersion(packageJson),
  };
}

/** 读取并校验打包配置,缺失字段回落到默认值 */
export function resolvePackingConfiguration(projectRoot: string): PackingConfiguration {
  return resolvePackingConfigurationFrom(readPackageJson(projectRoot));
}
