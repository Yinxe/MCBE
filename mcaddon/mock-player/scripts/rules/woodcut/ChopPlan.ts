// ─── 单棵树的砍伐计划（core 层） ───────────────────────
// 纯逻辑：给定一棵已认领的 TreeResource 与砍树模式，产出**有序砍伐目标列表**
// + 掉落物拾取范围 + 圆木卡叶清理目标。零 @minecraft，可 node 单测。
//
// 阶段编排（用户规格 2026-08-18）：
//   原木模式（logs）：
//     1. 全部圆木（**底→顶**：先破除树桩，再向上逐根砍——超出挖掘距离由
//        执行层靠近目标方块继续）
//     2. 阻碍挖圆木的树叶/障碍（blocker——提前排在该圆木前）
//     3. 圆木下方是树叶 → 掉落物会卡在树叶上 → 破除该树叶让掉落物掉下来
//     4. 拾取树范围内全部掉落物（拾取阶段在流程首尾执行）
//   收集模式（collect）：
//     1. 全部圆木（底→顶）
//     2. 整棵树全部树叶（完整破除树形）
//     3. 圆木卡叶清理同原木模式
//     4. 拾取树范围内全部掉落物
//
// ⚠️ 坐标制：输入使用 TreeResource 的存储坐标制（中心坐标 +0.5），计划输出
//   统一转**整数格**（破坏/拾取按格定位；与 basic/blocks 的 floor 语义一致）。
// ⚠️ "超出挖掘范围 → 靠近目标方块缩短距离再挖"由执行层（mc flow）处理，
//   本计划不关心距离。

import type { TreeResource } from "../tree/TreeRules";
import type { ChopMode, ChopTargetKind } from "./WoodcutRules";
import type { Vec3 } from "../Types";

/** 水平 8 邻方向（挖掘障碍检测：原木被树叶/障碍围着时需先破除） */
const ADJACENT_8: readonly { dx: number; dz: number }[] = [
  { dx: -1, dz: -1 },
  { dx: 0, dz: -1 },
  { dx: 1, dz: -1 },
  { dx: -1, dz: 0 },
  { dx: 1, dz: 0 },
  { dx: -1, dz: 1 },
  { dx: 0, dz: 1 },
  { dx: 1, dz: 1 },
];

/** 目标来源原因 */
export type ChopReason =
  | "log" // 圆木本身
  | "blocker-leaf" // 阻碍挖圆木的树叶
  | "blocker-obstacle" // 阻碍挖圆木的其他实心障碍（须执行层确认破坏）
  | "collect-leaf" // 收集模式完整破树叶
  | "stuck-cleanup"; // 圆木下方是树叶，掉落物会卡住 → 破除让掉落物掉下

/** 单个砍伐目标（整数格坐标） */
export interface ChopTarget {
  loc: Vec3;
  kind: ChopTargetKind;
  reason: ChopReason;
}

/** 单棵树砍伐计划 */
export interface ChopPlan {
  mode: ChopMode;
  treeId: string;
  base: Vec3;
  /** 有序砍伐目标（执行层按序处理；超距目标 → 靠近后再挖） */
  targets: ChopTarget[];
  /** 拾取范围（整格 min/max，含 1 格余量；拾取阶段扫描该区域掉落物） */
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

/** 是否同一格 */
function same(a: Vec3, b: Vec3): boolean {
  return fl(a.x) === fl(b.x) && fl(a.y) === fl(b.y) && fl(a.z) === fl(b.z);
}

/**
 * 空世界查看器（不传入时：无障碍判定，仅树内树叶算障碍）——
 * 非树的实心方块（如泥土/石头盖住原木）由 mc 层注入判定。
 */
export interface ChopWorld {
  /** 指定格是否非树的实心障碍（原木/树叶之外的方块；返回 true 会被计划为 blocker-obstacle） */
  isSolidForeign: (loc: Vec3) => boolean;
}

/** 默认查看器：无障碍（默认安全——执行层可传更精确的判定） */
const EMPTY_WORLD: ChopWorld = { isSolidForeign: () => false };

/**
 * 生成单棵树砍伐计划（纯函数）：
 * 按模式编排圆木/树叶/障碍/卡叶清理目标（详见文件头阶段编排）。
 *
 * @param tree 已认领树资源（logs/leafs 为存储坐标制）
 * @param mode 砍树模式（原木模式 / 收集模式）
 * @param world 障碍查看器（缺省无障碍）
 */
export function planChop(tree: TreeResource, mode: ChopMode, world: ChopWorld = EMPTY_WORLD): ChopPlan {
  const logSet = new Set<string>();
  const logs: ChopTarget[] = [];
  for (const l of tree.logs) {
    const k = key(fl(l.x), fl(l.y), fl(l.z));
    if (logSet.has(k)) continue;
    logSet.add(k);
    logs.push({ loc: { x: fl(l.x), y: fl(l.y), z: fl(l.z) }, kind: "log", reason: "log" });
  }

  const leafSet = new Set<string>();
  const leafs: ChopTarget[] = [];
  for (const l of tree.leafs) {
    const k = key(fl(l.x), fl(l.y), fl(l.z));
    if (leafSet.has(k)) continue;
    leafSet.add(k);
    leafs.push({ loc: { x: fl(l.x), y: fl(l.y), z: fl(l.z) }, kind: "leaf", reason: mode === "collect" ? "collect-leaf" : "blocker-leaf" });
  }

  // 圆木从底到顶（用户规格 2026-08-18：**先破除树桩，再向上砍掉所有圆木**；
  // 逐根上升，超出挖掘距离时执行层靠近目标方块继续）
  logs.sort((a, b) => a.loc.y - b.loc.y);
  leafs.sort((a, b) => a.loc.y - b.loc.y);

  const ordered: ChopTarget[] = [];
  const seen = new Set<string>();

  const push = (t: ChopTarget): void => {
    const k = key(t.loc.x, t.loc.y, t.loc.z);
    if (seen.has(k)) return;
    seen.add(k);
    ordered.push(t);
  };

  // ── 阶段 1/2：逐圆木（先插其障碍/树叶 blocker，再插圆木） ──
  for (const log of logs) {
    if (mode === "logs") {
      // 阻碍挖圆木的树叶/障碍：圆木水平 8 邻内，非圆木的实心物——
      // （树叶包住圆木四面时原木无可挖面 → 先破除；正上方树叶不挡圆木本身，
      //   由收集模式/卡叶清理另行处理）
      for (const { dx, dz } of ADJACENT_8) {
        const nb = { x: log.loc.x + dx, y: log.loc.y, z: log.loc.z + dz };
        const isLog = logSet.has(key(fl(nb.x), fl(nb.y), fl(nb.z)));
        if (isLog) continue;
        if (leafSet.has(key(fl(nb.x), fl(nb.y), fl(nb.z)))) {
          push({ loc: nb, kind: "leaf", reason: "blocker-leaf" });
        } else if (world.isSolidForeign(nb)) {
          push({ loc: nb, kind: "leaf", reason: "blocker-obstacle" }); // 障碍以 leaf 类型处理（执行层按方块实际类型破坏）
        }
      }
    }
    push(log);
  }

  // ── 收集模式：整棵树全部树叶（完整破除树形） ──
  if (mode === "collect") {
    for (const leaf of leafs) push(leaf);
  }

  // ── 阶段 3：圆木卡叶清理——圆木正下方是树叶 → 清除该树叶让掉落物掉下 ──
  for (const log of logs) {
    const below = { x: log.loc.x, y: log.loc.y - 1, z: log.loc.z };
    if (leafSet.has(key(fl(below.x), fl(below.y), fl(below.z)))) {
      push({ loc: below, kind: "leaf", reason: "stuck-cleanup" });
    }
  }

  // ── 拾取范围：logs ∪ leafs 的包围盒 + 1 格余量 ──
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of tree.logs) {
    minX = Math.min(minX, fl(l.x)); maxX = Math.max(maxX, fl(l.x));
    minY = Math.min(minY, fl(l.y)); maxY = Math.max(maxY, fl(l.y));
    minZ = Math.min(minZ, fl(l.z)); maxZ = Math.max(maxZ, fl(l.z));
  }
  for (const l of tree.leafs) {
    minX = Math.min(minX, fl(l.x)); maxX = Math.max(maxX, fl(l.x));
    minY = Math.min(minY, fl(l.y)); maxY = Math.max(maxY, fl(l.y));
    minZ = Math.min(minZ, fl(l.z)); maxZ = Math.max(maxZ, fl(l.z));
  }

  return {
    mode,
    treeId: tree.id,
    base: tree.base,
    targets: ordered,
    pickupMin: { x: Math.floor(minX) - 1, y: Math.floor(minY) - 1, z: Math.floor(minZ) - 1 },
    pickupMax: { x: Math.floor(maxX) + 1, y: Math.floor(maxY) + 1, z: Math.floor(maxZ) + 1 },
    logsCount: logs.length,
    leafsCount: leafs.length,
  };
}
