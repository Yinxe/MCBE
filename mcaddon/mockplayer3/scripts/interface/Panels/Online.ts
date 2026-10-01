// ─── 在线管理面板 ───
// 打开时快照初态，提交逐条 diff 只处理变化项；行级管理守卫含无主认领。
// 批量顺序 await：安全上下线内置排队，无需外部冷却。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import { isAdmin } from "../../domain/Permissions";
import { BOT_MARKER_TAG } from "../../domain/Record";
import {
  botStatus,
  formatDimension,
  formatPos,
  getStatusIcon,
  guardUiManage,
  ownerLabel,
  uiViewer,
  visibleRecords,
} from "../Kit";
import { services } from "../../Composition";

export function showOnlineManagement(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const records = visibleRecords(viewer);
  if (records.length === 0) {
    say(`${color.warn}暂无可见的模拟玩家`);
    return;
  }
  const admin = isAdmin(viewer, services.runtime.config);
  const initialState = records.map((r) => botStatus(r).online);
  void ModalFormBuilder.showQuick(player, `${color.bold}在线管理`, (f) => {
    records.forEach((record, i) => {
      const st = botStatus(record);
      const owner = ownerLabel(record, admin);
      const pos = st.online
        ? (services.ops.readPose(record.botId)?.position ?? record.home.position)
        : record.home.position;
      const posSummary = `${formatPos(pos)}${color.darkGray} ${formatDimension(record.dimensionId)}`;
      const tags = record.tags.filter((t) => t !== BOT_MARKER_TAG && !t.endsWith(":idle"));
      const tagSummary = tags.join(" ");
      const label =
        `${getStatusIcon(record)} ${color.playerName}${record.name}${owner ? ` ${owner}` : ""}` +
        ` ${color.accent}| ${posSummary}${tagSummary ? ` ${color.accent}[${tagSummary}]` : ""}`;
      f.toggle(`s${i}`, label, {
        defaultValue: initialState[i],
        tooltip: initialState[i] ? "关闭此开关将下线该假人" : "开启此开关将上线该假人",
      });
    });
  }).then((vals) => {
    if (!vals) return;
    const changes: { record: (typeof records)[number]; target: boolean }[] = [];
    records.forEach((record, i) => {
      const newVal = Boolean(vals[`s${i}`]);
      if (newVal !== initialState[i]) changes.push({ record, target: newVal });
    });
    if (changes.length === 0) return;
    say(
      `${color.success}正在更新 ${color.info}${changes.length}${color.success} 个模拟玩家的在线状态（安全上下线已内置排队与等待，无需外部冷却）...`
    );
    void system.run(async () => {
      for (const change of changes) {
        const { record: snapshot, target } = change;
        try {
          const record = services.runtime.record(snapshot.botId);
          if (!record) continue;
          if (!guardUiManage(say, viewer, record)) continue;
          const onlineNow = botStatus(record).online;
          if (target && !onlineNow) {
            const r = await services.lifecycle.online(viewer, record.botId);
            system.run(() =>
              say(
                r.ok
                  ? `${color.success}${record.name} 已上线`
                  : `${color.error}${record.name} 上线失败: ${r.reason ?? "unknown"}`
              )
            );
          } else if (!target && onlineNow) {
            const r = await services.lifecycle.offline(record.botId, "command");
            system.run(() =>
              say(
                r.ok
                  ? `${color.success}${record.name} 已下线`
                  : `${color.error}${record.name} 下线失败: ${r.reason ?? "unknown"}`
              )
            );
          }
        } catch (e) {
          system.run(() => say(`${color.error}${snapshot.name} 状态切换失败: ${(e as Error).message}`));
        }
      }
    });
  });
}
