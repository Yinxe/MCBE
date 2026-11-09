// ─── 日志分级（统一前缀 + 分级输出） ────────────────────
// 所有日志统一走本模块，而不是散落的 console.warn：
//   debug — 高频追踪（每次命中方块等），游戏内 Console 默认收敛
//   info  — 正常业务结果（已换入 / 保持 / 破碎补齐 / 耐久保护 / 尊重不动）
//   warn  — 意外但可恢复（背包无达标工具可换、残留堆叠失败等）
//   error — 操作失败（swap 失败、事件处理器抛异常等）
// console.info 在部分运行时缺失 → 降级到 console.log；入口自带 try-catch。

/** 日志级别 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const PREFIX = "[AutoRefill]";

function emit(level: LogLevel, message: string): void {
  const fn = (console as unknown as Record<string, unknown>)[level];
  if (typeof fn === "function") {
    (fn as (msg: string) => void)(`${PREFIX} ${message}`);
  } else {
    console.log(`${PREFIX} ${message}`); // 运行时无该级别方法 → 降级 log
  }
}

/** 分级日志工具（内部消息不面向玩家展示） */
export const logger = {
  debug: (message: string): void => emit("debug", message),
  info: (message: string): void => emit("info", message),
  warn: (message: string): void => emit("warn", message),
  error: (message: string): void => emit("error", message),
};
