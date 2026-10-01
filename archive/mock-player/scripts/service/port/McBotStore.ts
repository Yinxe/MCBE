// ─── NBT 木桶阵列持久化适配（mc 层） ───────────────────
// 实现 core/storage 的 BotStore 端口（@yinxe/nbt-data-storage 后端）。
//
// 记录（BotRecord）走单条 DP：mockplayer:players:<name>。
// 绑定表（StorageBinding）**独立存储**：mockplayer:players:<name>:bind
//   ——与记录解耦：事件驱动的绑定写穿不受记录覆盖影响（registry.save 只写
//   记录 key，不碰绑定 key），持久化更灵活。
// 物品（背包 36 格 + 装备 5 槽）存**真实 ItemStack** 到木桶阵列，完整 NBT
// 保留（潜影盒/收纳袋内容随物品原样存取，根除旧 JSON 视图的内容丢失限制）：
//   - 首次写某格 → itemStorage.put(item) 分配槽位 → 绑定表记录 slotId（按需分配）
//   - 后续写该格 → itemStorage.write(slotId, item) 指定槽覆写（slotId 不变）
//   - 空位       → write(slotId, structure_void 占位) **保持绑定**——
//                  槽位一旦绑定永不释放（存储永远是该假人的背包备份镜像），
//                  仅删除假人（removeInventory）时 take 释放全部绑定槽
//   - 读取格     → itemStorage.read(slotId)（O(1) 克隆返回；占位视为空位跳过）
// 区域懒注册（末地固定锚点，全假人共享，幂等）；失败降级为日志告警不抛错。

import { ItemStack, world } from "@minecraft/server";
import { ItemStorage } from "@yinxe/nbt-data-storage";
import type { StoredRegion } from "@yinxe/nbt-data-storage";

import type { BotRecord, StorageBinding } from "../../rules/Types";
import { DP_PREFIX, EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../../rules/Types";
import type { BotStore } from "./BotStore";
import {
  allBoundSlotIds,
  bindEquipSlot,
  bindSlot,
  boundEquipSlotId,
  boundSlotId,
  createBinding,
} from "./Binding";

/**
 * 存储区域锚点：自定义测试维度 (16,0,16)——玩家不可达，与装置 (0,0) 区块列
 * 相邻不重叠（区块即区域，全假人共享；容量 442,368 格 ≈ 1 万假人）。
 * ⚠️ 桶的实际 Y 层由 baseY 决定（默认 120，anchor.y 被忽略）——显式指定
 * baseY: 0 让阵列与装置同层（结构方块 y=0）。
 */
const STORAGE_REGION = { dimension: "mockplayer:test", anchor: { x: 16, y: 0, z: 16 }, baseY: 0 };

/**
 * 空位占位物品：空槽保持绑定时写入（"结构空位"）。
 * 槽位一旦绑定就永不释放（存储永远是该假人的背包备份镜像），空手也写占位维持绑定；
 * 占位是**真实物品**——put 分配器探测真值为占用，不会把他人物品分进绑定空槽；
 * 恢复时按 typeId 跳过占位（视为空位）；仅删除假人时 take 释放全部绑定槽。
 */
export const PLACEHOLDER_TYPE = "minecraft:structure_void";

/** 绑定表独立 DP key（与记录解耦，防记录覆盖） */
function bindingKey(name: string): string {
  return `${DP_PREFIX}${name}:bind`;
}

export class McBotStore implements BotStore<ItemStack> {
  private itemStorage: StoredRegion | undefined;
  /** 绑定表内存缓存（事件驱动读写，写穿独立 DP key） */
  private readonly bindings = new Map<string, StorageBinding>();

  // ── 物品存储（懒注册，幂等；register 缓存命中成本低，失败下轮重试） ──
  private ensureItemStorage(): StoredRegion | undefined {
    if (this.itemStorage) return this.itemStorage;
    try {
      this.itemStorage = ItemStorage.register(STORAGE_REGION);
      console.info(`[MockPlayer] NBT 物品存储就绪 ${this.itemStorage.regionId}`);
    } catch (e: any) {
      console.error(`[MockPlayer] NBT 物品存储注册失败: ${e?.message ?? e}`);
    }
    return this.itemStorage;
  }

  /**
   * 按绑定表声明的区域寻址：slotId 是"区域内"稠密编号，跨区域用错句柄会
   * 定位到错误坐标（旧锚点数据会"看似丢失"）。绑定表 regionId 与当前
   * 默认区域不同时（锚点迁移/多区域并存），用 ItemStorage.getRegion 采纳
   * 既有区域（库支持跨区域采纳，无需重新注册）；否则用默认注册区域。
   */
  private storageOf(regionId: string): StoredRegion | undefined {
    if (this.itemStorage && this.itemStorage.regionId === regionId) return this.itemStorage;
    return ItemStorage.getRegion(regionId) ?? this.ensureItemStorage();
  }

  // ── 绑定表（独立持久化，与 BotRecord 解耦） ──

  /** 读绑定表（内存缓存 → DP；损坏跳过） */
  private loadBinding(name: string): StorageBinding | undefined {
    const cached = this.bindings.get(name);
    if (cached) return cached;
    const raw = world.getDynamicProperty(bindingKey(name));
    if (typeof raw !== "string") return undefined;
    try {
      const binding = JSON.parse(raw) as StorageBinding;
      if (!binding || typeof binding.regionId !== "string" || typeof binding.inv !== "object" || typeof binding.equip !== "object") {
        console.error(`[MockPlayer] 绑定表损坏已跳过 ${name}`);
        return undefined;
      }
      this.bindings.set(name, binding);
      return binding;
    } catch {
      console.error(`[MockPlayer] 绑定表损坏已跳过 ${name}`);
      return undefined;
    }
  }

  /** 写绑定表（内存 + DP 写穿） */
  private saveBinding(name: string, binding: StorageBinding): void {
    this.bindings.set(name, binding);
    world.setDynamicProperty(bindingKey(name), JSON.stringify(binding));
  }

  /** 取绑定表（无则新建并写穿）；区域不可用返回 undefined */
  private bindingOf(name: string): StorageBinding | undefined {
    const existing = this.loadBinding(name);
    if (existing) return existing;
    if (!this.ensureItemStorage()) return undefined;
    const binding = createBinding(this.itemStorage!.regionId);
    this.saveBinding(name, binding);
    return binding;
  }

  /** 公开读绑定表（调试命令 /mp:storage 用） */
  getBinding(name: string): StorageBinding | undefined {
    return this.loadBinding(name);
  }

  /** 改名迁移绑定表 key（BotRegistry.rename 调用；绑定随记录同迁） */
  renameBinding(oldName: string, newName: string): void {
    const binding = this.loadBinding(oldName);
    if (!binding) return;
    this.saveBinding(newName, binding);
    this.bindings.delete(oldName);
    world.setDynamicProperty(bindingKey(oldName), undefined);
  }

  // ── 基础记录（DP，不变） ──

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
      return record;
    } catch {
      console.error(`[MockPlayer] 加载记录 ${name} 损坏`);
      return undefined;
    }
  }

  /**
   * 世界重启时加载所有假人记录。
   * 跳过子 key：`:inv:` / `:equip:`（旧版 DP 物品数据残留）与 `:bind` 结尾
   * （独立绑定表——注意绑定 key 是 `...:bind` 结尾，无尾部冒号，`:bind:` 匹配不到）。
   * 解析后**结构校验**（name 必须是 string）——绑定表/损坏 JSON 即使解析成功
   * 也不会被当作记录（防坏记录进入 registry：name/tags undefined 会导致
   * UI 表单与劫掠巡检报 "cannot read property xxx of undefined"）。
   */
  loadAllRecords(): BotRecord[] {
    const ids = world.getDynamicPropertyIds();
    const records: BotRecord[] = [];
    for (const id of ids) {
      if (!id.startsWith(DP_PREFIX)) continue;
      if (id.includes(":inv:") || id.includes(":equip:") || id.endsWith(":bind")) continue;
      const value = world.getDynamicProperty(id);
      if (typeof value !== "string") continue;
      try {
        const parsed = JSON.parse(value) as BotRecord;
        // 结构校验：必须有合法 name（绑定表/损坏记录解析成功但缺字段 → 拒绝）
        if (!parsed || typeof parsed.name !== "string" || parsed.name.length === 0) {
          console.error(`[MockPlayer] 加载记录 ${id} 结构非法已跳过`);
          continue;
        }
        records.push(parsed);
      } catch {
        console.error(`[MockPlayer] 加载记录 ${id} 损坏已跳过`);
      }
    }
    return records;
  }

  removeRecord(name: string): void {
    world.setDynamicProperty(this.getDPKey(name), undefined);
  }

  // ── 背包（每格 ↔ NBT 存储槽） ──

  /** 保存单个格子（null 写占位保持绑定；首次写分配槽位） */
  saveSlot(name: string, slot: number, item: ItemStack | null): void {
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    if (this.writeSlot(storage, binding, slot, item)) {
      this.saveBinding(name, binding);
    }
  }

  /** 保存全部背包格（空位传 null） */
  saveInventory(name: string, items: (ItemStack | null)[]): void {
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    let changed = false;
    for (let i = 0; i < Math.min(items.length, INVENTORY_SIZE); i++) {
      changed = this.writeSlot(storage, binding, i, items[i] ?? null) || changed;
    }
    if (changed) this.saveBinding(name, binding);
  }

  /** 批量保存指定背包格（对账式：只写变化的格子） */
  saveSlots(name: string, items: { slot: number; item: ItemStack | null }[]): void {
    if (items.length === 0) return;
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    let changed = false;
    for (const { slot, item } of items) {
      changed = this.writeSlot(storage, binding, slot, item ?? null) || changed;
    }
    if (changed) this.saveBinding(name, binding);
  }

  /**
   * 未绑定/无任何物品时返回 undefined（调用方据此判断是否需要恢复）。
   * 返回真实 ItemStack（完整 NBT）；占位物品（structure_void）视为空位跳过。
   * 批量读取：readBatch 按桶分组一次取容器（36 格 ≈ 2 次容器读取，替代逐格方块查询）。
   */
  loadInventory(name: string): (ItemStack | null)[] | undefined {
    const binding = this.loadBinding(name);
    if (!binding) return undefined;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return undefined;

    // 收集已绑定格的 slotId（未绑定格保持 null）
    const slotIds: number[] = [];
    const slotIndexes: number[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const sid = boundSlotId(binding, i);
      if (sid !== undefined) {
        slotIds.push(sid);
        slotIndexes.push(i);
      }
    }
    if (slotIds.length === 0) return undefined;

    const values = storage.readBatch(slotIds);
    const result: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
    let found = false;
    for (let k = 0; k < slotIndexes.length; k++) {
      const item = values[k];
      if (item && item.typeId !== PLACEHOLDER_TYPE) {
        result[slotIndexes[k]!] = item;
        found = true;
      }
    }
    return found ? result : undefined;
  }

  // ── 装备栏（每槽 ↔ NBT 存储槽） ──

  saveEquipSlot(name: string, slot: string, item: ItemStack | null): void {
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    if (this.writeEquipSlot(storage, binding, slot, item)) {
      this.saveBinding(name, binding);
    }
  }

  saveEquipment(name: string, equipment: Record<string, ItemStack | null>, _silent = false): void {
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    let changed = false;
    for (const [slot, item] of Object.entries(equipment)) {
      changed = this.writeEquipSlot(storage, binding, slot, item ?? null) || changed;
    }
    if (changed) this.saveBinding(name, binding);
  }

  /** 批量保存指定装备槽（对账式：只写变化的槽） */
  saveEquipSlots(name: string, items: { slot: string; item: ItemStack | null }[]): void {
    if (items.length === 0) return;
    const binding = this.bindingOf(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return;
    let changed = false;
    for (const { slot, item } of items) {
      changed = this.writeEquipSlot(storage, binding, slot, item ?? null) || changed;
    }
    if (changed) this.saveBinding(name, binding);
  }

  /** 返回 { head?, chest?, legs?, feet?, offhand? }（真实 ItemStack；占位视为空），全空返回 undefined；批量读取 */
  loadEquipment(name: string): Record<string, ItemStack> | undefined {
    const binding = this.loadBinding(name);
    if (!binding) return undefined;
    const storage = this.storageOf(binding.regionId);
    if (!storage) return undefined;

    const slotIds: number[] = [];
    const slotNames: string[] = [];
    for (const slotName of EQUIP_SLOT_NAMES) {
      const sid = boundEquipSlotId(binding, slotName);
      if (sid !== undefined) {
        slotIds.push(sid);
        slotNames.push(slotName);
      }
    }
    if (slotIds.length === 0) return undefined;

    const values = storage.readBatch(slotIds);
    const result: Record<string, ItemStack> = {};
    for (let k = 0; k < slotNames.length; k++) {
      const item = values[k];
      if (item && item.typeId !== PLACEHOLDER_TYPE) {
        result[slotNames[k]!] = item;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /** 删除假人的全部背包 + 装备槽数据（槽位释放回收 + 绑定表清除） */
  removeInventory(name: string): void {
    const binding = this.loadBinding(name);
    if (!binding) return;
    const storage = this.storageOf(binding.regionId);
    if (storage) {
      for (const sid of allBoundSlotIds(binding)) {
        storage.take(sid);
      }
    }
    this.bindings.delete(name);
    world.setDynamicProperty(bindingKey(name), undefined);
  }

  // ── 私有：单格写入（返回绑定表是否变化） ──

  private writeSlot(storage: StoredRegion, binding: StorageBinding, slot: number, item: ItemStack | null): boolean {
    const bound = boundSlotId(binding, slot);
    if (!item) {
      // 空位占位：保持绑定（槽位永不漂移），写入结构空位占位物品
      // （put 分配器探测为占用，不会分给别人）；从未绑定则无操作
      if (bound !== undefined) {
        const r = storage.write(bound, new ItemStack(PLACEHOLDER_TYPE, 1));
        if (!r.ok) {
          console.error(`[MockPlayer] 背包占位失败 slot=${slot}: ${r.error ?? "未知错误"}`);
        }
      }
      return false;
    }
    if (bound !== undefined) {
      const r = storage.write(bound, item);
      if (!r.ok) {
        console.error(`[MockPlayer] 背包保存失败 slot=${slot}: ${r.error ?? "未知错误"}`);
      }
      return false;
    }
    const ref = storage.put(item);
    if (ref) {
      bindSlot(binding, slot, ref.slotId);
      return true;
    }
    console.error(`[MockPlayer] 背包存储失败 slot=${slot}（区域满或区块未加载）`);
    return false;
  }

  private writeEquipSlot(storage: StoredRegion, binding: StorageBinding, slot: string, item: ItemStack | null): boolean {
    const bound = boundEquipSlotId(binding, slot);
    if (!item) {
      // 空位占位（同背包语义）：保持绑定，写入结构空位；从未绑定则无操作
      if (bound !== undefined) {
        const r = storage.write(bound, new ItemStack(PLACEHOLDER_TYPE, 1));
        if (!r.ok) {
          console.error(`[MockPlayer] 装备占位失败 ${slot}: ${r.error ?? "未知错误"}`);
        }
      }
      return false;
    }
    if (bound !== undefined) {
      const r = storage.write(bound, item);
      if (!r.ok) {
        console.error(`[MockPlayer] 装备保存失败 ${slot}: ${r.error ?? "未知错误"}`);
      }
      return false;
    }
    const ref = storage.put(item);
    if (ref) {
      bindEquipSlot(binding, slot, ref.slotId);
      return true;
    }
    console.error(`[MockPlayer] 装备存储失败 ${slot}（区域满或区块未加载）`);
    return false;
  }
}
