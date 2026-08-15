// ─── /mp:test — 管理员传送到测试维度 ────────────────────
// 测试维度（mockplayer:test）用于假人装置/存储阵列，管理员调试用。
// 默认传送到 (0, 3, 0)（结构方块在 0,0,0，y=3 为可站立高度），可指定坐标。
// 仅管理员（OP 或配置名单）可用。

import { world, type Vector3 } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";

import { TEST_DIMENSION } from "../features/manage/gametestContext";
import { isAdmin } from "./auth";

export function registerTestCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:test",
    description: "传送到测试维度（默认 0 3 0，可指定坐标）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
  }, ({ player, params }) => {
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}该命令仅管理员可用`);
      return;
    }

    let dimension;
    try {
      dimension = world.getDimension(TEST_DIMENSION);
    } catch {
      player.sendMessage(`${color.error}测试维度不可用（未注册或加载失败）`);
      return;
    }

    const loc = (params.location as Vector3 | undefined) ?? { x: 0, y: 3, z: 0 };
    try {
      player.teleport(loc, { dimension });
      player.sendMessage(`${color.success}已传送到测试维度 (${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)})`);
    } catch (e: any) {
      player.sendMessage(`${color.error}传送失败: ${e?.message ?? e}`);
    }
  });
}
