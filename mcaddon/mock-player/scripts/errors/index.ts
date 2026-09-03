// ─── 自定义异常体系（全模块统一错误通道） ────────────────
// 原则（用户规格）：basic 动作/过程代码**内部消化引擎异常**（原始
// @minecraft/server 错误不允许穿透到调用方），统一转为本模块的自定义异常抛出。
// 调用方只需识别 BotError 家族，按 code/reason 分支处理；日志统一走
// describeError 输出中文摘要。
//
// 异常分层：
//   BotError        基类：code 稳定标识 + 中文消息 + cause 保留根因
//   ├─ ActionError  basic 动作失败（busy/far/blocked/offline/unavailable/failed）
//   ├─ CancelledError  主动取消（控制流信号，调用方应静默收尾不告警）
//   └─ FlowError    flow 流程编排失败（任务/流程无法继续推进）
//
// 使用约定：
//   - 动作函数（async）内部 try-catch 引擎调用 → throw new ActionError(...)
//   - 读函数（reader）保持防御默认值（undefined/false），不参与异常体系
//   - 事件回调/任务循环 catch 后用 describeError(e) 打日志
//   - 取消不是失败：CancelledError 单列，日志层可过滤降噪

/** 动作失败原因（稳定字符串码，调用方按码分支，不解析消息文本） */
export type ActionFailReason =
  /** 并发防护：同假人已有进行中的同类动作 */
  | "busy"
  /** 超距（目标超出最大作用距离） */
  | "far"
  /** 视线被遮挡（目标不再是当前视线方块） */
  | "blocked"
  /** 假人记录不可用（未上线/已死亡/实体丢失） */
  | "offline"
  /** 目标不可用（方块不可读/容器不是容器/坐标未加载等） */
  | "unavailable"
  /** 引擎调用失败（原始异常已消化进 cause） */
  | "failed";

/** BotError 构造选项 */
export interface BotErrorOptions {
  /** 稳定错误码（缺省按类名推导） */
  code?: string;
  /** 根因（消化掉的原始异常——保留排查现场） */
  cause?: unknown;
}

/** mock-player 自定义异常基类：所有模块抛出的业务异常都继承自此 */
export class BotError extends Error {
  /** 稳定错误码（日志过滤/程序分支用） */
  readonly code: string;

  constructor(message: string, options: BotErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? new.target.name;
    // 根因挂 cause（ES2022 Error.cause；引擎侧不识别也不影响）
    (this as { cause?: unknown }).cause = options.cause;
  }
}

/** basic 动作失败：动作函数内部消化引擎异常后统一抛出 */
export class ActionError extends BotError {
  /** 失败原因码（busy/far/blocked/offline/unavailable/failed） */
  readonly reason: ActionFailReason;

  constructor(reason: ActionFailReason, message: string, cause?: unknown) {
    super(message, { code: `action:${reason}`, cause });
    this.name = "ActionError";
    this.reason = reason;
  }
}

/** 主动取消（控制流信号）：任务/流程被取消令牌中止，非失败态 */
export class CancelledError extends BotError {
  constructor(message = "操作已取消", cause?: unknown) {
    super(message, { code: "cancelled", cause });
    this.name = "CancelledError";
  }
}

/** flow 流程编排失败：任务推进受阻（无法定位目标/编排前置不满足等） */
export class FlowError extends BotError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "flow", cause });
    this.name = "FlowError";
  }
}

/** 是否为 mock-player 自定义异常（家族判定） */
export function isBotError(error: unknown): error is BotError {
  return error instanceof BotError;
}

/** 是否为取消信号（调用方收尾时静默处理，不打告警） */
export function isCancelledError(error: unknown): error is CancelledError {
  return error instanceof CancelledError;
}

/**
 * 统一日志摘要：BotError 输出「消息（code）」，未知异常输出 String(error)。
 * 供 console.warn / 玩家提示统一格式，避免各处手写 e?.message ?? e。
 * @param error 未知异常
 * @returns 中文摘要文本
 */
export function describeError(error: unknown): string {
  if (error instanceof BotError) {
    return `${error.message}（${error.code}）`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** 从未知异常提取根因消息（cause 链展开，最深层优先） */
export function rootCauseMessage(error: unknown): string {
  let current = error;
  while (current instanceof Error && (current as { cause?: unknown }).cause !== undefined) {
    current = (current as { cause?: unknown }).cause;
  }
  return current instanceof Error ? current.message : String(current);
}
