// ─── MCBE 字体颜色码 ────────────────────────────────────
//
// Minecraft Bedrock Edition 使用 §（section sign）+ 字符控制文字颜色和格式。
// 参考: https://minecraft.wiki/w/Formatting_codes
//
// 用法：
//   import { string, color, actionFormFg } from "@yinxe/toolkit";
//
//   const msg = string("已上线", color.green);
//   const warn = string("警告", color.yellow, color.bold);
//   const err  = string(`错误: ${msg}`, color.red);
//   const tag  = string(botName, color.playerName);      // 假人名着色
/**
 * §t 材质 青金石 material lapis
 §u 材质 紫水晶 material amethyst
 §v 材质 树脂 material resin

 其他格式化代码
 §k 随机字符
 §l 粗体
 §m 删除线 仅java版
 §n 下划线 仅Java版
 §o 斜体
 §r 重置样式

 §d 亮紫色 light purple
 §e 黄色 yellow
 §f 白色 white

 §0 黑色 black
 §1 深蓝 dark blue
 §2 深绿 dark green
 §3 深湖绿 dark aqua
 §4 深红 dark red
 §5 深紫 dark purple
 §6 金色 gold
 §7 灰色 gray
 §8 深灰 dark gray
 §9 蓝色 blue
 §a 绿色 green
 §b 湖绿色
 §c 红色 red

 以下内容仅基岩版可用！
 §g minecoin金 minecoin gold
 §h 材质 石英 material quartz
 §i 材质 铁 material iron
 §j 材质 下界合金 material netherite
 §m 材质 红石 material redstone
 §n 材质 铜 material copper
 §p 材质 金 material gold
 §q 材质 绿宝石 material emerald
 §s 材质 钻石 material diamond

 */
const S = "§";

// ─── 颜色 & 格式常量 ───────────────────────────────────

export const color = {
  // ── 标准色 §0–§f ──
  /** §0 黑色 — 背景 #D0D1D4 对比度 13.6:1（推荐 ActionForm） */
  black: `${S}0`,
  /** §1 深蓝 — 背景 #D0D1D4 对比度 8.6:1（推荐 ActionForm） */
  darkBlue: `${S}1`,
  /** §2 深绿 — 对比度 2.0:1（不推荐 ActionForm，不易辨认） */
  darkGreen: `${S}2`,
  /** §3 深青 — 对比度 1.5:1（不推荐 ActionForm） */
  darkAqua: `${S}3`,
  /** §4 深红 — 背景 #D0D1D4 对比度 5.0:1（推荐 ActionForm） */
  darkRed: `${S}4`,
  /** §5 深紫 — 对比度 4.2:1（大字号可，小字号不推荐） */
  darkPurple: `${S}5`,
  /** §6 金色 — 对比度 1.2:1（不推荐 ActionForm） */
  gold: `${S}6`,
  /** §7 灰色 — 对比度 1.5:1（不推荐 ActionForm，和背景融合） */
  gray: `${S}7`,
  /** §8 深灰 — 背景 #D0D1D4 对比度 4.8:1（推荐 ActionForm） */
  darkGray: `${S}8`,
  /** §9 蓝色 — 对比度 3.3:1（大字号可，小字号不推荐） */
  blue: `${S}9`,
  /** §a 绿色 — 对比度 1.2:1（不推荐 ActionForm，背景上反白） */
  green: `${S}a`,
  /** §b 青色 — 对比度不足（不推荐 ActionForm） */
  aqua: `${S}b`,
  /** §c 红色 — 对比度 2.0:1（不推荐 ActionForm，偏暗） */
  red: `${S}c`,
  /** §d 浅紫 — 对比度不足（不推荐 ActionForm） */
  lightPurple: `${S}d`,
  /** §e 黄色 — 对比度不足（不推荐 ActionForm） */
  yellow: `${S}e`,
  /** §f 白色 — 对比度 1.0:1（不推荐 ActionForm，和背景融为一体） */
  white: `${S}f`,

  // ── Bedrock 独占 ──
  /** §g 金币金 — 对比度不足（不推荐 ActionForm） */
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

// ─── ActionForm 推荐前景色 ────────────────────────────
//
// ActionForm 按钮背景 #D0D1D4（rgb(208,209,212)），
// 以下颜色经 WCAG 对比度计算达到 AA 级（≥4.5:1）或
// AA-large 级（≥3:1），在按钮上清晰可读。

/**
 * ActionForm 按钮（背景 #D0D1D4）上推荐使用的前景色数组。
 *
 * WCAG 分级：
 *   ★★★ = AAA ≥7:1（强烈推荐）
 *   ★★  = AA  ≥4.5:1（推荐）
 *   ★   = AA-large ≥3:1（大字号可）
 *
 * @example
 *   // 按钮标题用黑色粗体
 *   form.title(string("确认操作", color.black, color.bold));
 *
 *   // 按钮 body 用深蓝
 *   form.body(string("此操作不可撤销", color.darkBlue));
 */
export const actionFormFg: readonly {
  label: string;
  color: string;
  contrast: string;
  level: "AAA" | "AA" | "AA-large";
}[] = [
  { label: "black",      color: `${S}0`, contrast: "13.6:1", level: "AAA" },
  { label: "darkBlue",   color: `${S}1`, contrast: "8.6:1",  level: "AAA" },
  { label: "darkRed",    color: `${S}4`, contrast: "5.0:1",  level: "AA"  },
  { label: "darkGray",   color: `${S}8`, contrast: "4.8:1",  level: "AA"  },
  { label: "darkPurple", color: `${S}5`, contrast: "4.2:1",  level: "AA"  },
  { label: "blue",       color: `${S}9`, contrast: "3.3:1",  level: "AA-large" },
] as const;

// ─── 辅助函数 ───────────────────────────────────────────

/**
 * 给文本加上 MCBE 颜色/格式码。
 *
 * 不追加 §r，便于多段拼接。需要重置时手动追加 `color.reset`。
 *
 * @param text  要着色的文本
 * @param styles  颜色/格式码，按顺序应用（color 在先，format 在后）
 * @returns  着色后的字符串
 *
 * @example
 *   style("已上线", color.green)               // "§a已上线"
 *   style("危险操作", color.red, color.bold)   // "§c§l危险操作"
 *   style(botName, color.playerName)           // "§e假人A"
 *   // 独立消息需手动追加 reset 防泄漏：
 *   style("完成", color.success) + color.reset // "§a完成§r"
 */
export function style(text: string | number | boolean, ...styles: string[]): string {
  return styles.join("") + text;
}
