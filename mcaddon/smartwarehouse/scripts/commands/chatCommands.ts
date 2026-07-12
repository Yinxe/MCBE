// ─── Chat 命令回退 — 兼容无 customCommandRegistry 的环境 ──
// 当 /sw:menu 未被自定义命令系统拦截时（如低版本 MC），
// 通过 chatSend 事件拦截并打开主菜单。
//
// chatSend 在 @minecraft/server v1.x（MC 1.21.x）中可用，
// 但在 v2.x 类型中已移除（v2.x 使用 customCommandRegistry）。
// 此处用运行时检测 + 类型断言安全访问。

import { world, system, type Player } from "@minecraft/server";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { showMainMenu } from "../ui/MainMenu";
import { showHelpGuide } from "../ui/HelpGuide";
import { Logger } from "../util/Logger";

const log = new Logger("ChatCommands");

interface ChatSendBeforeEvent {
  message: string;
  sender: Player;
  cancel: boolean;
}

/**
 * 注册 chat 命令回退处理器。
 * 当玩家发送 /sw:menu 且未被自定义命令系统处理时，打开主菜单。
 *
 * 与 customCommandRegistry 共存是安全的：
 * - 高版本 MC 中，自定义命令会先拦截 /sw:menu，chat 事件不会触发
 * - 低版本 MC 中，无自定义命令系统，chat 事件正常拦截
 *
 * 运行时安全：chatSend 不存在时（如纯 v2.x 环境），订阅被跳过。
 */
export function registerChatCommands(
  repository: WarehouseRepository,
  service: WarehouseService,
  configStore: ModConfigStore,
): void {
  // 运行时检测 chatSend 是否可用（v1.x 有，v2.x 没有）
  const beforeEvents = world.beforeEvents as unknown as Record<string, unknown>;
  const chatSendSignal = beforeEvents.chatSend as
    | { subscribe: (callback: (event: ChatSendBeforeEvent) => void) => void }
    | undefined;

  if (!chatSendSignal?.subscribe) {
    log.info("chatSend 不可用（预期内：v2.x 用 customCommandRegistry），跳过 chat 回退");
    return;
  }

  chatSendSignal.subscribe((event: ChatSendBeforeEvent) => {
    const msg = event.message;
    const player = event.sender;

    // 匹配 /sw:menu 命令
    if (/^\/sw:menu\s*$/i.test(msg)) {
      event.cancel = true;
      system.run(() => {
        showMainMenu(player, repository, service, configStore).catch((e) => {
          log.error(`菜单打开失败: ${e}`);
          player.sendMessage("§c菜单打开失败，请查看控制台日志");
        });
      });
    }

    // 匹配 /sw:help 命令
    if (/^\/sw:help\s*$/i.test(msg)) {
      event.cancel = true;
      system.run(() => {
        showHelpGuide(player);
      });
    }
  });

  log.info("chat 命令回退已注册（/sw:menu, /sw:help）");
}
