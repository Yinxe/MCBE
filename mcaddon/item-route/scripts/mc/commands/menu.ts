// ─── ir:menu 打开主菜单命令 ──────────────────────────────
// 纯入口：延迟一拍打开 MainMenu ActionForm（搜索/仓库列表/创建/帮助/配置管理员专属）。
// 主菜单按钮的权限分级在 MainMenu 内部判定（OP canManage 显配置入口）。
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { showMainMenu } from "../ui/MainMenu";

/**
 * 注册 `ir:menu`：不做任何权限限制，主菜单内部按玩家身份分级展示入口。
 *
 * @param registry - 自定义命令注册表
 * @param deps     - 命令共享依赖门面（含 loaded 仓库、config 等）
 */
export function registerMenu(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, noParamCommand("ir:menu", "打开主菜单"), ({ player }) => {
    system.runTimeout(() => {
      void showMainMenu(player, deps);
    });
  });
}
