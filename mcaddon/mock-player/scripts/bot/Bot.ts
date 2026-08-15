// ─── Bot 类（OOP 原子能力封装，mc 适配扩展） ─────────────
// 继承 BotCore（纯逻辑：构造/记录/状态/标签/距离/导航），本文件追加
// mc 侧委托方法（跟随/钓鱼/主手/生命周期/装备/三叉戟）——统一顶部导入
// 归类后的 features 实现（本文件不进 node 测试编译，可安全顶部 import）。

import type { Player, Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotCore } from "./BotCore";
import { navigateBot } from "../features/basic/move";
import { toggleControl } from "../features/basic/control";
import { swapMainhandWithBot, swapOffhandWithBot, swapEquipmentWithBot, SwapResult } from "../features/basic/items";
import { getMainhandOptions, setMainhandSlot } from "../features/basic/items";
import { useItemOnce } from "../features/basic/items";
import { tpPlayerToBot, tpBotToPlayer } from "../features/basic/teleport";
import { checkMainHandDurability } from "../features/basic/items";
import { deleteBot } from "../features/manage/deleteBot";
import { killBot } from "../features/manage/killBot";
import { offlineBot } from "../features/manage/offlineBot";
import { onlineBot } from "../features/manage/onlineBot";
import { safeReconnect } from "../features/manage/pendingRespawn";
import { reclaimBot, getReclaimPreview } from "../features/manage/reclaim";
import { switchSpawnMode } from "../features/manage/spawnMode";
import { startFollow, stopFollow, isFollowing } from "../features/state/follow";
import { hasFishingRod, hasFishingHook, castFishingRod, reelFishingRod } from "../features/task/fishing";
import { scanTridents, isMainhandTrident, throwTridents } from "../features/trident/trident";
import type { BotRegistry } from "../service/BotRegistry";

export class Bot extends BotCore {
  // ─── 原子能力：导航（委托 basic/move，闭包异步多状态） ──

  /**
   * 寻路到目标位置并等待完成（while+await 每 10tick 监测位置，多状态返回）。
   * 移动中自动更新假人位置/朝向数据（lastPoint + 持久化）。
   * @param callbacks 移动过程回调（onStart/onMoving/onStuck/onComplete，全部可选）
   * @returns NavigateResult：arrived / no-path / still-timeout / timeout / unavailable / entity-invalid / error
   */
  navigateTo(
    target: Vector3,
    speed?: number,
    callbacks?: import("../features/basic/move").NavigateCallbacks,
  ): Promise<import("../features/basic/move").NavigateResult> {
    return navigateBot(this.name, target, speed, callbacks);
  }

  // ─── 原子能力：跟随 ──────────────────────────────────

  /** 开始跟随目标玩家（OOP 门面，委托 state/follow） */
  follow(targetPlayerId: string): boolean {
    return startFollow(this.name, targetPlayerId);
  }

  /** 停止跟随 */
  unfollow(): void {
    stopFollow(this.name);
  }

  /** 是否正在跟随 */
  get isFollowing(): boolean {
    return isFollowing(this.name);
  }

  // ─── 原子能力：钓鱼 ──────────────────────────────────

  /** 是否有鱼竿 */
  get hasFishingRod(): boolean {
    return hasFishingRod(this.name);
  }

  /** 是否已抛竿（有鱼钩） */
  get isFishing(): boolean {
    return hasFishingHook(this.name);
  }

  /** 抛竿 */
  castRod(): Promise<import("../features/task/fishing").CastRodResult> {
    return castFishingRod(this.name);
  }

  /** 收竿 */
  reelRod(): Promise<import("../features/task/fishing").ReelRodResult> {
    return reelFishingRod(this.name);
  }

  // ─── 原子能力：主手 ──────────────────────────────────

  /** 主手选择列表（undefined=不可用；空数组=背包无物品） */
  getMainhandOptions(): import("../features/basic/items").MainhandOption[] | undefined {
    return getMainhandOptions(this.name);
  }

  /** 设置主手槽（-1=清空；>=0=背包槽位） */
  setMainhand(slotValue: number): void {
    setMainhandSlot(this.name, slotValue);
  }

  // ─── 原子能力：控制/状态 ─────────────────────────────

  /** 切换控制权（委托 basic/control） */
  toggleControl(controller: Player): void {
    toggleControl(this.record, controller);
  }

  /** 检查主手耐久（事件驱动补充；委托 basic/toolHealth） */
  checkMainhandDurability(changedSlot: number): void {
    const bot = this.entity;
    if (!bot) return;
    checkMainHandDurability(bot as Player, changedSlot);
  }

  /** 使用主手物品一次（闭包异步多状态：UseItemResult，永不 reject） */
  async useItem(): Promise<import("../features/basic/items/useItem").UseItemResult> {
    return useItemOnce(this.record);
  }

  /** 停止使用物品 */
  stopUsing(): void {
    try {
      this.entity?.stopUsingItem();
    } catch { /* ignore */ }
  }

  // ─── 原子能力：生命周期（委托 manage） ───────────────

  /** 上线（委托 manage/onlineBot；多状态结果，永不 reject） */
  async bringOnline(): Promise<import("../features/manage/onlineBot").OnlineResult> {
    return onlineBot(this.record);
  }

  /** 下线（委托 manage/offlineBot） */
  takeOffline(): void {
    offlineBot(this.record);
  }

  /** 击杀（委托 manage/killBot） */
  kill(): void {
    killBot(this.record);
  }

  /** 删除（委托 manage/deleteBot） */
  delete(reclaimTo?: Player): void {
    deleteBot(this.record, reclaimTo);
  }

  /** 安全重连（委托 manage/pendingRespawn） */
  safeReconnect(options?: import("../features/manage/pendingRespawn").SafeReconnectOptions): void {
    safeReconnect(this.record, options);
  }

  /** 切换生成模式（委托 manage/spawnMode） */
  switchSpawnMode(newMode: import("../features/manage/spawnMode").SpawnMode): void {
    switchSpawnMode(this.record, newMode);
  }

  /** 传送玩家到自己（委托 basic/teleport） */
  tpPlayerHere(player: Player): void {
    tpPlayerToBot(player, this.record);
  }

  /** 传送自己到玩家（委托 basic/teleport） */
  tpToPlayer(player: Player): void {
    tpBotToPlayer(this.record, player);
  }

  // ─── 原子能力：装备交换（委托 basic/equip，闭包异步） ──

  /** 与玩家交换主手（异步多状态：SwapResult） */
  async swapMainhand(player: Player): Promise<import("../features/basic/items/equip").SwapResult> {
    const bot = this.entity;
    if (!bot) return SwapResult.NoEntity;
    return swapMainhandWithBot(player, bot as Player);
  }

  /** 与玩家交换副手（异步多状态：SwapResult） */
  async swapOffhand(player: Player): Promise<import("../features/basic/items/equip").SwapResult> {
    const bot = this.entity;
    if (!bot) return SwapResult.NoEntity;
    return swapOffhandWithBot(player, bot as Player);
  }

  /** 与玩家交换全部装备（异步多状态：SwapResult） */
  async swapEquipment(player: Player): Promise<import("../features/basic/items/equip").SwapResult> {
    const bot = this.entity;
    if (!bot) return SwapResult.NoEntity;
    return swapEquipmentWithBot(player, bot as Player);
  }

  /** 回收（委托 manage/reclaim） */
  reclaim(player: Player, options?: import("../service/ReclaimPlanner").ReclaimOptions): import("../features/manage/reclaim").ReclaimResult {
    return reclaimBot(player, this.record, options);
  }

  /** 回收预览 */
  getReclaimPreview(): ReturnType<typeof import("../features/manage/reclaim").getReclaimPreview> {
    return getReclaimPreview(this.record);
  }

  // ─── 原子能力：三叉戟（委托 trident） ────────────────

  /** 扫描三叉戟（委托 trident/trident） */
  scanTridents(): import("../features/trident/trident").TridentSlot[] | undefined {
    return scanTridents(this.name);
  }

  /** 主手是否三叉戟 */
  get isMainhandTrident(): boolean {
    return isMainhandTrident(this.name);
  }

  /** 投掷三叉戟一轮（闭包异步多状态：ThrowResult；兼容 onComplete 回调） */
  async throwTridents(playerId: string, slots: number[], onComplete?: () => void): Promise<import("../features/trident/trident").ThrowResult> {
    return throwTridents(this.name, playerId, slots, onComplete);
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
