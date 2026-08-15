// ─── 通用结构搜索引擎（mc 层，全异步两阶段） ────────────
// 基于 dimension.getBlocks 的高性能结构搜索编排——**整个扫描过程异步**，
// 分阶段/分块/分批执行，每批之间 await 让出主线程，把一次大同步计算
// 摊到多个 tick，降低每 tick 计算压力（防大范围扫描卡顿/被 Watchdog 杀）：
//
//   Phase 1 粗扫（异步）：
//     ① 水平 16×16 分块批量定位特征方块（getBlocks includeTypes=种子 id，
//        Y 收窄便宜），块间 await waitTicks(1)
//     ② 批量列补全（可选）：种子列竖直延伸带合并 getBlocks，列批次间 await
//   Phase 2 细扫（异步并行）：
//     ③ 候选生成（聚类 / 模板匹配）
//     ④ 逐候选区域缓存评估——**候选并行**（并发组 Promise.all 交错推进，
//        组间 await）；每候选区域缓存构建内部按白名单分批 getBlocks，
//        批次间 await
//   Phase 3（同步）：距离排序 + 诊断行（内存操作）
//
// 结构无关：树/宝库/建筑…只需提供 spec（种子/聚类或模板/评估/诊断）。
// ⚠️ 永不 reject：任何异常 resolve 空结果（异步环境抛异常可能致游戏崩溃）。

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
import { waitTicks } from "../utils";

/** 粗扫水平分块边长（格）：每块一次 getBlocks，块间让出主线程 */
const LOCATE_CHUNK_SIZE = 16;
/** 细扫候选并发数（个）：每组 Promise.all 并行评估，组间让出 */
const EVALUATE_CONCURRENCY = 8;
/** 模板匹配种子分批（个）：每批校验后让出主线程 */
const TEMPLATE_SEED_BATCH = 64;

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

// ─── 粗扫：异步分块定位特征方块 ────────────────────────

/**
 * 粗扫（异步）：水平 16×16 分块批量定位特征方块。
 * 每块一次 getBlocks（Y 收窄薄层），块间 await 让出主线程——
 * 大范围搜索摊到多个 tick，不阻塞单 tick。
 */
async function locateSeedsAsync(
  dimension: Dimension,
  center: Vec3,
  radius: number,
  yBand: number,
  seedTypes: readonly string[],
  buildSeed: (block: Block) => ScanSeed | undefined,
): Promise<{ seeds: ScanSeed[]; filtered: number }> {
  const seeds: ScanSeed[] = [];
  let filtered = 0;
  const minX = center.x - radius;
  const maxX = center.x + radius;
  const minZ = center.z - radius;
  const maxZ = center.z + radius;
  const fromY = Math.max(-64, center.y - yBand);
  const toY = Math.min(320, center.y + yBand);

  for (let cx = minX; cx <= maxX; cx += LOCATE_CHUNK_SIZE) {
    for (let cz = minZ; cz <= maxZ; cz += LOCATE_CHUNK_SIZE) {
      try {
        const volume = new BlockVolume(
          { x: cx, y: fromY, z: cz },
          { x: Math.min(cx + LOCATE_CHUNK_SIZE - 1, maxX), y: toY, z: Math.min(cz + LOCATE_CHUNK_SIZE - 1, maxZ) },
        );
        const found = dimension.getBlocks(volume, { includeTypes: [...seedTypes] });
        for (const loc of found.getBlockLocationIterator()) {
          const block = dimension.getBlock(loc);
          if (!block) continue;
          const seed = buildSeed(block);
          if (!seed) {
            filtered++;
            continue;
          }
          seeds.push(seed);
        }
      } catch (e: any) {
        console.warn(`[MockPlayer] 结构粗扫定位失败（跳过该块）: ${e}`);
      }
      // 块间让出主线程（每 tick 计算压力摊平）
      await waitTicks(1);
    }
  }
  return { seeds, filtered };
}

// ─── 批量列补全（异步：列批次间让出） ───────────────────

/** 补全批量分组（列数上限——控制单次 getBlocks 体积） */
const PROBE_BATCH_COLUMNS = 400;

/**
 * 批量列补全（异步）：把"逐列向上/向下 getBlock 探测"合并为批量 getBlocks——
 * 对全部种子列的水平 bbox 构建延伸带 volume（每批 ≤ PROBE_BATCH_COLUMNS 列），
 * includeTypes=延伸种子 id，一次批量返回带内全部延伸种子，按列收集。
 * 每批后 await 让出主线程；批量失败回退逐列（正确性兜底）。
 */
async function probeColumnsBatched(
  dimension: Dimension,
  columns: Array<{ x: number; z: number; topY: number; minY: number }>,
  extendTypes: readonly string[],
  limit: number,
  dir: 1 | -1,
  isExtend: (block: Block) => boolean,
  buildExtend: (block: Block) => ScanSeed | undefined,
): Promise<ScanSeed[]> {
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
      console.warn(`[MockPlayer] 结构补全批量查询失败（回退逐列）: ${e?.message ?? e}`);
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
    // 列批次间让出主线程
    await waitTicks(1);
  }
  return added;
}

// ─── 细扫：异步区域缓存 + 候选并行评估 ─────────────────

/**
 * 区域分类缓存构建（异步）：区域批量 getBlocks 分批白名单填充，
 * 每批后 await 让出；批量失败回退逐格（正确性兜底）。
 * 未命中格 = foreignKind。
 */
async function buildRegionCellKindAsync(
  dimension: Dimension,
  bounds: RegionBounds,
  naturalBatches: readonly (readonly string[])[],
  classify: (typeId: string) => string,
  foreignKind: string,
): Promise<CellKindFn> {
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
      // 白名单批次间让出主线程
      await waitTicks(1);
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

/** 单候选细扫（异步）：区域缓存 → spec 评估 →（可选）诊断行（复用同一缓存） */
async function evaluateCandidateAsync<T extends StructureVerdict>(
  candidate: StructureCandidate,
  spec: StructureSearchSpec<T>,
  dimension: Dimension,
  region: { pad: number; defaultHeight: number; topMargin: number },
  includeDiagnostics: boolean,
): Promise<{ candidate: StructureCandidate; result: T; lines: string[] }> {
  const bounds = regionBoundsOf(candidate, region.pad, region.defaultHeight, region.topMargin);
  const foreignKind = spec.foreignKind ?? "foreign";
  const naturalBatches = spec.naturalBatches ?? [];
  const classify = spec.classifyBlock ?? ((typeId: string) => typeId);
  const cellKind = await buildRegionCellKindAsync(dimension, bounds, naturalBatches, classify, foreignKind);
  const result = spec.evaluate(candidate, cellKind, bounds);
  // 诊断行复用评估缓存（零额外世界查询）
  const lines = includeDiagnostics && spec.describe ? spec.describe(candidate, result, cellKind, bounds) : [];
  return { candidate, result, lines };
}

/**
 * 细扫（异步并行）：候选分组并发评估——每组 EVALUATE_CONCURRENCY 个候选
 * 以 Promise.all 并行推进（各候选内部批次 await，协程交错），组间让出。
 * 候选评估耗时 ≈ 单候选耗时 + 组数×1 tick，而非 N 候选串行累加。
 */
async function evaluateCandidatesParallel<T extends StructureVerdict>(
  candidates: StructureCandidate[],
  spec: StructureSearchSpec<T>,
  dimension: Dimension,
  region: { pad: number; defaultHeight: number; topMargin: number },
  includeDiagnostics: boolean,
): Promise<{ hits: StructureHit<T>[]; lines: string[] }> {
  const hits: StructureHit<T>[] = [];
  const lines: string[] = [];
  for (let i = 0; i < candidates.length; i += EVALUATE_CONCURRENCY) {
    const group = candidates.slice(i, i + EVALUATE_CONCURRENCY);
    const groupResults = await Promise.all(
      group.map((c) => evaluateCandidateAsync(c, spec, dimension, region, includeDiagnostics)),
    );
    for (const r of groupResults) {
      hits.push({ candidate: r.candidate, result: r.result });
      lines.push(...r.lines);
    }
    if (i + EVALUATE_CONCURRENCY < candidates.length) {
      await waitTicks(1); // 组间让出
    }
  }
  return { hits, lines };
}

// ─── 搜索编排 ──────────────────────────────────────────

/** 薄层定位默认 Y 范围（上下各 3 层） */
const DEFAULT_Y_BAND = 3;

/**
 * 在指定坐标、指定范围内搜索目标结构（全异步，降低每 tick 计算压力）。
 *
 * 流程（异步两阶段）：
 *   Phase 1 粗扫：水平分块批量定位特征方块（块间让出）→ 批量列补全（批间让出）
 *   Phase 2 细扫：候选生成（聚类/模板）→ 候选**并行**评估（并发组交错推进，
 *     区域缓存分批构建，批次间让出）
 *   Phase 3：距离排序 + 诊断（同步内存）
 * 永不 reject：任何异常 resolve 空结果。
 *
 * @param center 搜索中心坐标（如玩家/假人位置）
 * @param dimension 搜索维度
 * @param radius 搜索半径（格，立方体半边长；1-64 建议，超大范围会慢）
 * @param spec 结构描述（种子/聚类或模板/评估）
 * @param includeDiagnostics 是否生成逐候选诊断行（缺省 false）
 * @returns 命中结构（近→远）+ 被拒候选 + 诊断
 */
export async function scanStructures<T extends StructureVerdict>(
  center: Vec3,
  dimension: Dimension,
  radius: number,
  spec: StructureSearchSpec<T>,
  includeDiagnostics = false,
): Promise<StructureSearchResult<T>> {
  const empty = (): StructureSearchResult<T> => ({ accepted: [], rejected: [], lines: [], seedsFound: 0, probeAdded: 0, filtered: 0, center, radius });
  const yBand = spec.yBand ?? DEFAULT_Y_BAND;
  const region = spec.region ?? { pad: 2, defaultHeight: 10, topMargin: 8 };
  const sortOrigin = spec.sortOrigin ?? center;

  try {
    // ── Phase 1 粗扫（异步）：分块定位特征方块 ──
    const { seeds, filtered } = await locateSeedsAsync(dimension, center, radius, yBand, spec.seedTypes, spec.buildSeed);

    // ── Phase 1.5 批量列补全（异步，可选） ──
    let probeAdded = 0;
    if (spec.probe && seeds.length > 0) {
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
      const up = await probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, 1, isExtend, buildExtend);
      const down = await probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, -1, isExtend, buildExtend);
      seeds.push(...up, ...down);
      probeAdded = up.length + down.length;
    }

    // ── Phase 2 候选生成（聚类 / 模板，异步分批） ──
    const candidates: StructureCandidate[] = [];
    if (spec.pattern) {
      // 模板匹配模式：种子分批校验（每批后让出）——每个种子为线索推导锚点，
      // 区域方块单查（模板块数少），锚点去重
      const blockKind = (x: number, y: number, z: number): string => {
        try {
          return spec.classifyBlock?.(dimension.getBlock({ x, y, z })?.typeId ?? "") ?? "foreign";
        } catch {
          return "foreign";
        }
      };
      const anchorSeen = new Set<string>();
      for (let i = 0; i < seeds.length; i += TEMPLATE_SEED_BATCH) {
        const batch = seeds.slice(i, i + TEMPLATE_SEED_BATCH);
        for (const seed of batch) {
          const hits = matchPatternAtSeed(spec.pattern, seed, blockKind);
          for (const { anchor, match } of hits) {
            const key = `${anchor.x},${anchor.y},${anchor.z}`;
            if (anchorSeen.has(key)) continue;
            anchorSeen.add(key);
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
        await waitTicks(1); // 种子批间让出
      }
    } else if (spec.cluster) {
      candidates.push(...spec.cluster(seeds));
    } else {
      console.warn(`[MockPlayer][${spec.name}] spec 缺少候选生成（cluster 或 pattern）`);
    }

    // ── Phase 2.5 细扫（异步并行）：候选分组并发评估 + 诊断行（复用缓存） ──
    const { hits, lines } = await evaluateCandidatesParallel(candidates, spec, dimension, region, includeDiagnostics);

    // ── Phase 3 排序（同步内存） ──
    const accepted: StructureHit<T>[] = [];
    const rejected: StructureHit<T>[] = [];
    for (const hit of hits) {
      if (hit.result.accepted) {
        accepted.push(hit);
      } else {
        rejected.push(hit);
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
  } catch (e: any) {
    // ⚠️ 永不 reject：任何异常 resolve 空结果
    console.warn(`[MockPlayer][${spec.name}] 扫描异常: ${e?.message ?? e}`);
    return empty();
  }
}
