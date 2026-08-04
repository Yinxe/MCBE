// ─── 自定义命令配置构建器（defineCommand 的 CustomCommand 入参） ──
import { CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";

/** 区域命令：ir:xxx <名称> <x1> <y1> <z1> <x2> <y2> <z2> */
export function regionCommand(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "x1", type: CustomCommandParamType.Integer },
      { name: "y1", type: CustomCommandParamType.Integer },
      { name: "z1", type: CustomCommandParamType.Integer },
      { name: "x2", type: CustomCommandParamType.Integer },
      { name: "y2", type: CustomCommandParamType.Integer },
      { name: "z2", type: CustomCommandParamType.Integer },
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