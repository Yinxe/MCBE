// ─── 通用结构搜索引擎（mc 层，粗扫 + 分批细扫） ────────
// 基于 dimension.getBlocks 的高性能结构搜索编排——调度模型：
//
//   tick 1（调用 tick）：Phase 1 粗扫——**一次性 getBlocks 扫完全部范围**
//     特征方块（includeTypes=种子 id，Y 薄层收窄）；随后批量列补全（可选）、
//     候选生成（聚类/模板）——全部同步完成，粗扫只占一个 tick。
//   tick 2..N：Phase 2 细扫——候选按批次（默认每批 10 个，可调大至 20）
//     **system.run 排队到下一 tick**：每个 tick 只细扫一批（批内 Promise.all
//     并发评估），下一批排到再下一 tick。100 个候选 = 10 tick 扫完，
//     单 tick 不堆积并发特征扫描。
//   末 tick：距离排序 + 诊断行汇总（内存操作）→ resolve。
//
// 结构无关：树/宝库/建筑…只需提供 spec（种子/聚类或模板/评估/诊断）。
// ⚠️ 永不 reject：任何异常 resolve 空结果（异步环境抛异常可能致游戏崩溃）。

import { BlockVolume, system } from "@minecraft/server";
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

/**
 * 细扫并发批次（个）：每 tick 细扫的候选数。
 * 用户规格：默认 10，可提升到 20——单 tick 不堆积并发特征扫描。
 */
const EVALUATE_BATCH_SIZE = 10;

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

// ─── Phase 1 粗扫（一次性同步） ─────────────────────────

/**
 * 粗扫（一次性）：整个搜索范围一次 getBlocks 定位特征方块。
 * Y 收窄薄层（便宜、横向可宽）——粗扫只占一个 tick。
 */
function locateSeedsSync(
  dimension: Dimension,
  center: Vec3,
  radius: number,
  yBand: number,
  seedTypes: readonly string[],
  buildSeed: (block: Block) => ScanSeed | undefined,
): { seeds: ScanSeed[]; filtered: number } {
  const seeds: ScanSeed[] = [];
  let filtered = 0;
  try {
    const volume = new BlockVolume(
      { x: center.x - radius, y: Math.max(-64, center.y - yBand), z: center.z - radius },
      { x: center.x + radius, y: Math.min(320, center.y + yBand), z: center.z + radius },
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
    console.warn(`[MockPlayer] 结构粗扫失败: ${e}`);
  }
  return { seeds, filtered };
}

// ─── 批量列补全（同步，粗扫 tick 内完成） ───────────────

/** 补全批量分组（列数上限——控制单次 getBlocks 体积） */
const PROBE_BATCH_COLUMNS = 400;

/**
 * 批量列补全：把"逐列向上/向下 getBlock 探测"合并为批量 getBlocks——
 * 对全部种子列的水平 bbox 构建延伸带 volume（每批 ≤ PROBE_BATCH_COLUMNS 列），
 * includeTypes=延伸种子 id，一次批量返回带内全部延伸种子，按列收集。
 * 批量失败回退逐列（正确性兜底）。
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
  }
  return added;
}

// ─── Phase 2 细扫（每 tick 一批并发） ──────────────────

/**
 * 区域分类缓存构建（同步）：区域批量 getBlocks 分批白名单填充。
 * 批量失败回退逐格（正确性兜底）；未命中格 = foreignKind。
 */
function buildRegionCellKind(
  dimension: Dimension,
  bounds: RegionBounds,
  naturalBatches: readonly (readonly string[])[],
  classify: (typeId: string) => string,
  foreignKind: string,
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

/** 单候选细扫（同步）：区域缓存 → spec 评估 →（可选）诊断行（复用同一缓存） */
function evaluateCandidateSync<T extends StructureVerdict>(
  candidate: StructureCandidate,
  spec: StructureSearchSpec<T>,
  dimension: Dimension,
  region: { pad: number; defaultHeight: number; topMargin: number },
  includeDiagnostics: boolean,
): { candidate: StructureCandidate; result: T; lines: string[] } {
  try {
    const bounds = regionBoundsOf(candidate, region.pad, region.defaultHeight, region.topMargin);
    const foreignKind = spec.foreignKind ?? "foreign";
    const naturalBatches = spec.naturalBatches ?? [];
    const classify = spec.classifyBlock ?? ((typeId: string) => typeId);
    const cellKind = buildRegionCellKind(dimension, bounds, naturalBatches, classify, foreignKind);
    const result = spec.evaluate(candidate, cellKind, bounds);
    // 诊断行复用评估缓存（零额外世界查询）
    const lines = includeDiagnostics && spec.describe ? spec.describe(candidate, result, cellKind, bounds) : [];
    return { candidate, result, lines };
  } catch (e: any) {
    console.warn(`[MockPlayer] 候选细扫异常: ${e?.message ?? e}`);
    return { candidate, result: { accepted: false } as T, lines: [] };
  }
}

// ─── 搜索编排 ──────────────────────────────────────────

/** 薄层定位默认 Y 范围（上下各 3 层） */
const DEFAULT_Y_BAND = 3;

/**
 * 在指定坐标、指定范围内搜索目标结构（粗扫 + 分批细扫调度）。
 *
 * 调度（用户规格）：
 *   tick 1：粗扫一次性扫完（特征方块定位 + 列补全 + 候选生成，同步）
 *   tick 2..N：细扫每 tick 一批（EVALUATE_BATCH_SIZE=10 个，可调 20）——
 *     批内 Promise.all 并发评估，下一批 system.run 排到下一 tick；
 *     100 个候选 = 10 tick 扫完，单 tick 不堆积并发特征扫描
 *   末 tick：排序 + 诊断行汇总 → resolve
 * 永不 reject：任何异常 resolve 空结果。
 *
 * @param center 搜索中心坐标（如玩家/假人位置）
 * @param dimension 搜索维度
 * @param radius 搜索半径（格，立方体半边长；1-64 建议，超大范围会慢）
 * @param spec 结构描述（种子/聚类或模板/评估）
 * @param includeDiagnostics 是否生成逐候选诊断行（缺省 false）
 * @returns 命中结构（近→远）+ 被拒候选 + 诊断
 */
export function scanStructures<T extends StructureVerdict>(
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
    // ── Phase 1 粗扫（一次性同步，第 1 tick） ──
    const { seeds, filtered } = locateSeedsSync(dimension, center, radius, yBand, spec.seedTypes, spec.buildSeed);

    // ── 批量列补全（同步，可选） ──
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
      const up = probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, 1, isExtend, buildExtend);
      const down = probeColumnsBatched(dimension, columns, spec.probe.extendTypes, spec.probe.limit, -1, isExtend, buildExtend);
      seeds.push(...up, ...down);
      probeAdded = up.length + down.length;
    }

    // ── 候选生成（同步） ──
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

    // ── Phase 2 细扫（每 tick 一批并发）：system.run 排队调度 ──
    return new Promise<StructureSearchResult<T>>((resolvePromise) => {
      // 无候选：直接收尾（不调度）
      if (candidates.length === 0) {
        resolvePromise(empty());
        return;
      }
      const hits: Array<{ candidate: StructureCandidate; result: T; lines: string[] }> = [];
      let index = 0;

      const runBatch = (): void => {
        const batch = candidates.slice(index, index + EVALUATE_BATCH_SIZE);
        index += batch.length;
        // 批内并发评估（Promise.all——本 tick 内完成该批全部候选细扫）
        Promise.all(batch.map((c) => evaluateCandidateSync(c, spec, dimension, region, includeDiagnostics)))
          .then((results) => {
            hits.push(...results);
            if (index < candidates.length) {
              // 下一批 → 下一 tick（每 tick 只细扫一批，单 tick 不堆积）
              system.run(runBatch);
            } else {
              // 末批完成：排序 + 诊断行汇总 → resolve
              const accepted: StructureHit<T>[] = [];
              const rejected: StructureHit<T>[] = [];
              const lines: string[] = [];
              for (const h of hits) {
                if (h.result.accepted) {
                  accepted.push({ candidate: h.candidate, result: h.result });
                } else {
                  rejected.push({ candidate: h.candidate, result: h.result });
                }
                lines.push(...h.lines);
              }
              const dist = (c: StructureCandidate) =>
                Math.hypot(
                  Math.min(...c.seeds.map((s) => s.x)) - sortOrigin.x,
                  Math.min(...c.seeds.map((s) => s.z)) - sortOrigin.z,
                );
              accepted.sort((a, b) => dist(a.candidate) - dist(b.candidate));
              rejected.sort((a, b) => dist(a.candidate) - dist(b.candidate));
              resolvePromise({
                accepted,
                rejected,
                lines,
                seedsFound: seeds.length,
                probeAdded,
                filtered,
                center,
                radius,
              });
            }
          })
          .catch((e: any) => {
            // ⚠️ 永不 reject：批处理异常（理论不可达——evaluateCandidateSync 内部已兜底）
            console.warn(`[MockPlayer][${spec.name}] 细扫批次异常: ${e?.message ?? e}`);
            resolvePromise(empty());
          });
      };

      // 细扫从下一 tick 开始（第 2 tick 起每 tick 一批）
      system.run(runBatch);
    });
  } catch (e: any) {
    // ⚠️ 永不 reject：任何异常 resolve 空结果
    console.warn(`[MockPlayer][${spec.name}] 扫描异常: ${e?.message ?? e}`);
    return Promise.resolve(empty());
  }
}
