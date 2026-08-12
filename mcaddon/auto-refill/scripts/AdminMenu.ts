// ─── 管理员菜单（命令打开 + ModalForm 一键配置） ────────────
// 命令 /ar:menu（GameDirectors 即操作员/管理员）打开 ModalForm：全部开关用
// toggle 组件一次展示（可见当前状态），每个开关/滑条带 tooltip（悬停的感叹号
// 图标显示说明），耐久保护阈值用滑条，提交时一次性保存。
// 相比逐行按钮的 ActionForm（点一个开/关重开一次），可一次调整多项再统一落盘。
// 仅玩家可操作；控制台/命令方块（initiator 非玩家）拒绝。

import { CommandPermissionLevel, Player, system, type CustomCommandOrigin } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { type Feature, type SettingsService } from "./Settings";
import { playerOf } from "./PlayerPolicy";

/** 管理员菜单命令名 */
const ADMIN_MENU_COMMAND = "ar:menu";

/** 开关行（含全局）；与表单组件添加顺序一致 */
const SWITCHES: readonly ("global" | Feature)[] = [
  "global",
  "refill",
  "weapon",
  "tool",
  "totem",
  "antiTouch",
  "durability",
];

/** 各开关/滑条的 tooltip（悬停感叹号显示；面向玩家中文说明机制） */
const TOOLTIPS: Readonly<Record<string, string>> = {
  global: "总开关：关闭后自动替换全部功能停用（物品补充/工具/武器/防误触/耐久保护）",
  refill: "主手消耗品用尽或留下残留（空瓶/空桶/碗）时自动补同类并回收残留。吃食物、喝药水、射箭后生效",
  weapon: "攻击实体自动换正确武器：亡灵→亡灵杀手、其它→锋利（附魔优先，其次 剑>斧）；已持任意武器不切换",
  tool: "挖掘自动换正确工具；叠加方块偏好：农作物→时运、树叶·玻璃→精准采集（锄>剪>其它）",
  totem:
    "图腾补充：不死图腾触发（死亡保护生效）后，自动从背包把备用图腾换入副手，触发的瞬间即可续命；副手仍持图腾则不动",
  antiTouch:
    "挖掘防误触：第一次用错误工具/空手挖方块时不切换（防空手误拆建筑）；2.5 秒内同样操作再挖一次才确认有意·允许切换",
  durability: "工具耐久低于阈值未碎也提前收起换同类（绝不降级，旧带精准优先换带精准同款）",
  threshold: "剩余耐久占比低于该值即替换同类（1%~20%，默认 5%）。越低越延后收工具",
  floor: "剩余耐久点数低于该值也替换（1~64，默认 16），兜住低耐久上限的工具；与占比阈值取较大的生效",
};

/** 打开管理员配置 ModalForm：提交时按表单值一次性应用并落盘。每个开关/滑条带 tooltip。 */
function openMenu(player: Player, settings: SettingsService): void {
  const s = settings.snapshot();
  const form = new ModalFormData()
    .title("§l§6自动替换·管理员配置")
    .toggle("全局启用", { defaultValue: s.globalEnabled, tooltip: TOOLTIPS.global })
    .toggle("物品补充（使用后自动补货）", { defaultValue: s.refillEnabled, tooltip: TOOLTIPS.refill })
    .toggle("武器替换（攻击时换正确武器）", { defaultValue: s.weaponSwapEnabled, tooltip: TOOLTIPS.weapon })
    .toggle("工具替换（挖掘换正确工具）", { defaultValue: s.toolSwapEnabled, tooltip: TOOLTIPS.tool })
    .toggle("图腾补充（触发后自动换入备用不死图腾）", { defaultValue: s.totemEnabled, tooltip: TOOLTIPS.totem })
    .toggle("挖掘防误触（防误拆）", { defaultValue: s.antiTouchEnabled, tooltip: TOOLTIPS.antiTouch })
    .toggle("耐久保护（低耐久提前收起同类）", {
      defaultValue: s.durabilityProtectEnabled,
      tooltip: TOOLTIPS.durability,
    })
    .slider("耐久保护阈值：剩余占比低于该值即替换同类（%）", 1, 20, {
      defaultValue: Math.round(s.durabilityThreshold * 100),
      valueStep: 1,
      tooltip: TOOLTIPS.threshold,
    })
    .slider("耐久保护绝对下限：剩余耐久低于该值也替换同类", 1, 64, {
      defaultValue: s.durabilityFloor,
      valueStep: 1,
      tooltip: TOOLTIPS.floor,
    })
    .submitButton("§a保存");

  form.show(player).then((response) => {
    if (response.canceled || response.formValues === undefined) return;
    const [global, refill, weapon, tool, totem, antiTouch, durability, thresholdPct, floor] = response.formValues;
    settings.setFeature("global", global === true);
    settings.setFeature("refill", refill === true);
    settings.setFeature("weapon", weapon === true);
    settings.setFeature("tool", tool === true);
    settings.setFeature("totem", totem === true);
    settings.setFeature("antiTouch", antiTouch === true);
    settings.setFeature("durability", durability === true);
    if (typeof thresholdPct === "number") settings.setDurabilityThreshold(thresholdPct / 100);
    if (typeof floor === "number") settings.setDurabilityFloor(floor);
    player.sendMessage("§a已保存「自动替换」配置");
  });
}

/** 注册管理员菜单命令（startup 时挂到 customCommandRegistry）。 */
export function registerAdminMenu(settings: SettingsService): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: ADMIN_MENU_COMMAND,
        description: "打开「自动替换」管理员配置菜单（全局/物品补充/武器替换/工具替换/图腾补充/耐久保护/阈值）",
        permissionLevel: CommandPermissionLevel.GameDirectors, // 操作员/游戏导演
        cheatsRequired: false,
        mandatoryParameters: [],
      },
      (origin) => {
        const player = playerOf(origin);
        if (!player) return { status: 1, message: "该命令只能由玩家执行" };
        // 命令回调是受限上下文（world/UI 操作需安全 tick），延迟到 system.run
        system.run(() => openMenu(player, settings));
        return undefined;
      }
    );
  });
}
