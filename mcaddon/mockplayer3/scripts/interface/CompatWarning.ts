// ─── 兼容模式提示（interface：装配期写日志 + 玩家入服私信一次） ──────
// 测试维度不可用时进入兼容模式：物品仓改存末地、假人改由模块级函数生成，
// 能力与数据格式不变但存放位置不同，须让玩家当场知道。维度可用时不订阅、不打扰。

import { system, world } from "@minecraft/server";
import { customDimensionFailure } from "../engine/Rig";
import { dimensionFailureNotice } from "../domain/Compat";
import { services } from "../Composition";

/** 入服私信延迟：playerJoin 回调时玩家实体可能尚未就位 */
const WARN_DELAY_TICKS = 40;

/**
 * 安装兼容模式提示（装配末尾调用一次；测试维度可用则直接返回）。
 * 不可用时写一条 warn 日志，并对每个进入世界的玩家私信一次（会话内不重复）。
 * 订阅不持有退订句柄：本会话内锚点不会切换（升级要重启世界），提示要一直有效。
 */
export function installCompatWarning(): void {
  const failure = customDimensionFailure();
  if (!failure) return;
  const notice = dimensionFailureNotice(failure.kind, failure.detail);
  console.warn(`[mockplayer3] 兼容模式：${notice}`);
  const warned = new Set<string>();
  world.afterEvents.playerJoin.subscribe(({ playerName }) => {
    if (warned.has(playerName)) return;
    warned.add(playerName);
    // 私信经通知闸门（玩家可自关）；送达失败不重试，建档命令还会再报一次
    system.runTimeout(() => services.ops.notifyPlayer(playerName, notice, "error"), WARN_DELAY_TICKS);
  });
}
