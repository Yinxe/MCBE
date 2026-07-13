// ─── 标签行为引擎 ──────────────────────────────────────
// 按标签驱动假人的自动行为，每个行为独立 runInterval 轮询
// 同时承载位置/经验/装备的周期持久化（100tick ≈ 5秒）
// 因为装备栏没有对应的事件，只能轮询兜底
//
// 互斥标签：autoMine / autoPlace / autoAttack / control / idle / autoUse / vaultMode
// 各行为通过实体标签查询筛选，确保互斥生效

import { EntityEquippableComponent, Player, system, world } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, isBotRestored, saveBotEquipment, saveBotRecord } from "./persistence";
import { BOT_TAG, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_AUTO_USE, TAG_CONTROL, TAG_VAULT_MODE } from "./tags";
import { captureExperience, getPlayerLookTarget, serializeEquipment } from "./utils";
import { runVaultCycle } from "../vaultMode";

// ─── 启动引擎 ──────────────────────────────────────────
// 每个 runInterval 独立轮询，通过实体标签筛选确保互斥

export function startTagBehaviors(): void {
  // ─── 自动挖掘 ── 每 1 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_MINE.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try {
        const hit = (bot as SimulatedPlayer).getBlockFromViewDirection({ maxDistance: 6 });
        if (hit) (bot as SimulatedPlayer).breakBlock(hit.block.location, hit.face);
      } catch (e: any) { console.warn(`[MockPlayer] 自动挖掘异常 ${bot.name}: ${e?.message ?? e}`); }
    }
  }, 1);

  // ─── 自动攻击 ── 每 1 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_ATTACK.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try { (bot as SimulatedPlayer).attack(); } catch (e: any) { console.warn(`[MockPlayer] 自动攻击异常 ${bot.name}: ${e?.message ?? e}`); }
    }
  }, 3);

  // ─── 自动跳跃 ── 每 3 tick ───────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_JUMP.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try { (bot as SimulatedPlayer).jump(); } catch (e: any) { console.warn(`[MockPlayer] 自动跳跃异常 ${bot.name}: ${e?.message ?? e}`); }
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
      } catch (e: any) { console.warn(`[MockPlayer] 体态控制异常 ${bot.name}: ${e?.message ?? e}`); }
    }
  }, 2);

  // ─── 自动放置 ── 每 5 tick（与 autoMine 同频） ──────
  // startBuild + stopBuild 背靠背 = 放置一个方块的一次性动作
  // 执行前先 stopBreakingBlock 确保上个动作已清除
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_PLACE.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try {
        (bot as SimulatedPlayer).stopBreakingBlock();
        (bot as SimulatedPlayer).startBuild(0);
        (bot as SimulatedPlayer).stopBuild();
      } catch (e: any) { console.warn(`[MockPlayer] 自动放置异常 ${bot.name}: ${e?.message ?? e}`); }
    }
  }, 5);

  // ─── 使用物品 ── 每 10 tick ───────────────────────────
  // interact() = 右键单击，返回 boolean 表示交互是否执行
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_USE.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try {
        (bot as SimulatedPlayer).interact();
      } catch (e: any) { console.warn(`[MockPlayer] 使用物品异常 ${bot.name}: ${e?.message ?? e}`); }
    }
  }, 10);

  // ─── 宝库模式 ── 每 10 tick ──────────────────────────
  system.runInterval(() => {
    const bots = world.getPlayers({ tags: [BOT_TAG, TAG_VAULT_MODE.value] });
    for (const bot of bots) {
      const record = botRegistry.get(bot.name);
      if (!record) continue;
      try { runVaultCycle(bot as SimulatedPlayer, record); } catch (e: any) { console.warn(`[MockPlayer] 宝库模式异常 ${bot.name}: ${e?.message ?? e}`); }
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

  // ─── 状态清理 ── 每 40 tick ──────────────────────────
  // 兜底：某些代码路径直接改标签但不清理 SimulatedPlayer 残留状态。
  // 通过原生实体 tag 查询（Set.has O(1)），比查 record.tags 更高效。
  system.runInterval(() => {
    const mining = new Set(world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_MINE.value] }).map((p) => p.id));
    const placing = new Set(world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_PLACE.value] }).map((p) => p.id));
    const using = new Set(world.getPlayers({ tags: [BOT_TAG, TAG_AUTO_USE.value] }).map((p) => p.id));
    for (const bot of world.getPlayers({ tags: [BOT_TAG] })) {
      if (!mining.has(bot.id)) {
        try { (bot as SimulatedPlayer).stopBreakingBlock(); } catch {}
      }
      if (!placing.has(bot.id)) {
        try { (bot as SimulatedPlayer).stopBuild(); } catch {}
      }
      if (!using.has(bot.id)) {
        try { (bot as SimulatedPlayer).stopInteracting(); } catch {}
      }
    }
  }, 40);
}
