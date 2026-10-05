// ─── NBT 木桶物品仓（@yinxe/nbt-data-storage 之上的假人语义层） ──────
// 首次写格由 put() 惰性分配 slotId 入绑定表，此后覆写原槽——槽位一经绑定永不漂移。
// 空槽写 structure_void 占位保持绑定（put 分配器视其为占用；读取按 typeId 跳过占位）。
// 槽位释放只有两处：删除假人（takeAll）与兼容仓归位（迁完清源槽、失败回滚目标槽）。
// 按绑定表 regionId 严格寻址（寻不到即判区域不可用，不回落当次锚点，防旧 slotId 写错区域）。
// 绑定表独立键写穿（mp:store:bind:<botId>），与记录覆写解耦。
// 锚点二选一（domain/Compat.storageAnchorFor）：测试维度可用取首选 (16,0,16)，
// 不可用（低版本无自定义维度 API）取末地远点 (300000,0,300000)；升级后由归位流程迁回首选。

import { ItemStack } from "@minecraft/server";
import { chunkFromAnchor, ItemStorage, regionId, shortDimension, type StoredRegion } from "@yinxe/nbt-data-storage";
import { FALLBACK_STORAGE_ANCHOR, storageAnchorFor } from "../domain/Compat";
import type { EquipSlotName, StorageBinding } from "../domain/Record";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../domain/Record";
import { planBindingCarry } from "../domain/StorageCarry";
import type { RecordStore } from "./RecordStore";
import { customDimensionAvailable } from "./Rig";

/** 兼容锚点对应的区域 id（与 ItemStorage 内部同一算法；只算 id，不触世界） */
function fallbackRegionId(): string {
  const { cx, cz } = chunkFromAnchor(FALLBACK_STORAGE_ANCHOR.anchor.x, FALLBACK_STORAGE_ANCHOR.anchor.z);
  return regionId(shortDimension(FALLBACK_STORAGE_ANCHOR.dimension), cx, cz);
}

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

/** 单格写入结果 */
interface SlotWriteResult {
  /** 绑定表是否变化（新绑定需写穿） */
  bound: boolean;
  /** 是否写入成功（空位未绑定 = 无需写入，算成功） */
  ok: boolean;
}

/** 兼容仓归位结果 */
export interface VaultMigrationResult {
  /** 归位后的区域 id（档案 inventoryRef 须同步为它） */
  regionId: string;
  /** 实际迁入件数 */
  moved: number;
  /** 未搬运的绑定格数（占位/空格/读不到/同槽重复键） */
  skipped: number;
}

export class ItemVault {
  private region: StoredRegion | undefined;
  /** 当次注册用的锚点是否为末地兼容锚点（region 未注册时无意义） */
  private fallbackInUse = false;
  /** 最近一次注册异常原文（成功注册后清空）；供上层生成玩家可见原因 */
  private registerError: string | null = null;
  /** 绑定表内存缓存（写穿独立 DP 键） */
  private readonly bindings = new Map<number, StorageBinding>();

  constructor(private readonly store: RecordStore) {}

  /** 默认区域 id（新建记录 inventoryRef 用；区域未就绪时返回 null） */
  ensureRegionId(): string | null {
    return this.ensureRegion()?.regionId ?? null;
  }

  /** 最近一次木桶阵列注册异常原文（未失败为 null） */
  lastRegisterError(): string | null {
    return this.registerError;
  }

  /**
   * 仓区当前可读可写吗（阵列所在区块已加载）。
   * ItemStorage.register 只发起常加载（异步），返回句柄≠区块就绪；
   * 区块未加载时逐格读全 undefined、写全失败，不可按"仓空"处理。
   * 探针取槽位 0：unknown=未加载；empty/occupied/damaged=已加载（damaged 归巡检，不挡读写）。
   */
  regionReady(regionId?: string): boolean {
    const region = regionId ? this.storageOf(regionId) : this.ensureRegion();
    return region ? this.probeReady(region) : false;
  }

  // ─── 兼容锚点归位（升级后迁回首选锚点） ──

  /**
   * 列出绑定表落在兼容锚点、且不在线的假人（归位搬迁队列）。
   * @param isBusy - 在线判定（在线假人的仓保持原样，留到下次启动）
   * @returns 待搬 botId 升序；首选锚点不可用时为空表
   */
  fallbackBindingBotIds(isBusy: (botId: number) => boolean): number[] {
    if (!customDimensionAvailable()) return [];
    const fallbackId = fallbackRegionId();
    const out: number[] = [];
    for (const botId of this.store.listBindingBotIds()) {
      if (isBusy(botId)) continue;
      const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
      if (binding?.regionId === fallbackId) out.push(botId);
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * 把某假人的绑定表从兼容锚点迁回首选锚点：逐格读源仓 → 写目标仓，全部成功才改绑定表
   * 并清源槽；任一步失败回滚目标仓写入，源绑定与源物品保持原样（下次启动重试）。
   * 空位/占位槽不搬，对应绑定键不再写入目标表。
   * @param botId - 假人 id
   * @returns 新区域 id 与迁入件数；不可迁（无绑定/已在首选/首选不可用/区域未就绪）返回 null
   */
  migrateBindingToPrimary(botId: number): VaultMigrationResult | null {
    const binding = this.bindings.get(botId) ?? this.store.loadBinding(botId);
    if (!binding) return null;
    const target = this.primaryRegion();
    if (!target || binding.regionId === target.regionId) return null;
    // 严格按 regionId 取源区域：寻不到说明记录已失，绝不回落到当次锚点读错仓
    const source = this.storageOf(binding.regionId);
    if (!source) {
      console.error(`[mockplayer3] 兼容仓 ${binding.regionId} 区域记录缺失，bot=${botId} 归位跳过`);
      return null;
    }
    if (!this.probeReady(source) || !this.probeReady(target)) {
      console.warn(`[mockplayer3] 兼容仓归位暂缓 bot=${botId}：源或目标区域区块未加载`);
      return null;
    }
    const plan = planBindingCarry<ItemStack>(
      binding,
      (slotId) => source.read(slotId),
      (item) => item.typeId !== PLACEHOLDER_TYPE
    );
    const targetBinding: StorageBinding = { regionId: target.regionId, inv: {}, equip: {} };
    const written: number[] = [];
    try {
      for (const entry of plan.inv) {
        const ref = target.put(entry.item);
        if (!ref) throw new Error(`背包格 ${entry.key} 写入目标仓失败`);
        written.push(ref.slotId);
        targetBinding.inv[entry.key] = ref.slotId;
      }
      for (const entry of plan.equip) {
        const ref = target.put(entry.item);
        if (!ref) throw new Error(`装备槽 ${entry.key} 写入目标仓失败`);
        written.push(ref.slotId);
        targetBinding.equip[entry.key] = ref.slotId;
      }
    } catch (e: any) {
      // 回滚：副本丢弃即可，源物品一步未动；回滚失败只留孤儿副本（占容量，不丢数据）
      let leftovers = 0;
      for (const slotId of written) if (target.take(slotId) === undefined) leftovers++;
      console.error(
        `[mockplayer3] 兼容仓归位失败 bot=${botId}，已回滚目标仓：${e?.message ?? e}` +
          (leftovers > 0 ? `（${leftovers} 个目标槽回滚失败，留作孤儿副本）` : "")
      );
      return null;
    }
    this.adoptBinding(botId, targetBinding);
    let stuck = 0;
    for (const slotId of [...Object.values(binding.inv), ...Object.values(binding.equip)]) {
      try {
        if (!source.remove(slotId)) stuck++;
      } catch {
        stuck++;
      }
    }
    if (stuck > 0) {
      // 源槽残留：绑定表已切走，无人再引用，只占旧仓容量（巡检可回收）
      console.warn(`[mockplayer3] 兼容仓归位后源槽残留 ${stuck} 个（bot=${botId}，仅占容量）`);
    }
    return { regionId: target.regionId, moved: written.length, skipped: plan.skipped };
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

  /**
   * 单格写入并回执成功与否（区域不可用或写入失败 = false）。
   * 迁移导入专用：调用方要凭写入结果决定旧键去留，不能吞掉失败。
   */
  saveSlot(botId: number, slot: number, item: ItemStack | null): boolean {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return false;
    const r = this.writeSlot(storage, binding, slot, item);
    if (r.bound) this.persist(botId, binding);
    return r.ok;
  }

  /** 装备单槽写入并回执成功与否（区域不可用或写入失败 = false） */
  saveEquipSlot(botId: number, slot: EquipSlotName, item: ItemStack | null): boolean {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return false;
    const r = this.writeEquipSlot(storage, binding, slot, item);
    if (r.bound) this.persist(botId, binding);
    return r.ok;
  }

  /** 保存全部背包格（0..35，空位传 null——已绑定则写占位保持绑定） */
  saveInventory(botId: number, items: (ItemStack | null)[]): void {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (let i = 0; i < Math.min(items.length, INVENTORY_SIZE); i++) {
      changed = this.writeSlot(storage, binding, i, items[i] ?? null).bound || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  /**
   * 对账式批量保存指定背包格（只写变化的格）。
   * @returns 写入成功的格数；区域不可用返回 0
   */
  saveSlots(botId: number, writes: SlotWrite[]): number {
    if (writes.length === 0) return 0;
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return 0;
    let changed = false;
    let ok = 0;
    for (const { slot, item } of writes) {
      const r = this.writeSlot(storage, binding, slot, item);
      changed = r.bound || changed;
      if (r.ok) ok++;
    }
    if (changed) this.persist(botId, binding);
    return ok;
  }

  /** 保存全部装备槽（五槽，空槽传 null；主手不进仓） */
  saveEquipment(botId: number, equipment: (ItemStack | null)[]): void {
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return;
    let changed = false;
    for (let i = 0; i < EQUIP_SLOT_NAMES.length && i < equipment.length; i++) {
      changed = this.writeEquipSlot(storage, binding, EQUIP_SLOT_NAMES[i]!, equipment[i] ?? null).bound || changed;
    }
    if (changed) this.persist(botId, binding);
  }

  /**
   * 对账式批量保存指定装备槽。
   * @returns 写入成功的槽数；区域不可用返回 0
   */
  saveEquipSlots(botId: number, writes: EquipSlotWrite[]): number {
    if (writes.length === 0) return 0;
    const binding = this.bindingOf(botId);
    const storage = binding && this.storageOf(binding.regionId);
    if (!binding || !storage) return 0;
    let changed = false;
    let ok = 0;
    for (const { slot, item } of writes) {
      const r = this.writeEquipSlot(storage, binding, slot, item);
      changed = r.bound || changed;
      if (r.ok) ok++;
    }
    if (changed) this.persist(botId, binding);
    return ok;
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

  /**
   * 区域懒注册（register 幂等；失败留原文下轮重试，不抛穿）。
   * 锚点按当次测试维度可用性二选一：可用取首选，不可用取末地兼容锚点。
   */
  private ensureRegion(): StoredRegion | undefined {
    if (this.region) return this.region;
    const anchor = storageAnchorFor(customDimensionAvailable());
    try {
      this.region = ItemStorage.register({ dimension: anchor.dimension, anchor: anchor.anchor, baseY: anchor.baseY });
      this.fallbackInUse = anchor === FALLBACK_STORAGE_ANCHOR;
      this.registerError = null;
      if (this.fallbackInUse) {
        const { x, y, z } = anchor.anchor;
        console.warn(`[mockplayer3] 测试维度不可用，物品仓改用末地兼容锚点 ${anchor.dimension} (${x}, ${y}, ${z})`);
      }
    } catch (e: any) {
      this.registerError = String(e?.message ?? e);
      console.error(`[mockplayer3] NBT 物品存储注册失败: ${this.registerError}`);
    }
    return this.region;
  }

  /** 首选锚点区域；首选不可用或当次已用兼容锚点时返回 undefined */
  private primaryRegion(): StoredRegion | undefined {
    if (!customDimensionAvailable()) return undefined;
    const region = this.ensureRegion();
    return region && !this.fallbackInUse ? region : undefined;
  }

  /**
   * 区域当前可读可写吗（阵列所在区块已加载）。
   * probe 取槽位 0：unknown=未加载；empty/occupied/damaged=已加载（damaged 归巡检，不挡读写）。
   * 常加载可能因容量不足/异步挂载未生效：重挂一次（幂等、同名去重），使重试可自愈。
   */
  private probeReady(region: StoredRegion): boolean {
    try {
      if (region.probe(0) === "unknown") {
        region.ensureTickingArea();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 按绑定表 regionId 寻址（采纳既有区域，防换锚点后旧数据"看似丢失"）。
   * 寻不到区域记录即返回 undefined，绝不回落到当次锚点——绑定表里的 slotId 属于源区域，
   * 拿它去操作另一个区域会写进毫不相干的槽位；寻址失败由调用方按"区域不可用"处理。
   */
  private storageOf(regionId: string): StoredRegion | undefined {
    if (this.region && this.region.regionId === regionId) return this.region;
    return ItemStorage.getRegion(regionId);
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

  /** 单格写入；@returns 绑定表是否变化（新绑定才需写穿）+ 是否写入成功 */
  private writeSlot(
    storage: StoredRegion,
    binding: StorageBinding,
    slot: number,
    item: ItemStack | null
  ): SlotWriteResult {
    const key = String(slot);
    const bound = binding.inv[key];
    if (!item) {
      // 空位：已绑定写占位保持绑定；未绑定无操作（无需写入即算成功）
      if (bound === undefined) return { bound: false, ok: true };
      const ok = this.writeOrLog(storage, bound, new ItemStack(PLACEHOLDER_TYPE, 1), `背包占位 slot=${slot}`);
      return { bound: false, ok };
    }
    if (bound !== undefined) {
      const ok = this.writeOrLog(storage, bound, item, `背包保存 slot=${slot}`);
      return { bound: false, ok };
    }
    const ref = storage.put(item);
    if (ref) {
      binding.inv[key] = ref.slotId;
      return { bound: true, ok: true };
    }
    console.error(`[mockplayer3] 背包存储失败 slot=${slot}（区域满或区块未加载）`);
    return { bound: false, ok: false };
  }

  private writeEquipSlot(
    storage: StoredRegion,
    binding: StorageBinding,
    slot: EquipSlotName,
    item: ItemStack | null
  ): SlotWriteResult {
    const bound = binding.equip[slot];
    if (!item) {
      if (bound === undefined) return { bound: false, ok: true };
      const ok = this.writeOrLog(storage, bound, new ItemStack(PLACEHOLDER_TYPE, 1), `装备占位 ${slot}`);
      return { bound: false, ok };
    }
    if (bound !== undefined) {
      const ok = this.writeOrLog(storage, bound, item, `装备保存 ${slot}`);
      return { bound: false, ok };
    }
    const ref = storage.put(item);
    if (ref) {
      binding.equip[slot] = ref.slotId;
      return { bound: true, ok: true };
    }
    console.error(`[mockplayer3] 装备存储失败 ${slot}（区域满或区块未加载）`);
    return { bound: false, ok: false };
  }

  /** 覆写已有槽；@returns 写入是否成功（失败已记日志） */
  private writeOrLog(storage: StoredRegion, slotId: number, item: ItemStack, label: string): boolean {
    const r = storage.write(slotId, item);
    if (!r.ok) {
      console.error(`[mockplayer3] ${label} 失败: ${r.error ?? "未知错误"}`);
      return false;
    }
    return true;
  }
}
