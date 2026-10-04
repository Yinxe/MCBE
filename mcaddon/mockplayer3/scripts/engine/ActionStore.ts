// ─── 自定义动作：动作表存档（DP 读写） ────────────────────────────────
// 一段动作表一个键（mp:action:<botId>），与假人档案分开：档案每次对账都要整条读写，
// 动作表只在编辑/运行时才需要，且可达 256 条——混进档案会把每次落盘的体积都撑大。
// 读回一律过 normalizeActions（坏档不炸调用方）；空动作表删键（与"缺省即空"同义）。

import type { ActionProgram } from "../domain/ActionRules";
import { normalizeActions } from "../domain/ActionRules";
import { readJson, removeKey, writeJson } from "./Dp";

/** DP 键前缀（动作类型命名空间由引擎按 module_name 自动加） */
export const ACTION_KEY_PREFIX = "mp:action:";

/** 单键体积上限（字节估算）：DP 单值实测约 30KB，留余量；按 UTF-8 最坏 3 字节/字符估 */
export const ACTION_VALUE_BYTE_LIMIT = 24 * 1024;

/** 写入结果：用户手写动作表太大或落盘失败都回中文原因，不抛穿 */
export type ActionSaveResult = { ok: true } | { ok: false; reason: string };

export class ActionStore {
  /**
   * 读动作表：键缺失或内容坏 → 空动作表。
   * @param botId - 假人身份
   */
  load(botId: number): ActionProgram {
    return normalizeActions(readJson<unknown>(`${ACTION_KEY_PREFIX}${botId}`));
  }

  /**
   * 写动作表：空动作表删键；超体积上限或落盘失败回中文原因（不抛穿）。
   * @param botId - 假人身份
   * @param program - 已归一化的动作表
   */
  save(botId: number, program: ActionProgram): ActionSaveResult {
    const key = `${ACTION_KEY_PREFIX}${botId}`;
    if (program.steps.length === 0) {
      removeKey(key);
      return { ok: true };
    }
    let text = "";
    try {
      text = JSON.stringify(program);
    } catch {
      return { ok: false, reason: "动作表无法序列化" };
    }
    if (text.length * 3 > ACTION_VALUE_BYTE_LIMIT) {
      const kb = Math.ceil((text.length * 3) / 1024);
      return {
        ok: false,
        reason: `动作表太大（约 ${kb}KB，上限 ${ACTION_VALUE_BYTE_LIMIT / 1024}KB），请精简动作或备注`,
      };
    }
    try {
      writeJson(key, program);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `保存失败：${e?.message ?? e}` };
    }
  }

  /** 删假人清场 */
  forget(botId: number): void {
    removeKey(`${ACTION_KEY_PREFIX}${botId}`);
  }
}
