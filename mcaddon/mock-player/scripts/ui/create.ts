// ─── 创建模拟玩家表单 ───────────────────────────────────

import { Player, system, world, Vector3 } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit/ui";

import { PositionState } from "../features/types";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE } from "../features/tags";
import { getPlayerLookTarget, parseCoordinateInput } from "../features/utils";
import { generateBotName } from "../features/persistence";
import { createBot, CreateBotOptions } from "../features/operations";

export function showCreateForm(player: Player): void {
  const dimOptions = ["跟随玩家", "主世界 (overworld)", "下界 (nether)", "末地 (the_end)"];

  ModalFormBuilder.showQuick(player, "§l创建模拟玩家", (f) => {
    f.textField("name", "名称（留空自动生成）", { defaultValue: "" })
     .textField("coord", "坐标（留空使用玩家位置）", { defaultValue: "" })
     .dropdown("dim", "维度", dimOptions, { defaultValueIndex: 0 })
     .toggle("copyPosture", "§7复刻玩家体态（同步潜行/朝向）", { defaultValue: true })
     .toggle("respawn", "§7自动重生", { defaultValue: true })
     .toggle("idle", "§7空闲状态", { defaultValue: true });
  }).then((vals) => {
    if (!vals) return;
    const botName = (vals.name as string).trim() || generateBotName();
    const parsedCoord = parseCoordinateInput(vals.coord as string);
    const dimIndex = vals.dim as number;
    const copyPosture = vals.copyPosture as boolean;

    let targetDim = player.dimension;
    if (dimIndex === 1) targetDim = world.getDimension("overworld");
    else if (dimIndex === 2) targetDim = world.getDimension("nether");
    else if (dimIndex === 3) targetDim = world.getDimension("the_end");

    const pos: Vector3 = parsedCoord ?? player.location;
    const initTags: string[] = [TAG_BOT.value];
    if (vals.respawn) initTags.push(TAG_RESPAWN.value);
    if (vals.idle) initTags.push(TAG_IDLE.value);

    const playerRot = player.getRotation();
    const lookTarget = getPlayerLookTarget(player);
    const sneaking = copyPosture ? player.isSneaking : false;

    system.run(() => {
      try {
        createBot({
          name: botName,
          location: pos,
          dimension: targetDim,
          initialTags: initTags,
          rotation: { x: playerRot.x, y: playerRot.y, z: 0 },
          lookTarget: copyPosture ? lookTarget : { x: pos.x, y: pos.y, z: pos.z + 1 },
          isSneaking: sneaking,
        });
        player.sendMessage(`§a成功创建模拟玩家 §e${botName}`);
      } catch (e: any) {
        player.sendMessage(`§c创建模拟玩家失败: ${e.message}`);
      }
    });
  });
}
