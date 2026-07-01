import { world } from "@minecraft/server";
import { getUtf16Length, parseJsonObject, stringifyJson } from "../util/Json";

/**
 * 动态属性安全长度上限（24,000 UTF-16 编码单元）。
 *
 * Minecraft 动态属性的实际大小限制约 32KB，此处预留充足余量以避免静默截断。
 */
export const DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH = 24_000;

/**
 * 基于 Minecraft 世界动态属性的 JSON 读写存储层。
 *
 * 动态属性存在平台相关的大小限制，通过 `maxStringLength` 参数对序列化 JSON 字符串的
 * UTF-16 编码单元长度实施强制检查，防止数据被静默截断或损坏。
 *
 * 典型用途：将结构化数据（仓库索引、元数据、容器分片）序列化为 JSON 后存入动态属性。
 */
export class DynamicPropertyStore {
  /**
   * @param maxStringLength 序列化 JSON 字符串的最大允许 UTF-16 长度，默认值为
   *                         `DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH`（24,000）
   */
  constructor(private readonly maxStringLength = DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH) {}

  /**
   * 从动态属性中读取并解析 JSON 值。
   * @param key      属性键名
   * @param fallback 当属性不存在或值不是字符串时返回的默认值
   * @returns 解析后的类型化值或 fallback
   */
  getJson<T>(key: string, fallback: T): T {
    const value = world.getDynamicProperty(key);
    return parseJsonObject(typeof value === "string" ? value : undefined, fallback);
  }

  /**
   * 将值序列化为 JSON 并写入动态属性。
   * 写入前会校验 UTF-16 长度是否超过 `maxStringLength`，超限则抛出异常。
   * @param key   属性键名
   * @param value 要序列化的值
   * @throws 如果序列化后的 JSON 字符串长度超过上限则抛出错误
   */
  setJson(key: string, value: unknown): void {
    const raw = stringifyJson(value);
    if (getUtf16Length(raw) > this.maxStringLength) {
      throw new Error(`动态属性 ${key} 大小超限：${getUtf16Length(raw)} > ${this.maxStringLength}`);
    }
    world.setDynamicProperty(key, raw);
  }

  /**
   * 删除动态属性中的指定键。
   * @param key 要删除的属性键名
   */
  delete(key: string): void {
    world.setDynamicProperty(key, undefined);
  }
}
