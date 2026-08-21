// ─── 一次性破坏方块命令（调用 breakBlock 封装工作流） ───
// /mp:breakblock <假人> [x y z]：持续破坏一个方块直到消失——
//   无坐标 = 假人视线方向方块（viewBlock 探测）；
//   有坐标 = 指定坐标方块（breakBlockAt 持续破坏）。
// 工作流（features/basic/blocks/blockBreak.ts）：每 tick 起手 breakBlock +
// 轮询检测（实体/距离/方块消失）+ 成功信号 broken + 全路径清理。

import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { breakBlockAt, viewBlock, type BreakResult } from "../../../features/basic/blocks";
import { resolveBotForCommand } from "../auth";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { isAdmin } from "../auth";

/** 一次性破坏方块默认距离（格） */
const BREAK_DISTANCE = 6;

/** 破坏结果 → 中文消息 */
function resultLabel(result: BreakResult): string {
  switch (result) {
    case "broken": return `${color.success}方块已破坏`;
    case "far": return `${color.warn}目标超出距离（放弃）`;
    case "aborted": return `${color.warn}流程中止`;
    case "offline": return `${color.error}假人不可用`;
    case "busy": return `${color.warn}已有破坏进行中（拒绝重复）`;
    case "blocked": return `${color.warn}目标被遮挡（放弃）`;
  }
}

export function registerBreakBlockCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:breakblock",
    description: "让假人一次性破坏一个方块（无坐标=视线方向方块；带 x y z=指定坐标）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [
      { name: "x", type: CustomCommandParamType.Integer },
      { name: "y", type: CustomCommandParamType.Integer },
      { name: "z", type: CustomCommandParamType.Integer },
    ],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }
    const bot = resolveBotForCommand(player, params.name as string);
    if (!bot) return;

    const x = params.x as number | undefined;
    const y = params.y as number | undefined;
    const z = params.z as number | undefined;
    if ((x === undefined) !== (y === undefined) || (y === undefined) !== (z === undefined)) {
      player.sendMessage(`${color.error}用法: /mp:breakblock <假人> [x y z]（坐标需三个一起给）`);
      return;
    }

    // 目标解析：有坐标 → 指定；无坐标 → 视线方向方块
    let target: { x: number; y: number; z: number } | undefined;
    if (x !== undefined && y !== undefined && z !== undefined) {
      target = { x, y, z };
    } else {
      const entity = resolveBotPlayer(bot.name);
      if (!entity) {
        player.sendMessage(`${color.error}假人 ${color.playerName}${bot.name}${color.error} 不在线`);
        return;
      }
      const inSight = viewBlock(entity, BREAK_DISTANCE);
      if (!inSight) {
        player.sendMessage(`${color.warn}${bot.name} 视线方向 ${BREAK_DISTANCE} 格内没有可破坏方块`);
        return;
      }
      target = inSight.location;
    }

    player.sendMessage(
      `${color.muted}开始破坏：${color.playerName}${bot.name}${color.muted} → (${Math.floor(target.x)}, ${Math.floor(target.y)}, ${Math.floor(target.z)})`,
    );
    void (async () => {
      try {
        const result = await breakBlockAt(bot.name, target!, { maxDistance: BREAK_DISTANCE, skipLook: false });
        player.sendMessage(`${color.accent}[模拟玩家][破坏] ${color.playerName}${bot.name} ${resultLabel(result)}`);
      } catch (e: any) {
        player.sendMessage(`${color.error}[模拟玩家][破坏] ${bot.name} 流程异常: ${e?.message ?? e}`);
      }
    })();
  });
}
