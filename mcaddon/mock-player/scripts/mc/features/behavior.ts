// ─── 标签行为引擎（mc 层） ──────────────────────────────
// 按标签驱动假人的自动行为，单个 runInterval 查询后分发
// 同时承载位置/经验/装备的周期持久化（100tick ≈ 5秒）
// 因为装备栏没有对应的事件，只能轮询兜底
//
// 互斥标签：autoMine / autoPlace / autoAttack / control / idle / autoUse / vaultMode
// 各行为通过实体标签查询筛选，确保互斥生效

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, inventoryStorage, saveCoordinator } from "../bootstrap/context";
import { BOT_TAG, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_CONTROL } from "../../tags/BotTags";
import { EQUIP_SLOT_NAMES } from "../../model/Types";
import { captureExperience } from "../adapters/McItemCodec";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "../adapters/PoseGateway";

// ─── 启动引擎 ──────────────────────────────────────────
// 单 runInterval 1tick 轮询，通过 tick 计数控制各行为频次
// 相比每个行为独立 runInterval 减少 6 次 world.getPlayers 调用

export function startTagBehaviors(): void {
  let tick = 0;

  system.runInterval(() => {
    tick++;
    const bots = world.getPlayers({ tags: [BOT_TAG] });

    // ── 状态清理收集（每 40 tick；复用主循环的 bots，避免第二次全量 getPlayers） ──
    const collectState = tick % 40 === 0;
    const miningIds = collectState ? new Set<string>() : undefined;
    const placingIds = collectState ? new Set<string>() : undefined;

    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;

      const sim = bot as SimulatedPlayer;

      // ── 状态清理收集 ──
      if (collectState) {
        if (bot.hasTag(TAG_AUTO_MINE.value)) miningIds!.add(bot.id);
        if (bot.hasTag(TAG_AUTO_PLACE.value)) placingIds!.add(bot.id);
      }

      // ── 自动挖掘 ── 每 1 tick ──
      if (bot.hasTag(TAG_AUTO_MINE.value)) {
        try {
          const hit = sim.getBlockFromViewDirection({ maxDistance: 6 });
          if (hit) sim.breakBlock(hit.block.location, hit.face);
        } catch (e: any) { console.warn(`[MockPlayer] 自动挖掘异常 ${bot.name}: ${e?.message ?? e}`); }
      }

      // ── 自动攻击 ── 每 3 tick ──
      if (bot.hasTag(TAG_AUTO_ATTACK.value) && tick % 3 === 0) {
        try { sim.attack(); } catch (e: any) { console.warn(`[MockPlayer] 自动攻击异常 ${bot.name}: ${e?.message ?? e}`); }
      }

      // ── 自动跳跃 ── 每 3 tick ──
      if (bot.hasTag(TAG_AUTO_JUMP.value) && tick % 3 === 0) {
        try { sim.jump(); } catch (e: any) { console.warn(`[MockPlayer] 自动跳跃异常 ${bot.name}: ${e?.message ?? e}`); }
      }

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

      // ── 自动放置 ── 每 5 tick ──
      if (bot.hasTag(TAG_AUTO_PLACE.value) && tick % 5 === 0) {
        try {
          sim.stopBreakingBlock();
          sim.startBuild(0);
          sim.stopBuild();
        } catch (e: any) { console.warn(`[MockPlayer] 自动放置异常 ${bot.name}: ${e?.message ?? e}`); }
      }
    }

    // ── 状态清理 ── 每 40 tick ──
    // 只清理自动挖掘/放置的残留。使用物品是一次性动作（主菜单/行为开关触发），不进此循环。
    // 复用主循环收集的 miningIds/placingIds（不再第二次全量 getPlayers）
    if (collectState) {
      for (const bot of bots) {
        if (!miningIds!.has(bot.id)) { try { (bot as SimulatedPlayer).stopBreakingBlock(); } catch {} }
        if (!placingIds!.has(bot.id)) { try { (bot as SimulatedPlayer).stopBuild(); } catch {} }
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
