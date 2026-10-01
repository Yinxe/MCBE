// ─── DP JSON 读写原语（F-24：单值上限实测 ~32KB） ──────────────────
// 超限抛带键名的编程错误（超大负载应走 NBT 阵列）；损坏 JSON 返回 undefined。

import { world } from "@minecraft/server";

/** 单值字节上限（引擎实测 ~32KB，留余量） */
const DP_VALUE_BYTE_LIMIT = 30 * 1024;

/** UTF-8 字节长（不依赖 TextEncoder——BP 脚本环境无 DOM lib 保证） */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // 代理对占两码位
    } else n += 3;
  }
  return n;
}

/**
 * 读 DP 并 JSON 解析。
 * @param key DP 键
 * @returns 解析产物；键缺失/非字符串/解析失败均为 undefined（形状合法性由调用方守卫）
 */
export function readJson<T>(key: string): T | undefined {
  const raw = world.getDynamicProperty(key);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * 序列化写 DP（32KB 前置检查，F-24）。
 * @param key DP 键
 * @param value 可 JSON 化负载
 * @throws 超限时抛编程错误（带键名与字节数）
 */
export function writeJson(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  const bytes = utf8Bytes(json);
  if (bytes > DP_VALUE_BYTE_LIMIT) {
    throw new Error(
      `[mockplayer3] DP 超限（编程错误——该负载应走 NBT 阵列）：${key} ${bytes}B > ${DP_VALUE_BYTE_LIMIT}B`
    );
  }
  world.setDynamicProperty(key, json);
}

/** 删除 DP 键（setDynamicProperty undefined 语义）；异常吞（幂等清理） */
export function removeKey(key: string): void {
  try {
    world.setDynamicProperty(key, undefined);
  } catch {
    // 键不存在等——删除语义按完成处理
  }
}
