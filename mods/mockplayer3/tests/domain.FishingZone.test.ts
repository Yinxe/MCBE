// 钓鱼区（对象化钓点资源）纯逻辑单测：几何判据与并区传递闭包 / 建区并区时点位与占用搬迁 /
// 就近复用与区消散 / 无效钓点移出点位池。
import test from "node:test";
import assert from "node:assert/strict";

import type { Vec3 } from "../scripts/domain/Coords";
import type { FishSpot } from "../scripts/domain/FishingSpot";
import { FISH_PICK_MAX_DIST, FISH_RATE_DEFAULT } from "../scripts/domain/FishingSpot";
import type { ZoneRect } from "../scripts/domain/FishingZone";
import {
  FishZone,
  FishingZones,
  ZONE_EXPIRE_GRACE_TICKS,
  ZONE_MERGE_DISTANCE,
  ZONE_REUSE_MAX_DIST,
  ZONE_SCAN_COOLDOWN_TICKS,
  distanceToRectXz,
  mergeGroup,
  normalizeRect,
  rectGapXz,
  unionRect,
} from "../scripts/domain/FishingZone";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function spot(x: number, y: number, z: number, level = 3): FishSpot {
  const stand = v(x, y, z);
  return {
    stand,
    aim: { target: stand, level },
    distSqCenter: x * x + z * z,
    key: `overworld:${x},${y},${z}`,
    rate: FISH_RATE_DEFAULT,
  };
}

/** 以 center 为中心的扫描盒（水平半边长 half，层高 ±8——与能力侧 scanRect 同形） */
function box(center: Vec3, half = 16): ZoneRect {
  return {
    min: v(center.x - half, center.y - 8, center.z - half),
    max: v(center.x + half, center.y + 8, center.z + half),
  };
}

/** mergeGroup 夹具（只有覆盖盒参与判定） */
const zoneBox = (center: Vec3, half = 16): { rect: ZoneRect } => ({ rect: box(center, half) });

// ─── 几何判据 ──

test("钓鱼区几何：重叠盒间隙 0、分离盒取 x/z 欧氏间隙、y 维不参与", () => {
  const a = box(v(0, 64, 0)); // x/z -16..16
  assert.equal(rectGapXz(a, box(v(10, 64, 10))), 0, "重叠盒间隙必为 0");
  assert.equal(rectGapXz(a, box(v(48, 64, 0))), 16, "x 向分离 16 格");
  assert.equal(rectGapXz(a, box(v(0, 64, 48))), 16, "z 向同上");
  assert.equal(rectGapXz(a, box(v(48, 64, 48))), Math.hypot(16, 16), "对角按欧氏合成");
  assert.equal(rectGapXz(a, box(v(0, 300, 48))), 16, "层高差异不影响并区判据");
});

test("钓鱼区几何：点到盒距离（盒内 0 / 盒外欧氏）、并盒取极值、取整向下", () => {
  const a = box(v(0, 64, 0));
  assert.equal(distanceToRectXz(a, v(5, 64, -5)), 0, "盒内=0（就近复用必命中）");
  assert.equal(distanceToRectXz(a, v(0, 64, 24)), 8, "盒外 z 向 8 格");
  assert.equal(distanceToRectXz(a, v(20, 64, 19)), 5, "角外两轴 3-4-5 合成");
  const u = unionRect(a, box(v(100, 70, 0)));
  assert.deepEqual([u.min.x, u.max.x, u.min.y, u.max.y], [-16, 116, 56, 78], "并盒取两侧极值");
  const n = normalizeRect({ min: v(-0.5, 63.2, -0.5), max: v(15.9, 71.9, 15.9) });
  assert.deepEqual(n.min, { x: -1, y: 63, z: -1 }, "负半轴向下取整");
  assert.deepEqual(n.max, { x: 15, y: 71, z: 15 }, "正半轴截断");
});

test("钓鱼区合并分组：16 格阈值内全并（含传递闭包），阈值外不并", () => {
  const target = zoneBox(v(0, 64, 0), 4); // [-4,4]
  const near = zoneBox(v(24, 64, 0), 4); // [20,28] 间隙 16 → 并（含端点）
  const far = zoneBox(v(30, 64, 0), 4); // [26,34] 与 target 间隙 22 → 单看不并
  const chained = zoneBox(v(46, 64, 0), 4); // [42,50] 离 target 间隙 38，靠并盒推进后才够到
  const group = mergeGroup([near, far, chained], target, ZONE_MERGE_DISTANCE);
  assert.deepEqual(group, [near, far, chained], "并盒后链式相邻的区一次并齐（传递闭包）");
  assert.equal(mergeGroup([chained], target, ZONE_MERGE_DISTANCE).length, 0, "孤立远区不并");
});

// ─── 建区 / 并区 ──

test("钓鱼区注册表：就近无区各自建区，16 格内建区即并区", () => {
  const zones = new FishingZones();
  const a = zones.create("overworld", box(v(0, 64, 0)), 100);
  const b = zones.create("overworld", box(v(200, 64, 0)), 200);
  assert.notEqual(a.id, b.id, "远隔两湖=两个区");
  assert.equal(zones.zonesOf("overworld").length, 2);
  assert.equal(zones.zonesOf("nether").length, 0, "分维度互不串");
  const c = zones.create("overworld", box(v(40, 64, 0)), 300); // 与 a 间隙 8、与 b 间隙 148
  assert.equal(c.id, a.id, "邻区命中 → 存活区为最老区（id 稳定，成员无需搬迁）");
  assert.equal(zones.zonesOf("overworld").length, 2, "新区被并走，不占活表");
  assert.equal(zones.get(c.id)?.id, a.id, "墓碑解析到存活区");
  assert.deepEqual([c.rect.min.x, c.rect.max.x], [-16, 56], "存活区覆盖盒含被并区扫描范围");
});

test("钓鱼区合并：点位与在占用一起搬迁，同点绝不双占", () => {
  const zones = new FishingZones();
  const east = zones.create("overworld", box(v(48, 64, 0), 4), 100); // [44,52]
  east.pool.refill([spot(46, 64, 0), spot(48, 64, 2), spot(50, 64, 4)]);
  assert.notEqual(east.pool.claim("bot1"), null, "东岸假人先占一点");
  assert.equal(east.pool.claim("bot1"), null, "每 bot 同时只占一点");
  const west = zones.create("overworld", box(v(8, 64, 0), 4), 200); // [4,12] 与东间隙 32
  assert.equal(west.id, 2, "间隙 >16 → 独立成区");
  west.pool.refill([spot(6, 64, 0), spot(8, 64, 2), spot(6, 64, 0)]); // 同坐标重复只入一份
  assert.notEqual(west.pool.claim("bot2"), null, "西岸假人占一点");
  const mid = zones.create("overworld", box(v(30, 64, 0), 4), 300); // [26,34] 两侧间隙均 ≤16
  assert.equal(mid.id, east.id, "三区并一，存活区=最老区");
  const st = east.pool.stats();
  assert.equal(st.claimed, 2, "两侧在占用点随合并搬迁（bot1/bot2 都不丢点）");
  assert.equal(st.free, 3, "两侧空闲点并入（东 2 + 西 1，西在占用点进 claimed）");
  assert.equal(east.pool.claim("bot1"), null, "搬迁后仍守每 bot 一点");
  assert.equal(zones.get(west.id)?.id, east.id, "被并区经墓碑解析到存活区");
  east.pool.release("bot2", "ok");
  assert.equal(east.pool.stats().free, 4, "在途者向存活区正常归还");
  assert.equal(east.pool.freeKeys().filter((k) => k === spot(6, 64, 0).key).length, 1, "同坐标点全区只一份");
});

test("钓鱼区合并：失败账取高并入、同键点不双份入池", () => {
  const zones = new FishingZones();
  const old = zones.create("overworld", box(v(0, 64, 0), 4), 100);
  const dup = spot(0, 64, 0);
  old.pool.refill([dup]);
  old.pool.claim("botA");
  old.pool.release("botA", "blocked"); // 失败 1 次（未达阈值，回池）
  const fresh = zones.create("overworld", box(v(6, 64, 0), 4), 200);
  assert.equal(fresh.id, old.id, "间隙 2 → 并入老区");
  assert.equal(old.pool.claim("botA")?.key, dup.key, "合并后本区失败账仍随点保留");
  old.pool.release("botA", "ok");
  fresh.pool.refill([spot(6, 64, 0), dup]); // 重叠扫描区的同坐标重点
  const again = zones.create("overworld", box(v(10, 64, 0), 4), 300);
  assert.equal(again.id, old.id);
  assert.equal(old.pool.stats().free, 2, "同坐标点只留一份（东 dup + 新点）");
});

test("钓鱼区合并：在途扫描标随并区搬迁（单飞行不破）+ 交付验主（迟到者不误清他人标）", () => {
  const zones = new FishingZones();
  const east = zones.create("overworld", box(v(0, 64, 0), 4), 100); // [-4,4]
  assert.equal(east.pool.acquireScanToken("botA"), true, "botA 正在扫东岸");
  const west = zones.create("overworld", box(v(40, 64, 0), 4), 150); // [36,44] 间隙 32 → 独立区
  assert.equal(west.pool.acquireScanToken("botB"), true, "botB 同时在扫西岸（两片水域各持各标）");
  const mid = zones.create("overworld", box(v(20, 64, 0), 4), 200); // 两侧间隙均 12 → 三区并一
  assert.equal(mid.id, east.id, "存活区=最老区，两条在途扫描归到它名下");
  // 锁：并区必把源池扫描标搬进存活区——丢标则单飞行破防、先到者交付会抹掉后到者的锁
  assert.equal(east.pool.acquireScanToken("botC"), false, "并区后在途扫描标仍挡得住第三人");
  east.pool.refill([spot(2, 64, 0)], "botB");
  assert.equal(east.pool.acquireScanToken("botD"), false, "非持标者交付不解标");
  assert.equal(east.pool.stats().free, 1, "后到者的点位照样并进存活区（不丢成果）");
  east.pool.refill([spot(4, 64, 0)], "botA");
  assert.equal(east.pool.stats().free, 2, "两轮交付各入一点");
  assert.equal(east.pool.acquireScanToken("botD"), true, "持标者本人交付才放行下一轮");
});

// ─── 无效点移出池 / 消散 / 复用 ──

test("无效钓点除名：removeKeys 出池且失败账一并作废", () => {
  const pool = new FishingZones().create("overworld", box(v(0, 64, 0), 4), 100).pool;
  const dead = spot(0, 64, 0);
  pool.refill([dead, spot(2, 64, 0), spot(4, 64, 0)]);
  pool.claim("bot1"); // 取走 dead
  pool.release("bot1", "blocked"); // 失败 1 次后回池
  assert.equal(pool.removeKeys([dead.key, "不存在的键"]), 1, "命中才计数");
  assert.equal(pool.stats().free, 2);
  assert.equal(pool.removeKeys([]), 0, "空判据零成本");
  pool.claim("bot2"); // 取走 spot(2)
  pool.release("bot2", "blocked");
  assert.equal(
    pool.pruneFree((p) => p.key === spot(2, 64, 0).key),
    1,
    "陈旧清退"
  );
  pool.claim("bot3"); // 取走 spot(4)
  pool.release("bot3", "blocked");
  assert.equal(pool.countUsable(), 1, "只剩 spot(4)——无僵尸键重入");
});

test("空区宽限后消散、有占用不消散；消散区经 get 判不可用（不造幽灵区）", () => {
  const zones = new FishingZones();
  const zone = zones.create("overworld", box(v(0, 64, 0), 4), 100);
  zone.pool.refill([spot(0, 64, 0)]);
  assert.equal(zones.sweep(200), 0, "宽限窗内不清");
  zone.pool.claim("bot1");
  assert.equal(zones.sweep(10_000), 0, "有人占用不清散");
  zone.pool.release("bot1", "spent"); // 结构失效的点移出池 → 区空
  assert.equal(zones.sweep(10_000 + ZONE_EXPIRE_GRACE_TICKS), 1, "过宽限窗空区消散");
  assert.equal(zones.get(zone.id), undefined, "消散区不可再用");
  assert.equal(zones.zonesOf("overworld").length, 0);
  assert.equal(zones.nearest("overworld", v(0, 64, 0)), undefined, "活表无区 → 下轮建区重扫");
});

test("死占用会把区钉成不朽且整区认不出点（缺54 症状的区侧闭环）", () => {
  const zones = new FishingZones();
  const zone = zones.create("overworld", box(v(0, 64, 0), 4), 100);
  zone.pool.refill([spot(0, 64, 0), spot(1, 64, 1), spot(2, 64, 2)]);
  zone.pool.claim("7"); // 第一世认领，卸载缺陷导致没归还
  assert.equal(
    zone.pool.claimWhere("7", () => true, 6),
    null,
    "botId 跨会话复用 → 自己前世把这一世整区挡死"
  );
  assert.equal(zone.depleted, false, "claimed>0 → 空区也永不消散（死账把区钉成不朽）");
  assert.equal(zones.sweep(10_000 + ZONE_EXPIRE_GRACE_TICKS), 0, "宽限窗对死占用无效");
  // 能力侧兜底：判据=此刻是否仍持有本区那一点（7 的新会话空手 → 判失效）
  assert.equal(
    zone.pool.sweepClaims((owner) => owner === "8"),
    1,
    "收回 7 的死占用"
  );
  assert.equal(zone.pool.claimWhere("7", () => true, 6)?.key, spot(1, 64, 1).key, "同 botId 下一世恢复选点");
  zone.pool.forceRelease("7");
  zone.pool.pruneFree(() => true); // 点位全部移出池
  assert.equal(zone.depleted, true, "归还后区重归可消散");
  assert.equal(zones.sweep(20_000 + ZONE_EXPIRE_GRACE_TICKS), 1, "死账清了，宽限窗才管得住区");
});

test("区消散后墓碑指向消散区同样判不可用（点不会灌进别人看不见的区）", () => {
  const zones = new FishingZones();
  const old = zones.create("overworld", box(v(0, 64, 0), 4), 100);
  const tomb = zones.create("overworld", box(v(8, 64, 0), 4), 200);
  assert.equal(tomb.id, old.id, "新区被并走（留墓碑）");
  old.pool.refill([spot(0, 64, 0)]);
  assert.equal(
    old.pool.pruneFree(() => true),
    1,
    "点位全被除名 → 区空"
  );
  assert.equal(zones.get(2)?.id, old.id, "清扫前墓碑解析到存活区");
  zones.sweep(10_000 + ZONE_EXPIRE_GRACE_TICKS);
  assert.equal(zones.get(old.id), undefined, "存活区消散不可再用");
  assert.equal(zones.get(2), undefined, "墓碑链终点已消散 → 整体判不可用");
});

test("墓碑随存活区保命：在途持有者过宽限窗仍能解析归还（囤点泄漏防线）", () => {
  const zones = new FishingZones();
  const survivor = zones.create("overworld", box(v(0, 64, 0), 4), 100); // id 1
  survivor.pool.refill([spot(0, 64, 0)]);
  const back = zones.create("overworld", box(v(8, 64, 0), 4), 200); // 间隙 4 → 并走（墓碑 id 2）
  assert.equal(back.id, survivor.id, "返回值即存活区");
  assert.ok(survivor.pool.claim("bot1"), "并区后在途认领（点带所有权进存活区池）");
  assert.equal(zones.sweep(200 + ZONE_EXPIRE_GRACE_TICKS), 0, "有人占用区不消散，墓碑也不按龄强删");
  assert.equal(zones.use(2, 500)?.id, survivor.id, "超宽限窗后墓碑仍解析到活区（WATCH 一轮 900t > 600t）");
  survivor.pool.release("bot1", "ok");
  assert.equal(survivor.pool.stats().free, 1, "在途者经墓碑找回后正常归还（不被死会话囤占）");
  assert.equal(
    survivor.pool.pruneFree(() => true),
    1
  );
  assert.equal(zones.sweep(500 + ZONE_EXPIRE_GRACE_TICKS), 2, "区空过窗消散，连带墓碑出表");
  assert.equal(zones.get(2), undefined, "终点已散 → 墓碑判不可用");
});

test("就近复用钓鱼区：盒内命中、16 格外不命中、多区取最近", () => {
  const zones = new FishingZones();
  const near = zones.create("overworld", box(v(0, 64, 0), 4), 100); // [-4,4]
  const farther = zones.create("overworld", box(v(40, 64, 0), 4), 200); // [36,44]
  assert.equal(near.id, 1);
  assert.equal(farther.id, 2, "间隙 32 → 独立区");
  assert.equal(
    zones.nearest("overworld", v(20, 64, 0), ZONE_REUSE_MAX_DIST)?.id,
    near.id,
    "离近区 16 格 → 复用（零扫描）"
  );
  assert.equal(
    zones.nearest("overworld", v(30, 64, 0), ZONE_REUSE_MAX_DIST)?.id,
    farther.id,
    "两区之间取更近者（6 < 10）"
  );
  assert.equal(zones.nearest("overworld", v(300, 64, 0), ZONE_REUSE_MAX_DIST), undefined, "全无近区 → 建区");
  assert.equal(zones.nearest("nether", v(0, 64, 0), ZONE_REUSE_MAX_DIST), undefined, "跨维度不复用");
  assert.equal(zones.use(near.id, 500)?.lastUsedAt, 500, "复用刷新使用时刻（宽限窗滑动）");
  assert.equal(zones.get(near.id)?.lastUsedAt, 500, "纯解析不改时刻");
  assert.equal(zones.use(9999, 600), undefined, "无此区 → undefined");
});

test("建区扫描节流：同维度冷却窗内只扫一次", () => {
  const zones = new FishingZones();
  assert.equal(zones.scanDue("overworld", 0), true, "首次必到点");
  zones.markScanned("overworld", 0);
  assert.equal(zones.scanDue("overworld", 10), false, "窗内不重扫（慢操作治理）");
  assert.equal(zones.scanDue("overworld", ZONE_SCAN_COOLDOWN_TICKS), true);
  assert.equal(zones.scanDue("nether", 10), true, "分维度独立");
});

test("FishZone.resolve 路径压缩：多级墓碑一跳直达存活区", () => {
  const a = new FishZone(1, "overworld", box(v(0, 64, 0), 2), 0);
  const b = new FishZone(2, "overworld", box(v(6, 64, 0), 2), 0);
  const c = new FishZone(3, "overworld", box(v(12, 64, 0), 2), 0);
  b.mergedInto = a;
  c.mergedInto = b;
  assert.equal(c.resolve().id, 1);
  assert.equal(c.mergedInto?.id, 1, "压缩后不再多级跳转");
  assert.equal(a.resolve().id, 1, "存活区自指即自身");
});

test("区存活判据：黑标残留不算存活理由（区消散即黑标作废，下轮重扫自愈）", () => {
  const zone = new FishZone(1, "overworld", box(v(0, 64, 0), 2), 0);
  assert.equal(zone.depleted, true, "新建区空池");
  zone.pool.refill([spot(0, 64, 0)]);
  for (let i = 0; i < 2; i++) {
    zone.pool.claim("bot1");
    zone.pool.release("bot1", "blocked");
  }
  assert.equal(zone.depleted, false, "未达阈值的失败点回池——区仍存活");
  zone.pool.claim("bot1");
  zone.pool.release("bot1", "blocked"); // 第 3 次失败 → 达到阈值，该点进黑名单
  assert.equal(zone.pool.stats().blacklisted, 1);
  assert.equal(zone.depleted, true, "只剩黑标 → 可被清扫（消散重扫即复位）");
});

test("钓点认领半径与区复用/并区半径同值（就近语义一致，防三档漂移）", () => {
  assert.equal(ZONE_REUSE_MAX_DIST, FISH_PICK_MAX_DIST, "复用区半径=区内选点半径");
  assert.equal(ZONE_MERGE_DISTANCE, FISH_PICK_MAX_DIST, "并区阈值亦取同格距（用户规格 16）");
});
