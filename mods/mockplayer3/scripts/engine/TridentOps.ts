// ─── 三叉戟投掷原子（逐把串行投掷链） ──────────────────────────────
// 时序：注册 pending 快照 → 主手移位（移动非交换：源槽置空防双把同槽）
//   → 2t → useItemInSlot 按下（不扭头，保持当前朝向）→ 20t 蓄力 →
//   stopUsingItem 释放 → 20t → 回读主手格（仍持三叉戟即未投出）→ 下一把。
// 投掷失败件仍在主手：立即中止本链剩余把（下一把移位会将其覆盖丢失），
//   收尾回写至移位时清空的源槽，回写不成则留在主手不动。
// 任何断链路径必须走到主手恢复，否则投掷锁永卡+跟随永停——async/finally
// 覆盖异常/失效/失败全路径。
// 每假人互斥（A 投掷不阻塞 B）；永不 reject。主手格仅在处于本链留下状态
// （空格或失败未投出件）时被触碰，绝不覆盖他系统期间的改动。

import { EquipmentSlot } from "@minecraft/server";
import type { ItemStack } from "@minecraft/server";
import type { CancelToken } from "../domain/Cancellation";
import { INVENTORY_SIZE } from "../domain/Record";
import { TRIDENT_ID, isTrident, scanTridentSlots } from "../domain/TridentRules";
import type { TridentSlotInfo } from "../domain/TridentRules";
import { botOf, botValid, inventoryContainer, sleepTicks } from "./Atomic";
import { projectileTracker } from "./ProjectileTracker";
import { inventoryChanged } from "./Hooks";

/** 投掷时序（tick，引擎实测节奏下限） */
const SETTLE_BEFORE_THROW = 2;
const CHARGE_TICKS = 20;
const GAP_AFTER_RELEASE = 20;

/** 投掷链结果；ok 携带实际投出把数，thrown=0 表示槽位全空或全部未投出 */
export type ThrowResult = { status: "ok"; thrown: number } | { status: "already-throwing" } | { status: "not-online" };

/** 三叉戟扫描条目（UI 勾选源；附当下物品引用） */
export interface TridentSlot extends TridentSlotInfo {
  item: ItemStack;
}

/** 投掷链选项 */
export interface ThrowOptions {
  /** 取消令牌：等待节点提前结束，把与把之间的循环检查取消状态退出 */
  token?: CancelToken;
}

/** 单把三叉戟的尝试结果：槽位已空/换物、确认投出、未投出（件仍在主手） */
type ThrowAttempt = "skipped" | "thrown" | "not-thrown";

export class TridentOps {
  /** 投掷互斥（按 botId，A⊥B） */
  private readonly throwing = new Set<number>();

  /**
   * 扫描全部三叉戟（主手经装备组件判定；背包扫描排除主手格——防同一把
   * 重复计入）。假人不可用 undefined。
   */
  scanTridents(botId: number): TridentSlot[] | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    const container = inventoryContainer(bot);
    if (!container) return undefined;
    let mainhand: ItemStack | undefined;
    try {
      mainhand = bot.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    } catch {
      mainhand = undefined;
    }
    let selected: number;
    try {
      selected = bot.selectedSlotIndex;
    } catch {
      return undefined;
    }
    const typeIds: (string | null)[] = [];
    const items: (ItemStack | undefined)[] = [];
    for (let i = 0; i < Math.min(container.size, INVENTORY_SIZE); i++) {
      const item = container.getItem(i);
      typeIds.push(item?.typeId ?? null);
      items.push(item);
    }
    const mainhandIsTrident = mainhand !== undefined && isTrident(mainhand.typeId);
    const slots: TridentSlot[] = [];
    for (const s of scanTridentSlots(typeIds, selected, mainhandIsTrident)) {
      const item = s.isMainhand ? mainhand : items[s.slotIndex];
      if (item) slots.push({ ...s, item });
    }
    return slots;
  }

  /** 是否在投掷中（工作流 isRunning 查询） */
  isThrowing(botId: number): boolean {
    return this.throwing.has(botId);
  }

  /**
   * 按槽位序列逐把投掷（永不 reject；互斥防重入）。
   * 某把未投出即中止本链剩余把，未投出件由收尾回写源槽。
   * @param botId - 假人 id
   * @param slots - 三叉戟所在容器槽位（调用方自 scanTridents 取）
   * @param opts - 链选项（取消令牌）
   * @returns 链结果与实际投出把数
   */
  async throwTridents(botId: number, slots: number[], opts: ThrowOptions = {}): Promise<ThrowResult> {
    if (this.throwing.has(botId)) return { status: "already-throwing" };
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return { status: "not-online" };
    this.throwing.add(botId);
    let thrown = 0;
    try {
      thrown = await this.runChain(botId, slots, opts);
    } catch (e: any) {
      // 永不 reject 纪律（异步环境抛穿可崩游戏）
      console.error(`[mockplayer3] 投掷链异常 bot=${botId}: ${e?.message ?? e}`);
    } finally {
      this.throwing.delete(botId);
      inventoryChanged(botId); // 主手移位/消耗已过——报脏
    }
    return { status: "ok", thrown };
  }

  // ─── 私有 ──

  private async runChain(botId: number, slots: number[], opts: ThrowOptions): Promise<number> {
    const bot = botOf(botId);
    const container = bot ? inventoryContainer(bot) : undefined;
    if (!bot || !container) return 0;
    const mainhandSlot = this.selected(bot);
    let savedMainhand = container.getItem(mainhandSlot);
    let thrown = 0;
    // 未投出件的源槽；发生时该件正留在主手，至多一件
    let notThrownSource: number | undefined;
    try {
      for (const tridentSlot of slots) {
        if (opts.token?.cancelled) break;
        const outcome = await this.throwOne(botId, container, tridentSlot, mainhandSlot, opts);
        if (outcome === "skipped") continue;
        if (outcome !== "thrown") {
          notThrownSource = tridentSlot;
          break; // 件在主手，下一把移位会覆盖丢失——中止剩余
        }
        thrown++;
        // 从主手格本身投出：链始快照即该把已上天的件，不再回写
        if (tridentSlot === mainhandSlot) savedMainhand = undefined;
      }
    } finally {
      try {
        this.restoreMainhand(container, mainhandSlot, savedMainhand, notThrownSource);
      } catch {
        /* 恢复失败留给下一次全量对账 */
      }
    }
    return thrown;
  }

  private async throwOne(
    botId: number,
    container: NonNullable<ReturnType<typeof inventoryContainer>>,
    tridentSlot: number,
    mainhandSlot: number,
    opts: ThrowOptions
  ): Promise<ThrowAttempt> {
    const tridentItem = container.getItem(tridentSlot);
    if (!tridentItem || !isTrident(tridentItem.typeId)) return "skipped"; // 槽位已空/换物——跳过
    // 投掷前注册快照（entitySpawn 队尾消费打 mp:item: tag）
    projectileTracker.registerPending(botId, tridentItem);
    // 换到主手：移动非交换（源槽置空防双把同槽）；主手原物由收尾统一
    // 恢复，中途不回填（链上各把共用一个暂存位）
    if (tridentSlot !== mainhandSlot) {
      container.setItem(mainhandSlot, tridentItem);
      container.setItem(tridentSlot, undefined);
    }
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) {
      projectileTracker.discardPending(botId);
      return "not-thrown"; // 件已移位未投出，留待收尾回写
    }
    try {
      bot.selectedSlotIndex = mainhandSlot;
    } catch {
      /* 选中写失败仍尝试按下 */
    }
    await sleepTicks(SETTLE_BEFORE_THROW, opts.token); // 移位落定
    let used = false;
    try {
      used = bot.useItemInSlot(mainhandSlot); // 不扭头：保持当前朝向投掷
    } catch {
      projectileTracker.discardPending(botId);
      return "not-thrown";
    }
    if (!used) {
      projectileTracker.discardPending(botId); // 投掷未发生——撤回本快照不留旧附魔
      return "not-thrown";
    }
    await sleepTicks(CHARGE_TICKS, opts.token); // 蓄力（trident 15-20t）
    const fresh = botOf(botId);
    if (!fresh || !botValid(fresh)) {
      projectileTracker.discardPending(botId); // 死亡/下线瞬间，件未释放仍在手
      return "not-thrown";
    }
    try {
      fresh.stopUsingItem();
    } catch {
      /* 释放失败不直接判定——下方回读定成败 */
    }
    await sleepTicks(GAP_AFTER_RELEASE, opts.token); // 与下一把的间隔
    // 成败回读：投出后件变投射物、主手格必为空；仍持三叉戟即未投出
    if (container.getItem(mainhandSlot)?.typeId === TRIDENT_ID) {
      projectileTracker.discardPending(botId); // entitySpawn 未发生——撤回本快照
      return "not-thrown";
    }
    return "thrown";
  }

  /**
   * 链收尾：先处置未投出失败件，再恢复链始快照。
   * 仅当主手格为空（投出后正常离手）或仍是失败件本身时才写该格。
   * @param container - 背包容器
   * @param mainhandSlot - 链始主手槽位
   * @param saved - 链始主手快照（已投出的本格件由调用方置 undefined）
   * @param notThrownSource - 失败件源槽；无失败件为 undefined
   */
  private restoreMainhand(
    container: NonNullable<ReturnType<typeof inventoryContainer>>,
    mainhandSlot: number,
    saved: ItemStack | undefined,
    notThrownSource: number | undefined
  ): void {
    const current = container.getItem(mainhandSlot);
    if (notThrownSource !== undefined && current?.typeId === TRIDENT_ID) {
      // 失败件仍在主手：回写移位时清空的源槽；源槽被占或本槽即源位则留在手不回写快照
      if (notThrownSource === mainhandSlot || container.getItem(notThrownSource) !== undefined) return;
      container.setItem(notThrownSource, current);
      container.setItem(mainhandSlot, undefined);
    } else if (current !== undefined) {
      // 主手现持非本链留下的件（他系统改动）——不动该格
      return;
    }
    if (saved !== undefined) container.setItem(mainhandSlot, saved);
  }

  private selected(bot: { selectedSlotIndex: number }): number {
    try {
      return bot.selectedSlotIndex;
    } catch {
      return 0;
    }
  }
}

/** 进程级单例 */
export const tridentOps = new TridentOps();
