import type { Container } from "@minecraft/server";
import type { OrganizeResult } from "../organize/SlotOrganizer";

/**
 * 整理钩子上下文 —— 每次容器整理成功写入后触发。
 */
export interface OrganizeHookContext {
  /** 被整理的容器 */
  container: Container;
  /** 整理结果 */
  result: OrganizeResult;
  /** 触发方式（onDeposit / manual） */
  source: string;
  /** 容器 ID（可能为空） */
  containerId?: string;
}

/** 钩子函数类型。抛出异常不会影响整理流程。 */
export type OrganizeHook = (ctx: OrganizeHookContext) => void;

/**
 * 整理钩子注册表 —— 非侵入式扩展点。
 *
 * 在 SlotOrganizer.apply 成功写入后触发。
 * 钩子报错不影响整理流程（try-catch 包裹）。
 */
export class OrganizeHooks {
  private static hooks: OrganizeHook[] = [];

  static register(hook: OrganizeHook): void {
    this.hooks.push(hook);
  }

  static clear(): void {
    this.hooks = [];
  }

  static run(ctx: OrganizeHookContext): void {
    for (const hook of this.hooks) {
      try {
        hook(ctx);
      } catch {
        /* 钩子报错不影响整理 */
      }
    }
  }
}
