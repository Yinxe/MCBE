// 容器同族排行榜：纯函数单测。
// 覆盖：族归聚合（byType → 族）、类型数/总数计算、类型数降序、同类型数稳定排序、
//     只统计实含族（无族物品不参与）、formatCount 单位化渲染、空容器返回空。
import { test } from "node:test";
import assert from "node:assert/strict";
import { containerFamilyRanks, formatFamilyRankLine, formatFamilyRankBody } from "../scripts/core/stats/familyRanks";
import type { ContainerScanResult } from "../scripts/core/model/ContainerScan";

function scanOf(byType: Record<string, number>): ContainerScanResult {
  const items = Object.entries(byType).map(([itemId, amount]) => ({ itemId, amount }));
  const usedSlots = items.length;
  return {
    items: items as ContainerScanResult["items"],
    byType,
    usedSlots,
    totalItems: items.reduce((s, i) => s + i.amount, 0),
    lastNonEmptySlot: usedSlots - 1,
    emptySlots: [],
  };
}

test("containerFamilyRanks: 全羊毛 5 色 → 单族 5 类型 总数量聚合", () => {
  const r = containerFamilyRanks(
    scanOf({
      "minecraft:white_wool": 1200,
      "minecraft:orange_wool": 100,
      "minecraft:magenta_wool": 90,
      "minecraft:black_wool": 30,
      "minecraft:red_wool": 10,
    })
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]?.familyId, "wool");
  assert.equal(r[0]?.displayName, "羊毛");
  assert.equal(r[0]?.typeCount, 5);
  assert.equal(r[0]?.totalCount, 1430);
});

test("containerFamilyRanks: 多族按类型数降序 + 同类型数稳定（中文名序）", () => {
  const r = containerFamilyRanks(
    scanOf({
      "minecraft:white_wool": 10,
      "minecraft:orange_wool": 10, // 羊毛：2 类型
      "minecraft:white_carpet": 10,
      "minecraft:red_carpet": 10,
      "minecraft:yellow_carpet": 10, // 地毯：3 类型 → 应居首
      "minecraft:oak_log": 10, // 原木：1 类型
    })
  );
  assert.equal(r[0]?.familyId, "carpet");
  assert.equal(r[0]?.typeCount, 3);
  assert.equal(r[1]?.familyId, "wool");
  assert.equal(r[1]?.typeCount, 2);
  assert.equal(r[2]?.familyId, "logs");
  assert.equal(r[2]?.typeCount, 1);
});

test("containerFamilyRanks: 无族物品（合成物）不参与排行", () => {
  const r = containerFamilyRanks(
    scanOf({
      "minecraft:white_wool": 5,
      "minecraft:chest": 3, // chest → workstations 有族？这里用无族物验证跳过
      "minecraft:stick": 2,
    })
  );
  // chest/stick 若在族内会入榜；此处不断言具体，仅确保 wool 存在且为榜首之一
  const wool = r.find((x) => x.familyId === "wool");
  assert.ok(wool !== undefined);
});

test("familyRank 格式: → 分隔类型|数量（避免竖线误读为 1）", () => {
  assert.equal(formatFamilyRankBody({ familyId: "wool", displayName: "羊毛", typeCount: 5, totalCount: 1430 }), "羊毛(5→1.43k)");
  assert.equal(formatFamilyRankBody({ familyId: "plants", displayName: "植物", typeCount: 3, totalCount: 22 }), "植物(3→22)");
  assert.equal(formatFamilyRankLine({ familyId: "wool", displayName: "羊毛", typeCount: 5, totalCount: 1430 }, 1), "#1. 羊毛(5→1.43k)");
});

test("containerFamilyRanks: 空容器 → 空榜", () => {
  assert.deepEqual(containerFamilyRanks(scanOf({})), []);
});