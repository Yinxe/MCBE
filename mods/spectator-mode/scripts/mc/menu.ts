// ── 管理员表单(原生 ModalFormData) ──
import { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { clampMaxDistance, MAX_DISTANCE_MAX, MAX_DISTANCE_MIN } from "../core/config";
import { TOGGLE_COMMAND, type SoulController } from "./controller";

/**
 * 打开管理表单:启用开关 / 最大距离滑条 / 连线开关。
 * 取消(Close / Cancel)时不做任何改动。
 *
 * @param player - 执行命令的管理员
 * @param controller - 旁观控制器
 */
export function openAdminMenu(player: Player, controller: SoulController): void {
  const config = controller.getConfig();

  const form = new ModalFormData()
    .title("灵魂出窍 · 管理")
    .toggle("启用旁观模式", {
      defaultValue: config.enabled,
      tooltip: "关闭后玩家无法进入旁观,已在旁观中的灵魂会被强制回归本体",
    })
    .slider(`最大移动距离(米)`, MAX_DISTANCE_MIN, MAX_DISTANCE_MAX, {
      valueStep: 1,
      defaultValue: clampMaxDistance(config.maxDistance),
      tooltip: "灵魂离真身超过该距离后开始 5 秒容忍倒计时,倒计时结束强制回归",
    })
    .toggle("显示连线粒子", {
      defaultValue: config.showLink,
      tooltip: "在真身与灵魂之间绘制双向扫掠连线(琥珀:真身→灵魂,灰:灵魂→真身)",
    })
    .submitButton("保存");

  form.show(player).then(
    (response) => {
      if (response.canceled || response.formValues === undefined) return; // 取消不改动
      const [enabled, distance, showLink] = response.formValues as [boolean, number, boolean];
      controller.setConfig({
        enabled: !!enabled,
        maxDistance: clampMaxDistance(distance),
        showLink: !!showLink,
      });
      const next = controller.getConfig();
      player.sendMessage(
        `§a配置已保存 · ${next.enabled ? "§a已启用" : "§c已禁用"}§r · 最大距离 §f${next.maxDistance}m§r · 连线 ${
          next.showLink ? "§a开" : "§7关"
        }§r`
      );
      player.sendMessage(`§7提示:玩家用 §f/${TOGGLE_COMMAND}§7 切换旁观状态`);
    },
    (error) => {
      // 表单异常(玩家离线等)不抛出,只提示执行者
      player.sendMessage(`§c打开表单失败:${String(error)}`);
    }
  );
}
