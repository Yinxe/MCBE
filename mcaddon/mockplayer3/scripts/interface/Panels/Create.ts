// ─── 创建表单 ───
// 表单与命令的成功文案各自独立，勿合并；坐标解析失败不阻断原地创建。
// 体态复刻=潜行+朝向；创建后立即上线。

import { system, world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import { parseCoordString } from "../../domain/Coords";
import { uiViewer } from "../Kit";
import { services } from "../../Composition";

export function showCreateForm(player: Player): void {
  const viewer = uiViewer(player);
  void ModalFormBuilder.showQuick(player, `${color.bold}创建模拟玩家`, (f) => {
    f.textField("name", "名称（必填，不能留空）", {
      defaultValue: "",
      tooltip: "输入假人名称；名字将以玩家身份出现在世界中，需唯一",
    });
    f.textField("coord", "坐标（留空使用玩家位置）", {
      defaultValue: "",
      tooltip: "格式: x y z，留空则生成在玩家当前位置",
    });
    f.dropdown("dim", "维度", ["跟随玩家", "主世界 (overworld)", "下界 (nether)", "末地 (the_end)"], {
      defaultValueIndex: 0,
      tooltip: "假人所在的维度，跟随玩家则为当前维度",
    });
    f.toggle("copyPosture", style("复刻玩家体态（同步潜行/朝向）", color.playerName), {
      defaultValue: true,
      tooltip: "创建时复制玩家的潜行和面向方向",
    });
    f.toggle("respawn", style("自动重生", color.playerName), {
      defaultValue: true,
      tooltip: "开启后假人死亡会自动复活到重生点",
    });
  }).then((vals) => {
    if (!vals) return;
    const say = (t: string) => trySendMessage(player, t);
    const botName = String(vals.name ?? "").trim();
    if (!botName) {
      say(`${color.error}请输入假人名称（不能留空）`);
      return;
    }
    const coordRaw = String(vals.coord ?? "").trim();
    let position = player.location;
    if (coordRaw) {
      const r = parseCoordString(coordRaw, player.location);
      if (r.error || !r.value) {
        say(`${color.warn}坐标解析失败：${r.error ?? "格式错误"}，已在原地创建`);
      } else {
        position = r.value;
      }
    }
    let dimensionId = player.dimension.id;
    const dimIdx = Number(vals.dim) || 0;
    if (dimIdx >= 1) {
      const ids = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
      try {
        dimensionId = world.getDimension(ids[dimIdx - 1]).id;
      } catch {
        say(`${color.error}维度无效，已改用玩家当前维度`);
      }
    }
    const copyPosture = Boolean(vals.copyPosture);
    const rot = player.getRotation();
    const yaw = copyPosture ? rot.y : 0;
    const pitch = copyPosture ? rot.x : 0;
    const sneaking = copyPosture ? player.isSneaking : false;

    void system.run(async () => {
      const { lifecycle } = services;
      const created = lifecycle.create(viewer, botName, { position, yaw, pitch }, dimensionId);
      if (!created.ok) {
        say(`${color.error}${created.reason}`);
        return;
      }
      if (created.botId === undefined) {
        say(`${color.error}建档回执异常（缺少 botId）`);
        return;
      }
      lifecycle.setSwitch(created.botId, "autoRespawn", Boolean(vals.respawn));
      if (sneaking) lifecycle.setSwitch(created.botId, "sneaking", true);
      const on = await lifecycle.online(viewer, created.botId);
      system.run(() =>
        say(
          on.ok
            ? `${color.success}成功创建模拟玩家 ${color.playerName}${created.name ?? botName}`
            : `${color.error}模拟玩家 ${color.playerName}${created.name ?? botName} ${color.error}已建档但上线失败: ${on.reason ?? "unknown"}`
        )
      );
    });
  });
}
