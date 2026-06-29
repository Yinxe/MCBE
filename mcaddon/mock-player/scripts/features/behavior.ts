// ─── 标签行为引擎 ──────────────────────────────────────
// 按标签驱动假人的自动行为，每个行为独立 runInterval 轮询
// 同时承载位置/经验/装备的周期持久化（100tick ≈ 5秒）
// 因为装备栏没有对应的事件，只能轮询兜底

import { EntityEquippableComponent, Player, system, world } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, isBotRestored, saveBotEquipment, saveBotRecord } from "./persistence";
import { TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_CONTROL } from "./tags";
import { BOT_TAG } from "./types";
import { captureExperience, getPlayerLookTarget, serializeEquipment } from "./utils";

// ─── 启动引擎 ──────────────────────────────────────────
// world.getPlayers({ tags }) 的 tags 是 AND 逻辑
// [BOT_TAG, 行为标签] 直接筛出有该行为标签的假人，无需在循环内做 tags.includes

export function startTagBehaviors(): void {
  // ─── 自动挖掘 ── 每 8 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_MINE.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try {
        const hit = (bot as SimulatedPlayer).getBlockFromViewDirection({ maxDistance: 6 });
        if (hit) (bot as SimulatedPlayer).breakBlock(hit.block.location, hit.face);
      } catch { /* 单次失败不影响其他假人 */ }
    }
  }, 8);

  // ─── 自动攻击 ── 每 5 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_ATTACK.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try { (bot as SimulatedPlayer).attack(); } catch {}
    }
  }, 5);

  // ─── 自动跳跃 ── 每 3 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_JUMP.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try { (bot as SimulatedPlayer).jump(); } catch {}
    }
  }, 3);

  // ─── 体态控制 ── 每 2 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_CONTROL.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record || !record.controllerId) continue;
      try {
        const controller = world.getEntity(record.controllerId);
        if (!controller) continue;
        const playerRot = (controller as Player).getRotation();
        const lookTarget = getPlayerLookTarget(controller as Player);
        (bot as SimulatedPlayer).teleport(controller.location, { rotation: playerRot });
        (bot as SimulatedPlayer).lookAtLocation(lookTarget, LookDuration.Continuous);
        (bot as SimulatedPlayer).isSneaking = (controller as Player).isSneaking;
        record.isSneaking = (bot as SimulatedPlayer).isSneaking;
      } catch {}
    }
  }, 2);

  // ─── 自动放置管理 — 持续建造模式 ─────────────────────
  // 有 TAG_AUTO_PLACE 时 startBuild，无标签时 stopBuild
  const buildingBots: Set<string> = new Set();
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG] });
    for (const bot of bots) {
      const name = bot.name;
      const record = botRegistry.get(name);
      const hasTag = !!record?.tags.includes(TAG_AUTO_PLACE.value);
      if (hasTag && !buildingBots.has(name)) {
        (bot as SimulatedPlayer).startBuild(0);
        buildingBots.add(name);
      } else if (!hasTag && buildingBots.delete(name)) {
        (bot as SimulatedPlayer).stopBuild();
      }
    }
  }, 10);

  // ─── 周期持久化 ── 每 100 tick ───────────────────────
  // 保存位置/经验/装备。背包由 playerInventoryItemChange 事件实时保存
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG] });
    const saved: string[] = [];
    for (const entity of bots) {
      const record = botRegistry.get(entity.name);
      if (!record || record.death) continue;
      if (!isBotRestored(record.name)) continue;
      const bot = entity as Player;

      if (!record.lastPoint) {
        record.lastPoint = { location: bot.location, dimension: bot.dimension.id, rotation: bot.getRotation(), lookTarget: record.respawnPoint.lookTarget };
      } else {
        record.lastPoint.location = bot.location;
        record.lastPoint.dimension = bot.dimension.id;
        record.lastPoint.rotation = bot.getRotation();
      }
      record.isSneaking = bot.isSneaking;
      record.experience = captureExperience(bot);
      saveBotRecord(record);

      const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
      if (equip) saveBotEquipment(bot.name, serializeEquipment(equip));
      saved.push(record.name);
    }
    if (saved.length > 0) console.warn(`[MockPlayer] 周期保存 ${saved.join(",")}`);
  }, 100);
}
