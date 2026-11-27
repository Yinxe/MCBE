// ─── ir:token 领取仓库信物命令 ────────────────────────────
// 纯入口：把信物补齐到玩家背包（已有则不重复发，背包满则落地）。
// 无参数、无权限限制——信物是使用本模组的前提，新玩家必须能自助获取。
import type { CustomCommandRegistry } from "@minecraft/server";
import { registerPlayerCommand } from "./register";
import { noParamCommand } from "./defs";
import { giveWarehouseToken } from "../token";
import { chat } from "../ui/uiColor";

/**
 * 注册 `ir:token`：领取仓库信物。
 *
 * 三种结果对应三套文案（见 core/token.ts 的 GiveOutcome）：
 * - into-inventory：已放入背包
 * - dropped：背包满，已丢在脚下
 * - already-has：已有信物，不重复发放
 * - unavailable：读不到背包（半初始化/离线），提示稍后重试
 *
 * @param registry - 自定义命令注册表
 */
export function registerToken(registry: CustomCommandRegistry): void {
  registerPlayerCommand(registry, noParamCommand("ir:token", "领取仓库信物"), ({ player }) => {
    switch (giveWarehouseToken(player)) {
      case "into-inventory":
        player.sendMessage(`${chat.success}已获得仓库信物，手持它右键容器即可管理仓库`);
        break;
      case "dropped":
        player.sendMessage(`${chat.success}背包已满，仓库信物已丢在你脚下`);
        break;
      case "already-has":
        player.sendMessage(`${chat.muted}你已经有仓库信物了`);
        break;
      case "unavailable":
        player.sendMessage(`${chat.error}无法读取你的背包，请稍后重试`);
        break;
    }
  });
}
