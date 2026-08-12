// ─── DynamicProperty 持久化适配（mc 层） ────────────────
// 实现 core/storage 的 BotStore 端口（DynamicProperty 后端）。
//
// key 设计（避免 32KB 上限）：
//   mockplayer:players:<name>           — BotRecord（位置/标签/经验等）
//   mockplayer:players:<name>:inv:<N>   — 背包第 N 格（slot 0-35）
//   mockplayer:players:<name>:equip:<X> — 装备槽（head/chest/legs/feet/offhand）
//
// 载入时用 getDynamicPropertyIds() 枚举所有 key 按前缀过滤
// 清理时只删 inv: 和 equip: 子 key，不动主 record

import { world } from "@minecraft/server";
import type { BotRecord, SerializedItemStack } from "../../core/model/Types";
import { DP_PREFIX, INVENTORY_SIZE } from "../../core/model/Types";
import type { BotStore } from "../../core/storage/BotStore";

const INV_PREFIX = ":inv:";
const EQUIP_PREFIX = ":equip:";

export class McBotStore implements BotStore {
  // ── 基础记录 ──
  // BotRecord 存到单条 DynamicProperty，上限 32KB（不含背包/装备）

  private getDPKey(name: string): string {
    return `${DP_PREFIX}${name}`;
  }

  saveRecord(record: BotRecord, silent = false): void {
    try {
      world.setDynamicProperty(this.getDPKey(record.name), JSON.stringify(record));
      if (!silent) {
        console.info(`[MockPlayer] 记录保存 ${record.name}（在线=${record.online} 死亡=${record.death} 经验Lv=${record.experience.level}）`);
      }
    } catch (e: any) {
      console.error(`[MockPlayer] 保存假人 ${record.name} 失败: ${e.message}`);
    }
  }

  loadRecord(name: string): BotRecord | undefined {
    const value = world.getDynamicProperty(this.getDPKey(name));
    if (typeof value !== "string") return undefined;
    try {
      const record = JSON.parse(value) as BotRecord;
      console.info(`[MockPlayer] 加载单条记录 ${name}`);
      return record;
    } catch {
      console.error(`[MockPlayer] 加载记录 ${name} 损坏`);
      return undefined;
    }
  }

  /**
   * 世界重启时加载所有假人记录
   * 注意：需要跳过 :inv: 和 :equip: 子 key，它们由独立的 loadBotInventory / loadBotEquipment 加载
   */
  loadAllRecords(): BotRecord[] {
    const ids = world.getDynamicPropertyIds();
    const records: BotRecord[] = [];
    for (const id of ids) {
      if (!id.startsWith(DP_PREFIX)) continue;
      // 跳过背包/装备子 key（以 :inv: 或 :equip: 结尾的 segment）
      if (id.includes(INV_PREFIX) || id.includes(EQUIP_PREFIX)) continue;
      const value = world.getDynamicProperty(id);
      if (typeof value !== "string") continue;
      try {
        records.push(JSON.parse(value) as BotRecord);
      } catch {
        console.error(`[MockPlayer] 加载记录 ${id} 损坏已跳过`);
      }
    }
    console.info(`[MockPlayer] 世界加载恢复 ${records.length} 个假人记录`);
    return records;
  }

  removeRecord(name: string): void {
    world.setDynamicProperty(this.getDPKey(name), undefined);
    console.info(`[MockPlayer] 删除记录 ${name}`);
  }

  // ── 背包持久化（每格独立 key，避免 32KB 上限） ──
  //
  // slot 0-8 = 快捷栏，9-35 = 背包
  // 空位存 undefined（即删除 key），避免数据膨胀
  //
  // 使用 playerInventoryItemChange 事件实时保存单格变化
  // 离线/死亡时批量保存全部 36 格

  /** 保存单个背包格子（传入 null 或 undefined 会删除该 key） */
  saveSlot(name: string, slot: number, item: SerializedItemStack | null): void {
    const key = `${DP_PREFIX}${name}${INV_PREFIX}${slot}`;
    if (item) {
      world.setDynamicProperty(key, JSON.stringify(item));
    } else {
      // 空位删除 key，避免无用数据累积
      world.setDynamicProperty(key, undefined);
    }
  }

  /**
   * 保存假人全部 36 格背包
   *
   * ⚠️ 当前使用 DynamicProperty 按格序列化，潜影盒/收纳袋的内部物品
   *    因 API 限制不会真实保存（见 serializeItemStack 注释）。
   *    如需支持，需要在存/加载时分流：
   *      - 普通物品 → DynamicProperty（现有逻辑）
   *      - 特殊物品（typeId 白名单中的容器类）→ structureManager
   *    见 scripts/lib/ItemStorage.ts 预留实现。
   */
  saveInventory(name: string, items: (SerializedItemStack | null)[]): void {
    const nonEmpty = items.filter((i) => i !== null).length;
    for (let i = 0; i < items.length && i < INVENTORY_SIZE; i++) {
      this.saveSlot(name, i, items[i]);
    }
    console.info(`[MockPlayer] 背包保存 ${name}——${nonEmpty}/${items.length} 格`);
  }

  /**
   * 加载假人全部 36 格背包
   * 枚举所有 <name>:inv: 前缀的 key，按 slot 填入数组
   * 未找到任何 key 时返回 undefined（而非空数组），调用方据此判断是否需要恢复
   */
  loadInventory(name: string): (SerializedItemStack | null)[] | undefined {
    const ids = world.getDynamicPropertyIds();
    const prefix = `${DP_PREFIX}${name}${INV_PREFIX}`;
    const result: (SerializedItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
    let found = false;
    for (const id of ids) {
      if (!id.startsWith(prefix)) continue;
      const slotStr = id.slice(prefix.length);
      const slot = parseInt(slotStr);
      if (isNaN(slot) || slot < 0 || slot >= INVENTORY_SIZE) continue;
      const value = world.getDynamicProperty(id);
      if (typeof value === "string") {
        try {
          result[slot] = JSON.parse(value) as SerializedItemStack;
          found = true;
        } catch {
          console.error(`[MockPlayer] 加载背包 ${name} slot ${slot} 损坏`);
        }
      }
    }
    const count = result.filter((i) => i !== null).length;
    if (found) console.info(`[MockPlayer] 背包加载 ${name}——${count}/${INVENTORY_SIZE} 格`);
    return found ? result : undefined;
  }

  // ── 装备栏持久化 ──
  //
  // 装备槽没有变化事件，依赖 100tick 周期保存 + 离线/死亡兜底
  // key 格式：mockplayer:players:<name>:equip:<slotName>
  //
  // ⚠️ 注意：world.getEntity 在 playerLeave 中可能已不可访问
  // 所以装备在 entityDie 中保存最可靠

  /** 保存单个装备槽 */
  saveEquipSlot(name: string, slot: string, item: SerializedItemStack | null): void {
    const key = `${DP_PREFIX}${name}${EQUIP_PREFIX}${slot}`;
    if (item) {
      world.setDynamicProperty(key, JSON.stringify(item));
    } else {
      world.setDynamicProperty(key, undefined);
    }
  }

  /** 保存全部装备栏 */
  saveEquipment(
    name: string,
    equipment: Record<string, SerializedItemStack | null>,
    silent = false
  ): void {
    const slots = Object.keys(equipment);
    const nonEmpty = Object.values(equipment).filter((i) => i !== null).length;
    for (const [slot, item] of Object.entries(equipment)) {
      this.saveEquipSlot(name, slot, item);
    }
    if (!silent) console.info(`[MockPlayer] 装备保存 ${name}——${nonEmpty}/${slots.length} 槽`);
  }

  /** 加载全部装备栏，返回 { head?, chest?, legs?, feet?, offhand? } */
  loadEquipment(name: string): Record<string, SerializedItemStack> | undefined {
    const ids = world.getDynamicPropertyIds();
    const prefix = `${DP_PREFIX}${name}${EQUIP_PREFIX}`;
    const result: Record<string, SerializedItemStack> = {};
    for (const id of ids) {
      if (!id.startsWith(prefix)) continue;
      const slot = id.slice(prefix.length);
      const value = world.getDynamicProperty(id);
      if (typeof value === "string") {
        try {
          result[slot] = JSON.parse(value) as SerializedItemStack;
        } catch {
          console.error(`[MockPlayer] 加载装备 ${name} ${slot} 损坏`);
        }
      }
    }
    const count = Object.keys(result).length;
    if (count > 0) console.info(`[MockPlayer] 装备加载 ${name}——${count}/5 槽`);
    return count > 0 ? result : undefined;
  }

  /** 删除假人的全部背包 + 装备数据（删除假人时调用） */
  removeInventory(name: string): void {
    const ids = world.getDynamicPropertyIds();
    const baseKey = `${DP_PREFIX}${name}`;
    for (const id of ids) {
      if (id.startsWith(baseKey + INV_PREFIX) || id.startsWith(baseKey + EQUIP_PREFIX)) {
        world.setDynamicProperty(id, undefined);
      }
    }
  }
}