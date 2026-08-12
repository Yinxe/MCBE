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
import { normalizeRecord, DEFAULT_RESPAWN } from "../../core/service/RecordMigration";
import { deserializeLegacyItem } from "../adapters/LegacyCodec";
import { DP_PREFIX, INVENTORY_SIZE } from "../../core/model/Types";
import type { SerializedItemStack } from "../../core/model/Types";

/** 数据版本标记 key */
const DATA_VERSION_KEY = "mockplayer:data-version";
/** 当前数据版本（模组版本；迁移按"旧 key 是否存在"检测，版本号仅做标记） */
const CURRENT_DATA_VERSION = "1.1.52";

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
        botRegistry.save(record);
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
    world.setDynamicProperty(DATA_VERSION_KEY, CURRENT_DATA_VERSION);
    console.info(`[MockPlayer] 数据迁移完成（data-version=${CURRENT_DATA_VERSION}）`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 数据迁移异常: ${e?.message ?? e}`);
  }
}

// 保留引用（botStore 用于类型约束/未来扩展；避免未使用告警）
void botStore;
