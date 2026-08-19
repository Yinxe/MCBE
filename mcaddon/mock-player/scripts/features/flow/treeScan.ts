// ─── 树资源坐标集扫描（mc 层） ─────────────────────────
// 坐标集方案（用户规格）：一次性 getBlocks 采集原木/树叶两个坐标集 →
// 纯算术评估（聚类 → 全局树叶归属 BFS → L×C×H 评估，零世界查询）。
//   大树：2×2 原木垂直向上（恒等段）特征明显 → 直接接受，无需树叶；
//   小树：logs + 归属树叶判定（每片叶恰属一棵树）。
// 开销 = 2 次大范围 getBlocks + 全纯计算（零 getBlock 属性读取）。
// ⚠️ 永不 reject：任何异常 resolve 空结果。

import { BlockPermutation, BlockVolume } from "@minecraft/server";
import type { Dimension } from "@minecraft/server";

import {
  assignLeafOwnership,
  blockCenter,
  coordKey,
  EMPTY_OWNED_LEAFS,
  evaluateTreeFromSets,
  extractTrunkCandidatesSimple,
  keyToCoord,
  TREE_LEAF_TYPE_IDS,
  TREE_LOG_TYPE_IDS,
  treeCenter,
  treeResourceId,
  type TrunkCandidate,
  type TreeReject,
  type TreeResource,
  type TreeVerdict,
} from "../../rules/tree/TreeRules";
import type { Vec3 } from "../../rules/Types";
import { treeRescanYRange, RESCAN_RADIUS } from "../../rules/woodcut/ChopPlan";
export { RESCAN_RADIUS };

/** 无效旧 id（1.20.30 方块拆分后已不存在，vanilla-data 1.26.20 校验）——
 *  getBlocks includeTypes 传入无效 id 可能被引擎拒绝（导致整轮扫描失败被
 *  catch 吞成空 → 砍树不动），从所有 getBlocks 调用中剔除 */
const INVALID_LEGACY_IDS = new Set([
  "minecraft:log",
  "minecraft:log2",
  "minecraft:leaves",
  "minecraft:leaves2",
  "minecraft:flowering_azalea_leaves",
  "minecraft:dirt_path",
  "minecraft:tallgrass",
  "minecraft:grass",
  "minecraft:dead_bush",
]);

/** 有效自然原木 id（定位/补全用——剔除无效旧 id） */
export const VALID_LOG_TYPE_IDS = (TREE_LOG_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));

/**
 * 水平原木置换（pillar_axis = x/z）——getBlocks 引擎级排除：
 * 倒下的树/横梁在查询源头被剔除（无需几何后处理，结果更纯）。
 * 构造失败（非原木 id 无 pillar_axis）的置换跳过。
 */
export const HORIZONTAL_LOG_PERMUTATIONS: BlockPermutation[] = VALID_LOG_TYPE_IDS.flatMap((id) =>
  (["x", "z"] as const).flatMap((axis) => {
    try {
      return [BlockPermutation.resolve(id as never, { pillar_axis: axis } as never)];
    } catch {
      return [];
    }
  }),
);

/** 自然方块分批白名单（区域分类缓存用；每组 ≤30——getBlocks includeTypes
 *  数量过大可能被引擎拒绝（3.3.17 修复：原 50 一组 + 无效旧 id → 批量失败
 *  全拒 → 砍树不动）；覆盖 classifyTreeBlock 全部非 foreign 类别，未命中格
 *  = foreign，与逐格 getBlock 语义一致） */

function toTreeResource(candidate: TrunkCandidate, verdict: Extract<TreeVerdict, { accepted: true }>): TreeResource {
  const base = treeCenter(candidate);
  // 存储坐标制：内部候选为整数格，输出全部转 blockCenter
  return {
    id: treeResourceId(base),
    kind: verdict.kind,
    probability: verdict.probability,
    factors: verdict.factors,
    base,
    top: blockCenter(
      Math.max(...candidate.logs.map((l) => l.x)),
      candidate.topY,
      Math.max(...candidate.logs.map((l) => l.z)),
    ),
    footprint: candidate.footprint.map((c) => blockCenter(c.x, c.y, c.z)),
    logs: candidate.logs.map((l) => ({ x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5, woodId: l.woodId })),
    leafs: verdict.leafs.map((c) => blockCenter(c.x, c.y, c.z)),
  };
}

/**
 * 单个候选的详细诊断描述（区域范围/计数/异物 typeId 明细/因子/结论）。
 * 方块类别从评估缓存（cellKind）读取——零额外世界查询。
 */
// ─── 坐标集扫描（测试命令用：一次性 getBlocks 采集坐标集，纯算术评估） ──

/** 坐标集采集结果（一次 getBlocks 完成计数+收集，杜绝重复查询） */
export interface CoordinateSetResult {
  /** 集合名（如 原木/树叶） */
  name: string;
  /** 坐标数量 */
  count: number;
  /** 最低/最高 y（分布统计） */
  minY: number;
  maxY: number;
  /** 采集耗时（ms） */
  ms: number;
  /** 坐标列表（x/y/z；树叶即树叶坐标集） */
  coords: Array<{ x: number; y: number; z: number }>;
}

/**
 * 一次性 getBlocks 采集指定方块类型的坐标集（纯位置，零 getBlock）：
 * 大范围（半径 32 空间体）每次只扫一种方块——单次查询同时完成
 * 计数 + Y 分布统计 + 坐标收集（不再重复遍历同一体积）。
 */
export function collectCoordinateSet(
  dimension: Dimension,
  center: Vec3,
  radius: number,
  typeIds: readonly string[],
  name: string,
  fromY: number,
  toY: number,
  excludePermutations?: BlockPermutation[],
): CoordinateSetResult {
  const t0 = Date.now();
  const volume = new BlockVolume(
    { x: center.x - radius, y: fromY, z: center.z - radius },
    { x: center.x + radius, y: toY, z: center.z + radius },
  );
  const found = dimension.getBlocks(volume, {
    includeTypes: [...typeIds],
    ...(excludePermutations && excludePermutations.length > 0 ? { excludePermutations } : {}),
  });
  const coords: Array<{ x: number; y: number; z: number }> = [];
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const loc of found.getBlockLocationIterator()) {
    coords.push({ x: loc.x, y: loc.y, z: loc.z });
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }
  return {
    name, count: coords.length,
    minY: coords.length > 0 ? minY : center.y,
    maxY: coords.length > 0 ? maxY : center.y,
    ms: Date.now() - t0,
    coords,
  };
}

/** 坐标集树扫描结果（测试命令用） */
export interface TreeSetScanResult {
  /** 原木/树叶坐标集采集结果 */
  logs: CoordinateSetResult;
  leaves: CoordinateSetResult;
  /** 纯算术评估出的树（近→远） */
  trees: TreeResource[];
  /** 被拒候选 */
  rejected: TreeReject[];
  /** 树干候选数 */
  candidates: number;
  /** 大树/小树候选数（聚类统计） */
  bigCandidates: number;
  smallCandidates: number;
  /** 聚类耗时（ms） */
  clusterMs: number;
  /** 树叶归属耗时（ms）——全局单遍多源 BFS（每片叶恰属一棵树） */
  ownershipMs: number;
  /** 评估耗时（ms） */
  evalMs: number;
  /** 大树碎段合并耗时（ms） */
  mergeMs: number;
  /** 扫描阶段实际耗时（ms）：原木采集 + 树叶采集（getBlocks 执行时间，不含调度等待） */
  scanMs: number;
  /** 分析阶段耗时（ms）：聚类 + 评估 + 合并 */
  analyzeMs: number;
  /** 纯算法总耗时（ms）= 扫描 + 分析（不含调度等待、不含日志输出） */
  computeMs: number;
  /** 总耗时（ms）：全流程（采集+分析，零调度等待——不含日志输出，日志在调用方另行计时） */
  ms: number;
}

/** 坐标集扫描高度范围（下探 10 上探 40，覆盖树底到树顶） */
const SET_SCAN_BELOW = 10;
const SET_SCAN_ABOVE = 40;

/**
 * 坐标集树扫描（测试命令用）：两次 getBlocks 采集原木/树叶坐标集 →
 * 纯算术评估（evaluateTreeFromSets——聚类/树冠计数全在集合内，零 BFS，
 * 评估阶段零世界查询）。
 */
export async function scanTreesFromSets(
  center: Vec3,
  dimension: Dimension,
  radius: number,
): Promise<TreeSetScanResult> {
  const t0 = Date.now();
  const fromY = Math.max(-64, center.y - SET_SCAN_BELOW);
  const toY = Math.min(320, center.y + SET_SCAN_ABOVE);

  // ① 原木/树叶坐标集：直接连续采集（零等待——waitTicks 每次让出 50ms，
  //    等待开销 > 采集本身；纯算法性能优先，单 tick 完成两次引擎遍历）
  //    原木：引擎级排除水平原木（pillar_axis=x/z 在查询源头剔除）
  const logsResult = collectCoordinateSet(dimension, center, radius, VALID_LOG_TYPE_IDS, "原木", fromY, toY, HORIZONTAL_LOG_PERMUTATIONS);
  const leavesResult = collectCoordinateSet(dimension, center, radius, VALID_LEAF_TYPE_IDS, "树叶", fromY, toY);
  const logs = logsResult.coords;
  // 树叶坐标集：数字编码 Set<number>（零字符串分配——大范围几十万次查询的性能关键）
  const leafSet = new Set<number>(leavesResult.coords.map((c) => coordKey(c.x, c.y, c.z)));

  // ③ 纯算术评估：无属性聚类（几何成链，零 getBlock）→ 全局树叶归属（单遍
  //    多源 BFS，每片叶恰属一棵树——资源点 leafs 与 L 因子同源）→ L×C×H 判定
  const tCluster = Date.now();
  const candidates = extractTrunkCandidatesSimple(logs);
  const clusterMs = Date.now() - tCluster;
  const bigCandidates = candidates.filter((c) => c.kind === "big").length;
  const smallCandidates = candidates.length - bigCandidates;
  const tOwn = Date.now();
  const ownership = assignLeafOwnership(candidates, leafSet);
  const ownershipMs = Date.now() - tOwn;
  const tEval = Date.now();
  const trees: TreeResource[] = [];
  const rejected: TreeReject[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const verdict = evaluateTreeFromSets(c, ownership.get(i) ?? EMPTY_OWNED_LEAFS);
    if (verdict.accepted) {
      trees.push(toTreeResource(c, {
        accepted: true,
        kind: verdict.kind,
        probability: verdict.probability,
        factors: { G: 1, L: verdict.factors.L, C: verdict.factors.C, F: 1, H: verdict.factors.H, A: 1 },
        leafs: verdict.leafs,
      }));
    } else {
      rejected.push({
        kind: verdict.kind,
        base: treeCenter(c),
        reason: verdict.reason === "no-canopy" ? "no-canopy" : "low-prob",
        probability: verdict.probability,
        factors: { G: 1, L: verdict.factors.L, C: verdict.factors.C, F: 1, H: verdict.factors.H, A: 1 },
      });
    }
  }
  trees.sort((a, b) => Math.hypot(a.base.x - center.x, a.base.z - center.z) - Math.hypot(b.base.x - center.x, b.base.z - center.z));

  logsResult.count = logs.length; // 校正为参与计算的垂直原木数
  const evalMs = Date.now() - tEval;

  // ── ④ 大树碎段合并：同一棵 2×2 大树在树身偏移/加宽层被段切分断段后，
  //    产生多个同水平位置、垂直相邻（gap ≤2 层）的大树候选——
  //    合并为一棵树（取整体高度、合并原木与叶数，避免一棵树报多棵）
  const tMerge = Date.now();
  const mergedTrees = mergeBigTreeSegments(trees);
  const mergeMs = Date.now() - tMerge;
  const mergedRejected = rejected.filter((r) => {
    // 被合并段对应的拒绝候选（同水平位置的大树残段）一并过滤
    for (const t of mergedTrees) {
      if (t.kind !== "big") continue;
      const hd = Math.max(Math.abs(t.base.x - r.base.x), Math.abs(t.base.z - r.base.z));
      const vd = Math.abs(Math.floor(r.base.y) - Math.floor(t.base.y));
      if (hd <= 1 && vd <= 30) return false; // 属于已合并大树的高度范围内
    }
    return true;
  });
  const scanMs = logsResult.ms + leavesResult.ms; // 两个 getBlocks 实际执行时间
  const analyzeMs = clusterMs + ownershipMs + evalMs + mergeMs;
  return {
    logs: logsResult, leaves: leavesResult, trees: mergedTrees, rejected: mergedRejected, candidates: candidates.length,
    bigCandidates, smallCandidates, clusterMs, ownershipMs, evalMs, mergeMs,
    scanMs, analyzeMs, computeMs: scanMs + analyzeMs,
    ms: Date.now() - t0, // 总耗时（零调度等待；日志输出在调用方另行计时）
  };
}

// ─── 大树碎段合并 ─────────────────────────────────────

/**
 * 合并大树碎段：同一水平位置（|dx|≤1 且 |dz|≤1）且垂直 gap ≤2 层的大树候选
 * 视为同一棵树——段切分在树身偏移/加宽层断段导致一棵 2×2 大树报多棵。
 * 合并取整体高度、原木并集、叶数取最大。
 */
function mergeBigTreeSegments(trees: TreeResource[]): TreeResource[] {
  const big = trees.filter((t) => t.kind === "big");
  if (big.length <= 1) return trees;
  const small = trees.filter((t) => t.kind !== "big");
  const merged: TreeResource[] = [];
  const used = new Set<TreeResource>();
  for (const a of big) {
    if (used.has(a)) continue;
    used.add(a);
    const group = [a];
    for (const b of big) {
      if (used.has(b)) continue;
      const hd = Math.max(Math.abs(a.base.x - b.base.x), Math.abs(a.base.z - b.base.z));
      // 组内任一段与 b 垂直 gap ≤2 且水平相邻 → 同树（blockCenter y 取整还原原木层）
      const groupMinY = Math.min(...group.map((g) => Math.floor(g.base.y)));
      const groupMaxY = Math.max(...group.map((g) => Math.floor(g.top.y)));
      const bBaseY = Math.floor(b.base.y);
      const vd = bBaseY <= groupMaxY + 2 && Math.floor(b.top.y) >= groupMinY - 2 ? 0 : Math.min(
        Math.abs(bBaseY - groupMaxY), Math.abs(Math.floor(b.top.y) - groupMinY),
      );
      if (hd <= 1 && vd <= 2) {
        used.add(b);
        group.push(b);
      }
    }
    if (group.length === 1) {
      merged.push(a);
      continue;
    }
    // 合并：整体高度范围、原木并集、树叶并集、概率取最高段；
    // 树中心取最低段（同柱 2×2 x/z 一致，blockCenter y 取整还原原木层）
    const allLogs = group.flatMap((g) => g.logs);
    const baseY = Math.min(...group.map((g) => Math.floor(g.base.y)));
    const topY = Math.max(...group.map((g) => Math.floor(g.top.y)));
    const height = topY - baseY + 1;
    const leafKeySet = new Set<number>();
    for (const g of group) {
      for (const c of g.leafs) leafKeySet.add(coordKey(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)));
    }
    const leafs = [...leafKeySet].map((k) => {
      const c = keyToCoord(k);
      return blockCenter(c.x, c.y, c.z);
    });
    const baseSeg = group.reduce((m, g) => (Math.floor(g.base.y) < Math.floor(m.base.y) ? g : m));
    const base = baseSeg.base;
    merged.push({
      id: treeResourceId(base),
      kind: "big",
      probability: Math.min(Math.max(...group.map((g) => g.probability)), 1),
      factors: { G: 1, L: 1, C: 1, F: 1, H: Math.min(height / 4, 1), A: 1 },
      base,
      top: blockCenter(Math.floor(group[0]!.top.x), topY, Math.floor(group[0]!.top.z)),
      footprint: baseSeg.footprint,
      logs: allLogs,
      leafs,
    });
  }
  return [...small, ...merged];
}

// ─── 详细日志评估报告（一次性输出：概况/坐标集/聚类/接受/拒绝/耗时） ──

/** 因子格式化（L/C/H/A，G/F 坐标集方案恒 1） */
function fmtFactors(f: { L: number; C: number; H: number; A: number }): string {
  return `L${f.L.toFixed(2)} C${f.C.toFixed(2)} H${f.H.toFixed(2)} A${f.A.toFixed(2)}`;
}

/**
 * 构建详细日志评估报告行（扫描即报告——最终一次性输出，循环内零日志）。
 * 包含：概况 / 坐标集统计 / 聚类统计 / 接受明细（每树因子）/ 拒绝明细 / 分阶段耗时。
 */
export function buildTreeSetReport(r: TreeSetScanResult, radius: number, fromY: number, toY: number): string[] {
  const size = radius * 2 + 1;
  const volume = size * size * (toY - fromY + 1);
  const lines: string[] = [];
  lines.push(`[树] ═══ 树资源扫描评估报告 ═══`);
  lines.push(
    `[树] 概况：半径${radius} 空间体${size}×${size}×${toY - fromY + 1}（${volume.toLocaleString()}格）` +
      `Y[${fromY}..${toY}] 总耗时 ${r.ms}ms`,
  );
  lines.push(
    `[树] 纯算法：扫描 ${r.scanMs}ms（原木 ${r.logs.ms} + 树叶 ${r.leaves.ms}）＋ 分析 ${r.analyzeMs}ms` +
      `（聚类 ${r.clusterMs} + 归属 ${r.ownershipMs} + 评估 ${r.evalMs} + 合并 ${r.mergeMs}）＝ ${r.computeMs}ms` +
      `（调度等待 ${Math.max(r.ms - r.computeMs, 0)}ms，日志输出另计）`,
  );
  lines.push(
    `[树] 坐标集：原木 ${r.logs.count} 个（Y ${r.logs.minY}..${r.logs.maxY}，采集 ${r.logs.ms}ms）｜` +
      `树叶 ${r.leaves.count} 个（Y ${r.leaves.minY}..${r.leaves.maxY}，采集 ${r.leaves.ms}ms）｜查询 getBlocks ×2`,
  );
  lines.push(
    `[树] 聚类：候选 ${r.candidates}（大树 ${r.bigCandidates} / 小树 ${r.smallCandidates}）耗时 ${r.clusterMs}ms｜` +
      `归属：全局单遍多源 BFS（每片叶恰属一棵树）耗时 ${r.ownershipMs}ms｜` +
      `评估：接受 ${r.trees.length} / 拒绝 ${r.rejected.length} 耗时 ${r.evalMs}ms｜合并 ${r.mergeMs}ms｜` +
      `纯计算合计 ${r.clusterMs + r.ownershipMs + r.evalMs + r.mergeMs}ms`,
  );
  lines.push(`[树] ── 接受（${r.trees.length}）${"─".repeat(Math.max(8, 40 - String(r.trees.length).length))}`);
  for (const t of r.trees) {
    lines.push(
      `[树] ✓ ${t.kind === "big" ? "大树" : "小树"} P=${t.probability.toFixed(2)} 高${Math.floor(t.top.y) - Math.floor(t.base.y) + 1} ` +
        `原木${t.logs.length} 叶${t.leafs.length} ${t.id} ${t.kind === "big" ? "（2×2 直接判定）" : fmtFactors(t.factors)}`,
    );
  }
  lines.push(`[树] ── 拒绝（${r.rejected.length}）${"─".repeat(Math.max(8, 40 - String(r.rejected.length).length))}`);
  for (const rej of r.rejected) {
    lines.push(
      `[树] ✗ (${Math.floor(rej.base.x)},${Math.floor(rej.base.y)},${Math.floor(rej.base.z)}) ${rej.kind === "big" ? "大树" : "小树"} ` +
        `原因=${rej.reason} P=${rej.probability.toFixed(3)} ${fmtFactors(rej.factors)}`,
    );
  }
  return lines;
}

/** 有效树叶 id（剔除无效旧 id） */
export const VALID_LEAF_TYPE_IDS = (TREE_LEAF_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));

// ─── 砍伐前 7×7×7 重扫（用户规格：以树中心为 7×7×7 范围重扫，更新树资源清单） ──

/** 树中心 7×7×7 重扫结果（logs/leafs 为存储坐标制 0.5） */
export interface TreeRescanResult {
  logs: { x: number; y: number; z: number; woodId: string }[];
  leafs: Vec3[];
}

/** 重扫木材 id（规划不依赖种类；后续可由方块 states 归一细化） */
const RESCAN_WOOD_ID = "oak";

/**
 * 以树中心（底部坐标）为中心的重扫，用于**砍伐前更新树资源清单**（用户规格）：
 *   - 水平：7×7（base ± RESCAN_RADIUS）——覆盖树冠直径与散落分支；
 *   - 垂直：自 base（树桩/树根）**向上**，且**覆盖整树已知高度**（topY + 2）。
 *     修复①：旧实现向下扫 base−3（木头都在上面，向下无用）；
 *     修复②：旧实现只到 base+3（7 高），把更高树顶圆木/树叶丢出清单 → 树顶
 *     圆木永远砍不到——现按树高补全（缺 topY 时向上默认 12 格）。
 * 开销 = 2 次小范围 getBlocks。
 */
export function rescanTree7x7(dimension: Dimension, base: Vec3, topY?: number): TreeRescanResult {
  const bx = Math.floor(base.x);
  const by = Math.floor(base.y);
  const bz = Math.floor(base.z);
  // 竖向范围走 core 纯函数（只向上，覆盖整树高度，修复树顶漏扫回归）
  const { fromY, toY } = treeRescanYRange(by, topY);
  const center: Vec3 = { x: bx, y: by, z: bz };

  const logRes = collectCoordinateSet(dimension, center, RESCAN_RADIUS, VALID_LOG_TYPE_IDS, "原木(7×7)", fromY, toY, HORIZONTAL_LOG_PERMUTATIONS);
  const leafRes = collectCoordinateSet(dimension, center, RESCAN_RADIUS, VALID_LEAF_TYPE_IDS, "树叶(7×7)", fromY, toY);

  const leafs: Vec3[] = leafRes.coords.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }));
  const logs: { x: number; y: number; z: number; woodId: string }[] = logRes.coords
    .map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5, woodId: RESCAN_WOOD_ID }));
  return { logs, leafs };
}
