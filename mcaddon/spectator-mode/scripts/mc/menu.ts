// ── /sp:menu 管理员菜单：启用/禁用 + 最大移动距离 + 连线粒子开关 ──
import type { Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import { clampMaxDistance, MAX_DISTANCE_MIN, MAX_DISTANCE_MAX } from "../core/config";
import type { SoulController } from "./controller";

/**
 * 弹出旁观模式管理表单。
 * - 开关：启用/禁用旁观功能（禁用时强制所有灵魂回归）。
 * - 滑动条：最大移动距离（米）。
 * - 开关：真身↔灵魂连线粒子（默认关）。
 *
 * @param player     - 管理员玩家
 * @param controller - 旁观控制器
 */
export async function openAdminMenu(player: Player, controller: SoulController): Promise<void> {
  const config = controller.getConfig();

  const values = await new ModalFormBuilder()
    .title("灵魂出窍 · 管理")
    .toggle("switch", "启用旁观模式", {
      defaultValue: config.enabled,
      tooltip: "关闭后玩家无法进入旁观，已在旁观中的灵魂会强制回归",
    })
    .slider("distance", "最大移动距离（米）", MAX_DISTANCE_MIN, MAX_DISTANCE_MAX, {
      valueStep: 1,
      defaultValue: clampMaxDistance(config.maxDistance),
      tooltip: "灵魂可离开真身的最大距离，超出进入 5 秒容忍倒计时",
    })
    .toggle("link", "显示连线粒子", {
      defaultValue: config.showLink,
      tooltip: "在真身↔灵魂之间渲染双向连线粒子（默认关）",
    })
    .submitButton("保存")
    .show(player);

  if (!values) return; // 取消

  const enabled = typeof values.switch === "boolean" ? values.switch : config.enabled;
  const distance = typeof values.distance === "number" ? clampMaxDistance(values.distance) : config.maxDistance;
  const showLink = typeof values.link === "boolean" ? values.link : config.showLink;
  controller.setConfig({ enabled, maxDistance: distance, showLink });
  player.sendMessage(
    `§a已保存：旁观模式${enabled ? "启用" : "禁用"} · 最大距离 §f${distance}§a 米 · 连线${showLink ? "开" : "关"}`
  );
}
