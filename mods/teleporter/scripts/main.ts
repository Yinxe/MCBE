// ─── 组合根 ─────────────────────────────────────────────────────
//
// 启动阶段只做两件事:注册命令、注册事件。两者都必须在 startup 内完成,
// 因为命令注册与事件订阅都被标注为 "can't be called in read-only mode",
// 运行期再注册会抛错。详见 docs/research/read-only-context.md。

import { system } from "@minecraft/server";
import { registerAllCommands } from "./mc/commands";
import { registerAllEvents } from "./mc/events";
import { MOD_VERSION } from "./version";

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry);
  registerAllEvents();
});

// 启动完成后的提示。版本号来自 version.ts,不在这里硬编码。
system.run(() => {
  console.warn(`[Teleporter] 传送模组已加载 v${MOD_VERSION}`);
});
