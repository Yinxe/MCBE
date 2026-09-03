// ─── 丢弃物品（basic 原子能力） ────────────────────────
// 将假人当前选中物品以掉落物形式丢出（SimulatedPlayer.dropSelectedItem）

import { ActionError } from "../../../errors";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { runActionNextTick } from "../../utils";

/**
 * 以掉落物形式丢弃假人当前选中物品。
 * 微动作：system.run 推迟到下一 tick 执行；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError。
 * @param botName 假人名
 * @returns 成功 resolve(true)
 * @throws ActionError 实体不可用（offline）/ 引擎丢弃调用失败（failed）
 */
export function dropSelectedItem(botName: string): Promise<boolean> {
  const bot = resolveBotPlayer(botName) as any;
  if (!bot) {
    return Promise.reject(new ActionError("offline", `假人 ${botName} 不在线，无法丢弃物品`));
  }
  return runActionNextTick(() => {
    bot.dropSelectedItem();
  }, `假人 ${botName} 丢弃主手物品失败`);
}
