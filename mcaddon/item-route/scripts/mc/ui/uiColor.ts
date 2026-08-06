// ─── UI 颜色常量（全局唯一"颜色模块"，纯零依赖） ───────────
// MC § 格式码是固定值，这里一次性定义成命名常量（与 toolkit color 模块同值），
// 供 UI 表单、命令/交互/效果的聊天消息统一引用，杜绝散写 `§x`。
// 为何不直接从 @yinxe/toolkit 引 color：toolkit 根 index 会连带加载 @minecraft/server-ui，
// 在 node 单测（interactionLogic/auth 等被 node --test 编译/执行）下无法加载；
// 故此处本地镜像为**无依赖**模块，node 与游戏内均可用（单一事实来源）。
//
// 背景适配（审查要点，toolkit color 模块的 WCAG 对比度标注）：
//   · ActionForm 按钮背景 #D0D1D4（浅灰）→ 前景必须**深色**（btn.* 用
//     black/darkBlue/darkRed/darkGray/darkPurple/blue，均 ≥3:1）
//   · ModalForm 背景深灰 → 前景用**浅色**（form.* 用白/黄/亮青，深底可读）
//   · 聊天背景（关面板=透明 / 开面板=灰）→ 语义色（chat.* 用绿/黄/红/白），避免深色系

/** 标准色与格式码（§ 码，MC 固定值） */
export const color = {
  // 标准色 §0–§f
  black: "§0",
  darkBlue: "§1",
  darkGreen: "§2",
  darkAqua: "§3",
  darkRed: "§4",
  darkPurple: "§5",
  gold: "§6",
  gray: "§7",
  darkGray: "§8",
  blue: "§9",
  green: "§a",
  aqua: "§b",
  red: "§c",
  lightPurple: "§d",
  yellow: "§e",
  white: "§f",
  // 格式码
  obfuscated: "§k",
  bold: "§l",
  strikethrough: "§m",
  underline: "§n",
  italic: "§o",
  reset: "§r",
  // 语义别名
  success: "§a", // 成功/开启/在线
  warn: "§e", // 警告/注意
  error: "§c", // 错误/危险
  accent: "§b", // 强调/青色
  highlight: "§d", // 醒目/浅紫
  muted: "§7", // 辅助/次要
  info: "§f", // 信息/白色
  playerName: "§e", // 假人名/黄色
} as const;

/** ActionForm 按钮文字（浅灰背景 → 深色前景） */
export const btn = {
  /** 主操作（创建/确认/进入） */
  primary: color.black,
  /** 导航（列表/搜索/管理/菜单） */
  nav: color.darkBlue,
  /** 中性/信息 */
  info: color.darkGray,
  /** 强调/特殊（配置等） */
  accent: color.darkPurple,
  /** 危险（删除/移除） */
  danger: color.darkRed,
} as const;

/** ModalForm 文字（深灰背景 → 浅色前景） */
export const form = {
  /** 标题 */
  title: color.yellow,
  /** 正文/值 */
  body: color.white,
  /** 强调 */
  accent: color.aqua,
  /** 成功值 */
  success: color.green,
  /** 错误提示 */
  error: color.red,
  /** 次要说明（深底上 §7 偏弱，仅辅助用） */
  muted: color.gray,
} as const;

/** 聊天/命令消息（透明或灰背景 → 语义色） */
export const chat = {
  success: color.success,
  warn: color.warn,
  error: color.error,
  info: color.info,
  muted: color.muted,
  /** 高亮/搜索命中 */
  highlight: color.highlight,
  /** 强调/青色 */
  accent: color.accent,
  reset: color.reset,
} as const;
