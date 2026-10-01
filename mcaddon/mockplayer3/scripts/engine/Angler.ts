// ─── 钓鱼原子操作（F-17：MCBE 鱼竿右键为同键开关——有钩收线、无钩抛竿） ──
// 方向不靠内存标志：invoke 前先查钩实体的真实存在性（带 mp:fisher:<名字> 标签的
// fishing_hook，标签由 ProjectileTracker 在 entitySpawn 时认领）——内存标志
// 在重载/竞态下可能失真，实体存在性是唯一可回读确认的依据。
// 主手约定：竿必须位于槽 0——先扫 0 再扫 1..35，找到后双 setItem 互换到位
// （只交换、绝不丢物品），selectedSlotIndex 压回 0 后按下。
// 换到槽 0 时记下竿的原槽位（rodHome），流程收尾调 restoreRod 换回原位。
// 抛/收发起后回读钩实体的出现/消失来验证方向翻转：2t×3 探测窗。

import { INVENTORY_SIZE } from "../domain/Record";
import type { ItemStack } from "@minecraft/server";
import { makeFisherTag } from "../domain/ClaimRules";
import { HOOK_QUERY_RADIUS, PLACEMENT_ENTITY_RADIUS, WATER_BLOCK_IDS, judgeHookPlacement } from "../domain/FishingSpot";
import type { FishFailReason } from "../domain/FishingSpot";
import { SLOW_OP_MS } from "../domain/Perf";
import {
  BITE_CHECK_TICKS,
  BITE_TIMEOUT_TICKS,
  STABILIZE_TICKS,
  initBiteState,
  updateBiteTracker,
} from "../domain/BiteWatch";
import { botOf, botValid, dimensionOf, inventoryContainer, readBlockIn, sleepTicks } from "./Atomic";
import { entityGateway } from "./EntityGateway";
import type { CancelToken } from "../domain/Cancellation";
import type { Vec3 } from "../domain/Coords";
import { inventoryChanged } from "./Hooks";

const ROD_ID = "minecraft:fishing_rod";

/**
 * 单格是否鱼竿。ItemStack.matches 忽略 NBT/耐久且版本安全；typeId 等值仅在
 * 引擎别名/改 id 时漏判，作 matches 抛错的回退。
 */
function isRodItem(item: ItemStack | undefined | null): boolean {
  if (!item) return false;
  try {
    return item.matches(ROD_ID);
  } catch {
    return item.typeId === ROD_ID;
  }
}
/** 主手固定槽约定 */
const MAINHAND = 0;
/** 抛/收回读探测窗 */
const VERIFY_PROBE_TICKS = 2;
const VERIFY_PROBE_ROUNDS = 3;

export type CastResult = "cast" | "reeled" | "no-rod" | "no-slot" | "offline" | "engine-refused" | "verify-failed";

/** 一次性钓鱼结果（timeout=无获但流程正常，不属失败） */
export type FishOnceOutcome =
  { result: "caught" } | { result: "timeout" } | { result: "failed"; reason: FishFailReason };

/** 钩实体实时状态（供能力层咬钩监视读取） */
export interface HookState {
  entityId: string;
  /** 钩当下位置（落点探测、判定其他实体是否在钩旁的基准） */
  location: Vec3;
  /** 钩所在维度（落点探测回取） */
  dimensionId: string;
  /** 钩当下 y（用滚动最高点是否净降来判定咬钩） */
  y: number;
}

export class Angler {
  /** 竿被换到槽 0 前的原槽位（botId→槽号）：restoreRod 按此归位，未记录=竿本就在 0 */
  private readonly rodHome = new Map<number, number>();

  /** 自有钩实体探测（半径 40——线最长 32 留漂移余量） */
  hasHook(botId: number): boolean {
    return this.findHook(botId) !== undefined;
  }

  /** 自有钩状态（无钩/离线 undefined） */
  findHook(botId: number): HookState | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    const name = entityGateway.nameOf(botId);
    if (name === undefined) return undefined;
    const tag = makeFisherTag(name);
    // 慢操作记日志：WATCH 每 2t 一次，半径 40 带标签查询是钓鱼侧唯一的每刻世界读；
    // 半径改动须以实测日志为准（超 SLOW_OP_MS 才报，5s 一报防刷屏）
    const t0 = Date.now();
    try {
      for (const e of bot.dimension.getEntities({
        tags: [tag],
        location: bot.location,
        maxDistance: HOOK_QUERY_RADIUS,
      })) {
        try {
          if (!e.isValid) continue;
          const p = e.location;
          reportHookSlow(Date.now() - t0, name);
          return { entityId: e.id, location: { x: p.x, y: p.y, z: p.z }, dimensionId: bot.dimension.id, y: p.y };
        } catch {
          /* 单实体瞬态跳过 */
        }
      }
    } catch {
      /* 扫描瞬态——按无钩处理由调用方重试 */
    }
    reportHookSlow(Date.now() - t0, name);
    return undefined;
  }

  /**
   * 稳定期后落点探测：钩所在格是否水 + 钩 0.25 格内是否有其他实体。
   * 极小半径是引擎约束——放大即误判水中正常游动的鱼；判定走 judgeHookPlacement。
   * @returns 钩不存在/维度不可读返回 undefined（调用方按 hook-lost 处理）
   */
  probePlacement(botId: number): "water" | "snagged" | "landed" | undefined {
    const hook = this.findHook(botId);
    if (!hook) return undefined;
    const dim = dimensionOf(hook.dimensionId);
    if (!dim) return undefined;
    const info = readBlockIn(dim, {
      x: Math.floor(hook.location.x),
      y: Math.floor(hook.location.y),
      z: Math.floor(hook.location.z),
    });
    const inWater = info !== undefined && WATER_BLOCK_IDS.includes(info.id);
    let hasEntityNearby = false;
    try {
      // 任何其他实体贴钩都算勾中（鱼/玩家/假人），鱼钩类除外
      hasEntityNearby = dim
        .getEntities({ location: hook.location, maxDistance: PLACEMENT_ENTITY_RADIUS })
        .some((e) => e.id !== hook.entityId && e.typeId !== "minecraft:fishing_hook");
    } catch {
      /* 维度查询瞬态——按无实体处理（后续咬钩监视自会纠偏） */
    }
    return judgeHookPlacement(inWater, hasEntityNearby);
  }

  /** 背包任一格是否有鱼竿（竿在背包深处也算有） */
  hasRod(botId: number): boolean {
    return this.findRodSlot(botId) >= 0;
  }

  /**
   * 同键开关一次：查钩实体存在性定方向 → 竿换到主手 → 按下 → 回读验证。
   */
  async toggle(botId: number, token?: CancelToken): Promise<CastResult> {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const wasCast = this.hasHook(botId);
    const slot = this.findRodSlot(botId);
    if (slot < 0) return "no-rod";
    if (slot !== MAINHAND) {
      // 双 setItem 交换（wielder 同纪律）：0 槽与竿槽内容互换，绝不覆盖丢物
      const swapped = this.swapToMainhand(botId, slot);
      if (!swapped) return "no-slot";
      // 首次离位记原槽，供 restoreRod 归位；重复换出不覆盖，保留最早记录的原槽
      if (!this.rodHome.has(botId)) this.rodHome.set(botId, slot);
    }
    try {
      bot.selectedSlotIndex = MAINHAND;
    } catch {
      /* 选中写入失败仍试按下——useItemInSlot 自带槽参 */
    }
    const fresh = botOf(botId);
    if (!fresh || !botValid(fresh)) return "offline";
    let pressed = false;
    try {
      pressed = fresh.useItemInSlot(MAINHAND);
    } catch {
      return "offline";
    }
    if (!pressed) return "engine-refused";
    inventoryChanged(botId); // 竿耐久随动作波动——报脏防漏存
    // 回读验证方向翻转（钩实体出现/消失）
    for (let round = 0; round < VERIFY_PROBE_ROUNDS; round++) {
      await sleepTicks(VERIFY_PROBE_TICKS, token);
      if (token?.cancelled) return "verify-failed";
      const nowCast = this.hasHook(botId);
      if (wasCast && !nowCast) return "reeled";
      if (!wasCast && nowCast) return "cast";
    }
    return "verify-failed";
  }

  /**
   * 一次性钓鱼（/mp:fish 诊断入口）：抛竿→稳定 25t→落点检查（陆地/挂到实体则先
   * 收线再判失败）→咬钩监视（滚动最高点净降即咬钩；45s 超时=正常收线，不算失败）→收线。
   * 就地抛收，不寻点不导航（寻点归能力编排）。
   * 残留钩自愈：toggle 按钩实体存在性定方向，第一步可能是收线——收完再抛。
   * 结束时（含失败/取消）把竿换回原槽位。
   */
  async fishOnce(botId: number, token?: CancelToken): Promise<FishOnceOutcome> {
    try {
      return await this.runFishOnce(botId, token);
    } finally {
      this.restoreRod(botId);
    }
  }

  /**
   * 把竿从槽 0 换回记录的原槽位（双 setItem 互换，不丢物品）。
   * 无记录、主手已非竿（外界处置过）或原槽已有竿时只清记录、不动背包。
   * @param botId - 目标假人
   */
  restoreRod(botId: number): void {
    const home = this.rodHome.get(botId);
    if (home === undefined) return;
    this.rodHome.delete(botId);
    const bot = botOf(botId);
    const container = bot && botValid(bot) ? inventoryContainer(bot) : undefined;
    if (!container) return; // 离线/瞬态：记录已清，竿留在当下槽位
    try {
      if (home < 1 || home >= container.size) return;
      if (!isRodItem(container.getItem(MAINHAND))) return;
      if (isRodItem(container.getItem(home))) return; // 原槽已是竿（外界挪动过），不再互换
      const displaced = container.getItem(home);
      container.setItem(home, container.getItem(MAINHAND));
      container.setItem(MAINHAND, displaced ?? undefined);
    } catch {
      /* 背包瞬态：竿留在主手，下轮 toggle 仍能工作 */
    }
  }

  /** fishOnce 主体（收尾归位由外层 finally 保证） */
  private async runFishOnce(botId: number, token?: CancelToken): Promise<FishOnceOutcome> {
    let cast = await this.toggle(botId, token);
    if (cast === "reeled") cast = await this.toggle(botId, token);
    if (cast !== "cast")
      return { result: "failed", reason: cast === "no-rod" ? "no-rod" : cast === "offline" ? "offline" : "error" };
    await sleepTicks(STABILIZE_TICKS, token);
    if (token?.cancelled) {
      await this.reelOut(botId, token);
      return { result: "failed", reason: "error" };
    }
    const placement = this.probePlacement(botId);
    if (placement !== "water") {
      // hook-lost 也走这条：undefined 的 reason 归 hook-lost，钩由 reelOut 兜底清干净
      await this.reelOut(botId, token);
      return { result: "failed", reason: placement ?? "hook-lost" };
    }
    const bite = initBiteState();
    for (let waited = 0; waited < BITE_TIMEOUT_TICKS; waited += BITE_CHECK_TICKS) {
      await sleepTicks(BITE_CHECK_TICKS, token);
      if (token?.cancelled) {
        await this.reelOut(botId, token);
        return { result: "failed", reason: "error" };
      }
      const hook = this.findHook(botId);
      if (!hook) {
        await this.reelOut(botId, token);
        return { result: "failed", reason: "hook-lost" };
      }
      if (updateBiteTracker(bite, hook.y)) {
        const reeled = await this.reelOut(botId, token);
        return reeled ? { result: "caught" } : { result: "failed", reason: "error" };
      }
    }
    await this.reelOut(botId, token);
    return { result: "timeout" };
  }

  // ─── 私有 ──

  /** 收线清场：toggle 到钩消失为止（≤2 次），返回钩是否已清干净 */
  private async reelOut(botId: number, token?: CancelToken): Promise<boolean> {
    for (let i = 0; i < 2 && this.hasHook(botId); i++) {
      const r = await this.toggle(botId, token);
      if (r === "reeled") return true;
      if (r === "offline" || r === "no-rod") return false;
    }
    return !this.hasHook(botId);
  }

  /** 槽 0 优先，否则扫 1..35；竿在背包深处也算有竿 */
  private findRodSlot(botId: number): number {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return -1;
    const container = inventoryContainer(bot);
    if (!container) return -1;
    try {
      if (isRodItem(container.getItem(MAINHAND))) return MAINHAND;
      for (let i = 1; i < Math.min(container.size, INVENTORY_SIZE); i++) {
        if (isRodItem(container.getItem(i))) return i;
      }
    } catch {
      return -1;
    }
    return -1;
  }

  private swapToMainhand(botId: number, slot: number): boolean {
    const bot = botOf(botId);
    const container = bot ? inventoryContainer(bot) : undefined;
    if (!container) return false;
    try {
      const hand = container.getItem(MAINHAND);
      const rod = container.getItem(slot);
      if (!rod) return false;
      container.setItem(slot, hand ?? undefined);
      container.setItem(MAINHAND, rod);
      return isRodItem(container.getItem(MAINHAND));
    } catch {
      return false;
    }
  }
}

/** 进程级单例 */
export const angler = new Angler();

// ─── 慢操作日志 ──

/** 钩查询慢日志节流窗（ms）：WATCH 每 2t 调一次，逐刻刷屏反而看不出量级 */
const HOOK_SLOW_LOG_GAP_MS = 5000;
let hookSlowLoggedAt = 0;

/** 超阈值才落日志；阈值以下零输出 */
function reportHookSlow(ms: number, hookOwner: string): void {
  if (ms <= SLOW_OP_MS) return;
  const now = Date.now();
  if (now - hookSlowLoggedAt < HOOK_SLOW_LOG_GAP_MS) return;
  hookSlowLoggedAt = now;
  console.warn(`[mockplayer3] 慢操作：鱼钩查询 ${ms}ms（持有者=${hookOwner}，半径 ${HOOK_QUERY_RADIUS}）`);
}
