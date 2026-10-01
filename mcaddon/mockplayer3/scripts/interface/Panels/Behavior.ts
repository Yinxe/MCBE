// ─── 行为面板 ──────────────────────────────────────────────────────
// 自动重生/潜行开关 + 工作模式下拉（workModeEnabled 过滤）；采集对象即模式，
// 直接是下拉项；节拍配置不入面板。
// 纪律：开关先写→后切模式（模式切换即存盘）；成功消息在操作之后发出。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import { WORK_MODES, modeSpec } from "../../domain/Catalog";
import type { WorkMode } from "../../domain/Record";
import { ensureUiBotAvailable, guardUiManage, performSyncPose, resolveUiBotRecord, uiViewer } from "../Kit";
import { services } from "../../Composition";

/** 下拉列色：无=灰、劫掠=黄、钓鱼=青、其余玩家黄 */
function modeColor(id: WorkMode): string {
  if (id === "none") return color.muted;
  if (id === "raid") return color.warn;
  if (id === "fishing") return color.accent;
  return color.playerName;
}

export function showBehaviorPanel(player: Player, rawName: string): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const record = resolveUiBotRecord(say, rawName);
  if (!record) return;
  if (!guardUiManage(say, viewer, record)) return;
  const { botId, name } = record;

  const config = services.runtime.config;
  // 已禁用、或实验模式而"实现性功能"总闸未开启的模式不进下拉
  const usable = (id: WorkMode, m: { experimental?: boolean }): boolean =>
    id === "none" || (config.workModeEnabled[id] && (m.experimental !== true || config.experimentalEnabled));
  const options = WORK_MODES.filter((m) => usable(m.id, m));
  const currentIdx = Math.max(
    0,
    options.findIndex((m) => m.id === record.workMode)
  );

  void ModalFormBuilder.showQuick(player, `${color.bold}行为 · ${name}`, (f) => {
    f.toggle("respawn", style("自动重生", color.playerName), {
      defaultValue: record.switches.autoRespawn,
      tooltip: "死亡后自动复活到重生点",
    });
    f.label("sep1", style("━━ 其他开关 ────", color.accent));
    f.toggle("sneaking", style("潜行", color.playerName), {
      defaultValue: record.switches.sneaking,
      tooltip: record.switches.sneaking ? "关闭将站起" : "开启将使假人潜行",
    });
    f.toggle("syncPose", style("同步姿态", color.playerName), {
      defaultValue: false,
      tooltip: "勾选并提交：假人传送到你的位置并同步朝向与潜行（效果等同主菜单「同步姿态」按钮，要求假人在线）",
    });
    f.label("sep2", style("━━ 工作模式 ────", color.accent));
    f.dropdown(
      "workMode",
      style("工作模式（仅选一项，互斥）", color.accent),
      options.map((m) => style(m.label, modeColor(m.id))),
      {
        defaultValueIndex: currentIdx,
        tooltip: "单选工作模式（互斥，仅一项）：已禁用的模式不在列表中（管理员可在全局配置中启用/禁用）",
      }
    );
  }).then((vals) => {
    if (!vals) return;
    system.run(async () => {
      const live = services.runtime.record(botId);
      if (!live) {
        say(`${color.error}模拟玩家 ${color.playerName}${name}${color.error} 已不存在`);
        return;
      }
      const { lifecycle } = services;
      const idx =
        typeof vals.workMode === "number" && vals.workMode >= 0 && vals.workMode < options.length
          ? vals.workMode
          : currentIdx;
      const picked: WorkMode = options[idx]?.id ?? "none";
      // 开关（幂等直写；失败仅提示不中断后续）
      const sneak = lifecycle.setSwitch(botId, "sneaking", Boolean(vals.sneaking));
      if (!sneak.ok) say(`${color.error}切换潜行失败: ${sneak.reason}`);
      const respawn = lifecycle.setSwitch(botId, "autoRespawn", Boolean(vals.respawn));
      if (!respawn.ok) say(`${color.error}切换自动重生失败: ${respawn.reason}`);
      // 跟随关系（Follow 能力启动前提）：切入即写入；切出待模式切换成功后再清，
      // 切换被拒时保留关系（与 mp:work 命令路径一致）
      const wasFollow = live.workMode === "follow";
      if (picked === "follow") {
        const r = lifecycle.setFollowTarget(viewer, botId, viewer.key);
        if (!r.ok) say(`${color.error}切换跟随失败: ${r.reason}`);
      }
      const mode = lifecycle.changeWorkMode(viewer, botId, picked);
      if (!mode.ok) {
        say(`${color.error}${mode.reason}`);
        return;
      }
      if (wasFollow && picked !== "follow") {
        const r = lifecycle.setFollowTarget(viewer, botId, null);
        if (!r.ok) say(`${color.error}解除跟随目标失败: ${r.reason}`);
      }
      if (picked === "follow")
        say(
          services.runtime.session(botId)
            ? `${color.success}${color.playerName}${name}${color.success} 正在跟随你`
            : `${color.success}已为 ${color.playerName}${name}${color.success} 设定跟随（离线假人下次上线生效）`
        );
      else if (wasFollow) say(`${color.success}${color.playerName}${name}${color.success} 已停止跟随`);
      else if (picked.startsWith("harvest_"))
        say(
          services.runtime.session(botId)
            ? `${color.success}${color.playerName}${name}${color.success} 正在${color.playerName}${modeSpec(picked).label}`
            : `${color.success}已为 ${color.playerName}${name}${color.success} 预设${color.playerName}${modeSpec(picked).label}${color.success}（离线假人下次上线生效）`
        );
      say(`${color.success}已更新 ${color.playerName}${name}${color.success} 的行为设置`);
      // 姿态同步放在全部写入之后：其潜行取值来自玩家，须覆盖上方潜行开关的表单值
      if (vals.syncPose) {
        if (ensureUiBotAvailable(say, live)) {
          const r = performSyncPose(player, botId);
          say(
            r.ok
              ? `${color.success}已同步 ${color.playerName}${name}${color.success} 姿态与朝向`
              : `${color.error}${r.reason}`
          );
        }
      }
    });
  });
}
