// ─── 通用结构搜索（core 层） ────────────────────────────
// 纯逻辑：结构种子聚类、候选区域划分——任何结构（树/宝库/建筑/矿脉…）的
// 搜索共用的空间几何工具。零 @minecraft 依赖，可被 tsconfig.test.json
// 单独编译进 node 测试。
//
// 与 mc 层引擎（features/task/structureScan）的分工：
//   - core 只做"种子 → 候选"的空间几何（聚类/区域），不碰世界访问
//   - mc 引擎做 getBlocks 批量编排（定位/补全/缓存/评估循环）
//   - 结构特定逻辑（种子判定/评估公式）由各结构 spec 提供
//
// 树场景注意：树的聚类有专门规则（层分组 + 同型垂直成链 + 段切分，
// 见 rules/tree/TreeRules.extractTrunkCandidates）——通用聚类面向
// 无特殊约束的结构；树 spec 传入自身 cluster 即可。

import type { Vec3 } from "../Types";

// ─── 种子与聚类 ────────────────────────────────────────

/** 结构种子点（特征方块位置 + 类别） */
export interface ScanSeed {
  x: number;
  y: number;
  z: number;
  /** 种子类别（如树木材 id / 方块族；同类别聚类时用于分组） */
  kind: string;
}

/** 种子聚类（结构候选的雏形） */
export interface SeedCluster {
  seeds: ScanSeed[];
  /** 最低/最高种子 y（补全/评估锚点） */
  minY: number;
  maxY: number;
  /** 最底层种子水平足迹（支撑/站立检查用） */
  footprint: { x: number; z: number }[];
}

/** 单簇 BFS 的水平邻接遍历（种子网格访问） */
function bfsCluster(
  start: ScanSeed,
  all: ScanSeed[],
  visited: Set<string>,
  radius: number,
  sameKind: boolean,
): ScanSeed[] {
  const cluster: ScanSeed[] = [];
  const queue: ScanSeed[] = [start];
  visited.add(`${start.x},${start.y},${start.z}`);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    cluster.push(cur);
    for (const other of all) {
      const key = `${other.x},${other.y},${other.z}`;
      if (visited.has(key)) continue;
      if (sameKind && other.kind !== cur.kind) continue;
      // 3D 切比雪夫邻接（默认 radius=1：26 邻）
      if (
        Math.abs(other.x - cur.x) <= radius &&
        Math.abs(other.y - cur.y) <= radius &&
        Math.abs(other.z - cur.z) <= radius
      ) {
        visited.add(key);
        queue.push(other);
      }
    }
  }
  return cluster;
}

/**
 * 结构种子 3D 连通聚类（BFS，切比雪夫邻接）。
 * @param seeds 全部种子点
 * @param radius 邻接半径（默认 1 = 26 邻紧邻）
 * @param sameKind 是否仅同类别种子互相聚类（树场景 woodId 分流；false = 全类别合并）
 * @returns 聚类簇（每簇含种子/高度范围/底部足迹）
 */
export function clusterSeeds(seeds: ScanSeed[], radius = 1, sameKind = false): SeedCluster[] {
  const visited = new Set<string>();
  const clusters: SeedCluster[] = [];
  for (const seed of seeds) {
    const key = `${seed.x},${seed.y},${seed.z}`;
    if (visited.has(key)) continue;
    const cluster = bfsCluster(seed, seeds, visited, radius, sameKind);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let baseY = Number.POSITIVE_INFINITY;
    const footprint: { x: number; z: number }[] = [];
    for (const s of cluster) {
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
      if (s.y < baseY) baseY = s.y;
    }
    for (const s of cluster) {
      if (s.y === baseY) footprint.push({ x: s.x, z: s.z });
    }
    clusters.push({ seeds: cluster, minY, maxY, footprint });
  }
  return clusters;
}

// ─── 候选区域 ──────────────────────────────────────────

/** 候选结构（聚类 + 空间统计；评估入参） */
export interface StructureCandidate {
  /** 簇内种子（评估/诊断输入） */
  seeds: ScanSeed[];
  /** 最低/最高种子 y */
  baseY: number;
  topY: number;
  /** 底层种子足迹（支撑/站立检查用） */
  footprint: { x: number; z: number }[];
  /** 结构自定义负载（spec.cluster 可塞原始候选对象，evaluate 透传取回） */
  raw?: unknown;
}

/** 从聚类构建候选（通用；树场景用 TreeRules 自有提取） */
export function candidateFromCluster(cluster: SeedCluster): StructureCandidate {
  return {
    seeds: cluster.seeds,
    baseY: cluster.minY,
    topY: cluster.maxY,
    footprint: cluster.footprint,
  };
}

/** 候选区域范围（bbox ± pad，垂直自脚下到 regionTop；评估模板空间） */
export interface RegionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 脚下层 y（baseY - 1） */
  groundY: number;
  /** 区域顶 y（max(baseY + defaultHeight - 1, topY + topMargin)） */
  regionTop: number;
  /** 区域体积（格） */
  volume: number;
  /** 底部层格数（区域水平面积） */
  bottomCells: number;
}

/**
 * 候选区域范围：种子 bbox 水平扩展 pad 格，垂直自脚下层到
 * max(默认高度, 顶种子 + 顶部余量)（高结构自动加高）。
 */
export function regionBoundsOf(
  candidate: StructureCandidate,
  pad: number,
  defaultHeight: number,
  topMargin: number,
): RegionBounds {
  const xs = candidate.seeds.map((s) => s.x);
  const zs = candidate.seeds.map((s) => s.z);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const groundY = candidate.baseY - 1;
  const regionTop = Math.max(candidate.baseY + defaultHeight - 1, candidate.topY + topMargin);
  const bottomCells = (maxX - minX + 1) * (maxZ - minZ + 1);
  const volume = bottomCells * (regionTop - groundY + 1);
  return { minX, maxX, minZ, maxZ, groundY, regionTop, volume, bottomCells };
}

/** 水平距离（格；寻路/排序用） */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ─── 结构模板匹配 ──────────────────────────────────────
// 模板 = 一小块结构的组合描述（单方块 / 一组空间方块相对布局）。
// 匹配模式：以特征方块（锚点）批量定位候选位置，逐位校验模板其余方块。

/** 模板方块（相对锚点偏移 + 期望类别 + 可选） */
export interface PatternBlock {
  /** 相对锚点的偏移（锚点本身 = 0,0,0） */
  dx: number;
  dy: number;
  dz: number;
  /** 期望方块类别（方块 typeId 或分类标签，由 spec 的分类函数解释） */
  kind: string;
  /** 可选块：缺失不判定失败（宽容匹配，降低匹配度） */
  optional?: boolean;
}

/** 结构模板：锚点 + 一组空间方块组合 */
export interface StructurePattern {
  /** 模板名（诊断/日志） */
  name: string;
  /** 模板方块组合（含锚点方块 dx=dy=dz=0） */
  blocks: PatternBlock[];
}

/** 模板匹配结果 */
export interface PatternMatch {
  /** 是否完全匹配（全部非可选块命中） */
  matched: boolean;
  /** 缺失的非可选块（诊断） */
  missing: PatternBlock[];
  /** 命中块数 / 模板总块数（匹配度，可选块缺失降级） */
  score: number;
  /** 命中的模板块 */
  hit: PatternBlock[];
}

/**
 * 校验模板在锚点位置 (ax, ay, az) 的匹配（纯函数）。
 * @param pattern 结构模板
 * @param ax/ay/az 锚点世界坐标（模板 (0,0,0) 块对准的位置）
 * @param blockKind 世界方块类别查询（mc 层经缓存提供；测试用 MockWorld）
 * @returns 匹配结果（含缺失诊断与匹配度）
 */
export function matchPattern(
  pattern: StructurePattern,
  ax: number,
  ay: number,
  az: number,
  blockKind: (x: number, y: number, z: number) => string,
): PatternMatch {
  const hit: PatternBlock[] = [];
  const missing: PatternBlock[] = [];
  for (const block of pattern.blocks) {
    const kind = blockKind(ax + block.dx, ay + block.dy, az + block.dz);
    if (kind === block.kind) {
      hit.push(block);
    } else if (!block.optional) {
      missing.push(block);
    }
  }
  const required = pattern.blocks.filter((b) => !b.optional);
  // 匹配度 = 必需块命中数 / 必需块总数（可选块命中不计入分子，缺失不降分）
  const requiredHit = hit.filter((b) => !b.optional).length;
  return {
    matched: missing.length === 0,
    missing,
    score: required.length === 0 ? 1 : requiredHit / required.length,
    hit,
  };
}

/**
 * 以定位种子为线索生成模板候选：把种子对齐到模板每个非可选块位置，
 * 推导出可能锚点，逐锚点校验 → 命中者组成候选（含锚点与命中块）。
 * 同一结构被多个种子命中时由调用方按锚点/命中块聚合去重。
 * @param pattern 结构模板
 * @param seed 定位到的种子方块位置（模板任一非可选块的实例）
 * @param blockKind 方块类别查询
 * @returns 以该种子为线索的全部命中锚点（锚点 + 匹配结果）
 */
export function matchPatternAtSeed(
  pattern: StructurePattern,
  seed: { x: number; y: number; z: number },
  blockKind: (x: number, y: number, z: number) => string,
): Array<{ anchor: { x: number; y: number; z: number }; match: PatternMatch }> {
  const anchors: Array<{ anchor: { x: number; y: number; z: number }; match: PatternMatch }> = [];
  // 模板锚点块（(0,0,0) 位；无锚点块时跳过锚点类别预检）
  const anchorBlock = pattern.blocks.find((b) => b.dx === 0 && b.dy === 0 && b.dz === 0);
  for (const block of pattern.blocks) {
    if (block.optional) continue;
    // 假设种子 = 该块实例 → 锚点反推
    const ax = seed.x - block.dx;
    const ay = seed.y - block.dy;
    const az = seed.z - block.dz;
    // 锚点位置本身的类别必须匹配锚点块（防无效锚点推导）
    if (anchorBlock && blockKind(ax, ay, az) !== anchorBlock.kind) continue;
    const match = matchPattern(pattern, ax, ay, az, blockKind);
    if (match.matched) anchors.push({ anchor: { x: ax, y: ay, z: az }, match });
  }
  // 锚点去重（同一锚点多块命中只留一次）
  const seen = new Set<string>();
  return anchors.filter((a) => {
    const key = `${a.anchor.x},${a.anchor.y},${a.anchor.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
