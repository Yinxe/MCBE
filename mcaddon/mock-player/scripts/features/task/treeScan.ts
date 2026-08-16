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

/** 坐标集采集结果 */
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
}

/**
 * 一次性 getBlocks 采集指定方块类型的坐标集（纯位置，零 getBlock）。
 * 大范围（半径 32 空间体）每次只扫一种方块——得到该类型全部坐标。
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
  let count = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const loc of found.getBlockLocationIterator()) {
    count++;
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }
  return { name, count, minY: count > 0 ? minY : center.y, maxY: count > 0 ? maxY : center.y, ms: Date.now() - t0 };
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

  // ① 原木坐标集：一次 getBlocks，**纯位置零 getBlock**——
  //    实际世界"砍树就是树"：无需 wood_id 分流；水平原木（倒下树/横梁）
  //    由几何聚类天然排除（单层横排成不了垂直链）
  const logsResult = collectCoordinateSet(dimension, center, radius, VALID_LOG_TYPE_IDS, "原木", fromY, toY);
  const logs: Array<{ x: number; y: number; z: number }> = [];
  try {
    const volume = new BlockVolume(
      { x: center.x - radius, y: fromY, z: center.z - radius },
      { x: center.x + radius, y: toY, z: center.z + radius },
    );
    const found = dimension.getBlocks(volume, { includeTypes: [...VALID_LOG_TYPE_IDS] });
    for (const loc of found.getBlockLocationIterator()) {
      logs.push({ x: loc.x, y: loc.y, z: loc.z });
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] 坐标集原木收集失败: ${e?.message ?? e}`);
  }

  // ② 树叶坐标集：一次 getBlocks（纯位置，零 getBlock）
  const leavesResult = collectCoordinateSet(dimension, center, radius, VALID_LEAF_TYPE_IDS, "树叶", fromY, toY);
  const leafSet = new Set<string>();
  try {
    const volume = new BlockVolume(
      { x: center.x - radius, y: fromY, z: center.z - radius },
      { x: center.x + radius, y: toY, z: center.z + radius },
    );
    const found = dimension.getBlocks(volume, { includeTypes: [...VALID_LEAF_TYPE_IDS] });
    for (const loc of found.getBlockLocationIterator()) {
      leafSet.add(`${loc.x},${loc.y},${loc.z}`);
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] 坐标集树叶收集失败: ${e?.message ?? e}`);
  }

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
  return {
    logs: logsResult, leaves: leavesResult, trees, rejected, candidates: candidates.length,
    bigCandidates, smallCandidates, clusterMs, evalMs, ms: Date.now() - t0,
  };
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
