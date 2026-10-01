// ─── v2→v3 升级模拟：以世界 DP 快照为输入，走 Migrator 同款编排（domain 纯函数面） ───
// 复刻 engine/Migrator.run() 的判定链（键分类→幂等→记录映射→绑定采纳→物品子键
// decode 入仓→残留清扫），engine 触世界部分用内存 Map 替身，验证升级后
// 假人记录字段与背包/装备物品格数不丢失。不 Mock @minecraft（该面在 in-game 冒烟验收）。
import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_CONFIG_KEY,
  LEGACY_DP_PREFIX,
  isLegacyItemResidueKey,
  isLegacyRecordKey,
  isSerializedItemShape,
  legacyBindingKey,
  legacyNameOfRecordKey,
  migrateLegacyConfig,
  migrateRecord,
  parseLegacyItemKey,
  shouldSkipLegacy,
} from "../scripts/domain/Migrate";
import type { MigrateContext } from "../scripts/domain/Migrate";
import { normalizeBotName } from "../scripts/domain/Identity";

/** v2 全局配置键（engine/RecordStore.CONFIG_KEY 同值，测试不越层导入 engine） */
const CONFIG_KEY = "mp:config";

/** 世界 DP 替身：键 → 值（string 为 JSON 原文） */
type DpWorld = Map<string, string>;

/** Migrator.run 同构模拟产物 */
interface SimReport {
  found: number;
  migrated: { name: string; botId: number; notices: string[]; invSlots: number; equipSlots: number }[];
  skipped: string[];
  failures: { legacyName: string; error: string }[];
  configMigrated: boolean;
  itemSlots: { migrated: number; dropped: number };
  sweptItemKeys: number;
  residualKeys: string[];
}

/**
 * 按 engine/Migrator.run() 的编排对 DpWorld 快照做全量迁移模拟。
 * @param dp - 旧键空间快照（测试构造）
 * @param nameIndex - 现名索引（规范化名 → botId，幂等判定用）
 * @param defaultRegionId - 新建仓区兜底 regionId
 * @returns 迁移清单
 */
export function simulateMigration(dp: DpWorld, nameIndex: Map<string, number>, defaultRegionId: string): SimReport {
  const keys: string[] = [];
  const itemKeys = new Map<string, { inv: Map<number, string>; equip: Map<string, string> }>();
  for (const id of dp.keys()) {
    if (isLegacyRecordKey(id)) keys.push(id);
    const parsed = parseLegacyItemKey(id);
    if (parsed?.slot) {
      const g = itemKeys.get(parsed.name) ?? { inv: new Map(), equip: new Map() };
      if (parsed.slot.kind === "inv") g.inv.set(parsed.slot.slot, id);
      else g.equip.set(parsed.slot.slot, id);
      itemKeys.set(parsed.name, g);
    }
  }
  const report: SimReport = {
    found: keys.length,
    migrated: [],
    skipped: [],
    failures: [],
    configMigrated: false,
    itemSlots: { migrated: 0, dropped: 0 },
    sweptItemKeys: 0,
    residualKeys: [],
  };

  // 配置：v2 键不存在才写，写后删旧键
  if (dp.has(LEGACY_CONFIG_KEY) && !dp.has(CONFIG_KEY)) {
    const { value } = migrateLegacyConfig(JSON.parse(dp.get(LEGACY_CONFIG_KEY)!));
    dp.set(CONFIG_KEY, JSON.stringify(value));
    dp.delete(LEGACY_CONFIG_KEY);
    report.configMigrated = true;
  }

  let nextBotId = 1;
  for (const key of keys) {
    const legacyName = legacyNameOfRecordKey(key);
    const displayName = normalizeBotName(legacyName);
    if (shouldSkipLegacy(nameIndex, legacyName)) {
      report.skipped.push(displayName);
      continue;
    }
    const bindKey = legacyBindingKey(legacyName);
    let legacyBinding: unknown;
    if (dp.has(bindKey)) {
      try {
        legacyBinding = JSON.parse(dp.get(bindKey)!);
      } catch {
        legacyBinding = {}; // 键在而 JSON 坏 → "损坏按空仓"报备路
      }
    }
    const ctx: MigrateContext = { botId: nextBotId++, now: 1000, defaultRegionId, legacyBinding };
    let outcome;
    try {
      outcome = migrateRecord(JSON.parse(dp.get(key)!), ctx);
    } catch {
      report.failures.push({ legacyName: displayName, error: "旧记录 JSON 损坏（保留旧键）" });
      continue;
    }
    if (!outcome.ok) {
      report.failures.push({ legacyName: displayName, error: outcome.error });
      continue;
    }
    // 绑定采纳：零复制，regionId 指向旧阵列
    const adopted = outcome.binding;
    // 物品子键：读到即删，坏格计入 dropped（decode 在 engine 侧，形状判定在 domain 侧）
    const groups = itemKeys.get(legacyName);
    let invMigrated = 0;
    let equipMigrated = 0;
    if (groups) {
      for (const [, k] of groups.inv) {
        const ok = decodeItem(dp.get(k)!);
        dp.delete(k);
        if (ok) invMigrated++;
        else report.itemSlots.dropped++;
      }
      for (const [, k] of groups.equip) {
        const ok = decodeItem(dp.get(k)!);
        dp.delete(k);
        if (ok) equipMigrated++;
        else report.itemSlots.dropped++;
      }
    }
    report.itemSlots.migrated += invMigrated + equipMigrated;
    dp.delete(key);
    dp.delete(bindKey);
    nameIndex.set(outcome.record.name, outcome.record.botId);
    // 写入新键空间（记录 + 绑定 + 名字索引）
    dp.set(`mp:bot:${outcome.record.botId}`, JSON.stringify(outcome.record));
    if (adopted) dp.set(`mp:store:bind:${outcome.record.botId}`, JSON.stringify(adopted));
    dp.set(`mp:name:${outcome.record.name}`, String(outcome.record.botId));
    report.migrated.push({
      name: outcome.record.name,
      botId: outcome.record.botId,
      notices: outcome.notices,
      invSlots: Object.keys(adopted?.inv ?? {}).length + invMigrated,
      equipSlots: Object.keys(adopted?.equip ?? {}).length + equipMigrated,
    });
  }

  // 残留清扫（跳过条/失败条/孤儿名的物品键同批删）
  for (const id of [...dp.keys()]) {
    if (isLegacyItemResidueKey(id)) {
      dp.delete(id);
      report.sweptItemKeys++;
    }
  }
  report.residualKeys = [...dp.keys()].filter((k) => k.startsWith(LEGACY_DP_PREFIX));
  return report;
}

function decodeItem(raw: string): boolean {
  try {
    return isSerializedItemShape(JSON.parse(raw));
  } catch {
    return false;
  }
}

test("v2→v3 升级模拟：三假人（全量档/无主空仓档/已迁幂等档）+ 坏物品残留", () => {
  const dp: DpWorld = new Map();

  // 假人①：老格式完整记录——NBT 绑定表（现役 v2 存储）+ 中文名 + 挖掘模式 + 蹲立开关
  dp.set(
    `${LEGACY_DP_PREFIX}sim-矿工`,
    JSON.stringify({
      name: "sim-矿工",
      ownerName: "阿新",
      online: true,
      death: false,
      tags: ["mockplayer:tag:bot", "mockplayer:tag:respawn", "mockplayer:tag:autoMine"],
      workMode: "定点挖掘",
      isSneaking: true,
      lastPoint: {
        location: { x: 100.5, y: 64, z: -200.25 },
        dimension: "minecraft:overworld",
        rotation: { x: -12.5, y: 200 },
      },
      respawnPoint: {
        location: { x: 98, y: 64, z: -198 },
        dimension: "minecraft:overworld",
        rotation: { x: 0, y: 0 },
      },
      experience: { level: 12, xpProgress: 40, totalXp: 300 },
      effects: [
        { id: "minecraft:speed", duration: 200, amplifier: 1 },
        { id: "minecraft:regeneration", duration: 0, amplifier: 0 },
      ],
    })
  );
  dp.set(
    legacyBindingKey("sim-矿工"),
    JSON.stringify({
      regionId: "mockplayer:test:1:1",
      inv: { "0": 3, "1": 7, "2": 12, "3": 15, "4": 21, "8": 30 },
      equip: { head: 41, chest: 42, legs: 43, feet: 44, offhand: 52 },
    })
  );

  // 假人②：早期 DP JSON 物品档（inv 三格 + 装备两格 + 一格坏 JSON）
  dp.set(
    `${LEGACY_DP_PREFIX}$渔夫`,
    JSON.stringify({
      name: "$渔夫",
      ownerName: "老渔",
      online: false,
      tags: ["mockplayer:tag:bot"],
      aiBehavior: "fishing",
      lastPoint: { location: { x: 5, y: 70, z: 5 }, dimension: "minecraft:overworld", rotation: { x: 0, y: 90 } },
    })
  );
  dp.set(`${LEGACY_DP_PREFIX}$渔夫:inv:0`, JSON.stringify({ typeId: "minecraft:cod", amount: 3 }));
  dp.set(
    `${LEGACY_DP_PREFIX}$渔夫:inv:1`,
    JSON.stringify({
      typeId: "minecraft:fishing_rod",
      amount: 1,
      damage: 32,
      enchantments: [{ id: "mending", level: 1 }],
    })
  );
  dp.set(`${LEGACY_DP_PREFIX}$渔夫:inv:2`, "{坏 JSON");
  dp.set(
    `${LEGACY_DP_PREFIX}$渔夫:equip:head`,
    JSON.stringify({ typeId: "minecraft:leather_helmet", color: { red: 255, green: 0, blue: 0 } })
  );

  // 假人③：已迁移同名（mp:name 索引在）——应幂等跳过、旧记录键保留
  dp.set(`${LEGACY_DP_PREFIX}守卫`, JSON.stringify({ name: "守卫", lastPoint: { location: { x: 1, y: 2, z: 3 } } }));
  dp.set(`${LEGACY_DP_PREFIX}守卫:inv:0`, JSON.stringify({ typeId: "minecraft:stone", amount: 64 })); // 孤儿残留 → 清扫
  const nameIndex = new Map<string, number>([["sim-守卫", 9]]); // v3 索引键为规范化名

  // 全局配置 + 更早期缺点位的坏档（应拒绝并保留旧键）
  dp.set(
    LEGACY_CONFIG_KEY,
    JSON.stringify({ defaultQuota: 8, defaultOnlineQuota: 4, admins: ["腐竹"], menuTriggerItemId: "minecraft:stick" })
  );
  dp.set(`${LEGACY_DP_PREFIX}残记录`, JSON.stringify({ name: "残记录" }));

  const rep = simulateMigration(dp, nameIndex, "mockplayer:test:1:1");

  // ── 假人记录完整性 ──
  assert.equal(rep.found, 4);
  assert.equal(rep.migrated.length, 2);
  const miner = rep.migrated.find((m) => m.name === "sim-矿工")!;
  const fisher = rep.migrated.find((m) => m.name === "sim-渔夫")!;
  assert.ok(miner && fisher);
  const minerRecord = JSON.parse(dp.get(`mp:bot:${miner.botId}`)!);
  assert.equal(minerRecord.workMode, "mine"); // 中文别名归一
  assert.equal(minerRecord.ownerKey !== undefined, true);
  assert.equal(minerRecord.switches.sneaking, true);
  assert.equal(minerRecord.switches.autoRespawn, true);
  assert.equal(minerRecord.declaredOnline, true);
  assert.equal(minerRecord.home.position.x, 100.5);
  assert.equal(minerRecord.experience.level, 12);
  assert.equal(minerRecord.effects.length, 1); // 到期效果不回放
  assert.equal(fisher.name, "sim-渔夫"); // "$"→"sim-" 规范化
  assert.equal(
    fisher.notices.some((n) => n.includes("aiBehavior")),
    true
  );

  // ── 背包/装备物品完整性 ──
  // 假人①：绑定表零复制采纳——6 背包槽 + 6 装备槽原样进新键，regionId 指向旧阵列
  const bind = JSON.parse(dp.get(`mp:store:bind:${miner.botId}`)!);
  assert.equal(bind.regionId, "mockplayer:test:1:1");
  assert.equal(Object.keys(bind.inv).length, 6);
  assert.equal(Object.keys(bind.equip).length, 5);
  // 假人②：DP JSON 物品 4 格——3 好格入仓、1 坏格弃
  assert.equal(rep.itemSlots.migrated, 3);
  assert.equal(rep.itemSlots.dropped, 1);
  assert.equal(fisher.invSlots, 2); // inv 好格 2（0/1）
  assert.equal(fisher.equipSlots, 1);

  // ── 幂等与清扫 ──
  assert.deepEqual(rep.skipped, ["sim-守卫"]);
  assert.equal(dp.has(`${LEGACY_DP_PREFIX}守卫`), true); // 跳过条记录键保留
  assert.equal(rep.sweptItemKeys, 1); // 守卫孤儿物品格（渔夫坏格在导入路已删）
  assert.equal(rep.failures.length, 1);
  assert.equal(rep.failures[0]!.legacyName, "sim-残记录"); // 展示名同样规范化
  assert.equal(dp.has(`${LEGACY_DP_PREFIX}残记录`), true); // 失败条旧键保留可修后重试
  assert.equal(rep.configMigrated, true);
  assert.equal(dp.has(LEGACY_CONFIG_KEY), false);
  // 旧键空间终态：只剩跳过条与失败条的记录键（可再迁），物品键归零
  assert.deepEqual(rep.residualKeys.sort(), ["mockplayer:players:守卫", "mockplayer:players:残记录"]);
  for (const id of dp.keys()) assert.ok(!isLegacyItemResidueKey(id), `残留物品键未清扫: ${id}`);
});
