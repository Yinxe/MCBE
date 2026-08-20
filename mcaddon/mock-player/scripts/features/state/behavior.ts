// ─── 标签行为引擎（mc 层） ──────────────────────────────
// 按标签驱动假人的自动行为，单个 runInterval 查询后分发
// 同时承载位置/经验/装备的周期持久化（100tick ≈ 5秒）
// 因为装备栏没有对应的事件，只能轮询兜底
//
// 互斥标签：autoMine / autoPlace / autoAttack / control / idle / autoUse / vaultMode
// 各行为通过实体标签查询筛选，确保互斥生效

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, inventoryStorage, saveCoordinator } from "../../bootstrap/context";
import { BotEvents } from "../../events/DomainEvents";
import { BOT_TAG, TAG_CONTROL } from "../../rules/tags/BotTags";
import { EQUIP_SLOT_NAMES } from "../../rules/Types";
import { captureExperience } from "../basic/items/McItemCodec";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "../basic/PoseGateway";

// ─── 启动引擎 ──────────────────────────────────────────
// 单 runInterval 1tick 轮询，通过 tick 计数控制各行为频次
// 相比每个行为独立 runInterval 减少 6 次 world.getPlayers 调用

export function startTagBehaviors(): void {
  let tick = 0;

  system.runInterval(() => {
    tick++;
    const bots = world.getPlayers({ tags: [BOT_TAG] });

    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;

      const sim = bot as SimulatedPlayer;

      // ── 体态控制 ── 每 2 tick ──
      if (bot.hasTag(TAG_CONTROL.value) && tick % 2 === 0) {
        if (record.controllerId) {
          try {
            const controller = world.getEntity(record.controllerId);
            if (controller) {
              sim.teleport(controller.location, { dimension: controller.dimension });
              // 姿态统一应用（setPose 内部 try-catch 防御，位置照常保存）
              const playerRot = (controller as Player).getRotation();
              const lookTarget = getPlayerLookTarget(controller as Player);
              setPose(sim, playerRot, lookTarget);
              savePoseToRecord(record, controller.location, controller.dimension.id, playerRot, lookTarget);
              sim.isSneaking = (controller as Player).isSneaking;
              record.isSneaking = sim.isSneaking;
            }
          } catch (e: any) { console.warn(`[MockPlayer] 体态控制异常 ${bot.name}: ${e?.message ?? e}`); }
        }
      }
    }

    // ── 周期持久化 ── 每 100 tick ──
    // 高频轮询路径全部静默保存（silent），防止每 5 秒刷日志
    if (tick % 100 === 0) {
      for (const entity of bots) {
        const record = botRegistry.get(entity.name);
        if (!record || record.death) continue;
        if (!botRegistry.isRestored(record.name)) continue;
        const bot = entity as Player;
        if (!record.lastPoint) {
          record.lastPoint = { location: bot.location, dimension: bot.dimension.id, rotation: bot.getRotation(), lookTarget: record.respawnPoint.lookTarget };
        } else {
          savePoseToRecord(record, bot.location, bot.dimension.id, bot.getRotation());
        }
        record.isSneaking = bot.isSneaking;
        record.experience = captureExperience(bot);
        saveCoordinator.saveRecord(record, true);
        // 装备兜底：假人可能通过引擎行为（捡起自动穿上等）改变装备而无事件——
        // 复用装备槽快照对比（无变化零写入），事件驱动的安全网
        for (const slotName of EQUIP_SLOT_NAMES) {
          inventoryStorage.handleEquipSlotChanged(bot.name, slotName);
        }
      }
    }
  }, 1);
}

// ─── 工作模式设置（替代旧行为标签 + 劫掠独立开关机制） ──
// 用户拍板：统一「工作模式」单选互斥字段（record.workMode），
// 各驱动引擎按值认领：wander/mine/place/attack/fishing → 生物 AI
// 引擎；raid → 劫掠模块。互斥由单字段天然保证。
// ⚠️ 自动砍树（woodcut）已在代码层禁用（workMode="woodcut" 保留兼容但不再调度）。

/** 工作模式可选值（UI 下拉与各引擎对账共用；woodcut 已禁用） */
export const WORK_MODES = ["none", "wander", "mine", "place", "attack", "raid", "fishing"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** 设置假人工作模式（持久化 + 发布 botWorkModeChanged——驱动模块按值启动/停止） */
export function setWorkMode(record: import("../../rules/Types").BotRecord, mode: WorkMode): void {
  record.workMode = mode;
  saveCoordinator.saveRecord(record);
  BotEvents.botWorkModeChanged.trigger({ botName: record.name, workMode: mode });
}
