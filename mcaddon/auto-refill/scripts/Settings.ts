// ─── 全局配置（管理员设置服务） ────────────────────────
// 五项开关 + 耐久保护阈值 + 世界动态属性持久化：
//   全局启用 / 物品补充（refill）/ 武器替换（weapon）/ 工具替换（tool）
//   / 耐久保护（durability，含阈值 durabilityThreshold）
// 启动后由 main.ts 用 system.run 调用 load() 从世界 DP 恢复；此后在内存
// 读写，toggle/setThreshold 即落盘。各事件路由前用 isEnabled 判断是否执行。

import { world } from "@minecraft/server";

/** 功能开关标识（不含全局） */
export type Feature = "refill" | "weapon" | "tool" | "durability";

/** 当前配置快照（菜单展示用） */
export interface AutoRefillSettings {
  globalEnabled: boolean;
  refillEnabled: boolean;
  weaponSwapEnabled: boolean;
  toolSwapEnabled: boolean;
  durabilityProtectEnabled: boolean;
  /** 耐久保护替换阈值：剩余耐久占比低于该值（0..1）视为紧急 */
  durabilityThreshold: number;
  /** 耐久保护绝对下限：剩余耐久低于该值（不论占比）也视为紧急，兜住低耐久上限工具 */
  durabilityFloor: number;
}

const DP_GLOBAL = "autorefill:global";
const DP_REFILL = "autorefill:refill";
const DP_WEAPON = "autorefill:weapon";
const DP_TOOL = "autorefill:tool";
const DP_DURABILITY = "autorefill:durability";
const DP_DURABILITY_THRESHOLD = "autorefill:durabilityThreshold";
const DP_DURABILITY_FLOOR = "autorefill:durabilityFloor";

/** 耐久保护阈值取值范围（占比） */
export const DURABILITY_THRESHOLD_MIN = 0.01;
export const DURABILITY_THRESHOLD_MAX = 0.5;

/** 耐久保护绝对下限取值范围（剩余耐久点数） */
export const DURABILITY_FLOOR_MIN = 1;
export const DURABILITY_FLOOR_MAX = 64;

const DEFAULTS: AutoRefillSettings = {
  globalEnabled: true,
  refillEnabled: true,
  weaponSwapEnabled: true,
  toolSwapEnabled: true,
  durabilityProtectEnabled: true,
  durabilityThreshold: 0.1,
  durabilityFloor: 16,
};

/** 布尔开关字段（toggle 可写的快照字段集合） */
type BooleanField =
  "globalEnabled" | "refillEnabled" | "weaponSwapEnabled" | "toolSwapEnabled" | "durabilityProtectEnabled";

/** 开关 → 动态属性键 */
const DP_BY_FEATURE: Record<"global" | Feature, string> = {
  global: DP_GLOBAL,
  refill: DP_REFILL,
  weapon: DP_WEAPON,
  tool: DP_TOOL,
  durability: DP_DURABILITY,
};

/** 开关 → 快照布尔字段 */
const FIELD_BY_FEATURE: Record<"global" | Feature, BooleanField> = {
  global: "globalEnabled",
  refill: "refillEnabled",
  weapon: "weaponSwapEnabled",
  tool: "toolSwapEnabled",
  durability: "durabilityProtectEnabled",
};

export class SettingsService {
  private s: AutoRefillSettings = { ...DEFAULTS };

  /** 启动后调用一次：从世界动态属性恢复（世界加载后执行，见 main.ts 的 system.run）。 */
  load(): void {
    try {
      const threshold = world.getDynamicProperty(DP_DURABILITY_THRESHOLD);
      const floor = world.getDynamicProperty(DP_DURABILITY_FLOOR);
      this.s = {
        globalEnabled: world.getDynamicProperty(DP_GLOBAL) !== false,
        refillEnabled: world.getDynamicProperty(DP_REFILL) !== false,
        weaponSwapEnabled: world.getDynamicProperty(DP_WEAPON) !== false,
        toolSwapEnabled: world.getDynamicProperty(DP_TOOL) !== false,
        durabilityProtectEnabled: world.getDynamicProperty(DP_DURABILITY) !== false,
        durabilityThreshold:
          typeof threshold === "number" && threshold > 0 ? clamp(threshold) : DEFAULTS.durabilityThreshold,
        durabilityFloor: typeof floor === "number" && floor > 0 ? clampFloor(floor) : DEFAULTS.durabilityFloor,
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

  /** 将开关设为指定值并落盘（管理菜单 ModalForm 一次性应用用），返回设置后的状态 */
  setFeature(feature: "global" | Feature, on: boolean): boolean {
    const field = FIELD_BY_FEATURE[feature];
    this.s[field] = on;
    try {
      world.setDynamicProperty(DP_BY_FEATURE[feature], on);
    } catch {
      // 落盘失败不影响内存状态
    }
    return on;
  }

  /** 当前耐久保护阈值（占比 0..1） */
  durabilityThreshold(): number {
    return this.s.durabilityThreshold;
  }

  /**
   * 设置耐久保护阈值并落盘（收敛到 [MIN, MAX]）。
   * @param ratio 阈值占比 0..1
   */
  setDurabilityThreshold(ratio: number): void {
    this.s.durabilityThreshold = clamp(ratio);
    try {
      world.setDynamicProperty(DP_DURABILITY_THRESHOLD, this.s.durabilityThreshold);
    } catch {
      // 落盘失败不影响内存状态
    }
  }

  /** 当前耐久保护绝对下限（剩余耐久点数；与占比阈值折算取较大值生效） */
  durabilityFloor(): number {
    return this.s.durabilityFloor;
  }

  /**
   * 设置耐久保护绝对下限并落盘（收敛到 [FLOOR_MIN, FLOOR_MAX]）。
   * @param floor 剩余耐久点数下限（如 16：石镐还剩 16 点耐久就提前收起）
   */
  setDurabilityFloor(floor: number): void {
    this.s.durabilityFloor = clampFloor(floor);
    try {
      world.setDynamicProperty(DP_DURABILITY_FLOOR, this.s.durabilityFloor);
    } catch {
      // 落盘失败不影响内存状态
    }
  }
}

/** 收敛阈值占比到合法区间 */
function clamp(ratio: number): number {
  return Math.min(DURABILITY_THRESHOLD_MAX, Math.max(DURABILITY_THRESHOLD_MIN, ratio));
}

/** 收敛绝对下限到合法区间 */
function clampFloor(floor: number): number {
  return Math.min(DURABILITY_FLOOR_MAX, Math.max(DURABILITY_FLOOR_MIN, Math.round(floor)));
}
