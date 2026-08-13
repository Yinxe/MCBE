// ─── 能力：体态控制（2tick） ──────────────────────────
// 响应 TAG_CONTROL：持续跟随控制器（teleport 到身边 + 姿态/朝向/潜行同步）。

import { Player, world } from "@minecraft/server";

import { TAG_CONTROL } from "../../../core/tags/BotTags";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import { getPlayerLookTarget, savePoseToRecord, setPose } from "../../adapters/PoseGateway";
import type { MockBot } from "../MockBot";

/** 体态控制能力工厂（标签状态驱动启停） */
export function controlCapability(bot: MockBot): BotCapability {
  return {
    id: "control",
    tickInterval: 2,
    enabled: (ctx: BotContext) => ctx.tags.includes(TAG_CONTROL.value),
    tick: (): void => {
      const record = bot.record;
      if (!record.controllerId) return;
      const sim = bot.getEntity();
      if (!sim) return;
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
      } catch (e: any) {
        console.warn(`[MockPlayer] 体态控制异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
  };
}
