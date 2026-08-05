// ─── 自定义命令配置构建器（defineCommand 的 CustomCommand 入参） ──
import { CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";

/** 区域命令：ir:xxx <名称> <pos1> <pos2>（pos 用 Location 参数，玩家可输坐标或望准方块） */
export function regionCommand(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "pos1", type: CustomCommandParamType.Location },
      { name: "pos2", type: CustomCommandParamType.Location },
    ],
  };
}

/** 按名命令：ir:xxx <名称> */
export function nameCommand(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  };
}

/** 查询命令：ir:xxx <查询关键词> */
export function queryCommand(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
    mandatoryParameters: [{ name: "query", type: CustomCommandParamType.String }],
  };
}

/** 无参命令：ir:xxx */
export function noParamCommand(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
    mandatoryParameters: [],
  };
}