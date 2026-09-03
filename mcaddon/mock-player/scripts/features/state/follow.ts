// ─── 跟随（兼容薄壳——调度已收编任务运行时） ──────────
// 旧 10 tick 共享轮询引擎（followMap + 常驻 runInterval）已由
// flow/tasks/followTask（阶段机，事件驱动独立调度）替代：
//   - 跟随目标持久化 record.followTargetId/followTargetName（重启恢复）
//   - 启停 = setWorkMode("follow"/"none") → 任务运行时对账启动/停止
//   - 注视/近距守候/超距放弃/目标离线自然完成 → 全在 followTask
//   - trident 投掷暂停 → pauseFollowTask/resumeFollowTask（任务自旋）
// 本文件只留兼容门面（Bot 门面/命令/UI 旧调用点），语义 = 设置目标 + 切模式。

import { world, type Player } from "@minecraft/server";

import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { setWorkMode } from "./behavior";
import { pauseFollowTask, resumeFollowTask, isFollowPaused } from "../flow/tasks/followTask";

/**
 * 让假人开始跟随目标玩家（兼容门面）：写入跟随目标 + 切 workMode="follow"
 * （任务运行时事件驱动启动 followTask 协程）。
 * @returns 是否成功（记录不存在 → false）
 */
export function startFollow(botName: string, targetId: string): boolean {
  const record = botRegistry.get(botName);
  if (!record) return false;
  const target = world.getEntity(targetId) as Player | undefined;
  record.followTargetId = targetId;
  record.followTargetName = target?.name; // 实体 ID 失效时按名兜底重找
  saveCoordinator.saveRecord(record);
  setWorkMode(record, "follow");
  return true;
}

/**
 * 停止假人跟随（兼容门面）：切 workMode="none"（任务运行时取消令牌收尾）
 * + 清跟随目标 + 清暂停标志。
 */
export function stopFollow(botName: string): void {
  const record = botRegistry.get(botName);
  if (record) {
    record.followTargetId = undefined;
    record.followTargetName = undefined;
    setWorkMode(record, "none");
  }
  resumeFollowTask(botName); // 清残留暂停标志（幂等）
}

/**
 * 检查假人是否正在跟随（workMode 判定 + 目标在册）。
 */
export function isFollowing(botName: string): boolean {
  const record = botRegistry.get(botName);
  return record?.workMode === "follow" && !!record.followTargetId;
}

/** 暂停全部跟随中假人的跟随任务（trident 投掷期；任务自旋等待不寻路） */
export function pauseFollow(): void {
  for (const record of botRegistry.all()) {
    if (record.workMode === "follow" && record.online) pauseFollowTask(record.name);
  }
}

/** 恢复全部暂停的跟随任务 */
export function resumeFollow(): void {
  for (const record of botRegistry.all()) {
    if (record.workMode === "follow") resumeFollowTask(record.name);
  }
}

/** 某假人跟随是否暂停中（透传任务协作标志查询） */
export function isFollowTaskPaused(botName: string): boolean {
  return isFollowPaused(botName);
}

// ─── UI 事件订阅（行为菜单提交：跟随目标 = 操作者） ─────

import { system } from "@minecraft/server";
import { BotUiEvent } from "../../events/UiEvents";

export function registerUiSubscriptions(): void {
  // 行为菜单提交：workMode="follow" → 目标 = 操作玩家（写 record 供
  // followTask 消费）；切走 follow → 清跟随目标（stopFollow 兼容语义）。
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    if (e.workMode !== "follow") {
      // 从跟随切走：清目标字段（任务运行时随 workMode 变更自然停止）
      const rec = botRegistry.get(e.botName);
      if (rec?.followTargetId) {
        rec.followTargetId = undefined;
        rec.followTargetName = undefined;
        saveCoordinator.saveRecord(rec, true);
      }
      return;
    }
    system.run(() => {
      const player = world.getEntity(e.playerId) as Player | undefined;
      if (!player) return;
      const record = botRegistry.get(e.botName);
      if (!record) return;
      record.followTargetId = player.id;
      record.followTargetName = player.name;
      saveCoordinator.saveRecord(record);
      player.sendMessage(`§a§l${e.botName}§r§a 正在跟随你`);
    });
  });
}

