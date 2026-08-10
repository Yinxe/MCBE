// ─── 全局配置（管理员设置服务） ────────────────────────
// 四项开关 + 世界动态属性持久化：
//   全局启用 / 物品补充（refill）/ 武器替换（weapon）/ 工具替换（tool）
// 启动后由 main.ts 用 system.run 调用 load() 从世界 DP 恢复；此后在内存
// 读写，toggle 即落盘。各事件路由前用 isEnabled 判断是否执行。

import { world } from "@minecraft/server";

/** 功能开关标识（不含全局） */
export type Feature = "refill" | "weapon" | "tool";

/** 当前配置快照（菜单展示用） */
export interface AutoRefillSettings {
  globalEnabled: boolean;
  refillEnabled: boolean;
  weaponSwapEnabled: boolean;
  toolSwapEnabled: boolean;
}

const DP_GLOBAL = "autorefill:global";
const DP_REFILL = "autorefill:refill";
const DP_WEAPON = "autorefill:weapon";
const DP_TOOL = "autorefill:tool";

const DEFAULTS: AutoRefillSettings = {
  globalEnabled: true,
  refillEnabled: true,
  weaponSwapEnabled: true,
  toolSwapEnabled: true,
};

/** 开关 → 动态属性键 */
const DP_BY_FEATURE: Record<"global" | Feature, string> = {
  global: DP_GLOBAL,
  refill: DP_REFILL,
  weapon: DP_WEAPON,
  tool: DP_TOOL,
};

/** 开关 → 快照字段 */
const FIELD_BY_FEATURE: Record<"global" | Feature, keyof AutoRefillSettings> = {
  global: "globalEnabled",
  refill: "refillEnabled",
  weapon: "weaponSwapEnabled",
  tool: "toolSwapEnabled",
};

export class SettingsService {
  private s: AutoRefillSettings = { ...DEFAULTS };

  /** 启动后调用一次：从世界动态属性恢复（世界加载后执行，见 main.ts 的 system.run）。 */
  load(): void {
    try {
      this.s = {
        globalEnabled: world.getDynamicProperty(DP_GLOBAL) !== false,
        refillEnabled: world.getDynamicProperty(DP_REFILL) !== false,
        weaponSwapEnabled: world.getDynamicProperty(DP_WEAPON) !== false,
        toolSwapEnabled: world.getDynamicProperty(DP_TOOL) !== false,
      };
    } catch {
      // DP 读取失败（世界未完全加载）→ 保持默认全开
      this.s = { ...DEFAULTS };
    }
  }

  /** 当前配置快照（菜单展示用） */
  snapshot(): AutoRefillSettings {
    return { ...this.s };
  }

  /** 某功能是否执行（受全局开关约束） */
  isEnabled(feature: Feature): boolean {
    return this.s.globalEnabled && this.s[FIELD_BY_FEATURE[feature]];
  }

  /** 切换某个开关并落盘，返回切换后的状态 */
  toggle(feature: "global" | Feature): boolean {
    const field = FIELD_BY_FEATURE[feature];
    this.s[field] = !this.s[field];
    try {
      world.setDynamicProperty(DP_BY_FEATURE[feature], this.s[field]);
    } catch {
      // 落盘失败不影响内存状态
    }
    return this.s[field];
  }
}