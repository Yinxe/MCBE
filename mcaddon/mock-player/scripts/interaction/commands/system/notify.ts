// ─── /mp:notify —— 个人通知设置 ──────────────────────────
// 合并自 v3 的 mp:notify：on/off 总开关；档位词 = 开启并设为最低等级；show 查看。
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { color, defineCommand } from "@yinxe/toolkit";
import {
  getNotifyPref,
  prefSummary,
  setNotifyPref,
  type NotifyLevel,
} from "../../../features/notify/NotifyPrefs";
import { showNotifyPanel } from "../../ui/panels/notify";

/** 注册 /mp:notify 命令 */
export function registerNotifyCommand(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(
    registry,
    {
      name: "mp:notify",
      description: "个人通知设置（on/off/show，或直接填等级：debug/info/warn/error）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "mode", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const mode = String(params.mode ?? "").trim().toLowerCase();
      const pref = getNotifyPref(player);

      // ── 无参数：打开通知设置面板（图形界面） ──
      if (mode.length === 0) {
        showNotifyPanel(player);
        return;
      }
      // ── show：文字查看当前设置 ──
      if (mode === "show") {
        player.sendMessage(`${color.accent}通知设置：${color.black}${prefSummary(pref)}`);
        return;
      }
      if (mode === "on") {
        setNotifyPref(player, { ...pref, enabled: true });
        player.sendMessage(`${color.success}通知已开启（最低：${pref.level}）`);
        return;
      }
      if (mode === "off") {
        setNotifyPref(player, { ...pref, enabled: false });
        player.sendMessage(`${color.success}通知已关闭（仍可用 /mp:notify on 恢复）`);
        return;
      }
      if (mode === "debug" || mode === "info" || mode === "warn" || mode === "error") {
        setNotifyPref(player, { enabled: true, level: mode as NotifyLevel });
        player.sendMessage(`${color.success}通知已开启，最低等级：${mode}`);
        return;
      }
      player.sendMessage(
        `${color.error}未知参数「${mode}」（可用：on / off / show / debug / info / warn / error）`,
      );
    },
  );
}