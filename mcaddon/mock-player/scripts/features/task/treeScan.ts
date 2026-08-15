// ─── 树资源扫描（mc 层，通用结构搜索引擎的树 spec 封装） ──
// 世界接入：getBlocks 显式列出自然原木集（includeTypes 无通配符，见
// core/rules/TreeRules）→ woodId 归一（log/log2 读 wood_type state；
// mangrove_log/cherry_log/pale_oak_log 按 typeId 截取）→ **水平原木过滤**
// （pillar_axis = x/z 的原木是倒下的树/横梁——不参与计算，见下）→
// 批量列补全（引擎合并为少量 getBlocks）→ 逐候选区域缓存评估。
//
// ⚠️ cellKind **不做扫描盒截断**：区域查询是完整世界访问，边界树的评估
// 区域完整、无评分偏差。截断只发生在"树干在扫描范围外"的树——其原木
// 根本不在输入列表里，本就不归本次扫描负责。
//
// ⚠️ 水平原木（pillar_axis = x/z）一律过滤：倒下的树（横卧原木地物）与
// 人造建筑/横梁同构，不参与树判定；且躺靠活树的倒树若并入输入，会与活树
// 树干同层合并成大组导致活树被提取丢弃。竖直原木（含金合欢斜干、2×2、
// 大树加宽枝干）不受影响；被过滤的水平枝干由砍伐阶段以树干种子 BFS 补全。
//
// 本文件 = 树结构描述（spec）+ 对外兼容层；搜索编排见 structureScan.ts
// （通用引擎：薄层批量定位 → 批量列补全 → 候选聚类 → 区域缓存评估）。

import type { Block, Dimension } from "@minecraft/server";

import {
  classifyTreeBlock,
  evaluateTree,
  extractTrunkCandidates,
  treeRegionBounds,
  TREE_AUX_TYPE_IDS,
  TREE_GROUND_TYPE_IDS,
  TREE_LEAF_TYPE_IDS,
  TREE_LOG_TYPE_IDS,
  TREE_PLANT_TYPE_IDS,
  type TreeLog,
  type TreeReject,
  type TreeResource,
  type TreeVerdict,
} from "../../rules/tree/TreeRules";
import type { TrunkCandidate } from "../../rules/tree/TreeRules";
import type { RegionBounds, ScanSeed, StructureCandidate } from "../../rules/structure/StructureScan";
import type { Vec3 } from "../../rules/Types";
import {
  scanStructures,
  type CellKindFn,
  type StructureSearchSpec,
  type StructureVerdict,
} from "./structureScan";

/** 原木方块 → 木材种类 id（树干同型判定用；未知形态按 typeId 兜底） */
function woodIdOf(block: Block): string {
  const base = block.typeId.slice("minecraft:".length);
  if (base === "log" || base === "log2") {
    const woodType = block.permutation.getState("wood_type") as string | undefined;
    return woodType ?? base;
  }
  if (base.endsWith("_log")) return base.slice(0, -4); // mangrove_log → mangrove
  return base;
}

/** 是否水平原木（pillar_axis = x/z；倒下的树/横梁——不参与计算） */
function isHorizontalLog(block: Block): boolean {
  const axis = block.permutation.getState("pillar_axis") as string | undefined;
  return axis === "x" || axis === "z";
}

/** 树资源扫描详细结果（诊断输出用） */
export interface TreeScanDetail {
  /** 通过判定的树（按到 center 水平距离由近到远） */
  trees: TreeResource[];
  /** 被拒候选 */
  rejected: TreeReject[];
  /** 树干候选（评估顺序） */
  candidates: TrunkCandidate[];
  /** 逐候选详细描述行（可直接复制回排障） */
  lines: string[];
  /** 参与计算的垂直原木数（含补全） */
  logsFound: number;
  /** 被过滤的水平原木数（倒下的树/横梁） */
  horizontalFiltered: number;
  /** 扫描中心/半径 */
  center: Vec3;
  radius: number;
}

// ─── 树 spec（通用引擎参数化） ──────────────────────────

/** 树苗/郁金香（classifyTreeBlock 按后缀收编的自然方块——getBlocks
 *  includeTypes 无通配符，须显式列出才能参与区域分类） */
const TREE_SAPLING_TULIP_TYPE_IDS = [
  "minecraft:oak_sapling",
  "minecraft:spruce_sapling",
  "minecraft:birch_sapling",
  "minecraft:jungle_sapling",
  "minecraft:acacia_sapling",
  "minecraft:dark_oak_sapling",
  "minecraft:cherry_sapling",
  "minecraft:pale_oak_sapling",
  "minecraft:red_tulip",
  "minecraft:orange_tulip",
  "minecraft:white_tulip",
  "minecraft:pink_tulip",
] as const;

/** 无效旧 id（1.20.30 方块拆分后已不存在，vanilla-data 1.26.20 校验）——
 *  getBlocks includeTypes 传入无效 id 可能被引擎拒绝（导致整轮扫描失败被
 *  catch 吞成空 → 砍树不动），从所有 getBlocks 调用中剔除；
 *  classifyTreeBlock 的字符串匹配不受影响（旧 id 方块本就不存在） */
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
const VALID_LOG_TYPE_IDS = (TREE_LOG_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));

/** 自然方块分批白名单（区域分类缓存用；每组 ≤30——getBlocks includeTypes
 *  数量过大可能被引擎拒绝（3.3.17 修复：原 50 一组 + 无效旧 id → 批量失败
 *  全拒 → 砍树不动）；覆盖 classifyTreeBlock 全部非 foreign 类别，未命中格
 *  = foreign，与逐格 getBlock 语义一致） */
const NATURAL_BATCHES: readonly (readonly string[])[] = [
  ["minecraft:air", ...TREE_LOG_TYPE_IDS, ...TREE_LEAF_TYPE_IDS, ...TREE_AUX_TYPE_IDS].filter(
    (id) => !INVALID_LEGACY_IDS.has(id)
  ),
  [...TREE_GROUND_TYPE_IDS].filter((id) => !INVALID_LEGACY_IDS.has(id)),
  [...TREE_PLANT_TYPE_IDS].filter((id) => !INVALID_LEGACY_IDS.has(id)),
  [...TREE_SAPLING_TULIP_TYPE_IDS],
];

/** 树干补全探测上限（格，防超高建筑/异常结构） */
const TRUNK_PROBE_LIMIT = 40;

/** 树 spec（引擎种子/补全/聚类/评估/诊断）；origin 供诊断距离计算 */
function treeSpec(origin: Vec3): StructureSearchSpec<TreeVerdict> {
  return {
  name: "树",
  seedTypes: VALID_LOG_TYPE_IDS,
  buildSeed: (block: Block): ScanSeed | undefined => {
    // 水平原木（倒下的树/横梁）过滤
    if (isHorizontalLog(block)) return undefined;
    return { x: block.location.x, y: block.location.y, z: block.location.z, kind: woodIdOf(block) };
  },
  probe: {
    extendTypes: VALID_LOG_TYPE_IDS,
    limit: TRUNK_PROBE_LIMIT,
    isExtend: (block) => !isHorizontalLog(block),
    buildExtend: (block) => ({ x: block.location.x, y: block.location.y, z: block.location.z, kind: woodIdOf(block) }),
  },
  cluster: (seeds: ScanSeed[]): StructureCandidate[] => {
    // 种子（kind=woodId）→ TreeLog → 树干提取（core 原算法：层分组/同型成链/段切分）
    const logs: TreeLog[] = seeds.map((s) => ({ x: s.x, y: s.y, z: s.z, woodId: s.kind }));
    return extractTrunkCandidates(logs).map((c) => ({
      seeds: c.logs.map((l) => ({ x: l.x, y: l.y, z: l.z, kind: l.woodId })),
      baseY: c.baseY,
      topY: c.topY,
      footprint: c.footprint,
      raw: c, // 透传 TrunkCandidate 供评估/诊断
    }));
  },
  region: { pad: 2, defaultHeight: 10, topMargin: 8 }, // 与 TreeRules REGION_PAD/DEFAULT_REGION_HEIGHT/CANOPY_MARGIN 一致
  naturalBatches: NATURAL_BATCHES,
  classifyBlock: classifyTreeBlock,
  foreignKind: "foreign",
  evaluate: (candidate: StructureCandidate, cellKind: CellKindFn): TreeVerdict => {
    // classifyTreeBlock 运行时返回 TreeBlockKind（spec.classifyBlock 类型放宽为 string）
    const treeKind = cellKind as (x: number, y: number, z: number) => import("../../rules/tree/TreeRules").TreeBlockKind;
    return evaluateTree(candidate.raw as TrunkCandidate, treeKind);
  },
  describe: (
    candidate: StructureCandidate,
    verdict: TreeVerdict,
    cellKind: CellKindFn,
    bounds: RegionBounds,
  ): string[] => {
    return describeCandidate(candidate.raw as TrunkCandidate, verdict, cellKind, bounds, origin);
  },
  };
}

/** 候选 → TreeResource（从 verdict + raw 构建，与 evaluateCandidatesCached 同语义） */
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
function describeCandidate(
  candidate: TrunkCandidate,
  verdict: TreeVerdict,
  cellKind: CellKindFn,
  b: RegionBounds,
  origin: Vec3,
): string[] {
  const footSet = new Set(candidate.footprint.map((c) => `${c.x},${c.z}`));
  const counts = { log: 0, leaf: 0, air: 0, aux: 0, foreign: 0, groundAbove: 0, bottomGround: 0, underGround: 0 };
  let leafMinY = Number.POSITIVE_INFINITY;
  let leafMaxY = Number.NEGATIVE_INFINITY;
  const foreignByType = new Map<string, number>();
  try {
    for (let y = b.groundY; y <= b.regionTop; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        for (let z = b.minZ; z <= b.maxZ; z++) {
          const kind = cellKind(x, y, z);
          if (y === b.groundY) {
            if (kind === "ground") {
              counts.bottomGround++;
              if (footSet.has(`${x},${z}`)) counts.underGround++;
            }
            continue;
          }
          if (kind === "leaf") {
            counts.leaf++;
            leafMinY = Math.min(leafMinY, y);
            leafMaxY = Math.max(leafMaxY, y);
            continue;
          }
          if (kind === "foreign") {
            counts.foreign++;
            continue;
          }
          if (kind === "ground") {
            counts.groundAbove++; // 地形（山坡），不计异物
            continue;
          }
          if (kind === "log") counts.log++;
          else if (kind === "air") counts.air++;
          else counts.aux++;
        }
      }
    }
  } catch {
    /* 单候选描述失败不影响整体输出 */
  }
  const spanY = counts.leaf === 0 ? 0 : leafMaxY - leafMinY + 1;
  const f = verdict.factors;
  const d = Math.hypot(candidate.logs[0]!.x - origin.x, candidate.logs[0]!.z - origin.z);
  const foreignDetail =
    [...foreignByType.entries()].map(([t, n]) => `${t}×${n}`).join(" ") || "无";
  return [
    `候选@(${candidate.logs[0]!.x},${candidate.baseY},${candidate.logs[0]!.z}) 距离${Math.round(d)} ` +
      `${verdict.kind === "big" ? "大树" : "小树"} wood=${candidate.woodId} 高${candidate.topY - candidate.baseY + 1} ` +
      `原木${candidate.logs.length} footprint[${candidate.footprint.map((c) => `(${c.x},${c.y},${c.z})`).join(" ")}]`,
    `  区域 x[${b.minX}..${b.maxX}] z[${b.minZ}..${b.maxZ}] y[${b.groundY}..${b.regionTop}] 体积${b.volume} 底部${b.bottomCells}格 脚下${candidate.footprint.length}格`,
    `  底部地面 ${counts.bottomGround}/${b.bottomCells} 脚下地面 ${counts.underGround}/${candidate.footprint.length}`,
    `  空间 原木${counts.log} 树叶${counts.leaf}(spanY ${spanY}) 空气${counts.air} 附属${counts.aux} 异物${counts.foreign}${counts.groundAbove > 0 ? `（地形泥土${counts.groundAbove}，不计异物）` : ""}`,
    `  异物明细 ${foreignDetail}`,
    `  因子 G${f.G.toFixed(2)} L${f.L.toFixed(2)} C${f.C.toFixed(2)} F${f.F.toFixed(2)} H${f.H.toFixed(2)} A${f.A.toFixed(2)} → P=${verdict.probability.toFixed(3)} ${verdict.accepted ? "✓ 接受" : `✗ 拒绝(${verdict.reason})`}`,
  ];
}

// ─── 对外入口（兼容原签名） ─────────────────────────────

/**
 * 扫描 center 周围 radius 格（立方体）内的树资源，并生成逐候选详细诊断。
 *
 * 内部走通用结构搜索引擎（structureScan.scanStructures）：薄层批量定位原木
 * → 批量列补全（树顶/树底原木，合并 getBlocks）→ 树干提取（core 公式）→
 * 逐候选区域缓存评估 → 距离排序 → 诊断行（从缓存读，零额外查询）。
 *
 * @param center 扫描中心（假人/玩家位置）
 * @param dimension 扫描维度
 * @param radius 扫描半径（格，立方体半边长）
 * @param options 扫描选项（includeDiagnostics 缺省 true——命令路径）
 * @returns 树资源列表 + 拒绝诊断 + 逐候选详细描述行
 */
export async function scanTreesNear(
  center: Vec3,
  dimension: Dimension,
  radius: number,
  options: { includeDiagnostics?: boolean } = {},
): Promise<TreeScanDetail> {
  // 全异步两阶段扫描（粗扫分块 + 细扫并行），永不 reject
  const result = await scanStructures(center, dimension, radius, treeSpec(center), options.includeDiagnostics !== false);

  const trees: TreeResource[] = [];
  const rejected: TreeReject[] = [];
  const candidates: TrunkCandidate[] = [];
  for (const hit of result.accepted) {
    const trunk = hit.candidate.raw as TrunkCandidate;
    candidates.push(trunk);
    trees.push(toTreeResource(trunk, hit.result));
  }
  for (const hit of result.rejected) {
    const trunk = hit.candidate.raw as TrunkCandidate;
    candidates.push(trunk);
    const verdict = hit.result as Extract<TreeVerdict, { accepted: false }>;
    rejected.push({
      kind: verdict.kind,
      base: { x: Math.min(...trunk.logs.map((l) => l.x)), y: trunk.baseY, z: Math.min(...trunk.logs.map((l) => l.z)) },
      reason: verdict.reason,
      probability: verdict.probability,
      factors: verdict.factors,
    });
  }
  return {
    trees,
    rejected,
    candidates,
    lines: result.lines,
    logsFound: result.seedsFound,
    horizontalFiltered: result.filtered,
    center,
    radius,
  };
}
