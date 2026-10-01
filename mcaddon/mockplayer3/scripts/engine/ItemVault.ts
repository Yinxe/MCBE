// ─── NBT 木桶物品仓（@yinxe/nbt-data-storage 之上的假人语义层） ──────
// 首次写格由 put() 惰性分配 slotId 入绑定表，此后覆写原槽——槽位一经绑定永不漂移。
// 空槽写 structure_void 占位保持绑定（put 分配器视其为占用；读取按 typeId 跳过占位）。
// take 仅发生在删除假人（takeAll），是唯一槽位释放路径。
// 按绑定表 regionId 寻址（getRegion 采纳既有阵列，防锚点迁移后旧数据"看似丢失"）。
// 绑定表独立键写穿（mp:store:bind:<botId>），与记录覆写解耦。

import { ItemStack } from "@minecraft/server";
import { ItemStorage, type StoredRegion } from "@yinxe/nbt-data-storage";
import type { EquipSlotName, StorageBinding } from "../domain/Record";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../domain/Record";
import type { RecordStore } from "./RecordStore";

/**
 * 存储区域锚点：测试维度 (16,0,16)（玩家不可达，与装置区块列相邻不重叠）。
 * 桶层由 baseY 决定、anchor.y 被忽略；懒注册幂等，失败下轮重试。
 * regionId 含维度名，维度须与 Rig.TEST_DIMENSION 一致，否则寻不到既有阵列。
 */
const STORAGE_REGION = { dimension: "mockplayer:test", anchor: { x: 16, y: 0, z: 16 }, baseY: 0 };

/** 空槽占位物品（真实物品——防 put 分配器占用绑定空槽；读取视为空位） */
export const PLACEHOLDER_TYPE = "minecraft:structure_void";

/** 实体/物品对账的最小读写面（wielder/equpper 原子复用，避免每处取容器） */
export interface SlotWrite {
  slot: number;
  item: ItemStack | null;
}

export interface EquipSlotWrite {
  slot: EquipSlotName;
  item: ItemStack | null;
}

export class ItemVault {
  private region: StoredRegion | undefined;
  /** 绑定表内存缓存（写穿独立 DP 键） */
  private readonly bindings = new Map<number, StorageBinding>();

  constructor(private readonly store: RecordStore) {}

  /** 默认区域 id（新建记录 inventoryRef 用；区域未就绪时返回 null） */
  ensureRegionId(): string | null {
    return this.ensureRegion()?.regionId ?? null;
  }

  /**
   * 仓区当前可读可写吗（阵列所在区块已加载）。
   * ItemStorage.register 只发起常加载（异步），返回句柄≠区块就绪；
   * 区块未加载时逐格读全 undefined、写全失败，不可按"仓空"处理。
   * 探针取槽位 0：unknown=未加载；empty/occupied/damaged=已加载（damaged 归巡检，不挡读写）。
   */
  regionReady(regionId?: string): boolean {
    const region = regionId ? this.storageOf(regionId) : this.ensureRegion();
    if (!region) return false;
    try {
      if (region.probe(0) === "unknown") {
        // 常加载可能因容量不足/异步挂载未生效：重挂一次（幂等、同名去重），使重试可自愈
        region.ensureTickingArea();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 该假人是否绑过仓槽（有槽位才谈得上"读不到≠没有"——新假人零槽不拦） */
  hasStoredSlots(botId: number): boolean {
    const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
    if (!binding) return false;
    return Object.keys(binding.inv).length > 0 || Object.keys(binding.equip).length > 0;
  }

  /** 公开读绑定表（面板/迁移对账用） */
  getBinding(botId: number): StorageBinding | undefined {
    return this.bindings.get(botId) ?? this.store.loadBinding(botId);
  }

  /** 采纳迁移产物绑定表（零复制——旧物品仍在原槽位，写穿独立键） */
  adoptBinding(botId: number, binding: StorageBinding): void {
    this.bindings.set(botId, binding);
    this.store.writeBinding(botId, binding);
  }

  /** 丢弃绑定元数据（内存本体+独立键），不动木桶物品——供迁移写入后的回滚使用 */
  discardBinding(botId: number): void {
    this.bindings.delete(botId);
    this.store.deleteBinding(botId);
  }

  // ─── 保存（实体→仓） ──

  /** 保存全部背包格（0..35，空位传 null——已绑定则写占位保持绑定） */
  saveInventory(botId: number, items: (ItemStack | null)[]): void {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (let i = 0; i < Math.min(items.length, INVENTORY_SIZE); i++) {
      changed = this.writeSlot(storage, binding, i, items[i] ?? null) || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  /** 对账式批量保存指定背包格（只写变化的格） */
  saveSlots(botId: number, writes: SlotWrite[]): void {
    if (writes.length === 0) return;
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (const { slot, item } of writes) {
      changed = this.writeSlot(storage, binding, slot, item) || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  /** 保存全部装备槽（五槽，空槽传 null；主手不进仓） */
  saveEquipment(botId: number, equipment: (ItemStack | null)[]): void {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (let i = 0; i < EQUIP_SLOT_NAMES.length && i < equipment.length; i++) {
      changed = this.writeEquipSlot(storage, binding, EQUIP_SLOT_NAMES[i]!, equipment[i] ?? null) || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  /** 对账式批量保存指定装备槽 */
  saveEquipSlots(botId: number, writes: EquipSlotWrite[]): void {
    if (writes.length === 0) return;
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (const { slot, item } of writes) {
      changed = this.writeEquipSlot(storage, binding, slot, item) || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  // ─── 读取（仓→实体，RESTORING 导入源） ──

  /**
   * 读整包背包（真实 ItemStack，完整 NBT；占位=null）。
   * @returns 未绑定/仓空/区域不可用 → undefined（调用方判"无仓数据"）
   */
  readInventory(botId: number): (ItemStack | null)[] | undefined {
    const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
    if (!binding) return undefined;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return undefined;
    const slotIds: number[] = [];
    const indexes: number[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const sid = binding.inv[String(i)];
      if (sid !== undefined) {
        slotIds.push(sid);
        indexes.push(i);
      }
    }
    if (slotIds.length === 0) return undefined;
    const values = storage.readBatch(slotIds);
    const result: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
    let found = false;
    for (let k = 0; k < indexes.length; k++) {
      const item = values[k];
      if (item && item.typeId !== PLACEHOLDER_TYPE) {
        result[indexes[k]!] = item;
        found = true;
      }
    }
    return found ? result : undefined;
  }

  /** 读装备五槽（占位/空 → 键缺失）；全空或未绑定返回 undefined */
  readEquipment(botId: number): Partial<Record<EquipSlotName, ItemStack>> | undefined {
    const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
    if (!binding) return undefined;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return undefined;
    const slotIds: number[] = [];
    const names: EquipSlotName[] = [];
    for (const name of EQUIP_SLOT_NAMES) {
      const sid = binding.equip[name];
      if (sid !== undefined) {
        slotIds.push(sid);
        names.push(name);
      }
    }
    if (slotIds.length === 0) return undefined;
    const values = storage.readBatch(slotIds);
    const result: Partial<Record<EquipSlotName, ItemStack>> = {};
    for (let k = 0; k < names.length; k++) {
      const item = values[k];
      if (item && item.typeId !== PLACEHOLDER_TYPE) result[names[k]!] = item;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  // ─── 释放（删除假人唯一路径） ──

  /**
   * 取回并清空全部绑定槽；调用方须先取物后删仓。
   * @returns 全部真实物品（占位跳过）；同时删绑定表内存与 DP 键
   */
  takeAll(botId: number): (ItemStack | null)[] {
    const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
    const out: (ItemStack | null)[] = [];
    if (binding) {
      const storage = this.storageOf(binding.regionId);
      if (storage) {
        const all = [...Object.values(binding.inv), ...Object.values(binding.equip)];
        for (const sid of all) {
          const item = storage.take(sid);
          if (item && item.typeId !== PLACEHOLDER_TYPE) out.push(item);
        }
      }
    }
    this.bindings.delete(botId);
    this.store.deleteBinding(botId);
    return out;
  }

  // ─── 私有 ──

  /** 区域懒注册（register 幂等；失败告警下轮重试，不抛穿） */
  private ensureRegion(): StoredRegion | undefined {
    if (this.region) return this.region;
    try {
      this.region = ItemStorage.register(STORAGE_REGION);
    } catch (e: any) {
      console.error(`[mockplayer3] NBT 物品存储注册失败: ${e?.message ?? e}`);
    }
    return this.region;
  }

  /** 按绑定表 regionId 寻址（跨区域采纳，防旧锚点数据"看似丢失"） */
  private storageOf(regionId: string): StoredRegion | undefined {
    if (this.region && this.region.regionId === regionId) return this.region;
    return ItemStorage.getRegion(regionId) ?? this.ensureRegion();
  }

  /** 绑定表（惰性新建并写穿；区域不可用返回 undefined——本次保存放弃） */
  private bindingOf(botId: number): StorageBinding | undefined {
    const cached = this.bindings.get(botId);
    if (cached) return cached;
    const loaded = this.store.loadBinding(botId);
    if (loaded) {
      this.bindings.set(botId, loaded);
      return loaded;
    }
    const region = this.ensureRegion();
    if (!region) return undefined;
    const fresh: StorageBinding = { regionId: region.regionId, inv: {}, equip: {} };
    this.bindings.set(botId, fresh);
    this.store.writeBinding(botId, fresh);
    return fresh;
  }

  private persist(botId: number, binding: StorageBinding): void {
    this.bindings.set(botId, binding);
    this.store.writeBinding(botId, binding);
  }

  /** 单格写入；@returns 绑定表是否变化（新绑定才需写穿） */
  private writeSlot(storage: StoredRegion, binding: StorageBinding, slot: number, item: ItemStack | null): boolean {
    const key = String(slot);
    const bound = binding.inv[key];
    if (!item) {
      // 空位：已绑定写占位保持绑定；未绑定无操作
      if (bound !== undefined)
        this.writeOrLog(storage, bound, new ItemStack(PLACEHOLDER_TYPE, 1), `背包占位 slot=${slot}`);
      return false;
    }
    if (bound !== undefined) {
      this.writeOrLog(storage, bound, item, `背包保存 slot=${slot}`);
      return false;
    }
    const ref = storage.put(item);
    if (ref) {
      binding.inv[key] = ref.slotId;
      return true;
    }
    console.error(`[mockplayer3] 背包存储失败 slot=${slot}（区域满或区块未加载）`);
    return false;
  }

  private writeEquipSlot(
    storage: StoredRegion,
    binding: StorageBinding,
    slot: EquipSlotName,
    item: ItemStack | null
  ): boolean {
    const bound = binding.equip[slot];
    if (!item) {
      if (bound !== undefined) this.writeOrLog(storage, bound, new ItemStack(PLACEHOLDER_TYPE, 1), `装备占位 ${slot}`);
      return false;
    }
    if (bound !== undefined) {
      this.writeOrLog(storage, bound, item, `装备保存 ${slot}`);
      return false;
    }
    const ref = storage.put(item);
    if (ref) {
      binding.equip[slot] = ref.slotId;
      return true;
    }
    console.error(`[mockplayer3] 装备存储失败 ${slot}（区域满或区块未加载）`);
    return false;
  }

  private writeOrLog(storage: StoredRegion, slotId: number, item: ItemStack, label: string): void {
    const r = storage.write(slotId, item);
    if (!r.ok) console.error(`[mockplayer3] ${label} 失败: ${r.error ?? "未知错误"}`);
  }
}
