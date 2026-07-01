/**
 * 安全地解析 JSON 字符串为对象。
 * 如果输入为空或解析失败，返回 fallback 默认值。
 * 同时确保解析结果是一个普通对象（非数组）才返回，否则也回退到 fallback。
 *
 * @param raw - 待解析的 JSON 字符串（可能为 undefined）
 * @param fallback - 解析失败时的默认返回值
 * @returns 解析后的对象或 fallback
 */
export function parseJsonObject<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * 将任意值序列化为 JSON 字符串。
 * @param value - 要序列化的值
 * @returns JSON 字符串
 */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 获取字符串的 UTF-16 长度。
 * Minecraft 动态属性（dynamic property）的存储预算按 UTF-16 code units 计算，
 * JavaScript 的 String.length 恰好等于 UTF-16 code unit 的数量，因此直接返回 length。
 *
 * @param value - 输入字符串
 * @returns UTF-16 code unit 数量
 */
export function getUtf16Length(value: string): number {
  return value.length;
}
