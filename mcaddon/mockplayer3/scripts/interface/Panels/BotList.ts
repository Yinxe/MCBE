// ─── 假人列表面板 ───
// 按钮平铺无分页；点击行进 BotPanel，返回闭包串联主菜单。
// 图标按状态三分：死亡 kill_bot / 在线 toggle_online / 离线 bot_list，纹理由 RP 提供。

import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, style, trySendMessage } from "@yinxe/toolkit";
import { isAdmin } from "../../domain/Permissions";
import { botStatus, formatDimension, getStatusIcon, ownerLabel, uiViewer, visibleRecords } from "../Kit";
import { services } from "../../Composition";
import { showBotPanel } from "./BotPanel";

export function showBotList(player: Player, onMainMenu?: () => void): void {
  const viewer = uiViewer(player);
  const records = visibleRecords(viewer);
  const say = (t: string) => trySendMessage(player, t);
  if (records.length === 0) {
    say(`${color.warn}暂无可见的模拟玩家，请先创建`);
    return;
  }
  const admin = isAdmin(viewer, services.runtime.config);
  void ActionFormBuilder.showQuick(player, `${color.bold}模拟玩家列表`, (f) => {
    f.body(`${color.accent}共 ${color.playerName}${records.length} ${color.accent}个`);
    for (const record of records) {
      const dim = formatDimension(record.dimensionId);
      const owner = ownerLabel(record, admin);
      const st = botStatus(record);
      const statusIcon = st.death
        ? "textures/ui/mockplayer/kill_bot"
        : st.online
          ? "textures/ui/mockplayer/toggle_online"
          : "textures/ui/mockplayer/bot_list";
      f.buttonWithIcon(
        `${getStatusIcon(record)} ${color.black}${record.name} ${color.black}${dim}${owner ? ` ${owner}` : ""}`,
        statusIcon,
        () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu))
      );
    }
    f.buttonWithIcon(style("← 返回", color.darkBlue), "textures/ui/mockplayer/back", () => {
      if (onMainMenu) onMainMenu();
    });
  });
}
