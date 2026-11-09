// ── 管理员表单(共享 ModalFormBuilder) ──
import type { Player } from "@minecraft/server";
import { ModalFormBuilder, notifySuccess } from "@mc-toolchain/mod-common";
import { clampMaxDistance, MAX_DISTANCE_MAX, MAX_DISTANCE_MIN } from "../core/config";
import { TOGGLE_COMMAND, type SoulController } from "./controller";

/**
 * 打开管理表单:启用开关 / 最大距离滑条 / 连线开关 / 夜视增益开关。
 *
 * 取消与表单异常都表现为 `show()` 返回 `null`,一律静默返回、不改动配置
 * (异常已由共享构建器写入 `console.warn`)。
 *
 * 必须在安全上下文调用(命令回调里经 `runSafeDetached` 推迟)。
 *
 * @param player - 执行命令的管理员
 * @param controller - 旁观控制器
 */
export async function openAdminMenu(player: Player, controller: SoulController): Promise<void> {
  const config = controller.getConfig();

  const values = await new ModalFormBuilder()
    .title("灵魂出窍 · 管理")
    .toggle("enabled", "启用旁观模式", {
      defaultValue: config.enabled,
      tooltip: "关闭后玩家无法进入旁观,已在旁观中的灵魂会被强制回归本体",
    })
    .slider("maxDistance", "最大移动距离(米)", MAX_DISTANCE_MIN, MAX_DISTANCE_MAX, {
      valueStep: 1,
      defaultValue: clampMaxDistance(config.maxDistance),
      tooltip: "灵魂离真身超过该距离后开始 5 秒容忍倒计时,倒计时结束强制回归",
    })
    .toggle("showLink", "显示连线粒子", {
      defaultValue: config.showLink,
      tooltip: "在真身与灵魂之间绘制双向扫掠连线(琥珀:真身→灵魂,灰:灵魂→真身)",
    })
    .toggle("nightVision", "夜视增益", {
      defaultValue: config.nightVision,
      tooltip: "灵魂出窍期间为灵魂施加夜视;回归时原样恢复你进入前的夜视状态,不消耗你原有的夜视时长",
    })
    .submitButton("保存")
    .show(player);

  // null = 玩家取消 或 表单异常;两者都不改动配置
  if (values === null) return;

  const distance = typeof values.maxDistance === "number" ? values.maxDistance : config.maxDistance;
  controller.setConfig({
    enabled: !!values.enabled,
    maxDistance: clampMaxDistance(distance),
    showLink: !!values.showLink,
    nightVision: !!values.nightVision,
  });

  const next = controller.getConfig();
  notifySuccess(
    player,
    `配置已保存 · ${next.enabled ? "§a已启用" : "§c已禁用"}§r · 最大距离 §f${next.maxDistance}m§r · 连线 ${
      next.showLink ? "§a开" : "§7关"
    }§r · 夜视 ${next.nightVision ? "§a开" : "§7关"}§r`
  );
  player.sendMessage(`§7提示:玩家用 §f/${TOGGLE_COMMAND}§7 切换旁观状态`);
}
