// ─── 新手引导：首次进入主菜单展示，hasSeenGuide 去重 ────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import type { McModConfig } from "../storage/McModConfig";
import { playerNameOf } from "../util/playerName";
import { form, chat, btn } from "./uiColor";

/** 首次使用主菜单时展示引导页；该玩家已看过则跳过 */
export async function tryShowNewPlayerGuide(player: Player, config: McModConfig): Promise<boolean> {
  const playerName = playerNameOf(player);
  if (playerName === undefined) return false; // 取不到名（假人/半初始化）→ 不引导
  if (config.hasSeenGuide(playerName)) return false;
  const dlg = new ActionFormBuilder()
    .title(`${form.success}物品路由 · 欢迎`)
    .body(
      [
        `${chat.info}智能仓库自动路由系统。`,
        "",
        `${chat.warn}开始使用：`,
        `${chat.info}1. /ir:create 创建仓库区域`,
        `${chat.info}2. 在区域内放置容器（自动注册）`,
        `${chat.info}3. 手持信物右键容器设置角色`,
        `${chat.info}4. 往输入容器放物品 → 自动路由`,
        "",
        `${chat.muted}信物默认：${chat.info}木锄 ${chat.muted}（可在设置更换）`,
        `${chat.muted}更多见 /ir:help`,
      ].join("\n")
    )
    .button(`${btn.primary}知道了`, () => undefined);
  await dlg.show(player);
  config.markSeenGuide(playerName);
  return true;
}
