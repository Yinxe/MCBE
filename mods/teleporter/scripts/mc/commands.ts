// ─── 16 条自定义命令的注册 ──────────────────────────────────────
//
// ⚠ 命令回调运行在受限上下文(read-only mode)中:传送、打开界面、写存档、
// 修改背包都会抛 "cannot be called in read-only mode"。
// 因此本文件的回调体只做三件事:解包参数、校验来源、鉴权;真正干活的部分
// 全部交给 @mc-toolchain/mod-common 的 runSafeDetached,由它推迟到安全 tick 执行。
// 详见 docs/research/read-only-context.md。
//
// 本文件刻意不出现 system.run:推迟只由执行助手承担,避免双层包裹。

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandSource,
  CustomCommandStatus,
  type CustomCommand,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type CustomCommandResult,
  type Player,
} from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { listDeathPoints } from "../core/deathPoints";
import { dimensionDisplayName, formatLocation } from "../core/naming";
import { isAdmin } from "./detection";
import {
  acceptTeleportRequest,
  createTeleportRequest,
  denyTeleportRequest,
  findOnlinePlayerByName,
  getPendingRequest,
} from "./requests";
import { loadConfig, loadPlayerData } from "./store";
import { teleportToSavedPoint } from "./teleport";
import { giveTeleportToken } from "./token";
import { showAdminConfig } from "./ui/admin";
import { showDeathPointsList } from "./ui/deathPoints";
import { showMainMenu } from "./ui/menu";
import { showPublicWarpsList } from "./ui/publicWarps";
import { showWarpSelector } from "./ui/warps";
import {
  createWarpAtPlayer,
  deleteWaypointByName,
  switchWaypointPublic,
  warpToWaypointByName,
} from "./warpService";

/** 命令回调拿到的已解包上下文。 */
interface CommandContext {
  player: Player;
  params: Record<string, unknown>;
}

/** 命令注册配置。参数名顺序即位置参数顺序。 */
interface CommandSpec {
  name: string;
  description: string;
  mandatory?: string[];
  optional?: string[];
}

/**
 * 注册一条只允许玩家执行的命令。
 *
 * 与上游 @yinxe/toolkit 的 defineCommand 的行为对齐:
 *   1. 把位置参数按名字解包成 params
 *   2. 非玩家来源(控制台、命令方块)直接失败,不进入业务逻辑
 *   3. 业务逻辑推迟到安全 tick 执行
 *
 * 与上游的差异:业务逻辑抛出的异常会被记录到控制台而不是变成未处理的
 * Promise 拒绝(runSafeDetached 的错误处理约定)。
 */
function registerPlayerCommand(
  registry: CustomCommandRegistry,
  spec: CommandSpec,
  handler: (context: CommandContext) => void | Promise<void>,
): void {
  const parameterNames = (spec.mandatory ?? []).concat(spec.optional ?? []);

  const command: CustomCommand = {
    name: spec.name,
    description: spec.description,
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  };

  if (spec.mandatory && spec.mandatory.length > 0) {
    command.mandatoryParameters = spec.mandatory.map((name) => ({
      name,
      type: CustomCommandParamType.String,
    }));
  }

  if (spec.optional && spec.optional.length > 0) {
    command.optionalParameters = spec.optional.map((name) => ({
      name,
      type: CustomCommandParamType.String,
    }));
  }

  registry.registerCommand(
    command,
    (origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult => {
      const player = resolvePlayer(origin);
      if (!player) {
        return {
          status: CustomCommandStatus.Failure,
          message: "该命令只能由玩家执行",
        };
      }

      const params: Record<string, unknown> = {};
      for (let index = 0; index < parameterNames.length; index += 1) {
        params[parameterNames[index] as string] = args[index];
      }

      runSafeDetached(() => handler({ player, params }));
      return { status: CustomCommandStatus.Success };
    },
  );
}

/**
 * 从命令来源里取出玩家。
 *
 * 只有 Entity 来源且实体确实是玩家时才算数;命令方块与控制台返回 undefined。
 */
function resolvePlayer(origin: CustomCommandOrigin): Player | undefined {
  if (origin.sourceType !== CustomCommandSource.Entity) return undefined;
  const entity = origin.sourceEntity;
  if (!entity) return undefined;
  if (entity.typeId !== "minecraft:player") return undefined;
  return entity as Player;
}

/** 把参数值当可选字符串读出来;空串视为未提供。 */
function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** 注册全部 16 条命令。 */
export function registerAllCommands(registry: CustomCommandRegistry): void {
  registerMenuCommands(registry);
  registerWarpCommands(registry);
  registerDeathAndBackCommands(registry);
  registerPlayerTeleportCommands(registry);
  registerPublicCommands(registry);
  registerAdminCommands(registry);
  registerTokenCommand(registry);
}

/** 主菜单。 */
function registerMenuCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    { name: "tpa:menu", description: "打开传送管理菜单" },
    ({ player }) => showMainMenu(player),
  );
}

/** 传送点的增删查与传送。 */
function registerWarpCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    {
      name: "tpa:warp",
      description: "传送到指定传送点(不带名称则打开选择界面)",
      optional: ["name"],
    },
    ({ player, params }) => {
      const name = asOptionalString(params.name);
      if (!name) return showWarpSelector(player);
      warpToWaypointByName(player, name);
    },
  );

  registerPlayerCommand(
    registry,
    {
      name: "tpa:setwarp",
      description: "在当前位置设置传送点",
      mandatory: ["name"],
    },
    ({ player, params }) => {
      const name = asOptionalString(params.name);
      if (!name) {
        player.sendMessage("§c传送点名称不能为空");
        return;
      }

      const outcome = createWarpAtPlayer(player, name);
      if (!outcome.ok) {
        player.sendMessage(outcome.error);
        return;
      }
      player.sendMessage(
        `§a已创建传送点 §e${name} §6(${formatLocation(player.location, player.dimension.id)}§6)`,
      );
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:delwarp", description: "删除指定传送点", mandatory: ["name"] },
    ({ player, params }) => {
      const name = asOptionalString(params.name);
      if (!name) {
        player.sendMessage("§c请指定要删除的传送点名称");
        return;
      }
      deleteWaypointByName(player, name);
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:warps", description: "打开传送点选择界面" },
    ({ player }) => showWarpSelector(player),
  );
}

/** 回传与死亡点。 */
function registerDeathAndBackCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    { name: "tpa:back", description: "传送到最近的死亡点" },
    ({ player }) => {
      const points = listDeathPoints(loadPlayerData(player.id));
      const latest = points[0];
      if (!latest) {
        player.sendMessage("§c没有找到死亡记录");
        return;
      }
      teleportToSavedPoint(
        player,
        "最近的死亡点",
        latest.location,
        latest.dimensionId,
      );
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:deathpoints", description: "查看并传送至死亡点" },
    ({ player }) => showDeathPointsList(player),
  );
}

/** 玩家间传送的四个命令。 */
function registerPlayerTeleportCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    {
      name: "tpa:tpa",
      description: "请求传送到指定玩家身边",
      mandatory: ["player"],
    },
    ({ player, params }) => {
      const targetName = asOptionalString(params.player);
      if (!targetName) {
        player.sendMessage("§c请指定玩家名");
        return;
      }
      requestTeleportToPlayer(player, targetName, "tpa");
    },
  );

  registerPlayerCommand(
    registry,
    {
      name: "tpa:tphere",
      description: "请求指定玩家传送到自己身边",
      mandatory: ["player"],
    },
    ({ player, params }) => {
      const targetName = asOptionalString(params.player);
      if (!targetName) {
        player.sendMessage("§c请指定玩家名");
        return;
      }
      requestTeleportToPlayer(player, targetName, "tphere");
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:tpaccept", description: "接受传送请求" },
    ({ player }) => {
      const request = getPendingRequest(player.id);
      if (!request) {
        player.sendMessage("§c你没有任何待处理的传送请求 §6(可能已超时)");
        return;
      }
      acceptTeleportRequest(player, request);
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:tpadeny", description: "拒绝传送请求" },
    ({ player }) => {
      const request = getPendingRequest(player.id);
      if (!request) {
        player.sendMessage("§c你没有任何待处理的传送请求 §6(可能已超时)");
        return;
      }
      denyTeleportRequest(player, request);
    },
  );
}

/** 公共传送点。 */
function registerPublicCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    {
      name: "tpa:public",
      description: "切换传送点是否公开",
      mandatory: ["name"],
    },
    ({ player, params }) => {
      const name = asOptionalString(params.name);
      if (!name) {
        player.sendMessage("§c请指定传送点名称");
        return;
      }
      switchWaypointPublic(player, name);
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:publiclist", description: "查看所有公共传送点" },
    ({ player }) => showPublicWarpsList(player),
  );
}

/** 管理员命令。两条都需要鉴权。 */
function registerAdminCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    { name: "tpa:admin", description: "传送模组管理配置(需要 OP 或 op 标签)" },
    ({ player }) => {
      if (!isAdmin(player)) {
        player.sendMessage("§c你没有权限执行此命令");
        return;
      }
      return showAdminConfig(player);
    },
  );

  registerPlayerCommand(
    registry,
    { name: "tpa:config", description: "查看当前模组配置(需要 OP 或 op 标签)" },
    ({ player }) => {
      if (!isAdmin(player)) {
        player.sendMessage("§c你没有权限执行此命令");
        return;
      }
      printConfig(player);
    },
  );
}

/** 信物。 */
function registerTokenCommand(registry: CustomCommandRegistry): void {
  registerPlayerCommand(
    registry,
    { name: "tpa:token", description: "获得传送信物(右键打开传送菜单)" },
    ({ player }) => giveTeleportToken(player),
  );
}

/** 向在线玩家发起传送请求。 */
function requestTeleportToPlayer(
  player: Player,
  targetName: string,
  type: "tpa" | "tphere",
): void {
  const target = findOnlinePlayerByName(targetName);
  if (!target) {
    player.sendMessage(`§c未找到在线玩家 §e${targetName}`);
    return;
  }
  if (target.id === player.id) {
    player.sendMessage("§c不能向自己发送传送请求");
    return;
  }

  createTeleportRequest(player, target, type);
  player.sendMessage(
    `§a已向 §e${target.name} §a发送传送请求 §6(等待对方接受,60秒超时)`,
  );
}

/** 打印当前配置。 */
function printConfig(player: Player): void {
  const config = loadConfig();
  player.sendMessage("§b===== 传送模组配置 =====");
  player.sendMessage(`§6单人最大传送点: §f${config.maxWaypointsPerPlayer}`);
  player.sendMessage(
    `§6公共传送点: ${config.publicWaypointEnabled ? "§a启用" : "§c禁用"}`,
  );
  player.sendMessage(
    `§6当前维度: §f${dimensionDisplayName(player.dimension.id)}`,
  );
  player.sendMessage(
    `§6当前位置: §f${formatLocation(player.location, player.dimension.id)}`,
  );
}
