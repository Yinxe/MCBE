// ─── as-any 登记表（引擎绕行唯一集中地，F-09） ────────────────────
// 规则：新增绕行必须先在此登记，注明 F 编号与原因；本文件之外出现 `as any` 即打回。

import type { Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { BOT_MARKER_TAG } from "../domain/Record";

/**
 * 按 BOT_MARKER_TAG 真值把 Player 下转型为 SimulatedPlayer，无标记者返回 undefined。
 * @param entity 待判别的实体，可为 undefined
 * @returns 解析出的假人，或 undefined
 * [F-19] 假人与真人同池返回且类型系统无运行时判别面，只能按标记判定。
 */
export function asSimulated(entity: Player | undefined): SimulatedPlayer | undefined {
  if (!entity) return undefined;
  let isBot = false;
  try {
    isBot = entity.hasTag(BOT_MARKER_TAG);
  } catch {
    return undefined; // 实体已被移除，按未解析处理
  }
  return isBot ? (entity as unknown as SimulatedPlayer) : undefined;
}
