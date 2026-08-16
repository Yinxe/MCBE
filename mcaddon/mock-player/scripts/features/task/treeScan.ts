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

import { BlockVolume } from "@minecraft/server";
import type { Block, Dimension } from "@minecraft/server";

import {
  classifyTreeBlock,
  evaluateTree,
  evaluateTreeFromSets,
  extractTrunkCandidates,
  extractTrunkCandidatesSimple,
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
export const VALID_LOG_TYPE_IDS = (TREE_LOG_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));

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

// ─── 朴素全扫（对比基准：一次性扫描全部区域块） ─────────

/** 朴素版全高度范围（格，上下各 80 层——覆盖树高余量；全高 -64..320 太宽泛） */
const NAIVE_HEIGHT_RANGE = 80;
/** 朴素版全局缓存 y 分段（格，控制单次 getBlocks 体积） */
const NAIVE_Y_SEGMENT = 32;

/**
 * 朴素全扫（对比基准）：**一次性扫描整个立方体区域块**——
 *   ① 全局分类缓存：整个立方体（含全高度）按 y 段分批 getBlocks 白名单，
 *      所有候选共享一个缓存（无薄层定位、无按候选区域构建）；
 *   ② 原木收集：全区域一次 getBlocks（有效原木 id）+ 水平过滤；
 *   ③ 树干提取 → 逐候选从全局缓存评估（零额外世界查询）。
 * 与 scanTreesNear（两阶段算法）对比用：验证粗扫+细扫的查询量优势。
 * ⚠️ 永不 reject：任何异常 resolve 空结果。
 */
export async function scanTreesNearNaive(
  center: Vec3,
  dimension: Dimension,
  radius: number,
  options: { includeDiagnostics?: boolean } = {},
): Promise<TreeScanDetail> {
  const empty = (): TreeScanDetail => ({ trees: [], rejected: [], candidates: [], lines: [], logsFound: 0, horizontalFiltered: 0, center, radius });
  const minX = center.x - radius;
  const maxX = center.x + radius;
  const minZ = center.z - radius;
  const maxZ = center.z + radius;
  const fromY = Math.max(-64, center.y - NAIVE_HEIGHT_RANGE);
  const toY = Math.min(320, center.y + NAIVE_HEIGHT_RANGE);
  const includeDiagnostics = options.includeDiagnostics !== false;

  try {
    // ① 全局分类缓存（全区域全高度，所有候选共享）
    const cache = new Map<string, import("../../rules/tree/TreeRules").TreeBlockKind>();
    for (let ys = fromY; ys <= toY; ys += NAIVE_Y_SEGMENT) {
      const yTo = Math.min(ys + NAIVE_Y_SEGMENT - 1, toY);
      const volume = new BlockVolume(
        { x: minX, y: ys, z: minZ },
        { x: maxX, y: yTo, z: maxZ },
      );
      for (const batch of NATURAL_BATCHES) {
        try {
          const found = dimension.getBlocks(volume, { includeTypes: [...batch] });
          for (const loc of found.getBlockLocationIterator()) {
            const block = dimension.getBlock(loc);
            if (block) cache.set(`${loc.x},${loc.y},${loc.z}`, classifyTreeBlock(block.typeId));
          }
        } catch {
          /* 段失败跳过——该段格子缺失按 foreign 兜底 */
        }
      }
    }
    // classifyTreeBlock 运行时返回 TreeBlockKind（CellKindFn 类型放宽为 string）
    const globalCellKind = ((x: number, y: number, z: number) => cache.get(`${x},${y},${z}`) ?? "foreign") as (
      x: number, y: number, z: number
    ) => import("../../rules/tree/TreeRules").TreeBlockKind;

    // ② 原木收集（全区域一次批量）
    const logs: TreeLog[] = [];
    let horizontalFiltered = 0;
    try {
      const volume = new BlockVolume(
        { x: minX, y: fromY, z: minZ },
        { x: maxX, y: toY, z: maxZ },
      );
      const found = dimension.getBlocks(volume, { includeTypes: [...VALID_LOG_TYPE_IDS] });
      for (const loc of found.getBlockLocationIterator()) {
        const block = dimension.getBlock(loc);
        if (!block) continue;
        if (isHorizontalLog(block)) {
          horizontalFiltered++;
          continue;
        }
        logs.push({ x: loc.x, y: loc.y, z: loc.z, woodId: woodIdOf(block) });
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] 朴素扫描原木收集失败: ${e?.message ?? e}`);
    }

    // ③ 树干提取 + 逐候选评估（全局缓存读）
    const candidates = extractTrunkCandidates(logs);
    const trees: TreeResource[] = [];
    const rejected: TreeReject[] = [];
    const lines: string[] = [];
    for (const c of candidates) {
      const verdict = evaluateTree(c, globalCellKind);
      if (verdict.accepted) {
        trees.push(toTreeResource(c, verdict));
      } else {
        rejected.push({
          kind: verdict.kind,
          base: { x: Math.min(...c.logs.map((l) => l.x)), y: c.baseY, z: Math.min(...c.logs.map((l) => l.z)) },
          reason: verdict.reason,
          probability: verdict.probability,
          factors: verdict.factors,
        });
      }
      if (includeDiagnostics) {
        lines.push(...describeCandidate(c, verdict, globalCellKind, treeRegionBounds(c), center));
      }
    }
    trees.sort((a, b) => Math.hypot(a.base.x - center.x, a.base.z - center.z) - Math.hypot(b.base.x - center.x, b.base.z - center.z));

    return { trees, rejected, candidates, lines, logsFound: logs.length, horizontalFiltered, center, radius };
  } catch (e: any) {
    console.warn(`[MockPlayer] 朴素扫描异常: ${e?.message ?? e}`);
    return empty();
  }
}

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
  const candidates = extractTrunkCandidatesSimple(logs);
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
  return { logs: logsResult, leaves: leavesResult, trees, rejected, candidates: candidates.length, ms: Date.now() - t0 };
}

/** 有效树叶 id（剔除无效旧 id） */
export const VALID_LEAF_TYPE_IDS = (TREE_LEAF_TYPE_IDS as readonly string[]).filter((id) => !INVALID_LEGACY_IDS.has(id));
