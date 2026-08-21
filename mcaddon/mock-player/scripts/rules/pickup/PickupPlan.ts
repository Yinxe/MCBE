// ─── 拾取目标掉落物计划（core 层：独立的拾取子 flow 规划） ──
// 纯逻辑：给定候选掉落物实体 + 拾取工作范围 + 目标 typeId 白名单，产出
// **有序拾取计划**（就近排序）+ **卡落清理**（掉落物卡在树叶/半格上时需
// 先破除遮挡让其掉下来，才能被拾取）。
// 零 @minecraft，可 node 单测。
//
// 设计说明（用户规格 2026-08-18：拾取可单独做一个 flow）：
//   - types：可选目标掉落物 typeId 白名单（不传 = 全拾取）
//   - 工作范围：pickupRange {min,max}（超出范围不处理）
//   - 卡落清理：若某掉落物正下方是树叶（可被清理的薄层），先在拾取前破除
//     该树叶让掉落物掉到地面再拾取——应用于"圆木掉落物卡在树叶上"
//   - 背包满回调 / 无法拾取的回退是 **mc 执行层** 职责（本 core 只规划），
//     mc flow 在背包满时返回"背包满"由调用方暂停/清理

import type { Vec3 } from "../Types";

/** 单个候选掉落物（mc 层从 getEntities 快照构造） */
export interface PickupItem {
  /** 掉落物实体位置（浮点实体坐标；拾取导航用） */
  loc: Vec3;
  /** 掉落物物品 typeId（如 minecraft:oak_log / minecraft:apple） */
  typeId: string;
  /** 掉落物实体 ID（mc 层填入；执行流用它精确判定"是否已被拾取"，缺省 undefined） */
  entityId?: string;
}

/** 拾取任务说明（调用方提供）：工作范围 + 目标 typeId 白名单 */
export interface PickupTask {
  /** 拾取工作范围（整数格 min/max；掉落物中心在此范围内才算目标） */
  rangeMin: Vec3;
  rangeMax: Vec3;
  /** 目标掉落物 typeId 白名单（缺省/空 = 全拾取） */
  includeTypes?: string[];
  /** 排序原点（就近优先；缺省不排序） */
  origin?: Vec3;
  /** 指定格是否为"卡落遮挡"（如树叶）：掉落物正下方是该遮挡 → 需先破除 */
  isBlockingBelow?: (loc: Vec3) => boolean;
}

/** 拾取计划结果 */
export interface PickupPlan {
  /** 有序拾取目标（就近优先；已被之前清理/越界的排除） */
  targets: PickupItem[];
  /** 卡落清理（破除后掉落物可落到可拾取地面）——破坏这些薄层方块 */
  cleanups: Vec3[];
}

/** 是否在范围（含边界） */
function inRange(p: Vec3, min: Vec3, max: Vec3): boolean {
  return (
    p.x >= min.x && p.x <= max.x &&
    p.y >= min.y && p.y <= max.y &&
    p.z >= min.z && p.z <= max.z
  );
}

/** 3D 距离平方 */
function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 规划拾取（纯函数）：过滤范围 + typeId 白名单 → 就近排序 → 检测卡落清理。
 *
 * 卡落语义：某掉落物正下方（y-1）是 isBlockingBelow 判定的遮挡（如树叶），
 * 则掉落物卡在遮挡上面无法落到可拾取地面 → 计划里加入"先破除该遮挡"。
 * 同一遮挡格去重（多掉落物共享同一片树叶只破除一次）。
 *
 * @param items 候选掉落物（mc 层扫描结果）
 * @param task  拾取任务（范围/白名单/排序原点/遮挡判定）
 */
export function planPickup(items: readonly PickupItem[], task: PickupTask): PickupPlan {
  const { rangeMin, rangeMax, includeTypes, origin, isBlockingBelow } = task;
  const wantAll = !includeTypes || includeTypes.length === 0;

  const targets: PickupItem[] = [];
  const cleanupSet = new Set<string>();
  const cleanups: Vec3[] = [];

  for (const item of items) {
    if (!inRange(item.loc, rangeMin, rangeMax)) continue; // 超出工作范围
    if (!wantAll && !includeTypes!.includes(item.typeId)) continue; // 白名单过滤
    targets.push(item);
    // 卡落检测：正下方是遮挡（如树叶）→ 需要破除让掉落物掉下
    if (isBlockingBelow) {
      const below = { x: item.loc.x, y: item.loc.y - 1, z: item.loc.z };
      if (isBlockingBelow(below)) {
        const k = `${Math.floor(below.x)},${Math.floor(below.y)},${Math.floor(below.z)}`;
        if (!cleanupSet.has(k)) {
          cleanupSet.add(k);
          cleanups.push(below);
        }
      }
    }
  }

  // 就近优先（距 origin）
  if (origin) {
    targets.sort((a, b) => distSq(a.loc, origin!) - distSq(b.loc, origin!));
  }
  return { targets, cleanups };
}
