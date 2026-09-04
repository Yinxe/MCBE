// ─── 定点攻击任务（timed：阶段机 + 视线目标定向攻击） ──
// workMode="attack"。两阶段循环：probe（视线射线取最近实体目标；无目标
// 快速重探）→ strike（attackEntity 定向连击该目标；目标失效/击杀/跑出
// 攻击距离 → 回探测重新锁定）。
// 目标选择：getEntitiesFromViewDirection 最近命中（对齐引擎 attack() 的
// 射线语义，拿到实体句柄可定向连击同一目标，避免每击重选抖动）。
// 武器策略：锁定目标时换一次最优武器（剑 > 同品阶斧 + 锋利加分；全
// 背包快照一次）；strike 连击期间不再扫背包（武器集不变，避免每 4 tick
// 36 格快照浪费）。
// ⚠️ attackEntity 引擎语义「任意距离可打、无需视线」——连击中途目标被
//   击退跑远会无限追打，故 strike 自检 3D 距离超 ATTACK_DISTANCE 即回探测。

import { world } from "@minecraft/server";

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { snapshotTools } from "../../basic/items/ToolSnapshot";
import { setMainhandSlot } from "../../basic/items/mainhand";
import { pickBestWeapon } from "../../../rules/items/MineToolRules";
import { defineLoopTask, warnTaskError } from "./spec";

/** 视线探测/攻击距离（格） */
const ATTACK_DISTANCE = 4;
/** 攻击间隔（tick：近战连击节律，对齐玩家连点 ≈4 tick） */
const ATTACK_INTERVAL_TICKS = 4;
/** 无目标快速重探间隔（tick） */
const IDLE_RECHECK_TICKS = 4;
/** 实体瞬态不可用重查间隔（tick） */
const OFFLINE_RECHECK_TICKS = 10;

/** 攻击任务共享状态（探测 → 打击传递目标） */
interface AttackData {
  /** 当前目标实体 ID（strike 阶段定向连击；失效回探测） */
  targetId?: string;
}

/** 定点攻击（定时循环）任务 */
export const attackTask = defineLoopTask<AttackData>({
  workMode: "attack",
  kind: "timed",
  label: "定点攻击",
  createData: () => ({}),
  initial: "probe",
  phases: {
    probe: {
      label: "探测",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        if (!bot) {
          await ctx.wait(OFFLINE_RECHECK_TICKS);
          return "probe";
        }
        let targetId: string | undefined;
        try {
          const hits = bot.getEntitiesFromViewDirection({ maxDistance: ATTACK_DISTANCE });
          targetId = hits[0]?.entity.id;
        } catch (e: unknown) {
          warnTaskError(`视线目标探测失败 ${ctx.botName}`, e);
        }
        if (!targetId) {
          await ctx.wait(IDLE_RECHECK_TICKS);
          return "probe";
        }
        // 锁定新目标：换一次最优武器（连击期间不再扫背包）
        await ensureBestWeapon(ctx.botName, bot);
        ctx.data.targetId = targetId;
        return "strike";
      },
    },
    strike: {
      label: "打击",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        const targetId = ctx.data.targetId;
        if (!bot || !targetId) return "probe";
        const target = world.getEntity(targetId);
        if (!target?.isValid) {
          ctx.data.targetId = undefined; // 目标失效（击杀/消失）→ 回探测
          return "probe";
        }
        // 距离自检：目标被击退跑远 → 回探测重新锁定（防无限追打远距目标）
        const dx = bot.location.x - target.location.x;
        const dy = bot.location.y - target.location.y;
        const dz = bot.location.z - target.location.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > ATTACK_DISTANCE + 1) {
          ctx.data.targetId = undefined;
          return "probe";
        }
        try {
          bot.attackEntity(target);
        } catch (e: unknown) {
          // 攻击失败（冷却中/目标瞬移等瞬态）→ 可见但回探测重选
          warnTaskError(`定点攻击失败 ${ctx.botName}`, e);
          ctx.data.targetId = undefined;
          return "probe";
        }
        await ctx.wait(ATTACK_INTERVAL_TICKS);
        return "strike"; // 同目标连击（失效/跑远由下一轮探测兜底）
      },
    },
  },
});

/** 确保主手是最优武器（全背包扫描一次：剑 > 斧；主手已最优不折腾） */
async function ensureBestWeapon(botName: string, bot: Parameters<typeof snapshotTools>[0]): Promise<void> {
  const slot = pickBestWeapon(snapshotTools(bot), bot.selectedSlotIndex);
  if (slot === undefined) return;
  try {
    await setMainhandSlot(botName, slot);
  } catch {
    /* 换武器失败：用当前主手继续 */
  }
}
