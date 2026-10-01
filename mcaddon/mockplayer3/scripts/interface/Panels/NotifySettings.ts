// ─── 个人通知设置面板 ──────────────────────────────────────────────
// 只管假人私信（sendNotify 一路）：开关=任何档都不发，档位=最低接收档。
// 命令/面板即时回执与全服播报不走个人设置，不受本页影响。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import type { NotifyLevel, NotifySetting } from "../../domain/NotifyRules";
import { NOTIFY_LEVEL_LABELS, NOTIFY_LEVELS } from "../../domain/NotifyRules";
import { services } from "../../Composition";

/** 下拉项：档位名 + 各档典型内容说明（顺序与 NOTIFY_LEVELS 一致） */
const LEVEL_CHOICES: readonly string[] = [
  "调试——全部消息（含辅助覆盖图等细节）",
  "信息——上下线/回收/搬运结果等常规（推荐）",
  "警告——仅故障与降级（丢箱/满箱/模式失败）",
  "错误——仅操作出错",
];

/** 展示当前设置（面板说明与 mp:notify show 共用文案口径） */
export function notifySettingLine(setting: NotifySetting): string {
  if (!setting.enabled) return style("已关闭（不接收任何假人私信）", color.warn);
  return `${style("已开启，最低档 ", color.success)}${style(
    `${NOTIFY_LEVEL_LABELS[setting.minLevel]}（${setting.minLevel}）`,
    color.info
  )}`;
}

/** 通知设置面板：开关 + 最低档位下拉 */
export function showNotifySettingsForm(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const current = services.ops.notifySetting(player.name);
  void ModalFormBuilder.showQuick(player, `${color.bold}通知设置`, (f) => {
    f.label("cur", `${style("当前：", color.muted)}${notifySettingLine(current)}`);
    f.label("intro", style("通知分四档（调试<信息<警告<错误），只推送不低于所选档位的私信。", color.muted));
    f.toggle("enabled", "接收假人通知", {
      defaultValue: current.enabled,
      tooltip: "关闭后假人不再向你发送任何私信通知（命令与面板的即时回执不受影响）",
    });
    f.dropdown("level", "最低通知档位", [...LEVEL_CHOICES], {
      defaultValueIndex: Math.max(0, NOTIFY_LEVELS.indexOf(current.minLevel)),
      tooltip: "低于所选档位的通知不再推送",
    });
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const enabled = Boolean(vals.enabled);
      const minLevel: NotifyLevel = NOTIFY_LEVELS[Number(vals.level ?? 1)] ?? "info";
      services.ops.setNotifySetting(player.name, { enabled, minLevel });
      say(`${color.success}通知设置已保存：${notifySettingLine({ enabled, minLevel })}`);
    });
  });
}
