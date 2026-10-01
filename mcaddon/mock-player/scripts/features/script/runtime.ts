// ─── 编程模式运行时状态（内存态：进度 + 重跑信号） ────────
// 只保存「此刻跑到哪了」，不落盘；切换模式 / 世界重启后自然归零。
// 零 @minecraft 依赖，可 node 单测。

/** 运行阶段 */
export type ScriptPhase = "idle" | "running" | "completed" | "failed" | "empty";

/** 编程模式运行时快照 */
export interface ScriptRuntime {
  /** 阶段 */
  phase: ScriptPhase;
  /** 当前执行到第几条（1 起；非运行中为 0） */
  stepIndex: number;
  /** 脚本总条数 */
  total: number;
  /** 当前第几轮（1 起） */
  cycle: number;
  /** 附加说明（失败原因 / 已完成 / 已停止等） */
  message: string;
  /** 最后更新时间（毫秒时间戳） */
  updatedAt: number;
}

const runtimes = new Map<string, ScriptRuntime>();
const kicks = new Map<string, number>();

/** 局部更新运行时快照（未传字段保持原值） */
export function patchScriptRuntime(botName: string, patch: Partial<ScriptRuntime>): void {
  const prev: ScriptRuntime = runtimes.get(botName) ?? {
    phase: "idle",
    stepIndex: 0,
    total: 0,
    cycle: 0,
    message: "",
    updatedAt: 0,
  };
  runtimes.set(botName, { ...prev, ...patch, updatedAt: Date.now() });
}

/** 读取运行时快照（从未运行过 → undefined） */
export function getScriptRuntime(botName: string): ScriptRuntime | undefined {
  return runtimes.get(botName);
}

/** 请求重跑：脚本被编辑 / 手动 run 时调用，令常驻协程重新开始一轮 */
export function requestScriptKick(botName: string): void {
  kicks.set(botName, (kicks.get(botName) ?? 0) + 1);
}

/** 读取重跑信号值（协程内部对比变化判断是否需要重来） */
export function getScriptKick(botName: string): number {
  return kicks.get(botName) ?? 0;
}

/** 清理某假人的运行时状态（删除假人时调用，避免内存里留垃圾） */
export function clearScriptRuntime(botName: string): void {
  runtimes.delete(botName);
  kicks.delete(botName);
  lastAdded.delete(botName);
}

/** 最近一次新增/插入的指令下标（botName → index） */
const lastAdded = new Map<string, number>();

/** 记录最近新增的指令下标（界面列表里给它打标记用） */
export function setLastAddedIndex(botName: string, index: number): void {
  lastAdded.set(botName, index);
}

/** 读取最近新增的指令下标（无 → undefined） */
export function getLastAddedIndex(botName: string): number | undefined {
  return lastAdded.get(botName);
}
