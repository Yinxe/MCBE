// ─── 命令目录聚合（全量 mp:* 唯一真源） ────────────────────────────
// 组文件只提供 CommandSpec 数组，聚合与 mp:cmdlist 在此完成（目录命令渲染全
// 目录，放组文件会循环导入）。帮助命令取名 mp:help 会与原版 /help 冲突。

import { renderHelpLines, type CommandSpec } from "./CmdKit";
import { LIFECYCLE_COMMANDS } from "./Commands.Lifecycle";
import { NAVIGATION_COMMANDS } from "./Commands.Navigation";
import { BEHAVIOR_COMMANDS } from "./Commands.Behavior";
import { INSPECT_COMMANDS } from "./Commands.Inspect";
import { UI_COMMANDS } from "./Commands.Ui";
import { ADMIN_COMMANDS } from "./Commands.Admin";

const GROUPS: CommandSpec[] = [
  ...LIFECYCLE_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...BEHAVIOR_COMMANDS,
  ...INSPECT_COMMANDS,
  ...UI_COMMANDS,
  ...ADMIN_COMMANDS,
];

const HELP: CommandSpec = {
  name: "mp:cmdlist",
  description: "显示命令目录（本帮助）",
  usage: "mp:cmdlist",
  execute: (ctx) => {
    for (const line of renderHelpLines(ALL_COMMANDS)) ctx.say(line);
  },
};

/** 全量命令目录；仅由 main.ts 在 system.beforeEvents.startup 内注册一次 */
export const ALL_COMMANDS: CommandSpec[] = [...GROUPS, HELP];
