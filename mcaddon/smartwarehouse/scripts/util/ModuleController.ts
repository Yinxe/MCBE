import { world } from "@minecraft/server";

/** Dynamic Property 键名 */
const SWITCH_KEY = "sw:module_enabled";

/**
 * 模组总开关 —— 紧急关停所有核心功能。
 *
 * 关闭后：
 * - 所有自定义命令返回"模组已关闭"
 * - 所有交互事件被忽略
 * - 分拣调度器停止
 * - 边界渲染停止
 * - 搜索功能不可用
 * - 只有 OP 能打开配置菜单重新开启
 *
 * 状态持久化到 DynamicProperty，重启后保持。
 */
export class ModuleController {
  private static enabled: boolean | undefined;

  /** 模组是否全局启用 */
  static isEnabled(): boolean {
    if (this.enabled === undefined) {
      const raw = world.getDynamicProperty(SWITCH_KEY);
      this.enabled = raw !== false; // 默认启用
    }
    return this.enabled;
  }

  /** 设置模组启用状态 */
  static setEnabled(value: boolean): void {
    this.enabled = value;
    world.setDynamicProperty(SWITCH_KEY, value);
  }

  /**
   * 在命令处理函数开头调用，模组关闭时返回错误消息。
   * 用法：if (msg = ModuleController.checkEnabled()) return failure(msg);
   */
  static checkEnabled(): string | undefined {
    if (!this.isEnabled()) return "§cSmartWarehouse 模组已关闭，请联系管理员";
    return undefined;
  }

  /**
   * 在 UI/交互入口调用，关闭时直接提示玩家。
   * @returns true = 已拦截（模组关闭）
   */
  static intercept(player: { sendMessage: (msg: string) => void }): boolean {
    if (this.isEnabled()) return false;
    try {
      player.sendMessage("§cSmartWarehouse 模组已关闭，请联系管理员");
    } catch {
      /* 忽略 */
    }
    return true;
  }

  /** 使缓存失效，下次读取时从 DynamicProperty 重新加载 */
  static invalidateCache(): void {
    this.enabled = undefined;
  }
}
