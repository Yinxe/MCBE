// ─── 单棵树的砍伐计划（core 层） ───────────────────────
// 纯逻辑：给定一棵已认领的 TreeResource 与砍树模式，产出**分阶段有序砍伐目标**
// （树桩 → 主干 → 散落圆木 →（收集模式）全部树叶 → 卡叶清理）+ 7×7 拾取范围。
// 零 @minecraft，可 node 单测。
//
// 阶段编排（用户规格 2026-08-18 优化版）：
//   圆木模式（logs）：
//     ① stump   破除**树桩 1×2×1**（每根主干列的底部 2 格圆木）
//     ② trunk   移动进入树中心后**向上垂直砍伐主干**（底→顶；大树重复 4 列）
//     ③ scattered 移动到散落在树叶中的各圆木正下方，依次破除
//     ④ cleanup 圆木下方是树叶 → 破除让掉落物掉下（卡叶清理）
//     最后拾取：7×7（树中心为基准）内全部掉落物
//   收集模式（collect）：在拾取前追加
//     ⑤ leaf    挖掉**所有挖掘范围内**的树叶（超距 → 移动正下方缩短距离再挖；
//                 没有合适树叶工具 → 自动 fallback 圆木模式，由执行层判定）
//     最后拾取：树中心 7×7 范围内**圆木 + 树叶两类**掉落物
//
// ⚠️ 坐标制：输入使用 TreeResource 的存储坐标制（中心坐标 +0.5），计划输出
//   统一转**整数格**（破坏/拾取按格定位；与 basic/blocks 的 floor 语义一致）。
// ⚠️ "超出挖掘范围 → 靠近目标方块缩短距离再挖"由执行层（mc flow）处理。

import type { TreeResource } from "../tree/TreeRules";
import type { ChopMode, ChopTargetKind } from "./WoodcutRules";
import type { Vec3 } from "../Types";

/** 目标来源原因 */
export type ChopReason =
  | "stump" // 树桩（主干底部 2 格圆木）
  | "trunk" // 主干圆木
  | "scattered" // 散落在树叶中的圆木
  | "blocker-leaf" // 阻碍挖圆木的树叶（保留类型——散落圆木被树叶包住时）
  | "collect-leaf" // 收集模式完整破树叶
  | "stuck-cleanup"; // 圆木下方是树叶，掉落物卡住 → 破除让掉落物掉下

/** 单个砍伐目标（整数格坐标） */
export interface ChopTarget {
  loc: Vec3;
  kind: ChopTargetKind;
  reason: ChopReason;
}

/** 砍伐阶段种类 */
export type ChopStageKind = "stump" | "trunk" | "scattered" | "leaf" | "cleanup";

/** 砍伐阶段（目标有序；执行层整段推进，阶段内逐目标靠近/破块） */
export interface ChopStage {
  kind: ChopStageKind;
  targets: ChopTarget[];
}

/** 单棵树砍伐计划 */
export interface ChopPlan {
  mode: ChopMode;
  treeId: string;
  /** 树中心（底部坐标，blockCenter；导航/7×7 基准/重扫中心） */
  base: Vec3;
  /** 主干列数（大树 2×2 = 4 → 执行层"主干砍伐流程重复 4 次"；小树 = 1） */
  trunkColumns: number;
  /** 有序砍伐阶段（执行层按阶段推进） */
  stages: ChopStage[];
  /** 展平目标（兼容旧/诊断/拾取卡叶判定用） */
  targets: ChopTarget[];
  /** 拾取范围：树中心 7×7 水平（含整树高度；用户规格） */
  pickupMin: Vec3;
  pickupMax: Vec3;
  logsCount: number;
  leafsCount: number;
}

/** 方块坐标 key（整数格去重） */
function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 取整（负值向下取整，与 MC 方块坐标一致） */
function fl(v: number): number {
  return Math.floor(v);
}

/**
 * 生成单棵树砍伐计划（纯函数）：树桩→主干→散落圆木→[树叶]→卡叶清理，
 * 详见文件头阶段编排。主干列按树底 2×2 脚点识别（大树 4 列 / 小树 1 列）。
 *
 * @param tree 已认领树资源（logs/leafs 为存储坐标制）
 * @param mode 砍树模式（原木模式 / 收集模式）
 * @param world 障碍查看器（缺省无障碍）
 */
export function planChop(tree: TreeResource, mode: ChopMode): ChopPlan {
  // ── 收集去重后的圆木/树叶（整数格） ──
  const logSet = new Set<string>();
  const logs: { x: number; y: number; z: number }[] = [];
  for (const l of tree.logs) {
    const x = fl(l.x), y = fl(l.y), z = fl(l.z);
    const k = key(x, y, z);
    if (logSet.has(k)) continue;
    logSet.add(k);
    logs.push({ x, y, z });
  }
  const leafSet = new Set<string>();
  const leafs: { x: number; y: number; z: number }[] = [];
  for (const l of tree.leafs) {
    const x = fl(l.x), y = fl(l.y), z = fl(l.z);
    const k = key(x, y, z);
    if (leafSet.has(k)) continue;
    leafSet.add(k);
    leafs.push({ x, y, z });
  }

  const baseX = fl(tree.base.x);
  const baseY = fl(tree.base.y);
  const baseZ = fl(tree.base.z);

  // ── 主干列识别：树底 2×2 脚点（大树）内有原木的列 ──
  const trunkCols = new Set<string>();
  for (const dx of [0, 1]) {
    for (const dz of [0, 1]) {
      if (logSet.has(key(baseX + dx, baseY, baseZ + dz))) {
        trunkCols.add(key(baseX + dx, 0, baseZ + dz));
      }
    }
  }
  // 至少并入树中心列（小树锚点）
  if (trunkCols.size === 0 && logSet.has(key(baseX, baseY, baseZ))) trunkCols.add(key(baseX, 0, baseZ));

  // 分类：主干列内日志 → stump（底部 2 格）/ trunk（其上）；其余 → scattered
  const stump: ChopTarget[] = [];
  const trunk: ChopTarget[] = [];
  const scattered: ChopTarget[] = [];
  for (const l of logs) {
    const isTrunk = trunkCols.has(key(l.x, 0, l.z));
    if (!isTrunk) {
      scattered.push({ loc: { x: l.x, y: l.y, z: l.z }, kind: "log", reason: "scattered" });
    } else if (l.y - baseY < 2) {
      stump.push({ loc: { x: l.x, y: l.y, z: l.z }, kind: "log", reason: "stump" }); // 树桩 1×2×1（底部 2 格）
    } else {
      trunk.push({ loc: { x: l.x, y: l.y, z: l.z }, kind: "log", reason: "trunk" }); // 主干高出树桩部分（底→顶）
    }
  }
  const byY = (a: ChopTarget, b: ChopTarget): number => a.loc.y - b.loc.y;
  stump.sort(byY);
  trunk.sort(byY);
  scattered.sort(byY);

  // 收集模式：全部树叶（底→顶）
  const leafTargets: ChopTarget[] = leafs
    .map((c) => ({ loc: { x: c.x, y: c.y, z: c.z }, kind: "leaf" as ChopTargetKind, reason: "collect-leaf" as ChopReason }))
    .sort(byY);

  // 阶段组装：树桩 → 主干 → 散落圆木 →（收集模式）树叶 →（原木模式）卡叶清理
  const stages: ChopStage[] = [
    { kind: "stump", targets: stump },
    { kind: "trunk", targets: trunk },
  ];
  if (scattered.length > 0) stages.push({ kind: "scattered", targets: scattered });
  if (mode === "collect") stages.push({ kind: "leaf", targets: leafTargets });

  const cleanup: ChopTarget[] = [];
  for (const l of logs) {
    const belowKey = key(l.x, l.y - 1, l.z);
    if (leafSet.has(belowKey)) {
      cleanup.push({ loc: { x: l.x, y: l.y - 1, z: l.z }, kind: "leaf", reason: "stuck-cleanup" });
    }
  }
  if (mode === "logs" && cleanup.length > 0) stages.push({ kind: "cleanup", targets: cleanup });

  // 展平（去重）
  const seen = new Set<string>();
  const targets: ChopTarget[] = [];
  for (const s of stages) {
    for (const t of s.targets) {
      const k = key(t.loc.x, t.loc.y, t.loc.z);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(t);
    }
  }

  // ── 拾取范围：树中心 7×7 水平（树中心是底部坐标），Y 覆盖整树 ──
  let minY = Infinity, maxY = -Infinity;
  for (const l of logs) { minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y); }
  for (const c of leafs) { minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); }
  return {
    mode,
    treeId: tree.id,
    base: tree.base,
    trunkColumns: trunkCols.size,
    stages,
    targets,
    pickupMin: { x: baseX - 3, y: Math.floor(minY) - 1, z: baseZ - 3 },
    pickupMax: { x: baseX + 3, y: Math.floor(maxY) + 2, z: baseZ + 3 },
    logsCount: logs.length,
    leafsCount: leafs.length,
  };
}

// ─── 砍伐前 7×7×7 重扫后更新树资源（重扫更新清单位置） ──

/**
 * 用 7×7×7 重扫结果**刷新树资源清单**（用户规格：砍伐前以树中心 7×7×7
 * 重扫，更新圆木/树叶资源）。返回新 TreeResource（logs/leafs/top 更新；
 * 只含 7×7 范围覆盖的实际方块）。
 *
 * @param old 原树资源（保留 id/kind/base/footprint/概率信息）
 * @param newLogs 重扫到的圆木中心坐标列表（0.5 制）
 * @param newLeafs 重扫到的树叶中心坐标列表（0.5 制）
 * @param woodId 圆木木材 id（缺省 oak；规划不依赖种类）
 */
export function refreshTreeResource(
  old: TreeResource,
  newLogs: Vec3[],
  newLeafs: Vec3[],
  woodId = "oak",
): TreeResource {
  const logs = newLogs.map((l) => ({ x: l.x, y: l.y, z: l.z, woodId }));
  let top = old.top;
  if (logs.length > 0) {
    const maxY = Math.max(...logs.map((l) => l.y));
    const topLog = logs.find((l) => l.y === maxY)!;
    top = { x: topLog.x, y: topLog.y, z: topLog.z };
  }
  return { ...old, logs, leafs: newLeafs, top };
}
