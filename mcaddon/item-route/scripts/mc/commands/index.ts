// ─── 命令注册中心：注册全部 9 条命令 ────────────────────────
// 聚合 9 个命令文件的注册函数；在 startup 事件里以组合根注入 CommandDeps。
// 命令前缀 `ir:`；权限在命令回调内经 auth.requireRole 校验（非注册时），
// 统一走 core MemberService 矩阵。CommandDeps 即命令/UI 共享的依赖门面。
import type { CustomCommandRegistry } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import type { CommandDeps } from "./deps";
import { registerCreate } from "./create";
import { registerResize } from "./resize";
import { registerRescan } from "./rescan";
import { registerRescanPreview } from "./rescanPreview";
import { registerDelete } from "./delete";
import { registerOrganize } from "./organize";
import { registerMenu } from "./menu";
import { registerSearch } from "./search";
import { registerHelp } from "./help";

/** 注册全部命令（Phase 3 startup 事件内调用） */
export function registerAllCommands(registry: CustomCommandRegistry, deps: CommandDeps): void {
  registerCreate(registry, deps);
  registerResize(registry, deps);
  registerRescan(registry, deps);
  registerRescanPreview(registry, deps);
  registerDelete(registry, deps);
  registerOrganize(registry, deps);
  registerMenu(registry, deps);
  registerSearch(registry, deps);
  registerHelp(registry);
}

export { defineCommand };
export type { CommandDeps } from "./deps";