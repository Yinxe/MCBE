// ─── 潜行 ──────────────────────────────────────────────

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { ActionError, describeError } from "../../errors";
import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { syncEntityTags } from "./EntityTags";
import { runActionNextTick } from "../utils";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";

/**
 * 切换假人潜行（record 落库 + 实体同步 + 标签刷新）。
 * 微动作：system.run 推迟到下一 tick 执行实体同步；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError（record.isSneaking 已写，实体同步失败时
 * 调用方按需回滚或重试）。
 * @param record 假人记录
 * @param sneaking 目标潜行态
 * @returns 成功 resolve(true)
 * @throws ActionError 实体解析/标签同步失败（failed）；持久化失败（failed）
 */
export function setSneaking(record: BotRecord, sneaking: boolean): Promise<boolean> {
  record.isSneaking = sneaking;

  if (record.online) {
    return runActionNextTick(() => {
      const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
      if (entity && entity.hasTag(BOT_TAG)) {
        (entity as SimulatedPlayer).isSneaking = sneaking;
        syncEntityTags(entity, record.tags);
      }
    }, `同步假人潜行状态失败（${record.name}）`).then(() => {
      saveCoordinator.saveRecord(record);
      return true;
    });
  }

  try {
    saveCoordinator.saveRecord(record);
  } catch (e: unknown) {
    return Promise.reject(new ActionError("failed", `潜行状态持久化失败（${record.name}）`, e));
  }
  return Promise.resolve(true);
}

// ─── UI 事件订阅（行为菜单提交 → 感知潜行字段） ────────

/** 订阅行为菜单提交事件：潜行开关 diff 后同步 */
export function registerUiSubscriptions(): void {
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    const record = botRegistry.get(e.botName);
    if (!record || record.isSneaking === e.sneaking) return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    system.run(() => {
      setSneaking(record, e.sneaking).catch((err: unknown) => {
        console.warn(`[MockPlayer] 切换潜行失败: ${describeError(err)}`);
        player?.sendMessage(`${color.error}切换潜行失败: ${describeError(err)}`);
      });
    });
  });
}
