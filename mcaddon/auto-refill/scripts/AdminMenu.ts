// ─── 管理员菜单（命令打开 + 四项开关配置） ────────────
// 命令 /ar:menu（GameDirectors 即操作员/管理员）打开 ActionForm，
// 每行一个开关，点击切换并实时落盘（SettingsService），随后重开显示新状态。
// 仅玩家可操作；控制台/命令方块（initiator 非玩家）拒绝。

import { CommandPermissionLevel, Player, system, type CustomCommandOrigin } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { type Feature, type SettingsService } from "./Settings";

/** 管理员菜单命令名 */
const ADMIN_MENU_COMMAND = "ar:menu";

/** 从命令来源取玩家；非玩家来源（控制台等）返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/** 开关行格式：✔已开 / ✘已关 */
function statusBadge(on: boolean): string {
  return on ? "§a✔ §7已开" : "§c✘ §7已关";
}

/** 展示单个开关状态行（当前值） */
function stateLine(label: string, on: boolean): string {
  return `${on ? "§a✔" : "§c✘"} §f${label}${on ? "" : "（已停用）"}`;
}

/** 打开管理员配置菜单；点击开关项后重开以显示最新状态，末项关闭菜单。 */
function openMenu(player: Player, settings: SettingsService): void {
  const s = settings.snapshot();
  const form = new ActionFormData()
    .title("§l§6自动替换·管理员配置")
    .body(
      [
        "§7当前状态：",
        stateLine("全局启用", s.globalEnabled),
        stateLine("物品补充", s.refillEnabled),
        stateLine("武器替换", s.weaponSwapEnabled),
        stateLine("工具替换", s.toolSwapEnabled),
        "§8点击开关项切换，自动保存并刷新。",
      ].join("\n"),
    )
    .button(`☐ 全局启用  ${statusBadge(s.globalEnabled)}`)
    .button(`☐ 物品补充  ${statusBadge(s.refillEnabled)}`)
    .button(`☐ 武器替换  ${statusBadge(s.weaponSwapEnabled)}`)
    .button(`☐ 工具替换  ${statusBadge(s.toolSwapEnabled)}`);

  form.show(player).then((response) => {
    if (response.canceled) return;
    const sel = response.selection;
    if (sel === undefined) return;
    const switches: readonly ("global" | Feature)[] = ["global", "refill", "weapon", "tool"];
    const feature = switches[sel];
    if (feature === undefined) return; // 无匹配项 → 视为关闭
    settings.toggle(feature);
    openMenu(player, settings); // 重开显示最新状态
  });
}

/** 注册管理员菜单命令（startup 时挂到 customCommandRegistry）。 */
export function registerAdminMenu(settings: SettingsService): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: ADMIN_MENU_COMMAND,
        description: "打开「自动替换」管理员配置菜单（全局/物品补充/武器替换/工具替换）",
        permissionLevel: CommandPermissionLevel.GameDirectors, // 操作员/游戏导演
        cheatsRequired: false,
        mandatoryParameters: [],
      },
      (origin) => {
        const player = playerOf(origin);
        if (!player) return { status: 1, message: "该命令只能由玩家执行" };
        openMenu(player, settings);
        return undefined;
      },
    );
  });
}