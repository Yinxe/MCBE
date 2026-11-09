// ─── MCBE 文本颜色码与样式函数 ─────────────────────────────────
//
// Minecraft Bedrock Edition 使用 §(section sign)+ 字符控制文字颜色与格式。
// 参考: https://minecraft.wiki/w/Formatting_codes
//
// 用法:
//   import { color, style } from "@mc-toolchain/mod-common";
//
//   const msg = style("已上线", color.green);
//   const warn = style("警告", color.yellow, color.bold);
//   const err = style(`错误: ${msg}`, color.red);

const SECTION_SIGN = "§";

// ─── 颜色 & 格式常量 ───────────────────────────────────────────

export const color = {
  // ── 标准色 §0–§f ──
  /** §0 黑色 — 背景 #D0D1D4 对比度 13.6:1(推荐 ActionForm) */
  black: `${SECTION_SIGN}0`,
  /** §1 深蓝 — 背景 #D0D1D4 对比度 8.6:1(推荐 ActionForm) */
  darkBlue: `${SECTION_SIGN}1`,
  /** §2 深绿 — 对比度 2.0:1(不推荐 ActionForm,不易辨认) */
  darkGreen: `${SECTION_SIGN}2`,
  /** §3 深青 — 对比度 1.5:1(不推荐 ActionForm) */
  darkAqua: `${SECTION_SIGN}3`,
  /** §4 深红 — 背景 #D0D1D4 对比度 5.0:1(推荐 ActionForm) */
  darkRed: `${SECTION_SIGN}4`,
  /** §5 深紫 — 对比度 4.2:1(大字号可,小字号不推荐) */
  darkPurple: `${SECTION_SIGN}5`,
  /** §6 金色 — 对比度 1.2:1(不推荐 ActionForm) */
  gold: `${SECTION_SIGN}6`,
  /** §7 灰色 — 对比度 1.5:1(不推荐 ActionForm,和背景融合) */
  gray: `${SECTION_SIGN}7`,
  /** §8 深灰 — 背景 #D0D1D4 对比度 4.8:1(推荐 ActionForm) */
  darkGray: `${SECTION_SIGN}8`,
  /** §9 蓝色 — 对比度 3.3:1(大字号可,小字号不推荐) */
  blue: `${SECTION_SIGN}9`,
  /** §a 绿色 — 对比度 1.2:1(不推荐 ActionForm,背景上反白) */
  green: `${SECTION_SIGN}a`,
  /** §b 青色 — 对比度不足(不推荐 ActionForm) */
  aqua: `${SECTION_SIGN}b`,
  /** §c 红色 — 对比度 2.0:1(不推荐 ActionForm,偏暗) */
  red: `${SECTION_SIGN}c`,
  /** §d 浅紫 — 对比度不足(不推荐 ActionForm) */
  lightPurple: `${SECTION_SIGN}d`,
  /** §e 黄色 — 对比度不足(不推荐 ActionForm) */
  yellow: `${SECTION_SIGN}e`,
  /** §f 白色 — 对比度 1.0:1(不推荐 ActionForm,和背景融为一体) */
  white: `${SECTION_SIGN}f`,

  // ── Bedrock 独占 ──
  /** §g 金币金 — 对比度不足(不推荐 ActionForm) */
  minecoinGold: `${SECTION_SIGN}g`,

  // ── 格式码 ──
  /** §k 随机闪烁 */
  obfuscated: `${SECTION_SIGN}k`,
  /** §l 粗体 */
  bold: `${SECTION_SIGN}l`,
  /** §m 删除线 */
  strikethrough: `${SECTION_SIGN}m`,
  /** §n 下划线 */
  underline: `${SECTION_SIGN}n`,
  /** §o 斜体 */
  italic: `${SECTION_SIGN}o`,
  /** §r 重置 */
  reset: `${SECTION_SIGN}r`,

  // ── 语义别名 ──
  /** 成功/开启/在线 — §a 绿色 */
  success: `${SECTION_SIGN}a`,
  /** 警告/注意 — §e 黄色 */
  warn: `${SECTION_SIGN}e`,
  /** 错误/危险 — §c 红色 */
  error: `${SECTION_SIGN}c`,
  /** 高亮/强调 — §b 青色 */
  accent: `${SECTION_SIGN}b`,
  /** 醒目 — §d 浅紫 */
  highlight: `${SECTION_SIGN}d`,
  /** 辅助/次要 — §7 灰色 */
  muted: `${SECTION_SIGN}7`,
  /** 信息 — §f 白色 */
  info: `${SECTION_SIGN}f`,
  /** 假人名 — §e 黄色 */
  playerName: `${SECTION_SIGN}e`,
} as const;

// ─── 辅助函数 ─────────────────────────────────────────────────

/**
 * 给文本加上 MCBE 颜色/格式码。
 *
 * **不追加 §r**,便于多段拼接。需要重置时手动追加 `color.reset`。
 *
 * @param text   要着色的文本
 * @param styles 颜色/格式码,按顺序应用(颜色在先,格式在后)
 * @returns 着色后的字符串
 *
 * @example
 *   style("已上线", color.green)               // "§a已上线"
 *   style("危险操作", color.red, color.bold)   // "§c§l危险操作"
 *   // 独立消息需手动追加 reset 防样式泄漏:
 *   style("完成", color.success) + color.reset // "§a完成§r"
 */
export function style(text: string | number | boolean, ...styles: string[]): string {
  return styles.join("") + text;
}
