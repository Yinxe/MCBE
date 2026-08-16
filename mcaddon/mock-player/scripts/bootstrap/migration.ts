// ─── 数据迁移（版本升级安全通道） ──────────────────────
// 旧版本（1.1.34 / 1.1.40 等）玩家升级到当前版本时执行的数据迁移：
//
//   1. 记录归一化（normalizeRecord，core 纯逻辑）：
//      补齐旧记录缺失字段默认值（ownerName 缺失 = 无主，管理员可管理；
//      experience/respawnPoint 等极端缺失补默认）——幂等，每次启动执行。
//   2. 物品迁移（旧 DP JSON 视图 → NBT 木桶阵列）：
//      检测 `mockplayer:players:<name>:inv:<N>` / `:equip:<X>` 旧 key →
//      deserializeLegacyItem 还原真实物品 → 写入 ItemStorage（绑定）→ 删旧 key。
//      迁移后旧 key 已删除 → 幂等（重复执行无副作用）。
//   3. 版本标记（mockplayer:data-version）：记录当前数据版本，防重复执行耗时迁移。
//
// 安全设计：
//   - 单条记录/单格迁移失败隔离（try-catch，不影响其余）
//   - 迁移在 worldLoad 后、restoreAll 之后执行（记录已在内存，存储区域可注册）
//   - 潜影盒等嵌套容器：旧格式本来未保存内容（API 限制），迁移后同样无内容

import { world } from "@minecraft/server";

import { botRegistry, botStore, saveCoordinator } from "./context";
import { normalizeRecord, DEFAULT_RESPAWN } from "../service/RecordMigration";
import { deserializeLegacyItem } from "../service/port/LegacyCodec";
import { DP_PREFIX, INVENTORY_SIZE } from "../rules/Types";
import { TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_AUTO_ATTACK, TAG_WANDER_MODE, filterKnownTags } from "../rules/tags/BotTags";
import { TAG_PREFIX } from "../rules/Types";
import type { BotRecord, SerializedItemStack } from "../rules/Types";

/** 数据版本标记 key */
const DATA_VERSION_KEY = "mockplayer:data-version";
/** 当前数据版本（模组版本；迁移按"旧 key 是否存在"检测，版本号仅做标记） */
const CURRENT_DATA_VERSION = "2.2.1"; // 与包版本同步（审核 L3：数据版本误导排障）

/** 世界出生点（记录缺 respawnPoint 时的默认值；worldLoad 后可读） */
function defaultRespawn(): typeof DEFAULT_RESPAWN {
  try {
    const spawn = world.getDefaultSpawnLocation();
    return {
      location: { x: spawn.x, y: spawn.y, z: spawn.z },
      dimension: "minecraft:overworld",
      rotation: { x: 0, y: 0 },
      lookTarget: { x: spawn.x, y: spawn.y, z: spawn.z },
    };
  } catch {
    return DEFAULT_RESPAWN;
  }
}

/** 记录归一化：补齐缺失字段（幂等） */
function normalizeAllRecords(): void {
  const spawn = defaultRespawn();
  for (const record of botRegistry.all()) {
    try {
      if (normalizeRecord(record, spawn)) {
        saveCoordinator.saveRecord(record);
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] 记录归一化失败 ${record.name}: ${e?.message ?? e}`);
    }
  }
}

/** 旧 DP 物品 key 前缀检测（mockplayer:players:<name>:inv: / :equip:） */
function legacyKeyPrefix(name: string): { inv: string; equip: string } {
  return {
    inv: `${DP_PREFIX}${name}:inv:`,
    equip: `${DP_PREFIX}${name}:equip:`,
  };
}

/**
 * 物品迁移：旧 DP JSON 视图 → NBT 木桶阵列。
 * 对每条有旧 key 的假人：读旧背包/装备 → 还原真实物品 → 绑定写入 → 删旧 key。
 * 迁移后旧 key 删除 → 重复执行无副作用（幂等）。
 */
function migrateLegacyItems(): void {
  const ids = world.getDynamicPropertyIds();
  // 收集有旧物品 key 的假人名
  const names = new Set<string>();
  for (const id of ids) {
    if (!id.startsWith(DP_PREFIX)) continue;
    // 匹配 mockplayer:players:<name>:inv:<N> 或 :equip:<X>
    const m = id.match(/^mockplayer:players:(.+):(inv|equip):/);
    if (m) names.add(m[1]!);
  }
  if (names.size === 0) return;

  console.info(`[MockPlayer] 检测到 ${names.size} 个假人有旧版背包数据，开始迁移…`);
  for (const name of names) {
    try {
      migrateOneBot(name);
    } catch (e: any) {
      console.warn(`[MockPlayer] 迁移失败 ${name}: ${e?.message ?? e}`);
    }
  }

  // 全量清扫残留：任意 :inv: / :equip: 后缀的旧 key（含超范围/损坏格式）一律删除——
  // 迁移完成后彻底丢弃旧数据结构，DP 中不再有任何旧版物品残留
  let swept = 0;
  for (const id of world.getDynamicPropertyIds()) {
    if (id.startsWith(DP_PREFIX) && (id.includes(":inv:") || id.includes(":equip:"))) {
      world.setDynamicProperty(id, undefined);
      swept++;
    }
  }
  if (swept > 0) console.info(`[MockPlayer] 清扫残留旧物品 key ${swept} 个`);
  console.info(`[MockPlayer] 旧版背包数据迁移完成`);
}

/** 迁移单个假人的旧背包/装备（读旧 key → 写入 ItemStorage → 删旧 key） */
function migrateOneBot(name: string): void {
  const { inv: invPrefix, equip: equipPrefix } = legacyKeyPrefix(name);
  const ids = world.getDynamicPropertyIds();
  let migrated = 0;

  // ── 背包 36 格 ──
  for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
    const key = `${invPrefix}${slot}`;
    const raw = world.getDynamicProperty(key);
    if (typeof raw !== "string") continue;
    const data = parseLegacy(raw);
    world.setDynamicProperty(key, undefined); // 先删旧 key（防迁移中断后重复）
    if (!data) continue;
    const item = deserializeLegacyItem(data);
    if (!item) continue; // 坏数据跳过
    // 绑定写入 NBT 槽（首次写自动分配 + 记录绑定表）
    saveCoordinator.saveSlot(name, slot, item);
    migrated++;
  }

  // ── 装备 5 槽 ──
  for (const slotName of ["head", "chest", "legs", "feet", "offhand"]) {
    const key = `${equipPrefix}${slotName}`;
    const raw = world.getDynamicProperty(key);
    if (typeof raw !== "string") continue;
    const data = parseLegacy(raw);
    world.setDynamicProperty(key, undefined);
    if (!data) continue;
    const item = deserializeLegacyItem(data);
    if (!item) continue;
    saveCoordinator.saveEquipSlot(name, slotName, item);
    migrated++;
  }

  if (migrated > 0) {
    console.info(`[MockPlayer] 迁移 ${name}：${migrated} 件物品 → NBT 存储`);
  }
}

/** 解析旧物品 JSON（损坏返回 undefined） */
function parseLegacy(raw: string): SerializedItemStack | undefined {
  try {
    const data = JSON.parse(raw) as SerializedItemStack;
    if (!data || typeof data.typeId !== "string") return undefined;
    return data;
  } catch {
    return undefined;
  }
}

/**
 * 数据迁移入口（worldLoad 后、restoreAll 之后调用一次）。
 * 幂等：记录归一化每次执行安全；物品迁移后旧 key 已删不会重复。
 */
export function runMigrations(): void {
  try {
    normalizeAllRecords();
    migrateLegacyItems();
    cleanupUnknownTags();
    world.setDynamicProperty(DATA_VERSION_KEY, CURRENT_DATA_VERSION);
    console.info(`[MockPlayer] 数据迁移完成（data-version=${CURRENT_DATA_VERSION}）`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 数据迁移异常: ${e?.message ?? e}`);
  }
}

/**
 * 标签清理与职业迁移（用户拍板：行为标签 → 职业 profession 单选互斥字段）：
 * 1. 旧行为标签（自动挖掘/自动放置/随机游走/自动攻击）→ 转换到 record.profession；
 * 2. 旧劫掠标签（TAG_RAID_MODE 独立开关）→ 转换到 workMode = "raid"（劫掠
 *    从标签收进工作模式单选）；
 * 3. 旧 aiBehavior 字段（上代行为字段）→ 转换到 workMode；
 * 4. 其余未知标签（已删除定义的旧能力标签）→ 直接清理。
 * 否则 setTags 校验会拒绝（"包含未知标签"），任何标签操作都会失败。
 */
const BEHAVIOR_TAG_TO_WORK_MODE: Record<string, string> = {
  [TAG_AUTO_MINE.value]: "mine",
  [TAG_AUTO_PLACE.value]: "place",
  [TAG_WANDER_MODE.value]: "wander",
  [TAG_AUTO_ATTACK.value]: "attack",
  // 劫掠标签已删定义（收编进工作模式）——迁移表用旧标签字面量
  [`${TAG_PREFIX}raidMode`]: "raid",
};

/** 旧 aiBehavior 字段读取（类型已迁移为 workMode——旧存档兼容） */
function legacyAiBehavior(record: BotRecord): string | undefined {
  return (record as any).aiBehavior;
}

function cleanupUnknownTags(): void {
  for (const record of botRegistry.all()) {
    let changed = false;
    // 工作模式未设置时按优先级转换：旧行为/劫掠/钓鱼标签 → 旧 aiBehavior 字段
    if (!record.workMode || record.workMode === "none") {
      let mode: string | undefined;
      for (const tag of record.tags) {
        const m = BEHAVIOR_TAG_TO_WORK_MODE[tag];
        if (m) {
          mode = m;
          // 劫掠/钓鱼标签 vs 行为标签并存：劫掠优先（旧版可共存，单选取劫掠）
          if (m === "raid") break;
        }
      }
      // 无标签 → 读旧 aiBehavior 字段（上代行为选择）
      if (!mode) mode = legacyAiBehavior(record);
      if (mode) {
        record.workMode = mode;
        delete (record as any).aiBehavior;
        console.warn(`[MockPlayer] 数据迁移：工作模式 ${record.name}: ${mode}`);
        changed = true;
      }
    }
    // 移除旧行为/劫掠/钓鱼标签 + 未知标签（已转换/已删除定义的）
    const keep = record.tags.filter((t) => !BEHAVIOR_TAG_TO_WORK_MODE[t] && filterKnownTags([t]).length > 0);
    if (keep.length !== record.tags.length) {
      console.warn(`[MockPlayer] 数据迁移：清理行为标签 ${record.name}: ${record.tags.filter((t) => BEHAVIOR_TAG_TO_WORK_MODE[t] || !filterKnownTags([t]).includes(t)).join(", ")}`);
      record.tags = keep;
      changed = true;
    }
    if (changed) saveCoordinator.saveRecord(record);
  }
}

// 保留引用（botStore 用于类型约束/未来扩展；避免未使用告警）
void botStore;
