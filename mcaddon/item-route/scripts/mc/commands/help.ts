// ─── ir:help 帮助手册 ───────────────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { noParamCommand } from "./defs";
import { showHelpGuide } from "../ui/HelpGuide";

export function registerHelp(registry: Parameters<typeof defineCommand>[0]): void {
  defineCommand(registry, noParamCommand("ir:help", "查看帮助手册"), ({ player }) => {
    system.runTimeout(() => {
      void showHelpGuide(player);
    });
  });
}