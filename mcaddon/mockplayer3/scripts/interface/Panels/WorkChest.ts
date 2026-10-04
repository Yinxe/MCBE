// ─── 工作箱绑定面板 ────────────────────────────────────────────────
// 入口唯一：蹲下 + 手持信物 + 点击（与方块交互）普通木头箱子——判定在 Menu，此处 system.run 内开表单 F-11。
// 蹲下是"只与方块交互"的修饰键：不蹲下时点击会先去用手里物品，也就不会走到这里。
// 手持物取"本次交互实际使用的物品"（桥上报 event.itemStack），不是快捷栏某一格。
// 每个可管理的假人一个开关：勾选=绑到该箱（覆写旧绑定，每假人最多绑一箱）；
// 同一箱可被多个假人同时勾选共用。取消勾选且现绑为该箱=解绑。箱名整表共用一个字段，留保持原名。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import { canManage } from "../../domain/Permissions";
import { formatPosLine, uiViewer, visibleRecords } from "../Kit";
import { services } from "../../Composition";

/** 点击箱格（整数格，桥上报） */
export interface ClickedCell {
  dimId: string;
  x: number;
  y: number;
  z: number;
}

/** 绑定状态列：未绑灰、绑本箱绿、绑他箱黄（显示他箱名或坐标 id） */
function bindStateLabel(chestId: string | null, thisChestId: string): string {
  if (!chestId) return style("未绑定", color.muted);
  if (chestId === thisChestId) return style("已绑本箱", color.success);
  const name = services.lifecycle.workChestName(chestId);
  return style(`已绑: ${name || chestId}`, color.warn);
}

export function showWorkChestForm(player: Player, cell: ClickedCell): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const clicked = { x: cell.x, y: cell.y, z: cell.z };
  const peek = services.lifecycle.workChestPeek(cell.dimId, clicked);
  if (!peek) {
    say(`${color.error}该方块不是普通木头箱子（木桶/陷阱箱不可作工作箱）`);
    return;
  }
  const bots = visibleRecords(viewer).filter((r) => canManage(viewer, r, services.runtime.config));
  if (bots.length === 0) {
    say(`${color.error}你没有可管理的假人（仅主人或管理员可绑定工作箱）`);
    return;
  }
  const keys = new Map<string, number>();
  void ModalFormBuilder.showQuick(player, `${color.bold}工作箱绑定`, (f) => {
    f.label("chestLoc", `${style("箱子", color.accent)} ${formatPosLine(peek.origin, cell.dimId, false)}`);
    f.textField("chestName", "工作箱名称", {
      defaultValue: peek.name,
      tooltip: "可留空（保持原名）；用于各假人绑定状态与告警播报的显示",
    });
    f.label("sep", style("━━ 假人绑定（勾选=绑到该箱）────", color.accent));
    for (const r of bots) {
      const key = `b${r.botId}`;
      keys.set(key, r.botId);
      f.toggle(key, `${r.name} ${bindStateLabel(r.workChestId, peek.chestId)}`, {
        defaultValue: r.workChestId === peek.chestId,
        tooltip: "勾选后该假人在线期间把工作产物搬进这个箱子；取消勾选且现绑为该箱则解绑",
      });
    }
  }).then((vals) => {
    if (!vals) return;
    system.run(() => {
      const choices = [...keys.entries()].map(([key, botId]) => ({ botId, on: Boolean(vals[key]) }));
      const r = services.lifecycle.applyWorkChestForm(
        viewer,
        cell.dimId,
        clicked,
        String(vals.chestName ?? ""),
        choices
      );
      if (!r.ok) {
        say(`${color.error}${r.reason}`);
        return;
      }
      const label = peek.name || "未命名";
      if (r.bound.length > 0)
        say(
          `${color.success}已绑定工作箱「${label}」: ${color.playerName}${r.bound.join("、")}${color.success}（在线期间自动搬运工作产物）`
        );
      if (r.unbound.length > 0) say(`${color.info}已从该箱解绑: ${color.playerName}${r.unbound.join("、")}`);
      if (r.denied.length > 0) say(`${color.warn}未生效（非本人假人或保存失败）: ${r.denied.join("、")}`);
      if (r.bound.length === 0 && r.unbound.length === 0 && r.denied.length === 0) say(`${color.muted}绑定无变化`);
    });
  });
}
