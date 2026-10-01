// ─── 旧档迁移导入器单测：JSON 夹具→规范化/映射/幂等 ──
import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_DP_PREFIX,
  isLegacyItemResidueKey,
  isLegacyRecordKey,
  isSerializedItemShape,
  legacyBindingKey,
  legacyNameOfRecordKey,
  migrateLegacyConfig,
  migrateRecord,
  normalizeLegacyWorkMode,
  parseLegacyItemKey,
  shouldSkipLegacy,
} from "../scripts/domain/Migrate";
import type { MigrateContext } from "../scripts/domain/Migrate";
import type { BotRecord } from "../scripts/domain/Record";

function ctx(over: Partial<MigrateContext> = {}): MigrateContext {
  return { botId: 11, now: 555, defaultRegionId: "mockplayer3:default", ...over };
}

/** 旧版记录典型形态夹具 */
function legacyFixture(): Record<string, unknown> {
  return {
    name: "$矿工",
    ownerName: "阿新",
    online: true,
    death: false,
    entityId: "abc-123",
    tags: ["mockplayer:tag:bot", "mockplayer:tag:respawn", "mockplayer:tag:idle", "mockplayer:tag:autoMine"],
    workMode: "定点挖掘",
    actionIntervalTicks: 2,
    isSneaking: true,
    lastPoint: {
      location: { x: 100.5, y: 64, z: -200.25 },
      dimension: "minecraft:overworld",
      rotation: { x: -12.5, y: 200 },
      lookTarget: { x: 101, y: 64, z: -199 },
    },
    respawnPoint: {
      location: { x: 90, y: 63, z: -190 },
      dimension: "minecraft:overworld",
      rotation: { x: 0, y: 90 },
      lookTarget: { x: 91, y: 63, z: -190 },
    },
    deathPoint: null,
    experience: { level: 5, xpProgress: 10, totalXp: 105 },
    effects: [
      { id: "minecraft:speed", duration: 100, amplifier: 1 },
      { id: "minecraft:poison", duration: 0, amplifier: 0 },
    ],
    spawnMode: "chunkload",
  };
}

test("旧键空间枚举：记录键过滤 :inv:/:equip:/:bind 子键（归档 loadAllRecords 实测）", () => {
  assert.equal(isLegacyRecordKey(`${LEGACY_DP_PREFIX}sim-a`), true);
  assert.equal(isLegacyRecordKey(`${LEGACY_DP_PREFIX}sim-a:bind`), false);
  assert.equal(isLegacyRecordKey(`${LEGACY_DP_PREFIX}sim-a:inv:0`), false);
  assert.equal(isLegacyRecordKey(`${LEGACY_DP_PREFIX}sim-a:equip:head`), false);
  assert.equal(isLegacyRecordKey("mp:bot:3"), false);
  assert.equal(legacyNameOfRecordKey(`${LEGACY_DP_PREFIX}sim-a`), "sim-a");
  assert.equal(legacyBindingKey("sim-a"), `${LEGACY_DP_PREFIX}sim-a:bind`);
});

test("全量旧档：规范化/映射/丢弃逐项命中", () => {
  const out = migrateRecord(
    legacyFixture(),
    ctx({ legacyBinding: { regionId: "mockplayer:test:1:1", inv: { "0": 7, "13": 8 }, equip: { head: 9 } } })
  );
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const r: BotRecord = out.record;

  assert.equal(r.botId, 11);
  assert.equal(r.name, "sim-矿工", "$ 旧前缀迁移");
  assert.equal(r.ownerKey, "阿新");
  assert.equal(r.dimensionId, "minecraft:overworld");
  // 家点取 lastPoint，rotation.x=pitch / y=yaw；lookTarget 丢弃
  assert.deepEqual(r.home, { position: { x: 100.5, y: 64, z: -200.25 }, yaw: 200, pitch: -12.5 });
  assert.equal("lookTarget" in r.home, false);
  assert.deepEqual(r.respawnPoint, {
    position: { x: 90, y: 63, z: -190 },
    yaw: 90,
    pitch: 0,
    dimensionId: "minecraft:overworld",
  });
  // workMode：中文别名识别；标签 respawn→开关；bot/idle/autoMine 消费后清空
  assert.equal(r.workMode, "mine");
  assert.equal(r.switches.autoRespawn, true);
  assert.equal(r.switches.sneaking, true);
  assert.deepEqual(r.tags, []);
  // 物品仓：绑定表零复制采纳为独立产物；记录只留 regionId 指针
  assert.deepEqual(out.binding, { regionId: "mockplayer:test:1:1", inv: { "0": 7, "13": 8 }, equip: { head: 9 } });
  assert.deepEqual(r.inventoryRef, { regionId: "mockplayer:test:1:1" });
  assert.deepEqual(r.experience, { level: 5, progress: 10, totalXp: 105 });
  assert.deepEqual(r.effects, [{ id: "minecraft:speed", durationTicks: 100, amplifier: 1 }], "到期效果不回放");
  // 动作间隔配置已整删：旧值丢弃并报备，节拍写死常量
  assert.equal("actionIntervalTicks" in r, false);
  assert.ok(
    out.notices.some((n) => n.includes("actionIntervalTicks")),
    "退役字段须报备丢弃"
  );
  // 在线声明原样搬运（对账矩阵在启动侧）
  assert.equal(r.declaredOnline, true);
  assert.equal(r.deathMark, false);
  assert.ok(out.notices.some((n) => n.includes("spawnMode")));
});

test("workMode 优先级：记录字段 > 行为标签映射 > none+报备", () => {
  const base = legacyFixture();
  delete base.workMode;
  const fromTags = migrateRecord({ ...base, tags: ["mockplayer:tag:bot", "mockplayer:tag:wanderMode"] }, ctx());
  assert.equal(fromTags.ok && fromTags.record.workMode, "wander");

  const fishTag = migrateRecord({ ...base, tags: ["mockplayer:tag:fishMode"] }, ctx());
  assert.equal(fishTag.ok && fishTag.record.workMode, "none", "异16 归档口径：fishMode 不参与模式推导（迁移表仅五项）");
  assert.ok(fishTag.ok && !fishTag.notices.some((n) => n.includes("未识别")), "已知标签不落脏数据报备");

  const raidTag = migrateRecord({ ...base, tags: ["mockplayer:tag:raidMode"] }, ctx());
  assert.equal(raidTag.ok && raidTag.record.workMode, "raid", "劫掠标签收编进 workMode（归档约定）");

  const unrecognized = migrateRecord({ ...base, workMode: "挖矿", tags: ["mockplayer:tag:autoMine"] }, ctx());
  assert.equal(unrecognized.ok && unrecognized.record.workMode, "mine", "无法识别的记录值回落标签映射");
  assert.ok(unrecognized.ok && unrecognized.notices.some((n) => n.includes("无法识别")));

  const nothing = migrateRecord({ ...base, workMode: undefined, tags: [] }, ctx());
  assert.equal(nothing.ok && nothing.record.workMode, "none");
});

test("别名识别（目录派生，ADR-6）：id 与中文名均可", () => {
  assert.equal(normalizeLegacyWorkMode("fishing"), "fishing");
  assert.equal(normalizeLegacyWorkMode("自动钓鱼"), "fishing");
  assert.equal(normalizeLegacyWorkMode(" none "), "none");
  assert.equal(normalizeLegacyWorkMode("vault模式"), undefined);
  assert.equal(normalizeLegacyWorkMode(42), undefined);
});

test("损坏档拒绝迁移（保留旧键策略），不产出半成品记录", () => {
  assert.equal(migrateRecord(null, ctx()).ok, false);
  assert.equal(migrateRecord({ tags: [] }, ctx()).ok, false, "缺 name");
  assert.equal(migrateRecord({ name: "" }, ctx()).ok, false);
  assert.equal(
    migrateRecord({ name: "sim-a", lastPoint: { location: { x: 1 } }, respawnPoint: null }, ctx()).ok,
    false,
    "双缺点位"
  );
  const badName = migrateRecord({ name: "a:inv:b" }, ctx());
  assert.equal(badName.ok, false);
});

test("无点位但有 respawnPoint：home 回落重生点；无主记录报备认领口径", () => {
  const f = legacyFixture();
  f.lastPoint = null;
  delete f.ownerName;
  const out = migrateRecord(f, ctx());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.record.home.position, { x: 90, y: 63, z: -190 });
  assert.equal(out.record.ownerKey, null);
  assert.ok(out.notices.some((n) => n.includes("认领")));
});

test("绑定表损坏：空仓迁移 + 报备（物品可人工找回），合法表不受记录覆盖影响", () => {
  const out = migrateRecord(legacyFixture(), ctx({ legacyBinding: { regionId: 42, inv: {}, equip: {} } }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.binding, null, "损坏绑定不产出独立键");
  assert.deepEqual(out.record.inventoryRef, { regionId: "mockplayer3:default" });
  assert.ok(out.notices.some((n) => n.includes("绑定表损坏")));

  const none = migrateRecord(legacyFixture(), ctx());
  assert.equal(none.ok && none.binding, null);
  assert.equal(none.ok && none.record.inventoryRef.regionId, "mockplayer3:default");
});

test("幂等：同输入两次迁移产物全等（02 章 §7 导入器重跑判据）", () => {
  const raw = JSON.stringify(legacyFixture());
  const bind = JSON.stringify({ regionId: "r", inv: { "5": 3 }, equip: {} });
  const a = migrateRecord(JSON.parse(raw), ctx({ legacyBinding: JSON.parse(bind) }));
  const b = migrateRecord(JSON.parse(raw), ctx({ legacyBinding: JSON.parse(bind) }));
  assert.deepEqual(a, b);
});

test("幂等跳过：旧名规范化后已在名字索引 → skip（02 章 §6 步骤 4）", () => {
  const index = new Map<string, number>([["sim-矿工", 11]]);
  assert.equal(shouldSkipLegacy(index, "$矿工"), true, "旧前缀形态同样命中");
  assert.equal(shouldSkipLegacy(index, "sim-新矿"), false);
});

// ─── 旧 aiBehavior 字段兜底 ──

test("aiBehavior 兜底：workMode 缺/none 时读上代字段；标签优先级高于它", () => {
  const base = legacyFixture();
  delete base.workMode;

  const fromAi = migrateRecord({ ...base, tags: [], aiBehavior: "attack" }, ctx());
  assert.equal(fromAi.ok && fromAi.record.workMode, "attack");
  assert.ok(fromAi.ok && fromAi.notices.some((n) => n.includes("aiBehavior")), "来源报备");

  const noneField = migrateRecord(
    { ...base, workMode: "none", tags: ["mockplayer:tag:autoPlace"], aiBehavior: "attack" },
    ctx()
  );
  assert.equal(
    noneField.ok && noneField.record.workMode,
    "place",
    "字段显式 none 视为未设置（归档 !workMode||none 判定）"
  );

  const overAi = migrateRecord(
    { ...base, tags: ["mockplayer:tag:autoMine", "mockplayer:tag:raidMode"], aiBehavior: "attack" },
    ctx()
  );
  assert.equal(overAi.ok && overAi.record.workMode, "raid", "劫掠定案优先（归档 break 语义）");

  const deadAi = migrateRecord({ ...base, tags: [], aiBehavior: "什么鬼" }, ctx());
  assert.equal(deadAi.ok && deadAi.record.workMode, "none", "aiBehavior 无法识别回落 none");
});

// ─── 旧 DP JSON 物品子键（≤1.1.34 时代） ──

test("旧物品键解析：inv 槽界内/equip 槽名/越界仅提名（清扫路）", () => {
  assert.deepEqual(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a:inv:0`), {
    name: "sim-a",
    slot: { kind: "inv", slot: 0 },
  });
  assert.deepEqual(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a:inv:35`), {
    name: "sim-a",
    slot: { kind: "inv", slot: 35 },
  });
  assert.deepEqual(parseLegacyItemKey(`${LEGACY_DP_PREFIX}$旧名:equip:offhand`), {
    name: "$旧名",
    slot: { kind: "equip", slot: "offhand" },
  });
  assert.deepEqual(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a:inv:99`), { name: "sim-a" }, "越界槽无 slot——清扫兜底");
  assert.deepEqual(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a:equip:mainhand`), { name: "sim-a" }, "主手不进仓");
  assert.equal(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a`), undefined);
  assert.equal(parseLegacyItemKey(`${LEGACY_DP_PREFIX}sim-a:bind`), undefined);
  assert.equal(isLegacyItemResidueKey(`${LEGACY_DP_PREFIX}sim-a:inv:99`), true);
  assert.equal(isLegacyItemResidueKey(`${LEGACY_DP_PREFIX}sim-a:bind`), false);
  assert.equal(isSerializedItemShape({ typeId: "minecraft:diamond", amount: 3 }), true);
  assert.equal(isSerializedItemShape({ amount: 3 }), false);
  assert.equal(isSerializedItemShape(null), false);
});

// ─── 旧全局配置键 mockplayer:config 迁移 ──

test("migrateLegacyConfig：双配额/逐人覆盖/管理员/模式表/信物逐字段搬运", () => {
  const { value, notices } = migrateLegacyConfig({
    defaultQuota: 7,
    defaultOnlineQuota: 2,
    quotas: { 阿新: 9, 坏值: "x" },
    onlineQuotas: { 阿新: 1 },
    admins: [" 阿王", "", 5 as unknown as string],
    autoOnlineOnRestart: false,
    ownerOfflineAutoOffline: true,
    enabledWorkModes: { mine: true, autoInteract: true, fishing: false, 未知键: true },
    menuTriggerItemId: "minecraft:breeze_rod",
    safeCooldownSeconds: 3,
    auxTickingRadius: 6,
  });
  const v = value as Record<string, any>;
  assert.equal(v.quotas.create, 7);
  assert.equal(v.quotas.online, 2);
  assert.deepEqual(v.quotas.perPlayer, { 阿新: { create: 9, online: 1 } }, "非数坏值剔除、双表合并同人");
  assert.deepEqual(v.adminKeys, [" 阿王"], "归档 filter 口径（trim 判空不 trim 值）");
  assert.equal(v.autoOnlineAfterRestart, undefined, "重启征询自动上线已移除：旧键不迁移进新表");
  assert.ok(
    notices.some((n) => n.includes("autoOnlineOnRestart")),
    "移除功能的旧键走丢弃报备"
  );
  assert.equal(v.ownerDownOfflineDefault, true);
  assert.equal(v.workModeEnabled.mine, true);
  assert.equal(v.workModeEnabled.autoInteract, undefined, "定点交互已按用户规格移除（缺38）：旧键丢弃不进新表");
  assert.ok(
    notices.some((n) => n.includes("未知键 autoInteract")),
    "移除模式的旧启用键走未知键丢弃报备"
  );
  assert.equal(v.workModeEnabled.fishing, false, "归档显式 false 逐项覆盖新默认");
  assert.equal(v.workModeEnabled.raid, true, '缺59：没点名的模式按新默认表启用（旧口径"缺省全禁"退场）');
  assert.equal(v.workModePolicyVersion, 2, "迁出即盖策略版本戳，读盘侧不再二次重置");
  assert.deepEqual(v.tokenItem, { enabled: true, typeId: "minecraft:breeze_rod" });
  assert.ok(notices.some((n) => n.includes("未知键")));
  assert.ok(notices.some((n) => n.includes("safeCooldownSeconds")));
  assert.equal(v.auxTickingRadius, 6, "v2 辅助常加载档位同名迁入");
  assert.ok(!notices.some((n) => n.includes("auxTickingRadius")), "合法档位迁入不报备");

  const badAux = migrateLegacyConfig({ auxTickingRadius: 5 });
  assert.equal((badAux.value as Record<string, any>).auxTickingRadius, 4, "非 0/4/6/8 回退模拟4");
  assert.ok(
    badAux.notices.some((n) => n.includes("auxTickingRadius")),
    "非法档位报备"
  );

  const off = migrateLegacyConfig({ menuTriggerItemId: null });
  assert.equal((off.value as Record<string, any>).tokenItem.enabled, false);
  const bad = migrateLegacyConfig({ menuTriggerItemId: "minecraft:bedrock" });
  assert.equal(
    (bad.value as Record<string, any>).tokenItem.typeId,
    "minecraft:stick",
    "非选项表回退（归档 sanitizeMenuTrigger）"
  );
  assert.ok(bad.notices.some((n) => n.includes("不在选项表")));
  const empty = migrateLegacyConfig(undefined);
  assert.equal((empty.value as Record<string, any>).quotas.create, 5, "空配置落 v2 默认");
  assert.ok(
    empty.notices.some((n) => n.includes("按新默认表启用")),
    "旧档无启用表→未点名模式默认启用（缺59）"
  );
});
