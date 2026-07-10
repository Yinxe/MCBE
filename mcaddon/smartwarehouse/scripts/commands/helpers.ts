import { Player, CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";
import type { WarehouseId } from "../types";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";
import { canManageWarehouse } from "../util/PlayerAuth";

export function requireOp(player: Player): boolean {
  if (!canManageWarehouse(player)) {
    player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）");
    return false;
  }
  return true;
}

export function parseId(raw: string): { ok: true; id: WarehouseId } | { ok: false; message: string } {
  try { return { ok: true, id: normalizeWarehouseId(raw) }; }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "无效的仓库名称" }; }
}

export function msg(player: Player, text: string): void {
  try { player.sendMessage(text); } catch { }
}

export function cmdBase(name: string, desc: string): Omit<CustomCommand, "mandatoryParameters"> {
  return { name, description: desc, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false };
}

export function regionCmd(name: string, desc: string): CustomCommand {
  return {
    ...cmdBase(name, desc),
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "pos1", type: CustomCommandParamType.Location },
      { name: "pos2", type: CustomCommandParamType.Location },
    ],
  };
}

export function nameCmd(name: string, desc: string): CustomCommand {
  return {
    ...cmdBase(name, desc),
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  };
}
