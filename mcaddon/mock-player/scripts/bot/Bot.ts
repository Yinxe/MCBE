// ─── Bot 类（OOP 原子能力封装，mc 适配扩展） ─────────────
// 继承 BotCore（纯逻辑：构造/记录/状态/标签/距离/导航），本文件追加
// mc 侧委托方法（跟随/钓鱼/主手/生命周期/装备/三叉戟）——均惰性 require
// 归类后的 features 实现，避免顶层 mc 依赖（node 测试只编译 BotCore）。

import type { Player, Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotCore } from "./BotCore";
import type { BotRegistry } from "../service/BotRegistry";

export class Bot extends BotCore {
  // ─── 原子能力：跟随 ──────────────────────────────────

  /** 开始跟随目标玩家（OOP 门面，委托 state/follow） */
  follow(targetPlayerId: string): boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startFollow } = require("../features/state/follow") as typeof import("../features/state/follow");
    return startFollow(this.name, targetPlayerId);
  }

  /** 停止跟随 */
  unfollow(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stopFollow } = require("../features/state/follow") as typeof import("../features/state/follow");
    stopFollow(this.name);
  }

  /** 是否正在跟随 */
  get isFollowing(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isFollowing } = require("../features/state/follow") as typeof import("../features/state/follow");
    return isFollowing(this.name);
  }

  // ─── 原子能力：钓鱼 ──────────────────────────────────

  /** 是否有鱼竿 */
  get hasFishingRod(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hasFishingRod } = require("../features/task/fishing") as typeof import("../features/task/fishing");
    return hasFishingRod(this.name);
  }

  /** 是否已抛竿（有鱼钩） */
  get isFishing(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hasFishingHook } = require("../features/task/fishing") as typeof import("../features/task/fishing");
    return hasFishingHook(this.name);
  }

  /** 抛竿 */
  castRod(): Promise<import("../features/task/fishing").CastRodResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { castFishingRod } = require("../features/task/fishing") as typeof import("../features/task/fishing");
    return castFishingRod(this.name);
  }

  /** 收竿 */
  reelRod(): Promise<import("../features/task/fishing").ReelRodResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reelFishingRod } = require("../features/task/fishing") as typeof import("../features/task/fishing");
    return reelFishingRod(this.name);
  }

  // ─── 原子能力：主手 ──────────────────────────────────

  /** 主手选择列表（undefined=不可用；空数组=背包无物品） */
  getMainhandOptions(): import("../features/basic/mainhand").MainhandOption[] | undefined {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMainhandOptions } = require("../features/basic/mainhand") as typeof import("../features/basic/mainhand");
    return getMainhandOptions(this.name);
  }

  /** 设置主手槽（-1=清空；>=0=背包槽位） */
  setMainhand(slotValue: number): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setMainhandSlot } = require("../features/basic/mainhand") as typeof import("../features/basic/mainhand");
    setMainhandSlot(this.name, slotValue);
  }

  // ─── 原子能力：控制/状态 ─────────────────────────────

  /** 切换控制权（委托 basic/control） */
  toggleControl(controller: Player): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toggleControl } = require("../features/basic/control") as typeof import("../features/basic/control");
    toggleControl(this.record, controller);
  }

  /** 检查主手耐久（事件驱动补充；委托 basic/toolHealth） */
  checkMainhandDurability(changedSlot: number): void {
    const bot = this.entity;
    if (!bot) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { checkMainHandDurability } = require("../features/basic/toolHealth") as typeof import("../features/basic/toolHealth");
    checkMainHandDurability(bot as Player, changedSlot);
  }

  /** 使用主手物品（消费主手 ItemStack；返回是否执行） */
  useMainhand(): boolean {
    const bot = this.entity;
    const item = this.mainhandItem;
    if (!bot || !item) return false;
    try {
      bot.useItem(item);
      return true;
    } catch {
      return false;
    }
  }

  /** 停止使用物品 */
  stopUsing(): void {
    try {
      this.entity?.stopUsingItem();
    } catch { /* ignore */ }
  }

  // ─── 原子能力：生命周期（委托 manage） ───────────────

  /** 上线（委托 manage/onlineBot） */
  async bringOnline(): Promise<SimulatedPlayer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onlineBot } = require("../features/manage/onlineBot") as typeof import("../features/manage/onlineBot");
    return onlineBot(this.record);
  }

  /** 下线（委托 manage/offlineBot） */
  takeOffline(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { offlineBot } = require("../features/manage/offlineBot") as typeof import("../features/manage/offlineBot");
    offlineBot(this.record);
  }

  /** 击杀（委托 manage/killBot） */
  kill(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { killBot } = require("../features/manage/killBot") as typeof import("../features/manage/killBot");
    killBot(this.record);
  }

  /** 删除（委托 manage/deleteBot） */
  delete(reclaimTo?: Player): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { deleteBot } = require("../features/manage/deleteBot") as typeof import("../features/manage/deleteBot");
    deleteBot(this.record, reclaimTo);
  }

  /** 安全重连（委托 manage/pendingRespawn） */
  safeReconnect(options?: import("../features/manage/pendingRespawn").SafeReconnectOptions): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeReconnect } = require("../features/manage/pendingRespawn") as typeof import("../features/manage/pendingRespawn");
    safeReconnect(this.record, options);
  }

  /** 切换生成模式（委托 manage/spawnMode） */
  switchSpawnMode(newMode: import("../features/manage/spawnMode").SpawnMode): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { switchSpawnMode } = require("../features/manage/spawnMode") as typeof import("../features/manage/spawnMode");
    switchSpawnMode(this.record, newMode);
  }

  /** 传送玩家到自己（委托 basic/teleport） */
  tpPlayerHere(player: Player): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tpPlayerToBot } = require("../features/basic/teleport") as typeof import("../features/basic/teleport");
    tpPlayerToBot(player, this.record);
  }

  /** 传送自己到玩家（委托 basic/teleport） */
  tpToPlayer(player: Player): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tpBotToPlayer } = require("../features/basic/teleport") as typeof import("../features/basic/teleport");
    tpBotToPlayer(this.record, player);
  }

  // ─── 原子能力：装备交换（委托 basic/equip） ──────────

  /** 与玩家交换主手 */
  swapMainhand(player: Player): boolean {
    const bot = this.entity;
    if (!bot) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { swapMainhandWithBot } = require("../features/basic/equip") as typeof import("../features/basic/equip");
    return swapMainhandWithBot(player, bot as Player);
  }

  /** 与玩家交换副手 */
  swapOffhand(player: Player): boolean {
    const bot = this.entity;
    if (!bot) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { swapOffhandWithBot } = require("../features/basic/equip") as typeof import("../features/basic/equip");
    return swapOffhandWithBot(player, bot as Player);
  }

  /** 与玩家交换全部装备 */
  swapEquipment(player: Player): boolean {
    const bot = this.entity;
    if (!bot) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { swapEquipmentWithBot } = require("../features/basic/equip") as typeof import("../features/basic/equip");
    return swapEquipmentWithBot(player, bot as Player);
  }

  /** 回收（委托 manage/reclaim） */
  reclaim(player: Player, options?: import("../service/ReclaimPlanner").ReclaimOptions): import("../features/manage/reclaim").ReclaimResult {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reclaimBot } = require("../features/manage/reclaim") as typeof import("../features/manage/reclaim");
    return reclaimBot(player, this.record, options);
  }

  /** 回收预览 */
  getReclaimPreview(): ReturnType<typeof import("../features/manage/reclaim").getReclaimPreview> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getReclaimPreview } = require("../features/manage/reclaim") as typeof import("../features/manage/reclaim");
    return getReclaimPreview(this.record);
  }

  // ─── 原子能力：三叉戟（委托 trident） ────────────────

  /** 扫描三叉戟（委托 trident/trident） */
  scanTridents(): import("../features/trident/trident").TridentSlot[] | undefined {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scanTridents } = require("../features/trident/trident") as typeof import("../features/trident/trident");
    return scanTridents(this.name);
  }

  /** 主手是否三叉戟 */
  get isMainhandTrident(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isMainhandTrident } = require("../features/trident/trident") as typeof import("../features/trident/trident");
    return isMainhandTrident(this.name);
  }

  /** 投掷三叉戟（委托 trident/trident） */
  throwTridents(playerId: string, slots: number[], onComplete?: () => void): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { throwTridents } = require("../features/trident/trident") as typeof import("../features/trident/trident");
    throwTridents(this.name, playerId, slots, onComplete);
  }
}

// ─── Bot 解析工具 ──────────────────────────────────────

/**
 * 安全解析 Bot（记录不存在 → undefined，不抛错）。
 * @param name 假人名
 * @param registry 记录注册表（mc 层传全局单例；测试传 InMemory 替身）
 */
export function resolveBot(name: string, registry: BotRegistry): Bot | undefined {
  try {
    return new Bot(name, registry);
  } catch {
    return undefined;
  }
}

/**
 * 强制解析 Bot（记录不存在 → 抛错）。
 * @param name 假人名
 * @param registry 记录注册表（mc 层传全局单例；测试传 InMemory 替身）
 */
export function requireBot(name: string, registry: BotRegistry): Bot {
  return new Bot(name, registry);
}

// ─── 导出类型 ──────────────────────────────────────────

export type { BotRecord } from "../rules/Types";
