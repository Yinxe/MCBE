// ─── 长流程模式：指令表存档（DP 读写） ──────────────────────────────
// 指令表按假人独立存一份（mp:script:<botId>）：档案每次对账整条读写，指令表只在编辑/运行时
// 才需要，且可达 256 条，混进档案会把每次落盘的体积都撑大。
// 读回一律过 normalizeActions（坏档不炸调用方）；空指令表删键（与"缺省即空"同义）。
import type { ActionProgram } from "../domain/ActionRules";
import { normalizeActions } from "../domain/ActionRules";
import { readJson, removeKey, writeJson } from "./Dp";
/** DP 键前缀（长流程模式命名空间；引擎按 module_name 自动加外层前缀） */
export const SCRIPT_KEY_PREFIX = "mp:script:";
/** 单键体积上限（字节估算，与动作表同口径：DP 单值实测约 30KB，留余量） */
export const SCRIPT_VALUE_BYTE_LIMIT = 24 * 1024;

/** 写入结果：太大或落盘失败都回中文原因，不抛穿 */
export type ScriptSaveResult = { ok: true } | { ok: false; reason: string };

export class ScriptStore {
  /**
   * 读指令表：键缺失或内容坏 → 空指令表。
   * @param botId - 假人身份
   */
  load(botId: number): ActionProgram {
    return normalizeActions(readJson<unknown>(`${SCRIPT_KEY_PREFIX}${botId}`));
  }
  /**
   * 写指令表：空表删键；超体积上限或落盘失败回中文原因（不抛穿）。
   * @param botId - 假人身份
   * @param program - 已归一化的指令表
   */
  save(botId: number, program: ActionProgram): ScriptSaveResult {
    const key = `${SCRIPT_KEY_PREFIX}${botId}`;
    if (program.steps.length === 0) {
      removeKey(key);
      return { ok: true };
    }
    let text = "";
    try {
      text = JSON.stringify(program);
    } catch {
      return { ok: false, reason: "指令表无法序列化" };
    }
    if (text.length * 3 > SCRIPT_VALUE_BYTE_LIMIT) {
      const kb = Math.ceil((text.length * 3) / 1024);
      return {
        ok: false,
        reason: `指令表太大（约 ${kb}KB，上限 ${SCRIPT_VALUE_BYTE_LIMIT / 1024}KB），请精简指令或注释`,
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
    removeKey(`${SCRIPT_KEY_PREFIX}${botId}`);
  }
}