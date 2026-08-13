// ─── MockBot：假人面向对象实例（mc/bot） ──────────────
// `new MockBot(record)` 持有 botRegistry 单例 record 引用（改动即时生效，
// 实例跨下线/重连持续可用——实体每次操作惰性解析，含全守卫）。
// 基础操作全部实例化（**薄门面封装 features 单一事实源**，不双实现）：
//   生命周期 / 移动导航 / 交互体态 / 背包装备 / 使用物品 / 传送信息。
// 每实例一个独立 BotEngine（能力/任务），由 BotManager 驱动器每 tick 推进。

import {
  Container,
  Direction,
  ItemStack,
  Player,
  Vector3,
  world,
} from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { BotEngine, type BotContext, type BotTask } from "../../core/bot/Engine";
import {
  countItemTotal,
  findEmptySlot as findEmptySlotPure,
  findFirstItemByPriority as findFirstByPriority,
  findItemSlots as findItemSlotsPure,
  isValidSlot,
  type SlotView,
} from "../../core/bot/Inventory";
import { botRegistry } from "../bootstrap/context";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";
import { killBot } from "../features/killBot";
import { deleteBot } from "../features/deleteBot";
import { setTags } from "../features/setTags";
import { moveBot } from "../features/move";
import { setSneaking } from "../features/sneak";
import { lookAt as poseLookAt, setPose } from "../adapters/PoseGateway";
import { getMainhandOptions, setMainhandSlot } from "../features/mainhand";
import { swapMainhandWithBot, swapOffhandWithBot, swapEquipmentWithBot } from "../features/equip";
import { startUseItem, stopUseItem } from "../features/useItem";
import { tpPlayerToBot, tpBotToPlayer } from "../features/teleport";
import { sendData } from "../commands/data";
import { switchSpawnMode, type SpawnMode } from "../features/spawnMode";

/** 引擎执行上下文（mc 实现：tags 读 record、tick 读引擎计数） */
class MockBotContext implements BotContext {
  constructor(private readonly bot: MockBot) {}

  get tags(): readonly string[] {
    return this.bot.record.tags;
  }

  get tick(): number {
    return this.bot.engine.currentTick;
  }
}

export class MockBot {
  /** 假人记录引用（botRegistry 单例对象，改动即时生效） */
  readonly record: BotRecord;
  /** 独立行为引擎（持续能力 + 复杂任务） */
  readonly engine = new BotEngine();
  /** 引擎执行上下文 */
  readonly context: BotContext;

  constructor(record: BotRecord) {
    this.record = record;
    this.context = new MockBotContext(this);
  }

  /** 按名字取实例（registry 无记录 → undefined） */
  static from(name: string): MockBot | undefined {
    const record = botRegistry.get(name);
    return record ? new MockBot(record) : undefined;
  }

  // ── 基础信息 ────────────────────────────────────────

  /** 假人名字 */
  get name(): string {
    return this.record.name;
  }

  /** 当前实体（全守卫解析：在线/未死亡/entityId 有效/BOT_TAG/isValid） */
  getEntity(): SimulatedPlayer | undefined {
    if (!this.record.online || this.record.death || !this.record.entityId) return undefined;
    try {
      const e = world.getEntity(this.record.entityId);
      if (!e || !e.hasTag(BOT_TAG) || !e.isValid) return undefined;
      return e as SimulatedPlayer;
    } catch {
      return undefined;
    }
  }

  /** 在线且未死亡（引擎驱动/操作前置判定） */
  isActive(): boolean {
    return this.record.online && !this.record.death;
  }

  // ── 生命周期 ────────────────────────────────────────

  /** 恢复上线（异步：等待名称唯一后生成） */
  online(): Promise<SimulatedPlayer> {
    return onlineBot(this.record);
  }

  /** 下线（保存全量后断开） */
  offline(): void {
    offlineBot(this.record);
  }

  /** 击杀（走 entityDie 流程） */
  kill(): void {
    killBot(this.record);
  }

  /** 删除（可选回收资源；释放存储槽位） */
  delete(reclaimTo?: Player): void {
    deleteBot(this.record, reclaimTo);
  }

  /** 改名（registry 内部 key 迁移 + 绑定表随迁；⚠️ 需先下线） */
  rename(newName: string): void {
    botRegistry.rename(this.record.name, newName);
  }

  /** 标签更新（唯一落库渠道：记录 + 实体同步 + 持久化） */
  setTags(newTags: string[], controllerPlayer?: Player): string | undefined {
    return setTags(this.record, newTags, controllerPlayer);
  }

  /** 切换生成模式（离线路径显式写穿持久化） */
  switchSpawnMode(mode: SpawnMode): void {
    switchSpawnMode(this.record, mode);
  }

  // ── 移动 / 导航 ─────────────────────────────────────

  /** 一次性导航到坐标（路径不完整仍会移动） */
  navigateTo(target: Vector3): boolean {
    return moveBot(this.record, target);
  }

  /** 停止移动（try-catch 防护） */
  stopNavigation(): void {
    const bot = this.getEntity();
    if (!bot) return;
    try {
      bot.stopMoving();
    } catch {
      /* ignore */
    }
  }

  // ── 交互 / 体态 ─────────────────────────────────────

  /** 看向目标点（chunkload 模式 GameTest 限制抛错时降级忽略） */
  lookAt(target: Vector3): void {
    const bot = this.getEntity();
    if (bot) poseLookAt(bot, target);
  }

  /** 与方块交互一次（视线命中面，Down 兜底） */
  interactWithBlock(pos: Vector3): boolean {
    const bot = this.getEntity();
    if (!bot) return false;
    this.lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    let face: Direction = Direction.Down;
    try {
      const hit = bot.getBlockFromViewDirection({ maxDistance: 8 });
      if (hit) face = hit.face;
    } catch {
      /* 视线读取失败用兜底面 */
    }
    try {
      return bot.interactWithBlock(pos, face);
    } catch {
      return false;
    }
  }

  /** 设置姿态（teleport 朝向 + 持续注视；内部 try-catch 降级） */
  setPose(rotation: { x: number; y: number }, lookTarget?: Vector3): void {
    const bot = this.getEntity();
    if (bot) setPose(bot, rotation, lookTarget);
  }

  /** 潜行开关（记录 + 实体同步 + 持久化） */
  setSneaking(sneaking: boolean): void {
    setSneaking(this.record, sneaking);
  }

  // ── 背包 ────────────────────────────────────────────

  /** 安全获取背包容器（组件缺失/实体失效返回 undefined） */
  getContainer(): Container | undefined {
    const bot = this.getEntity();
    if (!bot) return undefined;
    try {
      const inv = bot.getComponent("minecraft:inventory") as { container?: Container } | undefined;
      return inv?.container;
    } catch {
      return undefined;
    }
  }

  /** 当前选中的热栏槽（即主手槽） */
  heldSlotIndex(): number {
    const bot = this.getEntity();
    return bot?.selectedSlotIndex ?? 0;
  }

  /** 主手物品（统一语义：selectedSlotIndex + container） */
  getHeldItem(): ItemStack | undefined {
    const container = this.getContainer();
    if (!container) return undefined;
    try {
      return container.getItem(this.heldSlotIndex());
    } catch {
      return undefined;
    }
  }

  /** 查找指定物品的所有槽位（空结果 = 背包没有） */
  findItemSlots(typeId: string): number[] {
    return findItemSlotsPure(this.slotView(), typeId);
  }

  /** 查找指定物品的第一个槽位（undefined = 背包没有） */
  findItem(typeId: string): number | undefined {
    return this.findItemSlots(typeId)[0];
  }

  /** 按优先级顺序找第一个匹配物品的槽位（undefined = 都没有） */
  findFirstItem(typeIds: string[]): number | undefined {
    return findFirstByPriority(this.slotView(), typeIds);
  }

  /** 统计指定物品在背包中的总数量 */
  countItem(typeId: string): number {
    return countItemTotal(this.slotView(), typeId);
  }

  /** 找第一个空槽（undefined = 背包已满） */
  findEmptySlot(): number | undefined {
    return findEmptySlotPure(this.slotView());
  }

  /** 交换两个槽位（同容器原生 swapItems，边界校验 + 异常防护） */
  swapItems(slotA: number, slotB: number): boolean {
    const container = this.getContainer();
    const view = this.slotView();
    if (!container || !isValidSlot(view, slotA) || !isValidSlot(view, slotB)) return false;
    try {
      container.swapItems(slotA, slotB, container);
      return true;
    } catch {
      return false;
    }
  }

  /** 将背包中的某个物品交换到指定槽位（默认 slot 0；已在目标槽算成功） */
  swapItemToSlot(typeId: string, toSlot = 0): boolean {
    const fromSlot = this.findItem(typeId);
    if (fromSlot === undefined) return false;
    if (fromSlot === toSlot) return true;
    return this.swapItems(fromSlot, toSlot);
  }

  /** 确保主手是候选物品之一（主手已是 → 返回类型；否则按优先级换到主手） */
  ensureMainhand(typeIds: string[]): string | undefined {
    const held = this.getHeldItem();
    if (held && typeIds.includes(held.typeId)) return held.typeId;
    const slot = this.findFirstItem(typeIds);
    if (slot === undefined) return undefined;
    const handSlot = this.heldSlotIndex();
    if (!this.swapItems(slot, handSlot)) return undefined;
    return this.getHeldItem()?.typeId ?? typeIds[0];
  }

  /** 主手选择列表（决策在 core/items/MainhandPolicy） */
  getMainhandOptions(): ReturnType<typeof getMainhandOptions> {
    return getMainhandOptions(this.record.name);
  }

  /** 将指定槽位物品置换到主手并选中（-1 = 清空） */
  setMainhandSlot(slotValue: number): void {
    setMainhandSlot(this.record.name, slotValue);
  }

  // ── 装备 / 使用 ─────────────────────────────────────

  /** 与玩家互换主手 */
  swapMainhandWith(player: Player): boolean {
    const bot = this.getEntity();
    if (!bot) return false;
    return swapMainhandWithBot(player, bot);
  }

  /** 与玩家互换副手 */
  swapOffhandWith(player: Player): boolean {
    const bot = this.getEntity();
    if (!bot) return false;
    return swapOffhandWithBot(player, bot);
  }

  /** 与玩家互换全部装备（头/胸/腿/靴/副手） */
  swapEquipmentWith(player: Player): boolean {
    const bot = this.getEntity();
    if (!bot) return false;
    return swapEquipmentWithBot(player, bot);
  }

  /** 使用主手物品（40tick 后自动停下） */
  useItem(player: Player): void {
    startUseItem(player, this.record);
  }

  /** 停止使用主手物品 */
  stopUsingItem(player: Player): void {
    stopUseItem(player, this.record);
  }

  // ── 传送 / 信息 ─────────────────────────────────────

  /** 把玩家传送到假人身边 */
  tpPlayerToBot(player: Player): void {
    tpPlayerToBot(player, this.record);
  }

  /** 把假人拉到玩家身边并同步姿态 */
  tpBotToPlayer(player: Player): void {
    tpBotToPlayer(this.record, player);
  }

  /** 查看完整数据（记录/背包/装备/经验） */
  sendData(player: Player): void {
    sendData(player, this.record);
  }

  // ── 引擎 ────────────────────────────────────────────

  /** 启动复杂任务（一次一活跃任务；已有活跃 → false） */
  startTask(task: BotTask): boolean {
    return this.engine.startTask(task, this.context);
  }

  /** 取消当前活跃任务 */
  cancelTask(): boolean {
    return this.engine.cancelTask(this.context);
  }

  /** 当前活跃任务 id */
  get activeTaskId(): string | undefined {
    return this.engine.activeTaskId;
  }

  // ── 私有 ────────────────────────────────────────────

  /** 容器 → 槽位视图数组（core 纯函数输入；读取失败返回空数组） */
  private slotView(): SlotView[] {
    const container = this.getContainer();
    if (!container) return [];
    try {
      const inv: SlotView[] = [];
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        inv.push(item ? { typeId: item.typeId, amount: item.amount } : undefined);
      }
      return inv;
    } catch {
      return [];
    }
  }
}
