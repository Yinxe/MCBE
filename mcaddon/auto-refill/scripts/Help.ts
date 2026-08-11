// ─── 帮助命令（/ar:help，全体玩家可用） ────────────────
// 简要说明本模组功能与机制：物品补充 / 工具替换 + 方块偏好 / 挖掘防误触 /
// 武器替换 / 耐久保护，及配置入口。面向玩家中文；命令回调是受限上下文，
// 发送消息延迟到 system.run 执行。

import { CommandPermissionLevel, system } from "@minecraft/server";
import { playerOf } from "./PlayerPolicy";

/** 帮助命令名 */
const HELP_COMMAND = "ar:help";

/** 帮助文本（一行一项，sendMessage 支持 \n 换行渲染） */
const HELP_TEXT = [
  "§l§6【自动替换 AutoRefill】§r 消耗品/工具自动管理，保留成就（无需作弊）：",
  "§e·§f物品补充§r —— 吃食物/喝药水/射箭后自动补同类，空瓶空桶自动回收",
  "§e·§f工具替换§r —— 挖方块自动换正确工具（农作物→时运、树叶·玻璃→精准采集，锄>剪>其它）",
  "§e·§f挖掘防误触§r —— 第一次用错误工具/空手挖方块不切换（防误拆）；2.5 秒内同样操作再挖一次才启用",
  "§e·§f武器替换§r —— 打亡灵换亡灵杀手、其它实体换锋利（附魔优先，其次剑>斧）；已持武器不换",
  "§e·§f耐久保护§r —— 工具耐久低于阈值（占比/点数取较大）未碎也提前换同类，绝不降级",
  "§a配置：§r/ar:menu（仅操作员）开关与阈值一键保存；本命令全体玩家可用",
].join("\n");

/** 注册帮助命令（startup 时挂到 customCommandRegistry）。 */
export function registerHelpCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: HELP_COMMAND,
        description: "查看「自动替换」功能与机制说明",
        permissionLevel: CommandPermissionLevel.Any, // 全体玩家可用（Any = 0）
        cheatsRequired: false,
        mandatoryParameters: [],
      },
      (origin) => {
        const player = playerOf(origin);
        if (!player) return { status: 1, message: "该命令只能由玩家执行" };
        // 命令回调是受限上下文（发送消息延迟到安全 tick），不过度处理
        system.run(() => player.sendMessage(HELP_TEXT));
        return undefined;
      }
    );
  });
}
