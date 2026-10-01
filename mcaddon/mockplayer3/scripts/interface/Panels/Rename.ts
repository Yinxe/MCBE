// ─── 改名表单 ───
// 校验全在 Lifecycle.rename（规范化/占用/在线禁改等），此处只渲染回执零规则。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import { guardUiManage, resolveUiBotRecord, uiViewer } from "../Kit";
import { services } from "../../Composition";

export function showRenameForm(player: Player, record: { botId: number; name: string }): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  void ModalFormBuilder.showQuick(player, `${color.bold}修改名字`, (f) =>
    f.textField("name", "新名字", { defaultValue: record.name, tooltip: "自动加假人前缀 sim-，无需手动输入" })
  ).then((vals) => {
    if (!vals) return;
    const raw = String(vals.name ?? "");
    if (!raw.trim()) return;
    system.run(() => {
      const live = services.runtime.record(record.botId);
      if (!live) {
        say(`${color.error}假人已不存在`);
        return;
      }
      if (!guardUiManage(say, viewer, live)) return;
      const r = services.lifecycle.rename(viewer, record.botId, raw);
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      if (r.name && r.name !== record.name) say(`${color.success}已重命名为 ${color.playerName}${r.name}`);
    });
  });
}
