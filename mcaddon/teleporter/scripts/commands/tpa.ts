import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandParamType,
  Player,
} from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import {
  TeleportRequest,
  TeleportRequestType,
  TELEPORT_REQUEST_TIMEOUT_MS,
} from "../teleporter/types";

// ─── 传送请求管理 ──────────────────────────────────────────────────

const pendingRequests = new Map<string, TeleportRequest>();

/**
 * 创建传送请求。
 * 如果该目标已有未处理的请求，通知旧请求方被覆盖。
 */
function createRequest(
  fromId: string,
  fromName: string,
  toId: string,
  type: TeleportRequestType,
): void {
  // 清理发送方自己的旧请求
  for (const [key, req] of pendingRequests) {
    if (req.toId === toId && req.fromId === fromId) {
      pendingRequests.delete(key);
    }
  }

  // 如果目标已有来自其他人的请求，通知旧请求方被覆盖
  const existing = pendingRequests.get(toId);
  if (existing) {
    const oldRequester = world.getEntity(existing.fromId) as Player | undefined;
    if (oldRequester) {
      oldRequester.sendMessage(`§6你的传送请求已被 §e${fromName}§6 的新请求覆盖`);
    }
    pendingRequests.delete(toId);
  }

  const request: TeleportRequest = {
    fromId,
    fromName,
    toId,
    type,
    createdAt: Date.now(),
  };
  pendingRequests.set(toId, request);

  system.runTimeout(() => {
    if (pendingRequests.has(toId) && pendingRequests.get(toId)!.createdAt === request.createdAt) {
      pendingRequests.delete(toId);
    }
  }, Math.ceil(TELEPORT_REQUEST_TIMEOUT_MS / 50));
}

/** @internal 导出供 UI 模块使用 */
export function findPendingRequest(playerId: string): TeleportRequest | undefined {
  cleanExpiredRequests();
  return pendingRequests.get(playerId);
}

/** @internal 执行接受请求逻辑 */
export function acceptRequest(player: Player, request: TeleportRequest): boolean {
  pendingRequests.delete(player.id);
  const requester = world.getEntity(request.fromId) as Player | undefined;
  if (!requester) {
    player.sendMessage("§c请求方已不在游戏中");
    return false;
  }

  if (request.type === "tpa") {
    const loc = formatLocation(player.location, player.dimension.id);
    const ok = teleportPlayerTo(requester, player.location, player.dimension.id);
    if (ok) {
      requester.sendMessage(`§a请求被接受，已传送到 §e${player.name}§a 身边 §6（${loc}§6）`);
      player.sendMessage(`§a已接受 §e${requester.name}§a 的传送请求`);
    } else {
      player.sendMessage("§c传送失败，请稍后重试");
      requester.sendMessage("§c传送失败，目标位置可能未加载");
    }
    return ok;
  } else {
    const loc = formatLocation(requester.location, requester.dimension.id);
    const ok = teleportPlayerTo(player, requester.location, requester.dimension.id);
    if (ok) {
      requester.sendMessage(`§e${player.name} §a已传送到你身边 §6（${loc}§6）`);
      player.sendMessage(`§a已接受 §e${requester.name}§a 的传送请求，传送到他身边`);
    } else {
      player.sendMessage("§c传送失败，请稍后重试");
      requester.sendMessage("§c传送失败，目标位置可能未加载");
    }
    return ok;
  }
}

/** @internal 执行拒绝请求逻辑 */
export function denyRequest(player: Player, request: TeleportRequest): void {
  pendingRequests.delete(player.id);
  const requester = world.getEntity(request.fromId) as Player | undefined;
  if (requester) {
    requester.sendMessage(`§e${player.name} §c拒绝了你的传送请求`);
  }
  player.sendMessage(`§c已拒绝 §e${request.fromName}§c 的传送请求`);
}

function cleanExpiredRequests(): void {
  const now = Date.now();
  for (const [key, req] of pendingRequests) {
    if (now - req.createdAt > TELEPORT_REQUEST_TIMEOUT_MS) {
      pendingRequests.delete(key);
    }
  }
}

// ─── 命令注册 ──────────────────────────────────────────────────────

export function registerTpaCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:tpa",
    description: "请求传送到指定玩家身边",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "player", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const targetName = params.player as string;
    const target = findOnlinePlayer(targetName);
    if (!target) {
      player.sendMessage(`§c未找到在线玩家 §e${targetName}`);
      return;
    }
    if (target.id === player.id) {
      player.sendMessage("§c不能向自己发送传送请求");
      return;
    }

    createRequest(player.id, player.name, target.id, "tpa");
    target.sendMessage(
      `§e§l${player.name} §r§a请求传送到你身边 §6（60秒有效）\n` +
      `§f▸ §f/tpa:tpaccept §f接受  §f/tpa:tpadeny §f拒绝\n` +
      `§f你当前在: ${formatLocation(target.location, target.dimension.id)}`,
    );
    player.sendMessage(`§a已向 §e${target.name} §a发送传送请求 §6（等待对方接受，60秒超时）`);
  });
}

export function registerTpHereCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:tphere",
    description: "请求指定玩家传送到自己身边",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "player", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const targetName = params.player as string;
    const target = findOnlinePlayer(targetName);
    if (!target) {
      player.sendMessage(`§c未找到在线玩家 §e${targetName}`);
      return;
    }
    if (target.id === player.id) {
      player.sendMessage("§c不能向自己发送传送请求");
      return;
    }

    createRequest(player.id, player.name, target.id, "tphere");
    target.sendMessage(
      `§e§l${player.name} §r§a请求你传送到他身边 §6（60秒有效）\n` +
      `§f▸ §f/tpa:tpaccept §f接受  §f/tpa:tpadeny §f拒绝\n` +
      `§f你当前在: ${formatLocation(target.location, target.dimension.id)}`,
    );
    player.sendMessage(`§a已向 §e${target.name} §a发送传送请求 §6（等待对方接受，60秒超时）`);
  });
}

export function registerTpAcceptCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:tpaccept",
    description: "接受传送请求",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    const request = findPendingRequest(player.id);
    if (!request) {
      player.sendMessage("§c你没有任何待处理的传送请求 §6（可能已超时）");
      return;
    }
    acceptRequest(player, request);
  });
}

export function registerTpDenyCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:tpadeny",
    description: "拒绝传送请求",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    const request = findPendingRequest(player.id);
    if (!request) {
      player.sendMessage("§c你没有任何待处理的传送请求 §6（可能已超时）");
      return;
    }
    denyRequest(player, request);
  });
}

// ─── 工具函数 ───────────────────────────────────────────────────────

function findOnlinePlayer(name: string): Player | undefined {
  const allPlayers = world.getAllPlayers();
  const lower = name.toLowerCase();
  return allPlayers.find(
    (p) => p.name.toLowerCase() === lower || p.name === name,
  );
}
