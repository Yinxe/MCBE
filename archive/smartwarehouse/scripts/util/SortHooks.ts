import type { Container, ItemStack } from "@minecraft/server";
import type { WarehouseData } from "../types";

/**
 * 分拣钩子上下文 —— 每次 ItemStack 被成功分拣到目标容器后触发。
 */
export interface SortHookContext {
  /** 被分拣的物品堆 */
  stack: ItemStack;
  /** 放置了多少个 */
  placed: number;
  /** 分拣后的剩余量（undefined = 全部放完） */
  remaining?: ItemStack;
  /** 目标容器 ID */
  targetContainerId: string;
  /** 目标容器对象 */
  targetContainer: Container;
  /** 所属仓库 */
  warehouse: WarehouseData;
  /** 标记标签（bulk/match/family/autocreate/misc） */
  tag: string;
}

/** 钩子函数类型。抛出异常不会影响分拣流程。 */
export type SortHook = (ctx: SortHookContext) => void;

/**
 * 分拣钩子注册表 —— 非侵入式扩展点。
 *
 * 在 tryTransfer 成功放置物品后调用已注册的钩子。
 * 钩子报错不影响分拣流程（try-catch 包裹）。
 * 可用于数据流监控、日志、审计等。
 *
 * 用法：
 * ```
 * import { SortHooks } from "./SortHooks";
 * SortHooks.register((ctx) => {
 *   if (ctx.stack.typeId === "minecraft:diamond") {
 *     console.warn(`玩家分拣了钻石到 ${ctx.targetContainerId}`);
 *   }
 * });
 * ```
 */
export class SortHooks {
  private static hooks: SortHook[] = [];

  /** 注册一个分拣钩子 */
  static register(hook: SortHook): void {
    this.hooks.push(hook);
  }

  /** 清空所有钩子（用于测试/重置） */
  static clear(): void {
    this.hooks = [];
  }

  /**
   * 触发所有已注册钩子。
   * 内部用 try-catch 包裹，单个钩子异常不影响其他钩子和分拣流程。
   */
  static run(ctx: SortHookContext): void {
    for (const hook of this.hooks) {
      try {
        hook(ctx);
      } catch {
        // 钩子报错不影响分拣
      }
    }
  }
}
