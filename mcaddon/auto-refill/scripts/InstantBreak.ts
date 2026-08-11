// ─── 瞬破方块规则集（声明式，零 @minecraft 依赖，可 node 单测） ──
// 不需要挖掘工具的"瞬破"方块识别，抽成规则集而不是硬编码 if：
// 这类 ID 常含关键词干扰词（redstone_wire 含 "stone"、jack_o_lantern 含
// "lantern"、stone_button 属按键），须先于标签/关键词识别层排除，避免
// 误判换工具。
// 扩展方式：新增一条则追加到 INSTANT_BREAK_RULES（suffix 后缀 / exact 整名 /
// keyword 包含三选多）；规则内为"任一命中即真"。顺序无关（互斥度高）。

/** 瞬破方块规则：命中即视为无需工具 */
export interface InstantBreakRule {
  /** 规则名（日志/调试用） */
  readonly name: string;
  /** 后缀匹配（如 "_button" 覆盖全部按钮变体） */
  readonly suffix?: readonly string[];
  /** 整名精确匹配 */
  readonly exact?: readonly string[];
  /** 关键词包含匹配（比 suffix/exact 宽泛，谨慎使用） */
  readonly keyword?: readonly string[];
}

/** 瞬破方块规则注册表（按序；任一规则任一条件命中即真） */
export const INSTANT_BREAK_RULES: readonly InstantBreakRule[] = [
  { name: "button-and-plate", suffix: ["_button", "_pressure_plate"] },
  { name: "redstone-wire-torch", exact: ["minecraft:redstone_wire", "minecraft:redstone_torch"] },
  { name: "jack-o-lantern", exact: ["minecraft:jack_o_lantern"] },
];

/**
 * 该方块类型是否为瞬破方块（无需挖掘工具）。
 * @param id 方块 typeId
 */
export function isInstantBreak(id: string): boolean {
  for (const rule of INSTANT_BREAK_RULES) {
    if (rule.suffix !== undefined && rule.suffix.some((s) => id.endsWith(s))) return true;
    if (rule.exact !== undefined && rule.exact.includes(id)) return true;
    if (rule.keyword !== undefined && rule.keyword.some((k) => id.includes(k))) return true;
  }
  return false;
}
