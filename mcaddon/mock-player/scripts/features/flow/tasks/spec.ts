// ─── 循环任务统一规范（游戏原生阶段机，tick 语义） ──────
// 用户规格：循环任务不允许各写各的 while 面向过程——统一声明为「阶段机」：
//   任务 = 阶段表（每阶段一个执行体）+ 初始阶段；运行骨架（本文件唯一实现）
//   统一承担循环分派、异常消化、退避上限、流转日志、收尾清理。
//
// 骨架职责（任务文件里**不得**再手写这些样板）：
//   - 循环分派：while(!token.cancelled) 按当前阶段执行，阶段返回值决定流转
//     （返回阶段 id；返回 "stop" 任务自然完成）
//   - 异常消化：阶段执行体抛出的异常 → 记 warn + 退避后**重跑当前阶段**；
//     连续失败达上限（默认 3）→ 上抛终止（任务运行时统一告警）；
//     取消（token.cancelled / CancelledError）→ 静默收尾
//   - 可观测：阶段流转记 info 日志（`阶段 find → navigate`），游戏内可排查
//     任务卡点；同阶段自旋（返回自身）不刷日志
//   - 收尾：finally 统一停动作（stopMoving/stopBreakingBlock）+ 执行
//     spec.cleanup（释放共享池认领等）+ 收口令牌
//
// 阶段实现约定（任务文件只写「这个阶段做什么」）：
//   - 细粒度节奏用 ctx.wait(ticks)（取消即唤醒），不自己写 runTimeout
//   - 预期内的瞬态失败（如放置冲突）就地 warn 后返回（下一轮自然重试）；
//     不确定能否恢复的异常直接抛，交给骨架退避
//   - 阶段间共享状态放 ctx.data（createData 声明字段），不藏闭包变量
//   - 游戏能力经 ctx（botName/shared/notify/wait/token）注入，不摸全局单例

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { CancelledError, describeError } from "../../../errors";
import type { CancelToken } from "../../../rules/utils/CancelToken";
import type { BotTask, BotTaskKind } from "../../../runtime";
import type { SharedMemory } from "../../../runtime";
import { createThrottledNotifier, waitTicksCancellable } from "./loops";

/** 终止阶段返回值：任务自然完成（正常退出，非失败） */
export const TASK_DONE = "stop";

// ─── 游戏运行环境（注入阶段上下文） ────────────────────

/** 游戏任务基础服务（阶段执行体经 ctx 访问，不摸全局单例） */
export interface GameTaskServices {
  /** 假人名 */
  readonly botName: string;
  /** 跨假人共享记忆（共享点池/树资源池） */
  readonly shared: SharedMemory;
  /** 任务取消令牌（骨架在每个阶段边界与 ctx.wait 中检测） */
  readonly token: CancelToken;
  /** 附近 16 格玩家通知（节流；只传详情） */
  notify(detail: string): void;
  /** tick 等待（取消即唤醒；任务内统一节奏控制） */
  wait(ticks: number): Promise<void>;
}

/** 阶段执行上下文：基础服务 + 阶段间共享状态 */
export interface PhaseContext<TData> extends GameTaskServices {
  /** 阶段间共享状态（createData 声明字段；阶段返回值不得携带状态，一律写 data） */
  data: TData;
}

/** 单个阶段：label 用于日志定位，run 返回下一阶段 id（或 TASK_DONE） */
export interface TaskPhase<TData> {
  /** 阶段展示名（日志/告警定位用，中文） */
  readonly label: string;
  /**
   * 执行一次该阶段。
   * @returns 下一阶段 id（同 id = 原地续跑该阶段）或 TASK_DONE 结束任务
   * @throws 可恢复失败可直接抛（骨架退避重跑本阶段）；取消由骨架静默处理
   */
  run(ctx: PhaseContext<TData>): Promise<string>;
}

// ─── 任务规格与装配 ────────────────────────────────────

/** 循环任务规格：元数据 + 阶段表 + 统一骨架参数 */
export interface LoopTaskSpec<TData> {
  /** 认领的工作模式值（record.workMode） */
  readonly workMode: string;
  /** 任务类型（timed/event/natural） */
  readonly kind: BotTaskKind;
  /** 展示名（中文，日志/告警用） */
  readonly label: string;
  /** 初始共享状态（每次任务启动新建） */
  readonly createData: () => TData;
  /** 初始阶段 id */
  readonly initial: string;
  /** 阶段表（键 = 阶段 id；流转目标必须是表内键或 TASK_DONE） */
  readonly phases: Record<string, TaskPhase<TData>>;
  /** 阶段异常退避时长（tick，默认 40） */
  readonly errorBackoffTicks?: number;
  /** 同一阶段连续异常上限（默认 3；达到即终止任务并告警） */
  readonly maxConsecutiveErrors?: number;
  /** 收尾清理（终态后执行；取消/完成/失败都执行；如释放共享池认领） */
  readonly cleanup?: (ctx: { botName: string; data: TData; shared: SharedMemory }) => void | Promise<void>;
}

/**
 * 定义游戏循环任务（统一规范入口）：任务文件只声明阶段表，循环骨架/
 * 异常退避/流转日志/收尾清理由本装配统一承担。
 * @param spec 任务规格
 * @returns BotTask（注册进 tasks/index 的 registerBotTasks）
 */
export function defineLoopTask<TData>(spec: LoopTaskSpec<TData>): BotTask {
  return {
    workMode: spec.workMode,
    kind: spec.kind,
    label: spec.label,
    run: async ({ botName, token, shared }) => {
      const notifyNearby = createThrottledNotifier();
      const data = spec.createData();
      const ctx: PhaseContext<TData> = {
        botName,
        shared,
        token,
        data,
        notify: (detail: string) => notifyNearby(botName, detail),
        wait: (ticks: number) => waitTicksCancellable(ticks, token),
      };

      const backoff = spec.errorBackoffTicks ?? 40;
      const maxErrors = spec.maxConsecutiveErrors ?? 3;
      let phase = spec.initial;
      let consecutiveErrors = 0;
      try {
        while (!token.cancelled && phase !== TASK_DONE) {
          const current = spec.phases[phase];
          if (!current) {
            throw new Error(`任务「${spec.label}」流转到未知阶段: ${phase}`);
          }
          try {
            const next = await current.run(ctx);
            if (token.cancelled) return; // 取消：静默收尾（finally 统一清理）
            consecutiveErrors = 0;
            if (next !== phase) {
              console.info(`[MockPlayer] ${spec.label} 阶段 ${phase} → ${next}`);
            }
            phase = next;
          } catch (e: unknown) {
            if (token.cancelled || e instanceof CancelledError) return;
            consecutiveErrors += 1;
            console.warn(
              `[MockPlayer] ${spec.label} 阶段「${current.label}」异常（${consecutiveErrors}/${maxErrors}）: ${describeError(e)}`,
            );
            if (consecutiveErrors >= maxErrors) throw e;
            await waitTicksCancellable(backoff, token);
          }
        }
      } finally {
        // 收尾：停动作 → 清理 → 收口令牌（自然结束也兑现，防桥接/协程悬挂）
        try {
          const bot = resolveBotPlayer(botName);
          bot?.stopMoving();
          bot?.stopBreakingBlock();
        } catch {
          /* 实体失效忽略 */
        }
        try {
          await spec.cleanup?.({ botName, data, shared });
        } catch (e: unknown) {
          console.warn(`[MockPlayer] ${spec.label} 收尾清理失败: ${describeError(e)}`);
        } finally {
          token.cancel();
        }
      }
    },
  };
}

/** 未知异常摘要（阶段内 catch 就地记日志用，统一格式） */
export function warnTaskError(scope: string, error: unknown): void {
  console.warn(`[MockPlayer] ${scope}: ${describeError(error)}`);
}
