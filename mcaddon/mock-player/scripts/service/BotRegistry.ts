// ─── 假人注册表（core 层） ──────────────────────────────
// 内存注册表 + 生命周期状态 + 恢复标记，持久化经 BotStore 端口注入。
// mc 层通过 bootstrap/context 持有单例，测试用 InMemoryBotStore 直接构造。

import type { BotRecord } from "../rules/Types";
import type { BotStore } from "./port/BotStore";

export class BotRegistry {
  private readonly records = new Map<string, BotRecord>();
  private readonly restoredBots = new Set<string>();

  constructor(private readonly store: BotStore) {}

  /** 注册表条目数 */
  get size(): number {
    return this.records.size;
  }

  get(name: string): BotRecord | undefined {
    return this.records.get(name);
  }

  has(name: string): boolean {
    return this.records.has(name);
  }

  /** 全部记录（内存视图） */
  all(): BotRecord[] {
    return [...this.records.values()];
  }

  /** 仅更新内存（高频路径：行为引擎逐 tick 更新 lastPoint 等） */
  set(record: BotRecord): void {
    this.records.set(record.name, record);
  }

  /** 更新内存并立即持久化（事件驱动写穿；高频周期路径传 silent 防刷日志） */
  save(record: BotRecord, silent = false): void {
    this.records.set(record.name, record);
    this.store.saveRecord(record, silent);
  }

  /**
   * 删除假人：内存 + 持久化记录 + 背包/装备数据 + 恢复标记
   * 由 deleteBot / killBot（无回收剩余）调用
   */
  remove(name: string): void {
    this.records.delete(name);
    this.store.removeRecord(name);
    this.store.removeInventory(name);
    this.restoredBots.delete(name);
  }

  /**
   * 假人改名：内存 key 迁移 + 持久化新 key + 绑定表迁移 + 恢复标记随迁
   * ⚠️ 旧 key 持久化记录必须清理（否则重启后 loadAllRecords 会载入幽灵旧假人）
   */
  rename(oldName: string, newName: string): void {
    const record = this.records.get(oldName);
    if (!record) return;
    this.records.delete(oldName);
    record.name = newName;
    this.records.set(newName, record);
    this.store.saveRecord(record);
    // 清旧 key 持久化记录：防止重启后出现"改名前的幽灵假人"
    this.store.removeRecord(oldName);
    // 绑定表独立存储：key 含假人名，改名需迁移（bind 数据跟随记录）
    this.store.renameBinding?.(oldName, newName);
    if (this.restoredBots.has(oldName)) {
      this.restoredBots.delete(oldName);
      this.restoredBots.add(newName);
    }
  }

  /**
   * 世界重启时恢复全部记录
   * 重启后所有假人默认为 offline / 非死亡 / 无实体 ID 状态，并回写持久化
   */
  restoreAll(): BotRecord[] {
    const loaded = this.store.loadAllRecords();
    for (const record of loaded) {
      record.online = false;
      record.death = false;
      record.entityId = undefined;
      this.records.set(record.name, record);
      this.store.saveRecord(record);
    }
    return [...this.records.values()];
  }

  // ── 恢复标记（防空背包覆写） ──
  //
  // ⚠️ 高危漏洞防护：
  //   spawnSimulatedPlayer 生成的假人自带空背包。
  //   如果在 playerJoin 恢复完成之前触发保存（如 100tick 周期、playerLeave 等），
  //   空背包数据会覆盖持久化的真实数据，造成背包永久清空。
  //
  //   此 Set 记录已完成恢复的假人名，保存逻辑遇到未恢复的假人直接跳过。
  //   世界重启后 Set 自动清空（内存数据），每个假人重新走恢复流程后重新标记。
  //
  //   标记时机：playerJoin 恢复完成后 → markRestored
  //   检查时机：保存流程开头 → isRestored
  //   清理时机：deleteBot → remove（自动清理）

  markRestored(name: string): void {
    this.restoredBots.add(name);
  }

  isRestored(name: string): boolean {
    return this.restoredBots.has(name);
  }

  removeRestored(name: string): void {
    this.restoredBots.delete(name);
  }
}