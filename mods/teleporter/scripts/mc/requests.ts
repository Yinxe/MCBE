// ─── 传送请求的运行期门面 ───────────────────────────────────────
//
// 请求簿本体在 core/requests.ts(纯内存、可测),这里补上「找在线玩家」
// 「发提示」「执行传送」这些必须碰 @minecraft 的部分。

import { system, world, type Player } from "@minecraft/server";
import { TeleportRequestBook } from "../core/requests";
import { formatLocation } from "../core/naming";
import {
  TELEPORT_REQUEST_TIMEOUT_MS,
  type TeleportRequest,
  type TeleportRequestType,
} from "../core/types";
import { notifyError, notifySuccess } from "@mc-toolchain/mod-common";
import { teleportPlayerTo } from "./teleport";

/** 全局唯一的请求簿。模组只有一个世界实例,无需多份。 */
const book = new TeleportRequestBook(TELEPORT_REQUEST_TIMEOUT_MS);

/** 按名字找在线玩家,大小写不敏感。 */
export function findOnlinePlayerByName(name: string): Player | undefined {
  const target = name.toLowerCase();
  const players = world.getAllPlayers();
  for (const player of players) {
    if (player.name.toLowerCase() === target) return player;
  }
  return undefined;
}

/** 按 ID 找在线玩家。 */
export function findOnlinePlayerById(playerId: string): Player | undefined {
  const players = world.getAllPlayers();
  for (const player of players) {
    if (player.id === playerId) return player;
  }
  return undefined;
}

/** 读取某个玩家当前的待处理请求。 */
export function getPendingRequest(
  playerId: string,
): TeleportRequest | undefined {
  return book.get(playerId);
}

/** 发给玩家看的请求描述。 */
export function describeRequest(request: TeleportRequest): string {
  return request.type === "tpa"
    ? `§e${request.fromName} §a请求传送到你身边`
    : `§e${request.fromName} §a请求你传送到他身边`;
}

/**
 * 创建一条传送请求并通知目标玩家。
 *
 * 若目标原本有别人的请求,旧请求方会收到「已被覆盖」的提示。
 */
export function createTeleportRequest(
  from: Player,
  to: Player,
  type: TeleportRequestType,
): void {
  const result = book.put({
    fromId: from.id,
    fromName: from.name,
    toId: to.id,
    type,
  });

  if (result.overwritten) {
    const previousRequester = findOnlinePlayerById(result.overwritten.fromId);
    if (previousRequester) {
      previousRequester.sendMessage(
        `§6你的传送请求已被 §e${from.name}§6 的新请求覆盖`,
      );
    }
  }

  // 定时清理:到点后若这条请求还在(没被接受/拒绝/覆盖)就删掉
  const request = result.request;
  system.runTimeout(
    () => {
      const current = book.get(to.id);
      if (current && current.createdAt === request.createdAt) {
        book.remove(to.id);
      }
    },
    Math.ceil(TELEPORT_REQUEST_TIMEOUT_MS / 50),
  );

  to.sendMessage(
    `§e§l${from.name} §r§a${type === "tpa" ? "请求传送到你身边" : "请求你传送到他身边"} §6（60秒有效）\n` +
      `§f▸ §f/tpa:tpaccept §f接受  §f/tpa:tpadeny §f拒绝\n` +
      `§f你当前在: ${formatLocation(to.location, to.dimension.id)}`,
  );
}

/**
 * 接受请求并执行传送。
 *
 * @returns 是否成功传送
 */
export function acceptTeleportRequest(
  player: Player,
  request: TeleportRequest,
): boolean {
  book.remove(player.id);

  const requester = findOnlinePlayerById(request.fromId);
  if (!requester) {
    notifyError(player, "请求方已不在游戏中");
    return false;
  }

  if (request.type === "tpa") {
    // 请求方来到目标身边
    const targetLocation = formatLocation(player.location, player.dimension.id);
    const ok = teleportPlayerTo(
      requester,
      player.location,
      player.dimension.id,
    );
    if (ok) {
      notifySuccess(
        requester,
        `请求被接受,已传送到 §e${player.name}§a 身边 §6（${targetLocation}§6）`,
      );
      notifySuccess(player, `已接受 §e${requester.name}§a 的传送请求`);
    } else {
      notifyError(player, "传送失败,请稍后重试");
      notifyError(requester, "传送失败,目标位置可能未加载");
    }
    return ok;
  }

  // 目标来到请求方身边
  const requesterLocation = formatLocation(
    requester.location,
    requester.dimension.id,
  );
  const ok = teleportPlayerTo(
    player,
    requester.location,
    requester.dimension.id,
  );
  if (ok) {
    notifySuccess(
      requester,
      `§e${player.name} §a已传送到你身边 §6（${requesterLocation}§6）`,
    );
    notifySuccess(
      player,
      `已接受 §e${requester.name}§a 的传送请求,传送到他身边`,
    );
  } else {
    notifyError(player, "传送失败,请稍后重试");
    notifyError(requester, "传送失败,目标位置可能未加载");
  }
  return ok;
}

/** 拒绝请求并通知请求方。 */
export function denyTeleportRequest(
  player: Player,
  request: TeleportRequest,
): void {
  book.remove(player.id);

  const requester = findOnlinePlayerById(request.fromId);
  if (requester) {
    requester.sendMessage(`§e${player.name} §c拒绝了你的传送请求`);
  }
  player.sendMessage(`§c已拒绝 §e${request.fromName}§c 的传送请求`);
}
