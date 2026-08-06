// ─── ir:help 帮助手册命令 ────────────────────────────────
// 纯入口：打开 HelpGuide 图文手册。无参数、无权限限制（help 对任意玩家开放）。
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { noParamCommand } from "./defs";
import { showHelpGuide } from "../ui/HelpGuide";

/**
 * 注册 `ir:help`：查看帮助手册。无需 deps（HelpGuide 只读静态内容）。
 *
 * @param registry - 自定义命令注册表
 */
export function registerHelp(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(registry, noParamCommand("ir:help", "查看帮助手册"), ({ player }) => {
    system.runTimeout(() => {
      void showHelpGuide(player);
    });
  });
}
