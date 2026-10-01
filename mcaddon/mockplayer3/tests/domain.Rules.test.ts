// ─── 规则/几何/权限/目录/经验/共享点池单测 ────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBotName, isValidBotName, validateBotName } from "../scripts/domain/Identity";
import {
  parseCoordString,
  toBlockLocation,
  toChunkLocation,
  yawToDirection,
  horizontalDistance,
} from "../scripts/domain/Coords";
import {
  isAdmin,
  canView,
  canManage,
  canCreate,
  canGoOnline,
  createQuotaFor,
  onlineQuotaFor,
  remainingQuota,
  remainingOnlineQuota,
} from "../scripts/domain/Permissions";
import type { Viewer } from "../scripts/domain/Permissions";
import {
  WORK_MODES,
  modeSpec,
  isKnownMode,
  isExperimentalMode,
  normalizeStoredWorkMode,
  defaultEnabledModes,
  modeAliasMap,
} from "../scripts/domain/Catalog";
import { xpForNextLevel, totalXpForLevel, levelFromTotalXp } from "../scripts/domain/XpMath";
import { SharedPool } from "../scripts/domain/Pool";
import { defaultConfig } from "../scripts/domain/Config";
import { auxChunkCovered, mergeConfig } from "../scripts/domain/Config";
import type { BotRecord } from "../scripts/domain/Record";
import { UNLIMITED_QUOTA } from "../scripts/domain/Config";

// ─── 名字（F-03 "(2)" 幽灵防护边界） ──

test("normalizeBotName：补前缀/旧 $ 迁移/去空白", () => {
  assert.equal(normalizeBotName("刷铁机"), "sim-刷铁机");
  assert.equal(normalizeBotName("$刷铁机"), "sim-刷铁机");
  assert.equal(normalizeBotName(" sim-a "), "sim-a");
  assert.equal(normalizeBotName(""), "");
});

test("isValidBotName/validateBotName：非法形态矩阵", () => {
  assert.equal(isValidBotName("sim-a"), true);
  assert.equal(isValidBotName("sim-a:inv:0"), false, "旧槽位片段");
  assert.equal(isValidBotName("sim-a(2)"), false, "引擎撞名后缀形态");
  assert.equal(isValidBotName("sim-a（2）"), false, "全角括号变体同样拒绝");
  assert.equal(isValidBotName("sim- 空格"), false);
  assert.equal(isValidBotName("sim-§红"), false, "格式码");
  assert.equal(isValidBotName(`sim-${"x".repeat(40)}`), false, "超长");
  assert.match(validateBotName("sim-")!, /主体不能为空/);
  assert.equal(validateBotName("sim-矿工"), undefined);
});

// ─── 坐标解析（F-22：无 Location 参数，字符串口径） ──

test("parseCoordString：绝对/相对/混合/全角容错", () => {
  const origin = { x: 10, y: 64, z: -20 };
  assert.deepEqual(parseCoordString("100 64 -200", origin).value, { x: 100, y: 64, z: -200 });
  assert.deepEqual(parseCoordString("~ ~ ~", origin).value, origin);
  assert.deepEqual(parseCoordString("~10 ~-3 ~", origin).value, { x: 20, y: 61, z: -20 });
  assert.deepEqual(parseCoordString("100　64，-200", origin).value, { x: 100, y: 64, z: -200 }, "全角空格/逗号");
  assert.deepEqual(parseCoordString("【100，64，-200】", origin).value, { x: 100, y: 64, z: -200 }, "全角括号包裹");
  assert.deepEqual(parseCoordString("(100, 64, -200)", origin).value, { x: 100, y: 64, z: -200 }, "半角括号+英文逗号");
  assert.deepEqual(parseCoordString("100 64.5 -200.25", origin).value, { x: 100, y: 64.5, z: -200.25 }, "小数");
  assert.match(parseCoordString("", origin).error!, /为空/);
  assert.match(parseCoordString("1 2", origin).error!, /三个分量/);
  assert.match(parseCoordString("abc 2 3", origin).error!, /不是合法数字/);
});

test("几何工具：负半轴取整与朝向", () => {
  assert.deepEqual(toBlockLocation({ x: -0.5, y: 64.9, z: -16.1 }), { x: -1, y: 64, z: -17 });
  assert.deepEqual(toChunkLocation({ x: -0.5, y: 64, z: -0.5 }), { x: -1, y: -1 });
  const d = yawToDirection(0);
  assert.equal(Math.abs(d.x), 0, "-sin(0) 的 -0 与 0 数值等价");
  assert.equal(d.z, 1);
  assert.equal(horizontalDistance({ x: 0, y: 99, z: 0 }, { x: 3, y: 0, z: 4 }), 5, "水平距离忽略 Y（F-14）");
});

// ─── 权限（角色矩阵） ──

const config = mergeConfig({
  quotas: { create: 5, online: 3, perPlayer: { 阿新: { online: 0 } } },
  adminKeys: ["老王"],
});
const op: Viewer = { key: "OP玩家", isOp: true };
const named: Viewer = { key: "阿新", isOp: false };
const listed: Viewer = { key: "老王", isOp: false };
const plain: Viewer = { key: "路人", isOp: false };
const rec = (ownerKey: string | null): BotRecord => ({ ...structuredClone(baseRecordFixture()), ownerKey });

function baseRecordFixture(): BotRecord {
  return {
    botId: 1,
    name: "sim-a",
    ownerKey: null,
    dimensionId: "o",
    home: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
    respawnPoint: null,
    workMode: "none",
    switches: { sneaking: false, autoRespawn: false, ownerDownOffline: false },
    tags: [],
    inventoryRef: { regionId: "r" },
    experience: { level: 0, progress: 0, totalXp: 0 },
    effects: [],
    followTarget: null,
    workChestId: null,
    raidVictories: 0,
    declaredOnline: false,
    deathMark: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

test("角色判定：OP ∨ 名单；查看含无主，管理无主仅管理员（FR-A1）", () => {
  assert.equal(isAdmin(op, config), true);
  assert.equal(isAdmin(listed, config), true);
  assert.equal(isAdmin(plain, config), false);

  assert.equal(canView(named, rec("阿新"), config), true, "主人可看");
  assert.equal(canView(plain, rec("阿新"), config), false, "他人有主不可看");
  assert.equal(canView(plain, rec(null), config), true, "无主公开可看（供认领）");

  assert.equal(canManage(named, rec("阿新"), config), true);
  assert.equal(canManage(plain, rec("阿新"), config), false);
  assert.equal(canManage(plain, rec(null), config), false, "无主仅管理员");
  assert.equal(canManage(op, rec(null), config), true);
});

test("配额：覆盖→全局→管理员无限；0=禁止（中文明示）", () => {
  assert.equal(createQuotaFor(op, config), UNLIMITED_QUOTA);
  assert.equal(onlineQuotaFor(named, config), 0, "逐玩家覆盖");
  assert.equal(onlineQuotaFor(plain, config), 3);

  assert.deepEqual(canCreate(plain, 5, config), {
    ok: false,
    reason: "创建失败：路人 的假人配额已达上限（5 个），剩余 0 个",
  });
  assert.deepEqual(canCreate(plain, 4, config), { ok: true });
  assert.deepEqual(canCreate(named, 4, config), { ok: true }, "在线覆盖不影响创建配额");
  assert.equal(remainingQuota(2, 5, false), 3, "余量 = 配额 − 已建（归档 QuotaRules）");
  assert.equal(remainingQuota(2, 5, true), -1, "管理员/无限回 -1（消息省略剩余段）");
  assert.equal(remainingOnlineQuota(1, UNLIMITED_QUOTA, false), -1);

  const zero = { ...defaultConfig(), quotas: { create: 0, online: 3, perPlayer: {} } };
  assert.deepEqual(canCreate(plain, 0, zero), { ok: false, reason: "管理员未给你开放假人创建配额" });

  assert.deepEqual(canGoOnline(named, 0, config), { ok: false, reason: "管理员未给你开放假人同时在线配额" });
  assert.deepEqual(canGoOnline(plain, 3, config), {
    ok: false,
    reason: "同时在线已达上限（3个），剩余 0 个，请先下线部分假人",
  });
  assert.deepEqual(canGoOnline(op, 99, config), { ok: true });
});

// ─── 目录（唯一真源） ──

test("目录派生：默认启用=全开（用户规格 2026-09-29 缺58，FR-W12 的 heavy 默认关退场）；别名表含中文；模式集合与枚举一致", () => {
  const enabled = defaultEnabledModes();
  for (const spec of WORK_MODES) {
    assert.equal(enabled[spec.id], true, `${spec.id} 默认启用`);
    // experimental 为可选键（仅实验模式携带）；剔除后各目录项同形
    const base = Object.keys(WORK_MODES[0]!).sort();
    const keys = Object.keys(modeSpec(spec.id))
      .filter((k) => k !== "experimental")
      .sort();
    assert.deepEqual(keys, base);
  }
  assert.equal(isExperimentalMode("harvest_wood"), true, "资源采集·原木归实现性功能总闸");
  assert.equal(isExperimentalMode("mine"), false, "非采集模式不受总闸管辖");
  assert.equal(modeAliasMap()["定点挖掘"], "mine");
  assert.equal(modeAliasMap()["fishing"], "fishing");
  assert.throws(() => modeSpec("hacked" as never), /目录缺项/);
});

test("isKnownMode：退场模式判拒（读盘边界回落 none），在目录模式与脏值矩阵各判对", () => {
  assert.equal(isKnownMode("woodcut"), false, "砍树已由 harvest 族取代——滞留旧档的值必须判false");
  assert.equal(isKnownMode("harvest"), false, "两级结构退役（对象即模式）——裸 harvest 不再是目录成员");
  assert.equal(isKnownMode("harvest_wood"), true);
  assert.equal(isKnownMode("harvest_leaves"), false, "树叶档已下架——滞留旧档的值必须判 false");
  assert.equal(isKnownMode("harvest_dirt"), false, "泥土档已下架——滞留旧档的值必须判 false");
  assert.equal(isKnownMode("none"), true);
  assert.equal(isKnownMode(undefined), false);
  assert.equal(isKnownMode(null), false);
  assert.equal(isKnownMode(3), false);
  assert.equal(isKnownMode(""), false);
});

test("normalizeStoredWorkMode：旧代 harvest+harvestKind 折成对象即模式，目录外回落 none（缺48）", () => {
  assert.equal(normalizeStoredWorkMode("harvest", "leaves"), "harvest_wood", "树叶已下架——旧 kind 折回默认 wood");
  assert.equal(normalizeStoredWorkMode("harvest", "dirt"), "harvest_wood", "泥土已下架——旧 kind 折回默认 wood");
  assert.equal(normalizeStoredWorkMode("harvest", null), "harvest_wood", "kind 缺失兜底 wood（旧默认口径）");
  assert.equal(normalizeStoredWorkMode("harvest", "bogus"), "harvest_wood", "kind 非法同兜底");
  assert.equal(normalizeStoredWorkMode("fishing", undefined), "fishing", "目录成员直通");
  assert.equal(normalizeStoredWorkMode("woodcut", undefined), "none", "退场模式仍回落 none");
  assert.equal(normalizeStoredWorkMode("harvest_wood", undefined), "harvest_wood", "新值幂等");
});

// ─── 经验换算（公式分段边界） ──

test("XpMath：分段边界 15/16/30/31 与互逆", () => {
  assert.equal(xpForNextLevel(0), 7);
  assert.equal(xpForNextLevel(15), 37);
  assert.equal(xpForNextLevel(16), 42);
  assert.equal(xpForNextLevel(30), 112);
  assert.equal(xpForNextLevel(31), 121);
  for (const lv of [0, 1, 15, 16, 30, 31, 50]) {
    assert.deepEqual(levelFromTotalXp(totalXpForLevel(lv)), { level: lv, progress: 0 }, `${lv} 级互逆`);
    assert.deepEqual(levelFromTotalXp(totalXpForLevel(lv) + 3), { level: lv, progress: 3 });
  }
  assert.deepEqual(levelFromTotalXp(-5), { level: 0, progress: 0 });
});

// ─── 共享点池 ──

test("SharedPool：独占取点防囤/结论归还/黑标/重扫去重/扫描标单飞行", () => {
  const pool = new SharedPool<{ key: string }>(2, 3);
  pool.refill([{ key: "a" }, { key: "b" }, { key: "a" }, { key: "c" }]);
  assert.equal(pool.stats().free, 3, "refill 去重");

  assert.equal(pool.claim("1")!.key, "a");
  assert.equal(pool.claim("1"), null, "已有占点不再取（防囤）");
  assert.equal(pool.claim("2")!.key, "b");

  pool.release("1", "ok"); // free=[c,a]
  assert.equal(pool.stats().free, 2);
  pool.release("2", "spent"); // b 彻底移除
  assert.equal(pool.claim("3")!.key, "c");
  pool.release("3", "blocked"); // free=[a,c]，c 失败 1 次
  assert.equal(pool.claim("4")!.key, "a");
  pool.release("4", "spent"); // free=[c]
  assert.equal(pool.claim("5")!.key, "c");
  pool.release("5", "blocked"); // c 失败 2 次，回池
  assert.equal(pool.stats().blacklisted, 0, "未达阈值不黑标");
  assert.equal(pool.claim("6")!.key, "c");
  pool.release("6", "blocked"); // 第 3 次 → 进黑名单，不回池
  assert.equal(pool.stats().blacklisted, 1);
  assert.equal(pool.claim("7"), null, "黑标点不被发放");

  pool.refill([{ key: "c" }, { key: "d" }]);
  assert.equal(pool.stats().free, 1, "黑标点重扫不回收");

  assert.equal(pool.acquireScanToken("9"), true);
  assert.equal(pool.acquireScanToken("10"), false, "单飞行：他 bot 拿不到标");
  assert.equal(pool.acquireScanToken("9"), true, "持标者可重入");
  pool.refill([]);
  assert.equal(pool.acquireScanToken("10"), true, "refill 清标");
  pool.releaseScanToken("7"); // 非持标方释放 no-op
  assert.equal(pool.acquireScanToken("8"), false, "他人迟到释放不误清");
  pool.releaseScanToken("10");
  assert.equal(pool.acquireScanToken("8"), true, "验主释放后他人可接管");
  pool.sweepScanToken(() => false); // 持标方"10"已失效→死标清扫
  assert.equal(pool.acquireScanToken("11"), true, "sweep 清死标（下线/死亡兜底）");
  pool.sweepScanToken(() => true);
  assert.equal(pool.acquireScanToken("11"), true, "在场持标者不被 sweep 误伤");
  assert.equal(pool.acquireScanToken("12"), false);
  pool.releaseScanToken("11");

  assert.equal(pool.needsRefill(), true, "free=1 < 阈值 2");
  assert.equal(pool.claim("8")!.key, "d");
  pool.forceRelease("8"); // 会话销毁强制回池
  assert.equal(pool.stats().claimed, 0);
  pool.forceRelease("不存在"); // 幂等无操作
});

test("SharedPool 死占用清扫（缺54）：botId 跨会话复用——前世未归还即永久挡门，必须可自解", () => {
  const pool = new SharedPool<{ key: string }>(2, 3);
  pool.refill([{ key: "a" }, { key: "b" }, { key: "c" }]);
  assert.equal(pool.claim("7")!.key, "a", "第一世认领一点");
  // 模拟死占用：会话销毁未归还，botId 跨会话复用后新会话仍按 botId 认领
  assert.equal(pool.hasClaim("7"), true, "认领闸门按 botId 记账（不认会话）");
  assert.equal(
    pool.claimWhere("7", () => true, 6),
    null,
    "自己挡自己：入口即回 null，整池一个看不见"
  );
  assert.equal(pool.claim("8")!.key, "b", "他人认领不受影响（闸门是 per-bot）");

  // 判据由调用方喂"此刻是否真持有本池点位"：无人持有 → 收回失效占用
  assert.equal(
    pool.sweepClaims((owner) => owner === "8"),
    1,
    "7 的死占用收回 1 个（8 在场不误撤）"
  );
  assert.equal(pool.stats().claimed, 1, "只剩 8 的活占用");
  assert.deepEqual(pool.freeKeys(), ["c", "a"], "收回的点回队尾（与 release ok 同轨）");
  assert.equal(pool.claimWhere("7", () => true, 6)!.key, "c", "同 botId 下一世认领恢复");

  // 全判失效=全部收回（提前返回时遗留状态的批量自愈）
  assert.equal(
    pool.sweepClaims(() => false),
    2,
    "两个死账一并收回"
  );
  assert.equal(pool.stats().free, 3, "点位全部回到空闲队列");
  assert.equal(
    pool.sweepClaims(() => false),
    0,
    "无占用时幂等零操作"
  );
});

// ─── 辅助常加载半径（模拟4/6/8 档位） ──

test("auxTickingRadius：默认4；仅 0/4/6/8 合法，其余回退默认", () => {
  assert.equal(defaultConfig().auxTickingRadius, 4);
  assert.equal(mergeConfig({ auxTickingRadius: 0 }).auxTickingRadius, 0);
  assert.equal(mergeConfig({ auxTickingRadius: 6 }).auxTickingRadius, 6);
  assert.equal(mergeConfig({ auxTickingRadius: 8 }).auxTickingRadius, 8);
  assert.equal(mergeConfig({ auxTickingRadius: 5 }).auxTickingRadius, 4, "非档位值回退");
  assert.equal(mergeConfig({ auxTickingRadius: "4" }).auxTickingRadius, 4, "字符串形态回退");
  assert.equal(mergeConfig({}).auxTickingRadius, 4, "缺字段按默认补");
});

test("auxChunkCovered：r=4 圆档足迹实占 49 区块列（归档实测口径）", () => {
  let n = 0;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (auxChunkCovered(dx, dz, 4)) n++;
  assert.equal(n, 49);
  assert.equal(auxChunkCovered(0, 0, 4), true, "中心区块恒覆盖");
  assert.equal(auxChunkCovered(3, 3, 4), false, "四角剔除");
  assert.equal(auxChunkCovered(4, 0, 4), true, "正方向到界");
});
