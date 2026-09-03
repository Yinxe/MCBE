// ─── 定点挖掘任务（timed：阶段机，连续挖掘 + 最优工具） ──
// workMode="mine"。两阶段循环：probe（视线射线取方块；无目标快速重探衔接
// 下一块）→ break（原子破坏，视线复核防隔山打牛）→ broken 立即回 probe
// 连续挖掘。far/busy/blocked 一律回探测重新选目标——blocked = 视线被插入
// 阻挡块，原地重敲会隔山打牛（恢复旧引擎"每轮重新视线探测"语义）。
//
// 工具策略（rules/items/MineToolRules）：每块破坏前按目标方块类型从全背包
// 选最优工具（镐/斧/锹/锄/剑映射 + 品阶/附魔评分）自动换主手；未映射类型
// 或背包无匹配 → 用当前主手不折腾。与砍树 ensureTool 同款回调注入。
// expectedTypeId 定点守卫：目标被外部改动 → changed 回探测重新选（铁律）。

import type { Vector3 } from "@minecraft/server";

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { breakBlockOnce, viewBlock, type EnsureToolContext } from "../../basic/blocks";
import { snapshotTools } from "../../basic/items/ToolSnapshot";
import { setMainhandSlot } from "../../basic/items/mainhand";
import { pickBestMineTool } from "../../../rules/items/MineToolRules";
import { defineLoopTask } from "./spec";

/** 视线探测/挖掘最大距离（格） */
const MINE_DISTANCE = 6;
/** 无目标快速重探间隔（tick——保持连续挖掘，不长时间空转） */
const IDLE_RECHECK_TICKS = 2;
/** 破坏状态检测间隔（tick） */
const POLL_TICKS = 5;
/** 不可破坏结果（far/busy/blocked）回探测前等待（tick） */
const RETRY_WAIT_TICKS = 1;

/** 挖掘任务共享状态（探测 → 破坏传递目标） */
interface MineData {
  /** 当前探测到的目标方块坐标（break 阶段消费） */
  target?: Vector3;
  /** 探测到的目标方块类型（换工具策略 + expectedTypeId 定点守卫） */
  targetTypeId?: string;
}

/** 定点挖掘（定时循环）任务 */
export const mineTask = defineLoopTask<MineData>({
  workMode: "mine",
  kind: "timed",
  label: "定点挖掘",
  createData: () => ({}),
  initial: "probe",
  phases: {
    probe: {
      label: "探测",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        const target = bot ? viewBlock(bot, MINE_DISTANCE) : undefined;
        if (!bot || !target) {
          // 实体瞬态不可用/视线无实心方块 → 快速重探（实体瞬态由事件层负责下线清理）
          await ctx.wait(IDLE_RECHECK_TICKS);
          return "probe";
        }
        ctx.data.target = target.location;
        ctx.data.targetTypeId = target.typeId;
        return "break";
      },
    },
    break: {
      label: "破坏",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        const target = ctx.data.target;
        if (!bot || !target) return "probe";
        const result = await breakBlockOnce(bot, target, {
          maxDistance: MINE_DISTANCE,
          pollTicks: POLL_TICKS,
          token: ctx.token,
          requireLineOfSight: true,
          // 按目标方块类型自动换最优工具（全背包扫描；主手已最优不折腾）
          ensureTool: (toolCtx) => ensureMineTool(ctx.botName, toolCtx),
          expectedTypeId: ctx.data.targetTypeId,
        });
        if (result === "aborted") return "stop"; // 取消 → 任务结束
        if (result !== "broken") {
          // far/busy/blocked/changed：短等后回探测重新选目标——blocked=有阻挡块
          // 插入视线，原地重敲会隔山打牛死循环（先挖阻挡块）；changed=目标被
          // 外部改动，重新探测（定点破坏铁律：绝不挖类型不符的方块）
          await ctx.wait(RETRY_WAIT_TICKS);
        }
        return "probe"; // broken 立即回探测（衔接下一块，连续挖掘不空转）
      },
    },
  },
});

/**
 * 挖掘工具策略（ensureTool 回调——breakBlockOnce 每块破坏前调用）：
 * 按即将破坏的方块类型从全背包快照选最优工具槽位换主手。
 * 换工具失败（背包不可读等）→ 静默用当前主手继续（不中断挖掘）。
 */
async function ensureMineTool(botName: string, toolCtx: EnsureToolContext): Promise<void> {
  const slot = pickBestMineTool(toolCtx.blockTypeId, snapshotTools(toolCtx.bot), toolCtx.handSlot);
  if (slot !== undefined) {
    try {
      await setMainhandSlot(botName, slot);
    } catch {
      /* 换工具失败：用当前主手继续 */
    }
  }
}
