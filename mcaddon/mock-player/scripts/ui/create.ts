// ─── 创建模拟玩家表单 ───────────────────────────────────

import { Player, system, world, Vector3 } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

import { PositionState } from "../features/types";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE } from "../features/tags";
import { getPlayerLookTarget, parseCoordinateInput } from "../features/utils";
import { generateBotName } from "../features/persistence";
import { createBot, CreateBotOptions } from "../features/operations";

export function showCreateForm(player: Player): void {
  const dimOptions = ["跟随玩家", "主世界 (overworld)", "下界 (nether)", "末地 (the_end)"];

  const form = new ModalFormData()
    .title("§l创建模拟玩家")
    .textField("名称（留空自动生成）", "例如 sim001", { defaultValue: "" })
    .textField("坐标（留空使用玩家位置）", "x y z", { defaultValue: "" })
    .dropdown("维度", dimOptions, { defaultValueIndex: 0 })
    .toggle("§7复刻玩家体态（同步潜行/朝向）", { defaultValue: true })
    .toggle("§7自动重生", { defaultValue: true })
    .toggle("§7空闲状态", { defaultValue: true });

  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;

    const nameInput = response.formValues[0] as string;
    const coordInput = response.formValues[1] as string;
    const dimIndex = response.formValues[2] as number;
    const copyPosture = response.formValues[3] as boolean;
    const enableRespawn = response.formValues[4] as boolean;
    const enableIdle = response.formValues[5] as boolean;

    const botName = nameInput.trim() || generateBotName();
    const parsedCoord = parseCoordinateInput(coordInput);

    let targetDim = player.dimension;
    if (dimIndex === 1) targetDim = world.getDimension("overworld");
    else if (dimIndex === 2) targetDim = world.getDimension("nether");
    else if (dimIndex === 3) targetDim = world.getDimension("the_end");

    const pos: Vector3 = parsedCoord ?? player.location;
    const initTags: string[] = [TAG_BOT.value];
    if (enableRespawn) initTags.push(TAG_RESPAWN.value);
    if (enableIdle) initTags.push(TAG_IDLE.value);

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
