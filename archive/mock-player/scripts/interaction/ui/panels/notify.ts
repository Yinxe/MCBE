// ─── 通知设置面板 ─────────────────────────────────────
// 玩家自己的通知开关 + 最低等级（对应 /mp:notify 命令；图标：notify.png 对话气泡）。
import type { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";
import { getNotifyPref, levelLabel, setNotifyPref, type NotifyLevel } from "../../../features/notify/NotifyPrefs";

const ICON_NOTIFY = "textures/ui/mockplayer/notify";
const ICON_BACK = "textures/ui/mockplayer/back";

/** 等级候选（低 → 高） */
const LEVELS: Array<{ id: NotifyLevel; label: string; desc: string }> = [
  { id: "debug", label: "调试", desc: "全部消息，含调试细节" },
  { id: "info", label: "信息", desc: "常规进度与结果（推荐）" },
  { id: "warn", label: "警告", desc: "只看警告与错误" },
  { id: "error", label: "错误", desc: "只看错误" },
];

/** 打开通知设置面板 */
export function showNotifyPanel(player: Player, onBack?: () => void): void {
  const pref = getNotifyPref(player);
  const builder = new ActionFormBuilder()
    .title(`${color.gold}🔔 通知设置`)
    .body(
      `${color.muted}控制运行通知（如编程模式进度）。\n` +
        `${color.muted}当前：${pref.enabled ? `${color.success}开启` : `${color.error}关闭`}${color.muted}；最低等级：${levelLabel(pref.level)}\n` +
        `${color.muted}低于所选等级的消息将不再发送。`,
    )
    .buttonWithIcon(
      pref.enabled ? style("关闭通知", color.darkRed) : style("开启通知", color.darkGreen),
      ICON_NOTIFY,
      () => {
        setNotifyPref(player, { ...pref, enabled: !pref.enabled });
        showNotifyPanel(player, onBack);
      },
    );
  for (const lv of LEVELS) {
    const current = pref.level === lv.id;
    builder.buttonWithIcon(
      `${current ? color.success + "● " : color.muted + "○ "}${lv.label}${color.muted} —— ${lv.desc}`,
      ICON_NOTIFY,
      () => {
        setNotifyPref(player, { enabled: true, level: lv.id });
        showNotifyPanel(player, onBack);
      },
    );
  }
  builder
    .buttonWithIcon(style("返回", color.muted), ICON_BACK, () => {
      if (onBack) onBack();
    })
    .show(player);
}
