// ─── 标签行为引擎 ──────────────────────────────────────
// 按标签驱动假人的自动行为，单个 runInterval 查询后分发
// 同时承载位置/经验/装备的周期持久化（100tick ≈ 5秒）
// 因为装备栏没有对应的事件，只能轮询兜底
//
// 互斥标签：autoMine / autoPlace / autoAttack / control / idle / autoUse / vaultMode
// 各行为通过实体标签查询筛选，确保互斥生效

import { EntityEquippableComponent, Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, isBotRestored, saveBotEquipment, saveBotRecord } from "./persistence";
import { BOT_TAG, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_CONTROL, TAG_VAULT_MODE, TAG_RAID_MODE } from "./tags";
import { captureExperience, serializeEquipment } from "./utils";
import { runVaultCycle } from "../vaultMode";
import { runRaidCycle } from "../raidMode";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "./pose";

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
              if (record.spawnMode !== "chunkload") {
                const playerRot = (controller as Player).getRotation();
                const lookTarget = getPlayerLookTarget(controller as Player);
                setPose(sim, playerRot, lookTarget);
                savePoseToRecord(record, controller.location, controller.dimension.id, playerRot, lookTarget);
              } else {
                savePoseToRecord(record, controller.location, controller.dimension.id);
              }
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

      // ── 宝库模式 ── 每 10 tick ──
      if (bot.hasTag(TAG_VAULT_MODE.value) && tick % 10 === 0) {
        try { runVaultCycle(sim, record); } catch (e: any) { console.warn(`[MockPlayer] 宝库模式异常 ${bot.name}: ${e?.message ?? e}`); }
      }

      // ── 劫掠模式 ── 每 10 tick ──
      if (bot.hasTag(TAG_RAID_MODE.value) && tick % 10 === 0) {
        try { runRaidCycle(sim, record); } catch (e: any) { console.warn(`[MockPlayer] 劫掠模式异常 ${bot.name}: ${e?.message ?? e}`); }
      }
    }

    // ── 状态清理 ── 每 40 tick ──
    // 只清理自动挖掘/放置的残留。使用物品是一次性动作（主菜单/行为开关触发），不进此循环。
    if (tick % 40 === 0) {
      const miningIds = new Set<string>();
      const placingIds = new Set<string>();
      for (const bot of world.getPlayers({ tags: [BOT_TAG] })) {
        if (bot.hasTag(TAG_AUTO_MINE.value)) miningIds.add(bot.id);
        if (bot.hasTag(TAG_AUTO_PLACE.value)) placingIds.add(bot.id);
        if (!miningIds.has(bot.id)) { try { (bot as SimulatedPlayer).stopBreakingBlock(); } catch {} }
        if (!placingIds.has(bot.id)) { try { (bot as SimulatedPlayer).stopBuild(); } catch {} }
      }
    }

    // ── 周期持久化 ── 每 100 tick ──
    // 高频轮询路径全部静默保存（silent），防止每 5 秒刷日志
    if (tick % 100 === 0) {
      for (const entity of bots) {
        const record = botRegistry.get(entity.name);
        if (!record || record.death) continue;
        if (!isBotRestored(record.name)) continue;
        const bot = entity as Player;
        if (!record.lastPoint) {
          record.lastPoint = { location: bot.location, dimension: bot.dimension.id, rotation: bot.getRotation(), lookTarget: record.respawnPoint.lookTarget };
        } else {
          savePoseToRecord(record, bot.location, bot.dimension.id, bot.getRotation());
        }
        record.isSneaking = bot.isSneaking;
        record.experience = captureExperience(bot);
        saveBotRecord(record, true);
        const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
        if (equip) saveBotEquipment(bot.name, serializeEquipment(equip), true);
      }
    }
  }, 1);
}
