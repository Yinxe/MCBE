// ─── 丢弃物品（basic 原子能力） ────────────────────────
// 将假人当前选中物品以掉落物形式丢出（SimulatedPlayer.dropSelectedItem）

import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/**
 * 以掉落物形式丢弃假人当前选中物品
 * @param botName 假人名
 * @returns true=成功丢弃，false=失败/无物品/实体不可用
 */
export function dropSelectedItem(botName: string): boolean {
  const bot = resolveBotPlayer(botName) as any;
  if (!bot) return false;
  try {
    return bot.dropSelectedItem() === true;
  } catch {
    return false;
  }
}
