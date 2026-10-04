// ─── 编程模式：脚本存档（DP 读写） ────────────────────────────────
// 一段脚本一个键（mp:script:<botId>），与假人档案分开：档案每次对账都要整条读写，
// 脚本只在编辑/运行时才需要，且可达 256 条——混进档案会把每次落盘的体积都撑大。
// 读回一律过 normalizeProgram（坏档不炸调用方）；空脚本删键（与"缺省即空"同义）。

import type { ScriptProgram } from "../domain/ScriptRules";
import { normalizeProgram } from "../domain/ScriptRules";
import { readJson, removeKey, writeJson } from "./Dp";

/** DP 键前缀（模块命名空间由引擎按 module_name 自动加） */
export const SCRIPT_KEY_PREFIX = "mp:script:";

/** 单键体积上限（字节估算）：DP 单值实测约 30KB，留余量；按 UTF-8 最坏 3 字节/字符估 */
export const SCRIPT_VALUE_BYTE_LIMIT = 24 * 1024;

/** 写入结果：用户手写脚本太大或落盘失败都回中文原因，不抛穿 */
export type ScriptSaveResult = { ok: true } | { ok: false; reason: string };

export class ScriptStore {
  /**
   * 读脚本：键缺失或内容坏 → 空脚本。
   * @param botId - 假人身份
   */
  load(botId: number): ScriptProgram {
    return normalizeProgram(readJson<unknown>(`${SCRIPT_KEY_PREFIX}${botId}`));
  }

  /**
   * 写脚本：空脚本删键；超体积上限或落盘失败回中文原因（不抛穿）。
   * @param botId - 假人身份
   * @param program - 已归一化的脚本
   */
  save(botId: number, program: ScriptProgram): ScriptSaveResult {
    const key = `${SCRIPT_KEY_PREFIX}${botId}`;
    if (program.steps.length === 0) {
      removeKey(key);
      return { ok: true };
    }
    let text = "";
    try {
      text = JSON.stringify(program);
    } catch {
      return { ok: false, reason: "脚本无法序列化" };
    }
    if (text.length * 3 > SCRIPT_VALUE_BYTE_LIMIT) {
      const kb = Math.ceil((text.length * 3) / 1024);
      return {
        ok: false,
        reason: `脚本太大（约 ${kb}KB，上限 ${SCRIPT_VALUE_BYTE_LIMIT / 1024}KB），请精简步骤或备注`,
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
