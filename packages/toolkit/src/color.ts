// ─── MCBE 字体颜色码 ────────────────────────────────────
//
// Minecraft Bedrock Edition 使用 §（section sign）+ 字符控制文字颜色和格式。
// 参考: https://minecraft.wiki/w/Formatting_codes
//
// 用法：
//   import { string, color } from "@yinxe/toolkit";
//
//   const msg = string("已上线", color.green);
//   const warn = string("警告", color.yellow, color.bold);
//   const err  = string(`错误: ${msg}`, color.red);
//   const tag  = string(botName, color.yellow);           // 假人名着色

const S = "§";

// ─── 颜色 & 格式常量 ───────────────────────────────────

export const color = {
  // ── 标准色 §0–§f ──
  /** §0 黑色 */
  black: `${S}0`,
  /** §1 深蓝 */
  darkBlue: `${S}1`,
  /** §2 深绿 */
  darkGreen: `${S}2`,
  /** §3 深青 */
  darkAqua: `${S}3`,
  /** §4 深红 */
  darkRed: `${S}4`,
  /** §5 深紫 */
  darkPurple: `${S}5`,
  /** §6 金色 */
  gold: `${S}6`,
  /** §7 灰色 */
  gray: `${S}7`,
  /** §8 深灰 */
  darkGray: `${S}8`,
  /** §9 蓝色 */
  blue: `${S}9`,
  /** §a 绿色 */
  green: `${S}a`,
  /** §b 青色 */
  aqua: `${S}b`,
  /** §c 红色 */
  red: `${S}c`,
  /** §d 浅紫 */
  lightPurple: `${S}d`,
  /** §e 黄色 */
  yellow: `${S}e`,
  /** §f 白色 */
  white: `${S}f`,

  // ── Bedrock 独占 ──
  /** §g 金币金（仅 Bedrock） */
  minecoinGold: `${S}g`,

  // ── 格式码 ──
  /** §k 随机闪烁 */
  obfuscated: `${S}k`,
  /** §l 粗体 */
  bold: `${S}l`,
  /** §m 删除线 */
  strikethrough: `${S}m`,
  /** §n 下划线 */
  underline: `${S}n`,
  /** §o 斜体 */
  italic: `${S}o`,
  /** §r 重置 */
  reset: `${S}r`,

  // ── 语义别名 ──
  /** 成功/开启/在线 — §a 绿色 */
  success: `${S}a`,
  /** 警告/注意 — §e 黄色 */
  warn: `${S}e`,
  /** 错误/危险 — §c 红色 */
  error: `${S}c`,
  /** 高亮/强调 — §b 青色 */
  accent: `${S}b`,
  /** 醒目 — §d 浅紫 */
  highlight: `${S}d`,
  /** 辅助/次要 — §7 灰色 */
  muted: `${S}7`,
  /** 信息 — §f 白色 */
  info: `${S}f`,
  /** 假人名 — §e 黄色 */
  playerName: `${S}e`,
} as const;

// ─── 辅助函数 ───────────────────────────────────────────

/**
 * 给文本加上 MCBE 颜色/格式码，自动追加 §r 重置。
 *
 * @param text  要着色的文本
 * @param styles  颜色/格式码，按顺序应用（color 在先，format 在后）
 * @returns  着色后的字符串
 *
 * @example
 *   string("已上线", color.green)             // "§a已上线§r"
 *   string("危险操作", color.red, color.bold) // "§c§l危险操作§r"
 *   string(botName, color.playerName)         // "§e假人A§r"
 */
export function string(text: string | number | boolean, ...styles: string[]): string {
  return styles.join("") + text + `${S}r`;
}
