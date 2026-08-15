// ─── 创建模拟玩家表单 ───────────────────────────────────

import { Player, system, world, Vector3 } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { PositionState } from "../../model/Types";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE } from "../../tags/BotTags";
import { parseCoordinateInput } from "../../coords/Coordinate";
import { getPlayerLookTarget } from "../adapters/PoseGateway";
import { createBot } from "../features/createBot";

export function showCreateForm(player: Player): void {
  const dimOptions = ["跟随玩家", "主世界 (overworld)", "下界 (nether)", "末地 (the_end)"];

  ModalFormBuilder.showQuick(player, `${color.bold}创建模拟玩家`, (f) => {
    f.textField("name", "名称（必填，不能留空）", { defaultValue: "", tooltip: "输入假人名称；名字将以玩家身份出现在世界中，需唯一" })
     .textField("coord", "坐标（留空使用玩家位置）", { defaultValue: "", tooltip: "格式: x y z，留空则生成在玩家当前位置" })
     .dropdown("dim", "维度", dimOptions, { defaultValueIndex: 0, tooltip: "假人所在的维度，跟随玩家则为当前维度" })
      .toggle("copyPosture", style("复刻玩家体态（同步潜行/朝向）", color.playerName), { defaultValue: true, tooltip: "创建时复制玩家的潜行和面向方向" })
      .toggle("respawn", style("自动重生", color.playerName), { defaultValue: true, tooltip: "开启后假人死亡会自动复活到重生点" })
      .toggle("idle", style("空闲状态", color.playerName), { defaultValue: true, tooltip: "开启后假人默认处于空闲状态，不执行任何行为" })
      .toggle("chunkload", style("强加载模式", color.playerName), { defaultValue: false, tooltip: "区块持续加载，但不可设置身体朝向。异地上线需玩家靠近后补足模拟距离" });
  }).then((vals) => {
    if (!vals) return;
    const botName = (vals.name as string).trim();
    if (!botName) {
      player.sendMessage(`${color.error}请输入假人名称（不能留空）`);
      return;
    }
    const coordResult = parseCoordinateInput(vals.coord as string, player.location);
    const dimIndex = vals.dim as number;
    const copyPosture = vals.copyPosture as boolean;

    let targetDim = player.dimension;
    if (dimIndex === 1) targetDim = world.getDimension("overworld");
    else if (dimIndex === 2) targetDim = world.getDimension("nether");
    else if (dimIndex === 3) targetDim = world.getDimension("the_end");

    // 坐标解析失败（非空但格式错误）→ 提示用户并原地创建
    let pos: Vector3;
    if (coordResult.ok) {
      pos = coordResult.pos;
    } else {
      pos = player.location;
      if (coordResult.reason === "invalid") {
        player.sendMessage(`${color.warn}坐标解析失败：${coordResult.message}，已在原地创建`);
      }
    }
    const initTags: string[] = [TAG_BOT.value];
    if (vals.respawn) initTags.push(TAG_RESPAWN.value);
    if (vals.idle) initTags.push(TAG_IDLE.value);

    const playerRot = player.getRotation();
    const lookTarget = getPlayerLookTarget(player);
    const sneaking = copyPosture ? player.isSneaking : false;

    system.run(async () => {
      try {
        await createBot({
          name: botName,
          ownerName: player.name,
          location: pos,
          dimension: targetDim,
          initialTags: initTags,
          rotation: { x: playerRot.x, y: playerRot.y, z: 0 },
          lookTarget: copyPosture ? lookTarget : { x: pos.x, y: pos.y, z: pos.z + 1 },
          isSneaking: sneaking,
          spawnMode: vals.chunkload ? "chunkload" : "normal",
        });
        player.sendMessage(`${color.success}成功创建模拟玩家 ${color.playerName}${botName}`);
      } catch (e: any) {
        player.sendMessage(`${color.error}创建模拟玩家失败: ${e.message}`);
      }
    });
  });
}
