// ─── 旧档迁移薄壳：只触世界，映射纯函数在 domain/Migrate ─────────────
// 触发：启动检测到旧键自动跑一次（成功条删旧键即自禁用）+ /mp:migrate 显式重跑
// （幂等：旧名规范化后与 mp:name:* 索引比对）。
// 逐条事务：采纳绑定→写记录→占名票据→删旧键；任一步抛错回滚三张新键、
// 旧键原样保留（人工修 JSON 后可再迁移，物品永不被动）。
// 旧全局配置 mockplayer:config 逐字段搬（无 v2 配置才写、有则只清旧键）；
// 旧 DP JSON 物品键 decode 入仓：读到即删键、坏格跳过不中断，
// 跑完全量清扫 :inv:/:equip: 残留（跳过/失败/孤儿名同批清除）。

import { EnchantmentType, ItemLockMode, ItemStack, Potions, world } from "@minecraft/server";
import {
  isLegacyItemResidueKey,
  isLegacyRecordKey,
  isSerializedItemShape,
  legacyBindingKey,
  legacyNameOfRecordKey,
  migrateLegacyConfig,
  migrateRecord,
  parseLegacyItemKey,
  shouldSkipLegacy,
} from "../domain/Migrate";
import type { LegacySerializedItem } from "../domain/Migrate";
import { LEGACY_CONFIG_KEY } from "../domain/Migrate";
import { normalizeBotName } from "../domain/Identity";
import type { EquipSlotName } from "../domain/Record";
import type { BotRecord } from "../domain/Record";
import type { EquipSlotWrite, ItemVault, SlotWrite } from "./ItemVault";
import { CONFIG_KEY } from "./RecordStore";
import { readJson, removeKey, writeJson } from "./Dp";
import type { SaveGate } from "./SaveGate";

/** 单条迁移产物（record 内存本体随报返回——命令中途触发可直接挂 runtime，免重启） */
export interface MigratedEntry {
  name: string;
  botId: number;
  record: BotRecord;
  notices: string[];
}

/** 被拒旧记录（旧键保留） */
export interface MigrateFailure {
  legacyName: string;
  error: string;
}

/** 迁移清单（命令面板与启动控制台两个渲染面） */
export interface MigrateReport {
  /** 检出的旧记录键数（0 = 无记录可迁；配置/物品残留仍可能非零工作量） */
  found: number;
  migrated: MigratedEntry[];
  /** 幂等跳过的规范化名（mp:name:* 已存在） */
  skipped: string[];
  failures: MigrateFailure[];
  /** 整体中止原因（存储未就绪等；非空 = 未做任何写入） */
  aborted?: string;
  /** 旧全局配置 mockplayer:config 已迁入 mp:config（无 v2 键才写） */
  configMigrated: boolean;
  /** 配置迁移报备（未识别字段丢弃等） */
  configNotices: string[];
  /** 旧 JSON 物品迁入仓格数 / 坏数据丢弃格数（跳过不中断） */
  itemSlots: { migrated: number; dropped: number };
  /** 清扫的 :inv:/:equip: 残留键数（跳过/失败/孤儿名同批） */
  sweptItemKeys: number;
}

/** 某旧名的物品子键分组（slot 越界键不入组——留给全量清扫） */
interface LegacyItemKeys {
  inv: Map<number, string>;
  equip: Map<EquipSlotName, string>;
}

export class Migrator {
  constructor(
    private readonly gate: SaveGate,
    private readonly vault: ItemVault
  ) {}

  /** 是否存在旧键空间（启动自动执行判定；旧包卸载后自然永假） */
  hasLegacyData(): boolean {
    for (const id of world.getDynamicPropertyIds()) {
      if (id === LEGACY_CONFIG_KEY || isLegacyRecordKey(id) || isLegacyItemResidueKey(id)) return true;
    }
    return false;
  }

  /**
   * 全量导入流程（同步执行，须处于 system.run / 命令回调上下文）。
   * @returns 迁移清单（永不抛穿：单条失败记 failures，旧键保留）
   */
  run(): MigrateReport {
    const keys: string[] = [];
    const itemKeys = new Map<string, LegacyItemKeys>();
    for (const id of world.getDynamicPropertyIds()) {
      if (isLegacyRecordKey(id)) keys.push(id);
      const parsed = parseLegacyItemKey(id);
      if (parsed?.slot) {
        const g = itemKeys.get(parsed.name) ?? { inv: new Map(), equip: new Map() };
        if (parsed.slot.kind === "inv") g.inv.set(parsed.slot.slot, id);
        else g.equip.set(parsed.slot.slot, id);
        itemKeys.set(parsed.name, g);
      }
    }
    const report: MigrateReport = {
      found: keys.length,
      migrated: [],
      skipped: [],
      failures: [],
      configMigrated: false,
      configNotices: [],
      itemSlots: { migrated: 0, dropped: 0 },
      sweptItemKeys: 0,
    };

    const regionId = this.vault.ensureRegionId();
    if (!regionId) {
      report.aborted = "物品存储未就绪（木桶阵列注册失败），旧键全部保留，稍后重试";
      return report;
    }
    this.migrateConfig(report);
    if (keys.length === 0) {
      this.sweepItemResidue(report);
      return report;
    }

    const nameIndex = this.gate.loadNameIndex();
    const now = Date.now();
    for (const key of keys) {
      const legacyName = legacyNameOfRecordKey(key);
      const displayName = normalizeBotName(legacyName);
      if (shouldSkipLegacy(nameIndex, legacyName)) {
        report.skipped.push(displayName);
        continue;
      }
      const bindKey = legacyBindingKey(legacyName);
      const raw = readJson<unknown>(key);
      if (raw === undefined) {
        report.failures.push({ legacyName: displayName, error: "旧记录缺失或 JSON 损坏（保留旧键）" });
        continue;
      }
      // 绑定表：键存在但解析失败 → 传 {} 触发"损坏按空仓"报备；键缺失 → undefined（正常空仓）
      let legacyBinding: unknown;
      if (typeof world.getDynamicProperty(bindKey) === "string") {
        legacyBinding = readJson<unknown>(bindKey) ?? {};
      }
      const botId = this.gate.allocateBotId(); // 失败条消耗的 botId 不回收（空洞无害，幂等以名字索引为准）
      const outcome = migrateRecord(raw, { botId, now, defaultRegionId: regionId, legacyBinding });
      if (!outcome.ok) {
        report.failures.push({ legacyName: displayName, error: outcome.error });
        continue;
      }
      const { record, binding, notices } = outcome;
      try {
        if (binding) this.vault.adoptBinding(botId, binding); // 零复制采纳：物品仍在原 NBT 木桶槽位
        if (!this.gate.saveRecord(record)) throw new Error("记录不变量校验拒写");
        this.gate.claimName(record.name, botId);
        removeKey(key);
        removeKey(bindKey);
        nameIndex.set(record.name, botId); // 同批撞名防护（"$foo"/"sim-foo" 两键归一同名）
        const items = itemKeys.get(legacyName);
        if (items) {
          // 物品导入独立吞错：键已读即删，失败只报备不回滚记录
          try {
            this.importLegacyItems(botId, items, report);
          } catch (e: any) {
            notices.push(`旧物品导入失败（记录已迁入）: ${e?.message ?? e}`);
          }
        }
        report.migrated.push({ name: record.name, botId, record, notices });
      } catch (e: any) {
        this.gate.releaseName(record.name);
        this.gate.deleteRecord(botId);
        this.vault.discardBinding(botId);
        report.failures.push({ legacyName: displayName, error: `写入被拒已回滚（旧键保留）：${e?.message ?? e}` });
      }
    }
    this.sweepItemResidue(report);
    return report;
  }

  // ─── 私有 ──

  /** 旧全局配置 → mp:config：v2 键已存在则不覆盖、只清旧键自禁用 */
  private migrateConfig(report: MigrateReport): void {
    if (typeof world.getDynamicProperty(LEGACY_CONFIG_KEY) !== "string") return;
    if (world.getDynamicProperty(CONFIG_KEY) === undefined) {
      const { value, notices } = migrateLegacyConfig(readJson<unknown>(LEGACY_CONFIG_KEY) ?? {});
      writeJson(CONFIG_KEY, value);
      report.configMigrated = true;
      report.configNotices = notices;
    } else {
      report.configNotices = ["v2 全局配置已存在，旧 mockplayer:config 不覆盖、仅清理"];
    }
    removeKey(LEGACY_CONFIG_KEY);
  }

  /** 旧 DP JSON 物品 → NBT 仓：读到即删键、坏格跳过不中断 */
  private importLegacyItems(botId: number, keys: LegacyItemKeys, report: MigrateReport): void {
    const invWrites: SlotWrite[] = [];
    const equipWrites: EquipSlotWrite[] = [];
    const take = (key: string): ItemStack | undefined => {
      const raw = world.getDynamicProperty(key);
      removeKey(key);
      if (typeof raw !== "string") return undefined;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return undefined;
      }
      return isSerializedItemShape(data) ? decodeLegacyItem(data) : undefined;
    };
    for (const [slot, key] of keys.inv) {
      const item = take(key);
      if (item) invWrites.push({ slot, item });
      else report.itemSlots.dropped++;
    }
    for (const [slot, key] of keys.equip) {
      const item = take(key);
      if (item) equipWrites.push({ slot, item });
      else report.itemSlots.dropped++;
    }
    if (invWrites.length > 0) this.vault.saveSlots(botId, invWrites);
    if (equipWrites.length > 0) this.vault.saveEquipSlots(botId, equipWrites);
    report.itemSlots.migrated += invWrites.length + equipWrites.length;
  }

  /** 全量清扫残留旧物品键（含越界槽/孤儿名/跳过条） */
  private sweepItemResidue(report: MigrateReport): void {
    for (const id of world.getDynamicPropertyIds()) {
      if (isLegacyItemResidueKey(id)) {
        removeKey(id);
        report.sweptItemKeys++;
      }
    }
  }
}

/**
 * SerializedItemStack JSON → ItemStack：逐件还原药水/名/lore/锁/耐久/附魔/染色；
 * 单件失败返回 undefined 跳格，迁移不中断。
 */
function decodeLegacyItem(data: LegacySerializedItem): ItemStack | undefined {
  try {
    let item: ItemStack;
    if (data.potionEffectType && data.potionDeliveryType) {
      try {
        item = Potions.resolve(data.potionEffectType, data.potionDeliveryType);
        item.amount = data.amount ?? 1;
      } catch {
        item = new ItemStack(data.typeId, data.amount ?? 1);
      }
    } else {
      item = new ItemStack(data.typeId, data.amount ?? 1);
    }

    if (data.nameTag) item.nameTag = data.nameTag;
    if (data.keepOnDeath) item.keepOnDeath = true;
    // 旧 JSON 的 lockMode 是自由文本；按 ItemLockMode 白名单过滤，
    // 未知值只跳过该属性不丢整件物品
    if (data.lockMode === "inventory" || data.lockMode === "slot") {
      item.lockMode = data.lockMode === "inventory" ? ItemLockMode.inventory : ItemLockMode.slot;
    }
    if (data.lore && data.lore.length > 0) item.setLore(data.lore);
    if (data.canDestroy && data.canDestroy.length > 0) item.setCanDestroy(data.canDestroy);
    if (data.canPlaceOn && data.canPlaceOn.length > 0) item.setCanPlaceOn(data.canPlaceOn);

    if (data.damage !== undefined || data.unbreakable) {
      const d = item.getComponent("minecraft:durability") as { damage?: number; unbreakable?: boolean } | undefined;
      if (d) {
        if (data.damage !== undefined) d.damage = data.damage;
        if (data.unbreakable) d.unbreakable = true;
      }
    }

    if (data.enchantments && data.enchantments.length > 0 && item.hasComponent("minecraft:enchantable")) {
      const ench = item.getComponent("minecraft:enchantable") as
        { addEnchantment(e: { type: EnchantmentType; level: number }): void } | undefined;
      if (ench) {
        for (const e of data.enchantments) {
          try {
            ench.addEnchantment({ type: new EnchantmentType(e.id), level: e.level });
          } catch {
            // 单个附魔添加失败不影响其他
          }
        }
      }
    }

    if (data.color && item.hasComponent("minecraft:dyeable")) {
      const d = item.getComponent("minecraft:dyeable") as
        { color?: { red: number; green: number; blue: number } } | undefined;
      if (d) d.color = { red: data.color.red, green: data.color.green, blue: data.color.blue };
    }

    return item;
  } catch {
    return undefined; // 坏数据：跳过该格（迁移不中断）
  }
}
