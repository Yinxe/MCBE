// ─── 标签行为引擎 ──────────────────────────────────────

import { world, system, Player } from "@minecraft/server";
import { SimulatedPlayer, LookDuration } from "@minecraft/server-gametest";

import { BotRecord, BOT_TAG } from "./types";
import { TAG_AUTO_MINE, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_CONTROL } from "./tags";
import { getPlayerLookTarget } from "./utils";
import { botRegistry, saveBotRecord } from "./persistence";

// ─── 行为定义 ──────────────────────────────────────────

interface TagBehavior {
  tagValue: string;
  intervalTicks: number;
  execute: (bot: SimulatedPlayer, record: BotRecord) => void;
}

const TAG_BEHAVIORS: TagBehavior[] = [
  {
    // 自动挖掘 — 每 8 tick 向前方 6 格内射线挖掘
    tagValue: TAG_AUTO_MINE.value,
    intervalTicks: 8,
    execute(bot, _record) {
      const hit = bot.getBlockFromViewDirection({ maxDistance: 6 });
      if (hit) bot.breakBlock(hit.block.location, hit.face);
    },
  },
  {
    // 自动攻击 — 每 15 tick 攻击一次
    tagValue: TAG_AUTO_ATTACK.value,
    intervalTicks: 15,
    execute(bot, _record) {
      bot.attack();
    },
  },
  {
    // 自动跳跃 — 每 3 tick 跳一次
    tagValue: TAG_AUTO_JUMP.value,
    intervalTicks: 3,
    execute(bot, _record) {
      bot.jump();
    },
  },
  {
    // 体态控制 — 每 2 tick 同步控制器玩家的位置/朝向/潜行
    tagValue: TAG_CONTROL.value,
    intervalTicks: 2,
    execute(bot, record) {
      if (!record.controllerId) return;
      const controller = world.getEntity(record.controllerId);
      if (!controller) return;
      const playerRot = (controller as Player).getRotation();
      const lookTarget = getPlayerLookTarget(controller as Player);
      bot.teleport(controller.location, { rotation: playerRot });
      bot.lookAtLocation(lookTarget, LookDuration.Continuous);
      bot.isSneaking = (controller as Player).isSneaking;
      record.isSneaking = bot.isSneaking;
    },
  },
];

// ─── 启动引擎 ──────────────────────────────────────────

export function startTagBehaviors(): void {
  // 每个标签行为独立轮询
  for (const behavior of TAG_BEHAVIORS) {
    system.runInterval(() => {
      for (const [, record] of botRegistry) {
        if (!record.online || record.death) continue;
        if (!record.tags.includes(behavior.tagValue)) continue;
        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) continue;
        try {
          behavior.execute(entity as SimulatedPlayer, record);
        } catch {
          // 单次执行失败不影响其他假人
        }
      }
    }, behavior.intervalTicks);
  }

  // 每 100 ticks（约 5 秒）自动持久化在线存活假人的位置/朝向
  system.runInterval(() => {
    for (const [, record] of botRegistry) {
      if (!record.online || record.death) continue;
      if (!record.entityId) continue;
      const entity = world.getEntity(record.entityId);
      if (!entity || !entity.hasTag(BOT_TAG)) continue;

      if (!record.lastPoint) {
        record.lastPoint = {
          location: entity.location,
          dimension: entity.dimension.id,
          rotation: (entity as Player).getRotation(),
          lookTarget: record.respawnPoint.lookTarget,
        };
      } else {
        record.lastPoint.location = entity.location;
        record.lastPoint.dimension = entity.dimension.id;
        record.lastPoint.rotation = (entity as Player).getRotation();
      }
      record.isSneaking = (entity as Player).isSneaking;
      saveBotRecord(record);
    }
  }, 100);
}
