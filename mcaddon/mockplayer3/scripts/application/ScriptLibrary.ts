// ─── 编程模式：脚本库（命令与面板的唯一读写口） ────────────────────
// 读（带缓存）/ 归一化写入 / 变更版本号（执行器据此在步骤边界换用新脚本）/ 运行状态板。
// 命令与面板一律只调这里，不各自解释与落盘脚本——旧版两套实现是漂移之源。
// 写得下就落盘、写不下回中文原因；版本号只增不减，写成功即 +1（重跑＝再 +1）。

import type { ScriptFailPolicy, ScriptProgram, ScriptStep } from "../domain/ScriptRules";
import { MAX_SCRIPT_STEPS, normalizeProgram } from "../domain/ScriptRules";
import { ScriptStatusBoard } from "../domain/ScriptStatus";
import type { ScriptStore } from "../engine/ScriptStore";

/** 写入结果（成功带必要回执字段；失败带中文原因） */
export type ScriptWriteResult = { ok: true } | { ok: false; reason: string };

export class ScriptLibrary {
  /** 变更版本号（逐假人）：任何写入 +1，执行器缓存的版本不等即在步骤边界重读 */
  private readonly versions = new Map<number, number>();
  /** 脚本缓存（首次读盘；写入后同步覆盖） */
  private readonly cache = new Map<number, ScriptProgram>();
  /** 运行状态板（面板/命令读取；进程内存活） */
  readonly status = new ScriptStatusBoard();

  constructor(private readonly store: ScriptStore) {}

  /**
   * 取脚本（首次读盘，之后走缓存）。
   * @param botId - 假人身份
   */
  programOf(botId: number): ScriptProgram {
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

  /**
   * 整段写入（归一化后落盘；成功即版本 +1）。
   * @param botId - 假人身份
   * @param program - 待写入脚本（可含坏条目，这里统一归一化）
   */
  setProgram(botId: number, program: ScriptProgram): ScriptWriteResult {
    const normalized = normalizeProgram(program);
    const saved = this.store.save(botId, normalized);
    if (!saved.ok) return saved;
    this.cache.set(botId, normalized);
    this.bump(botId);
    return { ok: true };
  }

  /**
   * 追加一条步骤（超上限拒收）。
   * @param botId - 假人身份
   * @param step - 已解析的步骤
   * @returns 成功带新序号与总数
   */
  appendStep(botId: number, step: ScriptStep): ScriptWriteResult & { index?: number; count?: number } {
    const program = this.programOf(botId);
    if (program.steps.length >= MAX_SCRIPT_STEPS) {
      return { ok: false, reason: `已达单脚本上限 ${MAX_SCRIPT_STEPS} 条` };
    }
    const next = { ...program, steps: [...program.steps, step] };
    const r = this.setProgram(botId, next);
    return r.ok ? { ok: true, index: next.steps.length, count: next.steps.length } : r;
  }

  /**
   * 删除第 N 条（1 起）。
   * @param botId - 假人身份
   * @param index1 - 人读序号
   */
  removeStep(botId: number, index1: number): ScriptWriteResult {
    const program = this.programOf(botId);
    if (!Number.isInteger(index1) || index1 < 1 || index1 > program.steps.length) {
      return { ok: false, reason: `序号需在 1-${program.steps.length} 之间` };
    }
    const steps = program.steps.filter((_, i) => i !== index1 - 1);
    return this.setProgram(botId, { ...program, steps });
  }

  /**
   * 改整段循环次数。
   * @param botId - 假人身份
   * @param loopCount - -1=一直；≥1=N 次
   */
  setLoopCount(botId: number, loopCount: number): ScriptWriteResult {
    return this.setProgram(botId, { ...this.programOf(botId), loopCount });
  }

  /**
   * 改失败策略。
   * @param botId - 假人身份
   * @param onFail - stop=失败停下；skip=跳过该条
   */
  setFailPolicy(botId: number, onFail: ScriptFailPolicy): ScriptWriteResult {
    return this.setProgram(botId, { ...this.programOf(botId), onFail });
  }

  /**
   * 清空步骤（循环与失败策略保留）。
   * @param botId - 假人身份
   */
  clear(botId: number): ScriptWriteResult {
    return this.setProgram(botId, { ...this.programOf(botId), steps: [] });
  }

  /**
   * 请求重跑：只把版本号 +1，执行器在下一个步骤边界看到就重开一轮。
   * @param botId - 假人身份
   */
  requestRerun(botId: number): void {
    this.bump(botId);
  }

  /** 停用/停机时把状态归零（脚本本体保留） */
  markIdle(botId: number, message: string, now: number): void {
    const program = this.programOf(botId);
    this.status.patch(botId, { phase: "idle", stepIndex: 0, total: program.steps.length, message, updatedAt: now });
  }

  /** 删假人清场：缓存、版本、状态、落盘一键清 */
  forget(botId: number): void {
    this.cache.delete(botId);
    this.versions.delete(botId);
    this.status.forget(botId);
    this.store.forget(botId);
  }

  private bump(botId: number): void {
    this.versions.set(botId, this.versionOf(botId) + 1);
  }
}
