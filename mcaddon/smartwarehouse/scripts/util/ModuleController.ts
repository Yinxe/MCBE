import { world } from "@minecraft/server";

/** Dynamic Property 键名 */
const SWITCH_KEY = "sw:sorting_enabled";

/**
 * 分拣系统开关 —— 仅控制自动分拣系统是否运作。
 *
 * 关闭后：
 * - 分拣调度器停止（所有仓库 interval 清除）
 * - processWarehouse 快速返回
 *
 * 不影响：菜单/命令/交互/容器整理/搜索/边界渲染。
 * 开关状态持久化到 DynamicProperty，重启后保持。
 */
export class ModuleController {
  private static enabled: boolean | undefined;

  /** 分拣系统是否启用（默认启用） */
  static isEnabled(): boolean {
    if (this.enabled === undefined) {
      const raw = world.getDynamicProperty(SWITCH_KEY);
      this.enabled = raw !== false;
    }
    return this.enabled;
  }

  /** 设置分拣系统启用状态 */
  static setEnabled(value: boolean): void {
    this.enabled = value;
    world.setDynamicProperty(SWITCH_KEY, value);
  }

  /**
   * 在分拣入口检查，关闭时返回错误消息。
   * 用法：const err = ModuleController.checkEnabled(); if (err) return failure(err);
   */
  static checkEnabled(): string | undefined {
    if (!this.isEnabled()) return "§c分拣系统已关闭";
    return undefined;
  }

  /**
   * 在 UI/交互入口调用，关闭时静默拦截。
   * @returns true = 已拦截（不分拣）
   */
  static intercept(player: { sendMessage: (msg: string) => void }): boolean {
    if (this.isEnabled()) return false;
    return true;
  }

  /** 使缓存失效，下次读取时从 DynamicProperty 重新加载 */
  static invalidateCache(): void {
    this.enabled = undefined;
  }
}
