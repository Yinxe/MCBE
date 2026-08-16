// ─── 树资源坐标集扫描（mc 层） ─────────────────────────
// 坐标集方案（用户规格）：一次性 getBlocks 采集原木/树叶两个坐标集 →
// 纯算术评估（聚类/树冠计数/连通 BFS 全在集合内，评估零世界查询）。
//   大树：2×2 原木垂直向上（恒等段）特征明显 → 直接接受，无需树叶；
//   小树：logs + leaves 坐标关系判定。
// 开销 = 2 次大范围 getBlocks + 全纯计算（零 getBlock 属性读取）。
// ⚠️ 永不 reject：任何异常 resolve 空结果。

import { BlockVolume } from "@minecraft/server";
import type { Dimension } from "@minecraft/server";

import {
  evaluateTreeFromSets,
  extractTrunkCandidatesSimple,
  TREE_LEAF_TYPE_IDS,
  TREE_LOG_TYPE_IDS,
  type TrunkCandidate,
  type TreeReject,
  type TreeResource,
  type TreeVerdict,
} from "../../rules/tree/TreeRules";
import type { Vec3 } from "../../rules/Types";
import { waitTicks } from "../utils";

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

/** 自然方块分批白名单（区域分类缓存用；每组 ≤30——getBlocks includeTypes
 *  数量过大可能被引擎拒绝（3.3.17 修复：原 50 一组 + 无效旧 id → 批量失败
 *  全拒 → 砍树不动）；覆盖 classifyTreeBlock 全部非 foreign 类别，未命中格
 *  = foreign，与逐格 getBlock 语义一致） */

function toTreeResource(candidate: TrunkCandidate, verdict: TreeVerdict): TreeResource {
  return {
    kind: verdict.kind,
    probability: verdict.probability,
    factors: verdict.factors,
    base: { x: Math.min(...candidate.logs.map((l) => l.x)), y: candidate.baseY, z: Math.min(...candidate.logs.map((l) => l.z)) },
    top: { x: Math.max(...candidate.logs.map((l) => l.x)), y: candidate.topY, z: Math.max(...candidate.logs.map((l) => l.z)) },
    footprint: candidate.footprint,
    logs: candidate.logs,
    leafCount: verdict.leafCount,
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
): CoordinateSetResult {
  const t0 = Date.now();
  const volume = new BlockVolume(
    { x: center.x - radius, y: fromY, z: center.z - radius },
    { x: center.x + radius, y: toY, z: center.z + radius },
  );
  const found = dimension.getBlocks(volume, { includeTypes: [...typeIds] });
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
  /** 评估耗时（ms） */
  evalMs: number;
  /** 总耗时（ms） */
  ms: number;
}

/** 坐标集扫描高度范围（下探 10 上探 40，覆盖树底到树顶） */
const SET_SCAN_BELOW = 10;
const SET_SCAN_ABOVE = 40;

/**
 * 坐标集树扫描（测试命令用）：两次 getBlocks 采集原木/树叶坐标集 →
 * 纯算术评估（evaluateTreeFromSets——聚类/树冠计数/连通 BFS 全在集合内，
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

  // ① 原木/树叶坐标集：Promise.all 并发采集（协程交错调度）——
  //    getBlocks 是同步 API（单线程），协程间靠 waitTicks 让出点错开，
  //    原木遍历落在 tick N、树叶遍历落在 tick N+1——主线程每 tick 只做
  //    一次大体积引擎遍历；两个协程生命周期重叠（Promise.all 语义并发）。
  const collectLogs = (async () => {
    const r = collectCoordinateSet(dimension, center, radius, VALID_LOG_TYPE_IDS, "原木", fromY, toY);
    await waitTicks(1); // 原木遍历后让出
    return r;
  })();
  const collectLeaves = (async () => {
    await waitTicks(1); // 错开：树叶遍历从原木的下一个 tick 开始
    const r = collectCoordinateSet(dimension, center, radius, VALID_LEAF_TYPE_IDS, "树叶", fromY, toY);
    await waitTicks(1);
    return r;
  })();
  const [logsResult, leavesResult] = await Promise.all([collectLogs, collectLeaves]);
  const logs = logsResult.coords;
  const leafSet = new Set<string>(leavesResult.coords.map((c) => `${c.x},${c.y},${c.z}`));

  // ③ 纯算术评估：无属性聚类（几何成链，零 getBlock）→ 坐标集树判定
  const tCluster = Date.now();
  const candidates = extractTrunkCandidatesSimple(logs);
  const clusterMs = Date.now() - tCluster;
  const bigCandidates = candidates.filter((c) => c.kind === "big").length;
  const smallCandidates = candidates.length - bigCandidates;
  const tEval = Date.now();
  const trees: TreeResource[] = [];
  const rejected: TreeReject[] = [];
  for (const c of candidates) {
    const verdict = evaluateTreeFromSets(c, leafSet);
    if (verdict.accepted) {
      trees.push(toTreeResource(c, {
        accepted: true,
        kind: verdict.kind,
        probability: verdict.probability,
        factors: { G: 1, L: verdict.factors.L, C: verdict.factors.C, F: 1, H: verdict.factors.H, A: verdict.factors.A },
        leafCount: verdict.leafCount,
      }));
    } else {
      rejected.push({
        kind: verdict.kind,
        base: { x: Math.min(...c.logs.map((l) => l.x)), y: c.baseY, z: Math.min(...c.logs.map((l) => l.z)) },
        reason: verdict.reason === "no-canopy" ? "no-canopy" : "low-prob",
        probability: verdict.probability,
        factors: { G: 1, L: verdict.factors.L, C: verdict.factors.C, F: 1, H: verdict.factors.H, A: verdict.factors.A },
      });
    }
  }
  trees.sort((a, b) => Math.hypot(a.base.x - center.x, a.base.z - center.z) - Math.hypot(b.base.x - center.x, b.base.z - center.z));

  logsResult.count = logs.length; // 校正为参与计算的垂直原木数
  const evalMs = Date.now() - tEval;

  // ── ④ 大树碎段合并：同一棵 2×2 大树在树身偏移/加宽层被段切分断段后，
  //    产生多个同水平位置、垂直相邻（gap ≤2 层）的大树候选——
  //    合并为一棵树（取整体高度、合并原木与叶数，避免一棵树报多棵）
  const mergedTrees = mergeBigTreeSegments(trees);
  const mergedRejected = rejected.filter((r) => {
    // 被合并段对应的拒绝候选（同水平位置的大树残段）一并过滤
    for (const t of mergedTrees) {
      if (t.kind !== "big") continue;
      const hd = Math.max(Math.abs(t.base.x - r.base.x), Math.abs(t.base.z - r.base.z));
      const vd = Math.abs(r.base.y - t.base.y);
      if (hd <= 1 && vd <= 30) return false; // 属于已合并大树的高度范围内
    }
    return true;
  });
  return {
    logs: logsResult, leaves: leavesResult, trees: mergedTrees, rejected: mergedRejected, candidates: candidates.length,
    bigCandidates, smallCandidates, clusterMs, evalMs, ms: Date.now() - t0,
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
      // 组内任一段与 b 垂直 gap ≤2 且水平相邻 → 同树
      const groupMinY = Math.min(...group.map((g) => g.base.y));
      const groupMaxY = Math.max(...group.map((g) => g.top.y));
      const vd = b.base.y <= groupMaxY + 2 && b.top.y >= groupMinY - 2 ? 0 : Math.min(
        Math.abs(b.base.y - groupMaxY), Math.abs(b.top.y - groupMinY),
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
    // 合并：整体高度范围、原木并集、叶数取最大、概率取最高段
    const allLogs = group.flatMap((g) => g.logs);
    const baseY = Math.min(...group.map((g) => g.base.y));
    const topY = Math.max(...group.map((g) => g.top.y));
    const height = topY - baseY + 1;
    merged.push({
      kind: "big",
      probability: Math.min(Math.max(...group.map((g) => g.probability)), 1),
      factors: { G: 1, L: 1, C: 1, F: 1, H: Math.min(height / 4, 1), A: 1 },
      base: { x: group[0]!.base.x, y: baseY, z: group[0]!.base.z },
      top: { x: group[0]!.top.x, y: topY, z: group[0]!.top.z },
      footprint: group[0]!.footprint,
      logs: allLogs,
      leafCount: Math.max(...group.map((g) => g.leafCount)),
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
    `[树] 坐标集：原木 ${r.logs.count} 个（Y ${r.logs.minY}..${r.logs.maxY}，采集 ${r.logs.ms}ms）｜` +
      `树叶 ${r.leaves.count} 个（Y ${r.leaves.minY}..${r.leaves.maxY}，采集 ${r.leaves.ms}ms）｜查询 getBlocks ×2`,
  );
  lines.push(
    `[树] 聚类：候选 ${r.candidates}（大树 ${r.bigCandidates} / 小树 ${r.smallCandidates}）耗时 ${r.clusterMs}ms｜` +
      `评估：接受 ${r.trees.length} / 拒绝 ${r.rejected.length} 耗时 ${r.evalMs}ms｜纯计算合计 ${r.clusterMs + r.evalMs}ms`,
  );
  lines.push(`[树] ── 接受（${r.trees.length}）${"─".repeat(Math.max(8, 40 - String(r.trees.length).length))}`);
  for (const t of r.trees) {
    lines.push(
      `[树] ✓ ${t.kind === "big" ? "大树" : "小树"} P=${t.probability.toFixed(2)} 高${t.top.y - t.base.y + 1} ` +
        `原木${t.logs.length} 叶${t.leafCount} @(${t.base.x},${t.base.y},${t.base.z}) ${t.kind === "big" ? "（2×2 直接判定）" : fmtFactors(t.factors)}`,
    );
  }
  lines.push(`[树] ── 拒绝（${r.rejected.length}）${"─".repeat(Math.max(8, 40 - String(r.rejected.length).length))}`);
  for (const rej of r.rejected) {
    lines.push(
      `[树] ✗ (${rej.base.x},${rej.base.y},${rej.base.z}) ${rej.kind === "big" ? "大树" : "小树"} ` +
        `原因=${rej.reason} P=${rej.probability.toFixed(3)} ${fmtFactors(rej.factors)}`,
    );
  }
  return lines;
}

/** 有效树叶 id（剔除无效旧 id） */
export const VALID_LEAF_TYPE_IDS = (TREE_LEAF_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));
