// ─── 管理员菜单（命令打开 + ModalForm 一键配置） ────────────
// 命令 /ar:menu（GameDirectors 即操作员/管理员）打开 ModalForm：全部开关用
// toggle 组件一次展示（可见当前状态），耐久保护阈值用滑条，提交时一次性保存。
// 相比逐行按钮的 ActionForm（点一个开/关重开一次），可一次调整多项再统一落盘。
// 仅玩家可操作；控制台/命令方块（initiator 非玩家）拒绝。

import { CommandPermissionLevel, Player, system, type CustomCommandOrigin } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { type Feature, type SettingsService } from "./Settings";

/** 管理员菜单命令名 */
const ADMIN_MENU_COMMAND = "ar:menu";

/** 开关行（含全局）；与表单组件添加顺序一致 */
const SWITCHES: readonly ("global" | Feature)[] = ["global", "refill", "weapon", "tool", "durability"];

/** 从命令来源取玩家；非玩家来源（控制台等）返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/** 打开管理员配置 ModalForm：提交时按表单值一次性应用并落盘。 */
function openMenu(player: Player, settings: SettingsService): void {
  const s = settings.snapshot();
  const form = new ModalFormData()
    .title("§l§6自动替换·管理员配置")
    .toggle("全局启用", { defaultValue: s.globalEnabled })
    .toggle("物品补充（使用后自动补货）", { defaultValue: s.refillEnabled })
    .toggle("武器替换（攻击时换正确武器）", { defaultValue: s.weaponSwapEnabled })
    .toggle("工具替换（挖掘换正确工具）", { defaultValue: s.toolSwapEnabled })
    .toggle("耐久保护（低耐久提前收起同类）", { defaultValue: s.durabilityProtectEnabled })
    .slider("耐久保护阈值：剩余占比低于该值即替换同类", 1, 50, {
      defaultValue: Math.round(s.durabilityThreshold * 100),
      valueStep: 1,
    })
    .submitButton("§a保存");

  form.show(player).then((response) => {
    if (response.canceled || response.formValues === undefined) return;
    const [global, refill, weapon, tool, durability, thresholdPct] = response.formValues;
    settings.setFeature("global", global === true);
    settings.setFeature("refill", refill === true);
    settings.setFeature("weapon", weapon === true);
    settings.setFeature("tool", tool === true);
    settings.setFeature("durability", durability === true);
    if (typeof thresholdPct === "number") settings.setDurabilityThreshold(thresholdPct / 100);
    player.sendMessage("§a已保存「自动替换」配置");
  });
}

/** 注册管理员菜单命令（startup 时挂到 customCommandRegistry）。 */
export function registerAdminMenu(settings: SettingsService): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: ADMIN_MENU_COMMAND,
        description: "打开「自动替换」管理员配置菜单（全局/物品补充/武器替换/工具替换/耐久保护/阈值）",
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
