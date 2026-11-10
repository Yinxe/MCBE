// ─── 假人身份与名字规范（domain 纯逻辑） ──────────────────────────
// 假人以全局唯一自增 botId 寻址，显示名只是实体名与反查索引，不参与存储键。
// 名字合法性/规范化收敛于此。

/** MC 玩家名上限（含 sim- 前缀），超长引擎会生成 "(2)" 后缀幽灵（F-03） */
export const MAX_BOT_NAME_LENGTH = 32;

/** 假人显示名前缀：与真实玩家区分（真人默认名不带 sim-） */
export const BOT_NAME_PREFIX = "sim-";

/** 旧版 "$" 前缀（迁移兼容输入，规范化为 sim-） */
const LEGACY_PREFIX = "$";

/** 旧版 DP 槽位子键分隔片段，拒绝以防迁移歧义 */
const INVALID_NAME_SEGMENTS = [":inv:", ":equip:"] as const;

/**
 * 规范化假人名字：去空白、自动补 sim- 前缀、旧 "$" 前缀迁移。
 * @param input - 用户输入（可不含前缀）
 * @returns 规范化完整名；空输入原样返回（由校验判非法）
 */
export function normalizeBotName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(BOT_NAME_PREFIX)) return trimmed;
  if (trimmed.startsWith(LEGACY_PREFIX)) return `${BOT_NAME_PREFIX}${trimmed.slice(1)}`;
  return `${BOT_NAME_PREFIX}${trimmed}`;
}

/**
 * 规范化名是否合法；带引擎重名 "(N)" 后缀形态的尾巴（如 "sim-x(2)"）拒绝直接输入。
 * @param name - 已规范化的完整名
 */
export function isValidBotName(name: string): boolean {
  if (!name) return false;
  if (name.length > MAX_BOT_NAME_LENGTH) return false;
  if (INVALID_NAME_SEGMENTS.some((seg) => name.includes(seg))) return false;
  if (/[（(]\d+[)）]$/.test(name)) return false;
  return !/[\s§]/.test(name);
}

/**
 * 名字校验：返回中文错误串，合法返回 undefined。
 * @param name - 已规范化的完整名
 */
export function validateBotName(name: string): string | undefined {
  if (!name) return "假人名字不能为空";
  if (!name.startsWith(BOT_NAME_PREFIX)) return `假人名字必须以 ${BOT_NAME_PREFIX} 开头（内部规范化漏网）`;
  if (name.length <= BOT_NAME_PREFIX.length) return "假人名字主体不能为空";
  if (name.length > MAX_BOT_NAME_LENGTH) return `假人名字过长（含前缀最多 ${MAX_BOT_NAME_LENGTH} 字符）`;
  if (!isValidBotName(name)) return `假人名字 ${name} 含非法字符或旧格式冲突片段`;
  return undefined;
}

/**
 * 玩家身份键（ownerKey/配额 key/adminKeys 统一口径）。
 * Script API 无 XUID 暴露，以玩家名为键；一切真人引用只经本函数产出键。
 * @param playerName - 真人玩家名
 */
export function playerKey(playerName: string): string {
  return playerName;
}
