// ─── 长流程模式：指令表库（命令与面板的唯一读写口） ──────────────────────
// 职责：读（带缓存）/ 归一化写入 / 变更版本号（执行器据此在指令边界换用新表）/ 重跑请求。
// 指令模型与规则**一律复用 domain/ActionRules**，不另立平行实现——两份规则是漂移之源。
// 与上游「长流程模式」的唯一差别：存档键不同（mp:script:）、界面不同，其余同源。
import { ActionStatusBoard } from "../domain/ActionStatus";
import {
  cloneAction,
  insertActionAfter,
  MAX_ACTIONS,
  moveActionBy,
  normalizeActions,
  replaceActionAt,
  type ActionProgram,
  type ActionStep,
  type ActionsArrayResult,
} from "../domain/ActionRules";
import type { ScriptStore } from "../engine/ScriptStore";

/** 写入结果（成功可带新序号与总数；失败带中文原因） */
export type ScriptWriteResult =
  | { ok: true; index?: number; count?: number }
  | { ok: false; reason: string };

export class ScriptLibrary {
  /** 变更版本号（逐假人）：任何写入 +1，执行器缓存的版本不等即在指令边界重读 */
  private readonly versions = new Map<number, number>();
  /** 指令表缓存（首次读盘；写入后同步覆盖） */
  private readonly cache = new Map<number, ActionProgram>();
  /** 停止请求位（逐假人）：记下"请求停止时所在的版本号"，执行器看到就收工待命 */
  private readonly stopAt = new Map<number, number>();
  /** 运行状态板（面板/命令读取；进程内存活） */
  readonly status = new ActionStatusBoard();

  constructor(private readonly store: ScriptStore) {}

  /** 取指令表（首次读盘，之后走缓存） */
  programOf(botId: number): ActionProgram {
    let program = this.cache.get(botId);
    if (!program) {
      program = this.store.load(botId);
      this.cache.set(botId, program);
    }
    return program;
  }
  /** 变更版本号（执行器比较用；从未写过为 0） */
  versionOf(botId: number): number {
    return this.versions.get(botId) ?? 0;
  }
  /** 整段写入（归一化后落盘；成功即版本 +1） */
  setProgram(botId: number, program: ActionProgram): ScriptWriteResult {
    const normalized = normalizeActions(program);
    const saved = this.store.save(botId, normalized);
    if (!saved.ok) return saved;
    this.cache.set(botId, normalized);
    this.bump(botId);
    return { ok: true };
  }
  /** 追加一条指令（超上限拒收） */
  appendStep(botId: number, step: ActionStep): ScriptWriteResult {
    const program = this.programOf(botId);
    if (program.steps.length >= MAX_ACTIONS) {
      return { ok: false, reason: `已达单指令表上限 ${MAX_ACTIONS} 条` };
    }
    const steps = [...program.steps, step];
    const r = this.setProgram(botId, { ...program, steps });
    return r.ok ? { ok: true, index: steps.length, count: steps.length } : r;
  }
  /** 在第 N 条之后插入一条（index1=0 插到最前；深拷贝，防调用方句柄逃逸） */
  insertStep(botId: number, index1: number, step: ActionStep): ScriptWriteResult {
    return this.applyArray(botId, insertActionAfter(this.programOf(botId).steps, index1, cloneAction(step)));
  }
  /** 替换第 N 条（1 起） */
  replaceStep(botId: number, index1: number, step: ActionStep): ScriptWriteResult {
    return this.applyArray(botId, replaceActionAt(this.programOf(botId).steps, index1, cloneAction(step)));
  }
  /** 上移/下移第 N 条（delta：-1 上移、1 下移） */
  moveStep(botId: number, index1: number, delta: number): ScriptWriteResult {
    return this.applyArray(botId, moveActionBy(this.programOf(botId).steps, index1, delta));
  }
  /** 删除第 N 条（1 起） */
  removeStep(botId: number, index1: number): ScriptWriteResult {
    const program = this.programOf(botId);
    if (!this.validIndex(program, index1)) return { ok: false, reason: this.rangeReason(program) };
    const steps = program.steps.filter((_, i) => i !== index1 - 1);
    return this.setProgram(botId, { ...program, steps });
  }
  /** 改整段循环次数（-1=一直；≥1=N 次） */
  setLoopCount(botId: number, loopCount: number): ScriptWriteResult {
    return this.setProgram(botId, { ...this.programOf(botId), loopCount });
  }
  /** 清空指令（循环与失败策略保留） */
  clear(botId: number): ScriptWriteResult {
    return this.setProgram(botId, { ...this.programOf(botId), steps: [] });
  }
  /** 请求重跑：只把版本号 +1，执行器在下一个指令边界看到就重开一轮（顺带解除停止请求） */
  requestRerun(botId: number): void {
    this.stopAt.delete(botId);
    this.bump(botId);
  }
  /**
   * 请求停止：只结束当前这一轮，**工作模式保持不变**。
   * 旧做法是切模式回空闲来"收工"，结果玩家刚选的长流程模式被丢掉
   * （实测症状："任务失败后 / 过一段时间，从长流程模式变回空闲模式"）。
   */
  requestStop(botId: number, now: number): void {
    this.bump(botId);
    this.stopAt.set(botId, this.versionOf(botId));
    this.markIdle(botId, "已停止", now);
  }
  /** 是否处于停止请求（执行器循环头查；玩家再次启动/重跑即自动解除） */
  stopRequested(botId: number): boolean {
    return this.stopAt.get(botId) === this.versionOf(botId);
  }
  /** 停用/停机时把运行状态归零（指令表本体保留） */
  markIdle(botId: number, message: string, now: number): void {
    const program = this.programOf(botId);
    this.status.patch(botId, { phase: "idle", stepIndex: 0, total: program.steps.length, message, updatedAt: now });
  }
  /** 删假人清场：缓存、版本、状态、落盘一键清 */
  forget(botId: number): void {
    this.cache.delete(botId);
    this.versions.delete(botId);
    this.stopAt.delete(botId);
    this.status.forget(botId);
    this.store.forget(botId);
  }

  /** 数组操作 → 落盘（失败原因原样带出） */
  private applyArray(botId: number, result: ActionsArrayResult): ScriptWriteResult {
    if (!result.ok) return { ok: false, reason: result.reason };
    return this.setProgram(botId, { ...this.programOf(botId), steps: result.steps });
  }
  private validIndex(program: ActionProgram, index1: number): boolean {
    return Number.isInteger(index1) && index1 >= 1 && index1 <= program.steps.length;
  }
  private rangeReason(program: ActionProgram): string {
    return program.steps.length === 0 ? "指令表还是空的" : `序号需在 1-${program.steps.length} 之间`;
  }
  private bump(botId: number): void {
    this.versions.set(botId, this.versionOf(botId) + 1);
  }
}