// ─── 通用结构搜索引擎（mc 层） ─────────────────────────
// 基于 dimension.getBlocks 的高性能结构搜索编排：
//   ① 薄层批量定位种子（getBlocks includeTypes=种子 id，Y 收窄便宜、横向可宽）
//   ② 批量列补全（可选）：全部种子列的竖直延伸带合并为少量 getBlocks
//      （替代逐列 getBlock 探测——原逐列方案每列最多 80 次单查）
//   ③ 候选生成：聚类模式（clusterSeeds / 结构自定聚类）或模板匹配模式
//      （结构模板：单方块/一组空间方块组合，种子为线索推导锚点逐位校验）
//   ④ 逐候选区域缓存评估：区域批量 getBlocks 建分类缓存（自然方块分批
//      白名单，未命中=foreign），spec 评估公式原样计算
//   ⑤ 按到中心距离排序 + 逐候选诊断行
// 结构无关：树/宝库/建筑…只需提供 spec（种子/聚类或模板/评估/诊断）。
// ⚠️ 永不 reject：任何异常返回空结果（异步环境抛异常可能致游戏崩溃）。

import { BlockVolume } from "@minecraft/server";
import type { Block, Dimension } from "@minecraft/server";

import {
  matchPatternAtSeed,
  regionBoundsOf,
  type RegionBounds,
  type ScanSeed,
  type StructureCandidate,
  type StructurePattern,
} from "../../rules/structure/StructureScan";
import type { Vec3 } from "../../rules/Types";

// ─── 结构描述（spec） ──────────────────────────────────

/** 区域方块类别查询（评估/模板校验的世界访问入口） */
export type CellKindFn = (x: number, y: number, z: number) => string;

/** 评估结论（spec 定义；须带 accepted 标志供引擎分组） */
export interface StructureVerdict {
  accepted: boolean;
}

/** 结构搜索描述（参数化：种子/聚类或模板/评估/诊断） */
export interface StructureSearchSpec<T extends StructureVerdict> {
  /** 结构名（诊断前缀/日志） */
  name: string;
  /** 定位阶段种子方块 id（getBlocks includeTypes；须为有效 id） */
  seedTypes: readonly string[];
  /** 种子构建：方块 → 种子（过滤 + 类别归一）；返回 undefined = 跳过 */
  buildSeed: (block: Block) => ScanSeed | undefined;
  /** 薄层定位 Y 范围（上下各 yBand 层） */
  yBand?: number;
  /** 批量列补全（可选：竖直延伸探测，如树顶/树底原木） */
  probe?: {
    /** 延伸种子 id（getBlocks includeTypes；须为有效 id） */
    extendTypes: readonly string[];
    /** 探测上限（格） */
    limit: number;
    /** 延伸判定（false = 跳过该方块，如水平原木） */
    isExtend?: (block: Block) => boolean;
    /** 延伸种子构建（缺省复用 buildSeed） */
    buildExtend?: (block: Block) => ScanSeed | undefined;
  };
  /** 候选生成：聚类模式（种子 → 候选；树用 TreeRules.extractTrunkCandidates） */
  cluster?: (seeds: ScanSeed[]) => StructureCandidate[];
  /** 模板匹配模式（与 cluster 二选一）：种子作为模板块线索 → 锚点候选 */
  pattern?: StructurePattern;
  /** 评估区域扩展（缺省：pad=2 / 高 10 / 顶余量 8） */
  region?: { pad: number; defaultHeight: number; topMargin: number };
  /** 区域分类缓存白名单批次（每组 ≤30；未命中格 = foreignKind）——缺省空 = 仅逐格回退 */
  naturalBatches?: readonly (readonly string[])[];
  /** 区域方块 → 类别（评估/模板校验的 kind 解释；缺省 = typeId 原样） */
  classifyBlock?: (typeId: string) => string;
  /** 未命中类别（缺省 "foreign"） */
  foreignKind?: string;
  /** 候选评估（core 公式；每候选一次，区域方块访问经缓存） */
  evaluate: (candidate: StructureCandidate, cellKind: CellKindFn, bounds: RegionBounds) => T;
  /** 候选诊断描述（可选；逐候选整遍区域遍历，仅诊断路径开启） */
  describe?: (candidate: StructureCandidate, result: T, cellKind: CellKindFn, bounds: RegionBounds) => string[];
  /** 结果排序原点（缺省 = 搜索中心） */
  sortOrigin?: Vec3;
}

// ─── 搜索参数与结果 ────────────────────────────────────

/** 结构搜索参数：指定中心坐标 + 指定范围（立方体半径） */
export interface StructureSearchParams<T extends StructureVerdict> {
  /** 搜索中心坐标 */
  center: Vec3;
  /** 搜索维度 */
  dimension: Dimension;
  /** 搜索半径（格，立方体半边长） */
  radius: number;
  /** 结构描述 */
  spec: StructureSearchSpec<T>;
  /** 是否生成逐候选诊断行（缺省 false——感知路径省开销） */
  includeDiagnostics?: boolean;
}

/** 单结构搜索结果 */
export interface StructureHit<T extends StructureVerdict> {
  candidate: StructureCandidate;
  result: T;
}

/** 结构搜索汇总 */
export interface StructureSearchResult<T extends StructureVerdict> {
  /** 通过判定的结构（近→远排序） */
  accepted: StructureHit<T>[];
  /** 被拒候选（诊断） */
  rejected: StructureHit<T>[];
  /** 逐候选诊断行（includeDiagnostics 时生成） */
  lines: string[];
  /** 定位阶段种子数（补全前） */
  seedsFound: number;
  /** 补全延伸种子数 */
  probeAdded: number;
  /** 被过滤的种子方块数（buildSeed 返回 undefined） */
  filtered: number;
  /** 搜索中心/半径 */
  center: Vec3;
  radius: number;
}

// ─── 批量列补全（性能关键：合并为少量 getBlocks） ──────

/** 补全批量分组（列数上限——控制单次 getBlocks 体积） */
const PROBE_BATCH_COLUMNS = 400;

/**
 * 批量列补全：把"逐列向上/向下 getBlock 探测"合并为批量 getBlocks——
 * 对全部种子列的水平 bbox 构建延伸带 volume（每批 ≤ PROBE_BATCH_COLUMNS 列），
 * includeTypes=延伸种子 id，一次批量返回带内全部延伸种子，按列收集。
 * @param columns 种子列（含当前上下界）
 * @param dir +1=向上（从 col.topY+1 起）/ -1=向下（从 col.minY-1 起）
 * @returns 补全的种子（已过滤 isExtend/buildExtend）
 */
function probeColumnsBatched(
  dimension: Dimension,
  columns: Array<{ x: number; z: number; topY: number; minY: number }>,
  extendTypes: readonly string[],
  limit: number,
  dir: 1 | -1,
  isExtend: (block: Block) => boolean,
  buildExtend: (block: Block) => ScanSeed | undefined,
): ScanSeed[] {
  const added: ScanSeed[] = [];
  if (columns.length === 0) return added;

  // 按水平 bbox 分批（每批列数受限，控制体积）
  const batchSize = Math.max(1, Math.ceil(columns.length / Math.ceil(columns.length / PROBE_BATCH_COLUMNS)));
  for (let start = 0; start < columns.length; start += batchSize) {
    const batch = columns.slice(start, start + batchSize);
    const minX = Math.min(...batch.map((c) => c.x));
    const maxX = Math.max(...batch.map((c) => c.x));
    const minZ = Math.min(...batch.map((c) => c.z));
    const maxZ = Math.max(...batch.map((c) => c.z));
    // 延伸带：所有列统一从"本批最高上界/最低下界"起，覆盖 limit 格
    const fromY = dir === 1 ? Math.max(...batch.map((c) => c.topY)) + 1 : Math.min(...batch.map((c) => c.minY)) - limit;
    const toY = dir === 1 ? Math.max(...batch.map((c) => c.topY)) + limit : Math.min(...batch.map((c) => c.minY)) - 1;
    // 裁剪到世界高度（越界 getBlocks 可能被拒）
    const vFromY = Math.max(-64, fromY);
    const vToY = Math.min(320, toY);
    if (vFromY > vToY) continue;
    try {
      const volume = new BlockVolume(
        { x: minX, y: vFromY, z: minZ },
        { x: maxX, y: vToY, z: maxZ },
      );
      const found = dimension.getBlocks(volume, { includeTypes: [...extendTypes] });
      for (const loc of found.getBlockLocationIterator()) {
        const block = dimension.getBlock(loc);
        if (!block) continue;
        if (!isExtend(block)) continue;
        const seed = buildExtend(block);
        if (!seed) continue;
        // 列归属：该列需从自身界外起延伸（批量带内含其他列范围，逐列筛选）
        const col = batch.find((c) => c.x === loc.x && c.z === loc.z);
        if (!col) continue;
        if (dir === 1 && loc.y <= col.topY) continue;
        if (dir === -1 && loc.y >= col.minY) continue;
        added.push(seed);
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] ${"结构"}补全批量查询失败（回退逐列）: ${e?.message ?? e}`);
      // 回退：逐列单查（正确性兜底，绝不静默丢失补全）
      for (const col of batch) {
        let y = dir === 1 ? col.topY + 1 : col.minY - 1;
        let probed = 0;
        while (probed < limit) {
          try {
            const b = dimension.getBlock({ x: col.x, y, z: col.z });
            if (!b) break;
            if (!isExtend(b)) break;
            const seed = buildExtend(b);
            if (seed) added.push(seed);
          } catch {
            break;
          }
          y += dir;
          probed++;
        }
      }
    }
  }
  return added;
}

// ─── 评估区域缓存（区域批量 getBlocks，未命中 = foreign） ──

/** 区域缓存构建器（spec 提供分批白名单；批量失败回退逐格——正确性兜底） */
export function buildRegionCellKind(
  dimension: Dimension,
  bounds: RegionBounds,
  naturalBatches: readonly (readonly string[])[],
  classify: (typeId: string) => string,
  foreignKind = "foreign",
): CellKindFn {
  const cache = new Map<string, string>();
  let bulkOk = true;
  try {
    const volume = new BlockVolume(
      { x: bounds.minX, y: Math.max(-64, bounds.groundY), z: bounds.minZ },
      { x: bounds.maxX, y: Math.min(320, bounds.regionTop), z: bounds.maxZ },
    );
    for (const batch of naturalBatches) {
      const found = dimension.getBlocks(volume, { includeTypes: [...batch] });
      for (const loc of found.getBlockLocationIterator()) {
        const block = dimension.getBlock(loc);
        if (block) cache.set(`${loc.x},${loc.y},${loc.z}`, classify(block.typeId));
      }
    }
  } catch (e: any) {
    console.error(`[MockPlayer] 结构区域批量缓存失败，回退逐格: ${e?.message ?? e}`);
    bulkOk = false;
  }
  if (bulkOk) {
    return (x, y, z) => cache.get(`${x},${y},${z}`) ?? foreignKind;
  }
  return (x, y, z) => {
    try {
      const block = dimension.getBlock({ x, y, z });
      return classify(block?.typeId ?? "");
    } catch {
      return foreignKind;
    }
  };
}

// ─── 搜索编排 ──────────────────────────────────────────

/** 薄层定位默认 Y 范围（上下各 3 层） */
const DEFAULT_Y_BAND = 3;

/**
 * 在指定坐标、指定范围内搜索目标结构（最高性能 getBlocks 编排）。
 *
 * 流程：薄层批量定位种子 → （可选）批量列补全 → 候选生成（聚类/模板）→
 * 逐候选区域缓存评估 → 距离排序 → （可选）诊断行。
 * 永不 reject：任何异常返回空结果。
 *
 * @param center 搜索中心坐标（如玩家/假人位置）
 * @param dimension 搜索维度
 * @param radius 搜索半径（格，立方体半边长；1-64 建议，超大范围会慢）
 * @param spec 结构描述（种子/聚类或模板/评估）
 * @returns 命中结构（近→远）+ 被拒候选 + 诊断
 */
export function scanStructures<T extends StructureVerdict>(
  center: Vec3,
  dimension: Dimension,
  radius: number,
  spec: StructureSearchSpec<T>,
  includeDiagnostics = false,
): StructureSearchResult<T> {
  const yBand = spec.yBand ?? DEFAULT_Y_BAND;
  const region = spec.region ?? { pad: 2, defaultHeight: 10, topMargin: 8 };
  const sortOrigin = spec.sortOrigin ?? center;
  const seeds: ScanSeed[] = [];
  let filtered = 0;

  try {
    // ── ① 薄层批量定位种子 ──
    const volume = new BlockVolume(
      { x: center.x - radius, y: center.y - yBand, z: center.z - radius },
      { x: center.x + radius, y: center.y + yBand, z: center.z + radius },
    );
    const found = dimension.getBlocks(volume, { includeTypes: [...spec.seedTypes] });
    for (const loc of found.getBlockLocationIterator()) {
      const block = dimension.getBlock(loc);
      if (!block) continue;
      const seed = spec.buildSeed(block);
      if (!seed) {
        filtered++;
        continue;
      }
      seeds.push(seed);
    }
  } catch (e: any) {
    console.warn(`[MockPlayer][${spec.name}] 定位失败: ${e}`);
    return { accepted: [], rejected: [], lines: [], seedsFound: 0, probeAdded: 0, filtered: 0, center, radius };
  }

  // ── ② 批量列补全（可选） ──
  let probeAdded = 0;
  if (spec.probe && seeds.length > 0) {
    // 种子列（含当前上下界）
    const colMap = new Map<string, { x: number; z: number; topY: number; minY: number }>();
    for (const s of seeds) {
      const key = `${s.x},${s.z}`;
      const col = colMap.get(key);
      if (!col) {
        colMap.set(key, { x: s.x, z: s.z, topY: s.y, minY: s.y });
      } else {
        if (s.y > col.topY) col.topY = s.y;
        if (s.y < col.minY) col.minY = s.y;
      }
    }
    const columns = [...colMap.values()];
    const isExtend = spec.probe.isExtend ?? (() => true);
    const buildExtend = spec.probe.buildExtend ?? spec.buildSeed;
    const up = probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, 1, isExtend, buildExtend);
    const down = probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, -1, isExtend, buildExtend);
    seeds.push(...up, ...down);
    probeAdded = up.length + down.length;
  }

  // ── ③ 候选生成 ──
  const candidates: StructureCandidate[] = [];
  if (spec.pattern) {
    // 模板匹配模式：每个种子为线索推导锚点，逐位校验（区域方块单查——模板块数少）
    const blockKind = (x: number, y: number, z: number): string => {
      try {
        return spec.classifyBlock?.(dimension.getBlock({ x, y, z })?.typeId ?? "") ?? "foreign";
      } catch {
        return "foreign";
      }
    };
    const anchorSeen = new Set<string>();
    for (const seed of seeds) {
      const hits = matchPatternAtSeed(spec.pattern, seed, blockKind);
      for (const { anchor, match } of hits) {
        const key = `${anchor.x},${anchor.y},${anchor.z}`;
        if (anchorSeen.has(key)) continue;
        anchorSeen.add(key);
        // 候选 = 锚点 + 命中模板块实例（世界坐标种子）
        const candSeeds: ScanSeed[] = match.hit.map((b) => ({
          x: anchor.x + b.dx,
          y: anchor.y + b.dy,
          z: anchor.z + b.dz,
          kind: b.kind,
        }));
        candidates.push({
          seeds: candSeeds,
          baseY: Math.min(...candSeeds.map((s) => s.y)),
          topY: Math.max(...candSeeds.map((s) => s.y)),
          footprint: [{ x: anchor.x, z: anchor.z }],
        });
      }
    }
  } else if (spec.cluster) {
    candidates.push(...spec.cluster(seeds));
  } else {
    console.warn(`[MockPlayer][${spec.name}] spec 缺少候选生成（cluster 或 pattern）`);
  }

  // ── ④ 逐候选评估（区域缓存） + ⑤ 排序/诊断 ──
  const accepted: StructureHit<T>[] = [];
  const rejected: StructureHit<T>[] = [];
  const lines: string[] = [];
  const naturalBatches = spec.naturalBatches ?? [];
  const classify = spec.classifyBlock ?? ((typeId: string) => typeId);
  const foreignKind = spec.foreignKind ?? "foreign";
  for (const candidate of candidates) {
    const bounds = regionBoundsOf(candidate, region.pad, region.defaultHeight, region.topMargin);
    const cellKind = buildRegionCellKind(dimension, bounds, naturalBatches, classify, foreignKind);
    const result = spec.evaluate(candidate, cellKind, bounds);
    const hit: StructureHit<T> = { candidate, result };
    if (result.accepted) {
      accepted.push(hit);
    } else {
      rejected.push(hit);
    }
    if (includeDiagnostics && spec.describe) {
      lines.push(...spec.describe(candidate, result, cellKind, bounds));
    }
  }
  const dist = (c: StructureCandidate) =>
    Math.hypot(
      Math.min(...c.seeds.map((s) => s.x)) - sortOrigin.x,
      Math.min(...c.seeds.map((s) => s.z)) - sortOrigin.z,
    );
  accepted.sort((a, b) => dist(a.candidate) - dist(b.candidate));
  rejected.sort((a, b) => dist(a.candidate) - dist(b.candidate));

  return { accepted, rejected, lines, seedsFound: seeds.length, probeAdded, filtered, center, radius };
}
