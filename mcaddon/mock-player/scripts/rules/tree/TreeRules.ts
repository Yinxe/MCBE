// ─── 树资源判定规则（core 层） ─────────────────────────
// 纯逻辑：方块分类、树干提取、树形概率（小树/大树两套算法）、扫描排序。
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
//
// 结构数据依据（Minecraft 中文 Wiki"树木/结构"，2026-08）：
//   - 树冠 = 直径 5-7 格、以树干为中心的球形 → 区域采样 ±2 覆盖稠密核心
//   - 树冠最低可触及地面（多数树型树叶自第 2 层起）→ 树冠计数自 baseY+1 起
//   - 深色橡树/大型云杉/大型丛林树 = 2×2 树干（深色橡树第 4-5 层加宽）
//   - 金合欢 = 斜干+分叉（每层 ≤2 块仍算小树）；红树 = 根+泥/水地基
//   - 藤蔓/红树根是自然附属（覆藤树/沼泽橡树/红树的常态结构），不算异物
//   - 倒下的树（水平原木）无垂直成链 → 提取天然拒绝
//
// 判定语义：硬门槛（地面支撑 G / 树冠存在 L）保安全，概率（G×L×C×F×H×A）
// 择优。P ≥ TREE_PROBABILITY_THRESHOLD 即视为树资源；概率同时是选树优先级
// （由近到远排序，钓鱼点星级同款语义）。

import type { Vec3 } from "../Types";

// ─── 方块分类 ──────────────────────────────────────────

/** 树方块类别（区域模板：底部泥土 / 原木 / 树叶 / 自然附属 / 其余空气） */
export type TreeBlockKind = "air" | "log" | "leaf" | "ground" | "aux" | "foreign";

/** 自然原木方块 ID（新旧 id 形态并存；stripped/wood/planks 加工品不在此列） */
export const TREE_LOG_TYPE_IDS = [
  "minecraft:log",
  "minecraft:log2",
  "minecraft:oak_log",
  "minecraft:spruce_log",
  "minecraft:birch_log",
  "minecraft:jungle_log",
  "minecraft:acacia_log",
  "minecraft:dark_oak_log",
  "minecraft:mangrove_log",
  "minecraft:cherry_log",
  "minecraft:pale_oak_log",
] as const;

/** 自然树叶方块 ID（含杜鹃树叶——杜鹃树树干是橡木、树冠是杜鹃叶） */
export const TREE_LEAF_TYPE_IDS = [
  "minecraft:leaves",
  "minecraft:leaves2",
  "minecraft:oak_leaves",
  "minecraft:spruce_leaves",
  "minecraft:birch_leaves",
  "minecraft:jungle_leaves",
  "minecraft:acacia_leaves",
  "minecraft:dark_oak_leaves",
  "minecraft:mangrove_leaves",
  "minecraft:cherry_leaves",
  "minecraft:pale_oak_leaves",
  "minecraft:azalea_leaves",
  "minecraft:flowering_azalea_leaves",
] as const;

/** 自然地面方块 ID（树支撑层标志特征；含耕地/草径——农田边合法树；水/泥——红树浅水地基；
 *  含天然岩石（石头/深板岩/安山岩…）——石头是山体的自然方块（用户拍板），
 *  wiki"石头上的橡树"真实存在；圆石/石砖等加工方块不在此列） */
export const TREE_GROUND_TYPE_IDS = [
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:podzol",
  "minecraft:mycelium",
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:gravel",
  "minecraft:farmland",
  "minecraft:dirt_path",
  "minecraft:mud",
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:stone",
  "minecraft:deepslate",
  "minecraft:andesite",
  "minecraft:diorite",
  "minecraft:granite",
  "minecraft:tuff",
  "minecraft:calcite",
  "minecraft:basalt",
  "minecraft:blackstone",
] as const;

/** 自然附属方块 ID（藤蔓/红树根/蜂巢——覆藤树、沼泽橡树、红树的常态结构，
 *  蜂巢是橡树/白桦/红树/樱花树自然携带（wiki），都不算异物） */
export const TREE_AUX_TYPE_IDS = ["minecraft:vine", "minecraft:mangrove_roots", "minecraft:bee_nest"] as const;

/** 自然植被方块 ID（地面草/花/蕨/菌/大型植物——森林地表的常态杂物，不算异物；
 *  游戏实测教训：真实森林每棵树的树空间里有 5-15 株植被，若算异物 F 因子全杀） */
export const TREE_PLANT_TYPE_IDS = [
  "minecraft:short_grass",
  "minecraft:tallgrass",
  "minecraft:grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:dead_bush",
  "minecraft:dandelion",
  "minecraft:poppy",
  "minecraft:blue_orchid",
  "minecraft:allium",
  "minecraft:azure_bluet",
  "minecraft:oxeye_daisy",
  "minecraft:cornflower",
  "minecraft:lily_of_the_valley",
  "minecraft:wither_rose",
  "minecraft:sunflower",
  "minecraft:lilac",
  "minecraft:rose_bush",
  "minecraft:peony",
  "minecraft:brown_mushroom",
  "minecraft:red_mushroom",
  "minecraft:crimson_fungus",
  "minecraft:warped_fungus",
  "minecraft:torchflower",
  "minecraft:pitcher_plant",
  // 地面覆盖物：枯叶堆（苍白橡树林）/ 粉瓣花（樱花林）——同属自然地表常态
  "minecraft:leaf_litter",
  "minecraft:pink_petals",
  // 竹子——雨林自然植被（实测 51 根 bamboo 曾杀一棵树）
  "minecraft:bamboo",
  // 西瓜——雨林自然植被（实测 4 棵树旁 melon_block 被算异物）
  "minecraft:melon_block",
] as const;

/** 自然植被后缀判定（树苗/郁金香——种类多，按后缀收编） */
function isPlantBySuffix(typeId: string): boolean {
  return typeId.endsWith("_sapling") || typeId.endsWith("_tulip");
}

/** 方块 typeId → 树方块类别（区域模板分类） */
export function classifyTreeBlock(typeId: string): TreeBlockKind {
  if (typeId === "minecraft:air") return "air";
  if ((TREE_LOG_TYPE_IDS as readonly string[]).includes(typeId)) return "log";
  if ((TREE_LEAF_TYPE_IDS as readonly string[]).includes(typeId)) return "leaf";
  if ((TREE_GROUND_TYPE_IDS as readonly string[]).includes(typeId)) return "ground";
  if ((TREE_AUX_TYPE_IDS as readonly string[]).includes(typeId)) return "aux";
  if (isPlantBySuffix(typeId) || (TREE_PLANT_TYPE_IDS as readonly string[]).includes(typeId)) return "aux";
  return "foreign";
}

// ─── 树干提取 ──────────────────────────────────────────

/** 树型：小树=单根/≤2 块横截面；大树=恒含 2×2 核心 */
export type TreeKind = "small" | "big";

/**
 * 原木点（扫描结果；woodId 由 mc 层按方块 states 归一：oak/spruce/birch/jungle/acacia/dark_oak/mangrove/cherry/pale_oak）。
 * ⚠️ 坐标制：内部扫描/聚类为整数格坐标；TreeResource.logs 存储为中心坐标制（+0.5）。
 * ⚠️ 输入约定：仅垂直原木——mc 层按 pillar_axis 过滤水平原木（倒下的树/
 * 横梁不参与计算，且躺靠活树时会污染树干聚类）。
 */
export interface TreeLog {
  x: number;
  y: number;
  z: number;
  /** 木材种类 id（树干同型判定用） */
  woodId: string;
}

/** 树干候选（提取结果；两套概率算法的入参） */
export interface TrunkCandidate {
  /** 候选型（按链内横截面判定；小树=每层 ≤2 块，大树=首层 2×2 且每层含核心） */
  kind: TreeKind;
  /** 木材种类（整链同型） */
  woodId: string;
  /** 链内全部原木（砍伐输入；横枝层会断链——枝干由 mc 层以树干种子 BFS 补全） */
  logs: TreeLog[];
  /** 最低/最高原木 y */
  baseY: number;
  topY: number;
  /** 底层 footprint（支撑层地面检查用；小=1~2 格，大=4 格） */
  footprint: Vec3[];
}

/** 树干最低高度（格；单根原木/丛林灌木不算树） */
export const MIN_TRUNK_HEIGHT = 2;
/** 大树核心边长（格，2×2） */
export const BIG_CORE_SIZE = 2;

interface LayerGroup {
  y: number;
  cells: TreeLog[];
}

interface TrunkChain {
  woodId: string;
  layers: LayerGroup[];
}

/** 两层组间邻接分（任意一对格切比雪夫 ≤1；2×2 恒叠=16，斜干偏移=1，不相邻=0） */
function layerAdjacencyScore(a: LayerGroup, b: LayerGroup): number {
  let score = 0;
  for (const ca of a.cells) {
    for (const cb of b.cells) {
      if (Math.abs(ca.x - cb.x) <= 1 && Math.abs(ca.z - cb.z) <= 1) score++;
    }
  }
  return score;
}

/** 4 格是否构成 2×2 方阵（x/z 跨度各 1 且去重后恰 4 格） */
function isSquare2x2(cells: readonly TreeLog[]): boolean {
  if (cells.length !== BIG_CORE_SIZE * BIG_CORE_SIZE) return false;
  const xs = cells.map((c) => c.x);
  const zs = cells.map((c) => c.z);
  const dx = Math.max(...xs) - Math.min(...xs);
  const dz = Math.max(...zs) - Math.min(...zs);
  return dx === 1 && dz === 1;
}

/**
 * 从扫描原木坐标提取树干候选（纯函数）。
 *
 * 算法：按 y 分层 → 层内 8 邻水平分组（2×2 对角自然合并）→ 垂直成链
 * （同型 + 连续层 + 层间切比雪夫 ≤1 邻接，金合欢斜干兼容）→ 链内按"最长
 * 合规段"切分分类（**大树判定优先**）：
 *   - 大树：首层恰 2×2 方阵 + 每层恒等于首层（"恒 2×2"身份证明；深色橡树
 *     第 4-5 层加宽会断链——树干 2×2 段仍被识别，加宽枝干由 mc 层以树干
 *     种子 BFS 补全；3×3+ 原木建筑各层超 4 块 → 整体丢弃，绝不砍建筑）
 *   - 小树：每层 ≤4 块（含密集森林交叉交融的合并簇——2×1 双生/三角形密植/
 *     2×2 缺角等，合并为单棵资源一起砍；1×4 墙等无树冠形态由评估层拒绝）
 *   - 其余（1×4 以上厚墙/不规则横截面）→ 丢弃
 * 单根原木（高度 <2，如丛林灌木）→ 丢弃。
 * 异种交织（acacia 斜靠 oak 等）：成链按 woodId 分流，互不合并。
 *
 * @param logs 扫描到的原木（含木材种类）
 * @returns 树干候选（大小树两套算法的入参）
 */
export function extractTrunkCandidates(logs: TreeLog[]): TrunkCandidate[] {
  // 1. 按 y 分层
  const byY = new Map<number, TreeLog[]>();
  for (const log of logs) {
    const list = byY.get(log.y) ?? [];
    list.push(log);
    byY.set(log.y, list);
  }
  const ys = [...byY.keys()].sort((a, b) => a - b);

  // 2. 层内 8 邻水平分组（索引化：Map<x,z> 邻接 O(1)，替代全层遍历 O(N²)——大范围扫描性能关键）
  const groupsByY = new Map<number, LayerGroup[]>();
  for (const y of ys) {
    const layerLogs = byY.get(y)!;
    // 层内坐标索引（"x,z" → 原木列表；同格多原木不会发生，列表长度 1）
    const cellIndex = new Map<string, TreeLog>();
    for (const log of layerLogs) {
      cellIndex.set(`${log.x},${log.z}`, log);
    }
    const groups: LayerGroup[] = [];
    const visited = new Set<string>();
    for (const start of layerLogs) {
      const key = `${start.x},${start.z}`;
      if (visited.has(key)) continue;
      const group: TreeLog[] = [];
      const queue: TreeLog[] = [start];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        group.push(cur);
        // 8 邻查索引（O(1) 而非遍历全层）
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const nk = `${cur.x + dx},${cur.z + dz}`;
            if (visited.has(nk)) continue;
            const nbr = cellIndex.get(nk);
            if (nbr) {
              visited.add(nk);
              queue.push(nbr);
            }
          }
        }
      }
      groups.push({ y, cells: group });
    }
    groupsByY.set(y, groups);
  }

  // 3. 垂直成链（同型 + 连续层 + 层间邻接；每层一组最多延伸一条链，反之亦然）
  const chains: TrunkChain[] = [];
  for (const y of ys) {
    const groups = groupsByY.get(y)!;
    const extended = new Set<TrunkChain>();
    for (const group of groups) {
      const woodId = group.cells[0]!.woodId;
      let best: TrunkChain | undefined;
      let bestScore = 0;
      for (const chain of chains) {
        if (extended.has(chain)) continue; // 一条链每层只接一组
        if (chain.woodId !== woodId) continue;
        const tail = chain.layers[chain.layers.length - 1]!;
        if (tail.y !== y - 1) continue; // 只在连续层延伸（断层=断链）
        const score = layerAdjacencyScore(tail, group);
        if (score > bestScore) {
          bestScore = score;
          best = chain;
        }
      }
      if (best && bestScore > 0) {
        best.layers.push(group);
        extended.add(best);
      }
    }
    for (const group of groups) {
      const chained = chains.some((c) => c.layers[c.layers.length - 1] === group);
      if (!chained) chains.push({ woodId: group.cells[0]!.woodId, layers: [group] });
    }
  }

  // 4. 链内按"最长合规段"切分分类（大树判定优先；深色橡树加宽层/建筑层自动断段）
  const candidates: TrunkCandidate[] = [];
  for (const chain of chains) {
    let runStart = 0;
    while (runStart < chain.layers.length) {
      const first = chain.layers[runStart]!;
      const firstSize = first.cells.length;
      const firstKeys = new Set(first.cells.map((c) => `${c.x},${c.z}`));
      const square2x2 = isSquare2x2(first.cells);
      let runEnd = runStart;
      if (square2x2) {
        // 大树段：每层恒等于首层 2×2 方阵（"恒 2×2"身份证明）
        while (runEnd + 1 < chain.layers.length) {
          const next = chain.layers[runEnd + 1]!;
          if (next.cells.length !== firstSize) break;
          const nextKeys = new Set(next.cells.map((c) => `${c.x},${c.z}`));
          let same = true;
          for (const k of firstKeys) {
            if (!nextKeys.has(k)) {
              same = false;
              break;
            }
          }
          if (!same) break;
          runEnd++;
        }
      } else if (firstSize <= 4) {
        // 小树段：每层 ≤4（密集森林交叉交融的合并簇——2×1 双生/三角形密植/
        // 2×2 缺角等；1×4 墙等无树冠形态由评估层拒绝兜底）
        while (runEnd + 1 < chain.layers.length && chain.layers[runEnd + 1]!.cells.length <= 4) runEnd++;
      }
      const run = chain.layers.slice(runStart, runEnd + 1);
      if (run.length >= MIN_TRUNK_HEIGHT) {
        const allLogs = run.flatMap((g) => g.cells);
        const baseY = run[0]!.y;
        const topY = run[run.length - 1]!.y;
        candidates.push({
          kind: square2x2 ? "big" : "small",
          woodId: chain.woodId,
          logs: allLogs,
          baseY,
          topY,
          footprint: run[0]!.cells.map((c) => ({ x: c.x, y: baseY, z: c.z })),
        });
      }
      runStart = runEnd + 1; // 断段后从断点继续（超段残留多被丢弃）
    }
  }
  return candidates;
}

// ─── 树形概率评估 ──────────────────────────────────────

/** 区域方块查询（mc 层实现：dimension.getBlock 分类；测试用 MockWorld） */
export type CellKindFn = (x: number, y: number, z: number) => TreeBlockKind;

/** 区域水平扩展（格，向各边延伸 2 格——小树 5×5 / 大树 6×6 的由来） */
export const REGION_PAD = 2;
/** 区域默认高度（格，从原木脚下泥土层起；常见树 10 格覆盖地面+树干+树冠） */
export const DEFAULT_REGION_HEIGHT = 10;
/** 树冠采样余量（格，区域顶 = 树顶 + 余量——高树自动加高，覆盖树冠球形顶部） */
export const CANOPY_MARGIN = 8;
/** 树冠计数起始（相对 baseY；wiki：多数树型树叶自第 2 层起） */
export const LEAF_MIN_LAYER_OFFSET = 1;
/** 小树树冠叶量目标（普通松树仅 10+ 叶——最低真实树冠） */
export const LEAF_TARGET_SMALL = 10;
/** 大树树冠叶量目标 */
export const LEAF_TARGET_BIG = 20;
/** 地面占比弱因子：G 软部分 = 0.75 + 0.25×占比（悬崖边树容错——底部层半边是空气） */
export const GROUND_SOFT_BASE = 0.75;
export const GROUND_SOFT_RANGE = 0.25;
/** 单层叶板（树冠厚 1 层）→ 形状因子 0.4（装饰平台/伞，一律拒） */
export const THIN_CANOPY_FACTOR = 0.4;
/** 树干高度归一基数（H = min(高/4, 1)；原版最低成树 4 格） */
export const TRUNK_HEIGHT_NORM = 4;
/** 异物击杀数（F = max(0, 1 − 异物/该值)；30 块异物 = 树空间内必非树；
 *  真实树空间异物 ≤3（花/草/碎石），分离度校准见 tree-rules.test.ts） */
export const FOREIGN_KILL_COUNT = 30;
/** 树冠主体阈值（A 因子）：主干连通团 ≥ 该比例即视为"树冠长在树上"= 1——
 *  窗口截断/邻树树冠混入窗口边缘不惩罚（游戏实测：真实白桦 A=0.82 因邻树
 *  树冠混入，被误压到 0.76 拒绝）；浮空叶板（连通 0）仍归零 */
export const A_DOMINANT_THRESHOLD = 0.5;
/** 树资源概率阈值（≥ 即视为树资源） */
export const TREE_PROBABILITY_THRESHOLD = 0.8;

/** 概率因子分解（校准/调试/通知用） */
export interface TreeFactors {
  /** 地面支撑（硬门槛：脚下全为自然地面，否则 0；软：底部层地面占比） */
  G: number;
  /** 树冠叶量（树冠存在门槛：0 = 无冠） */
  L: number;
  /** 树冠形状（厚 ≥2 层 = 1；单层薄板 = 0.4） */
  C: number;
  /** 树空间纯净度（异物击杀数归一） */
  F: number;
  /** 树干高度（≥4 格满值，防矮柱冒充） */
  H: number;
  /** 树冠与树干连通（主干连通团 ≥ 50% = 1；浮空叶板 = 0；窗口截断/邻树混入不惩罚） */
  A: number;
}

/** 拒绝原因（idle 缺因诊断用） */
export type TreeRejectReason = "no-ground" | "no-canopy" | "low-prob";

/** 树形评估结论（两套算法的统一出口） */
export type TreeVerdict =
  | { accepted: true; kind: TreeKind; probability: number; factors: TreeFactors; leafs: Vec3[] }
  | { accepted: false; reason: TreeRejectReason; kind: TreeKind; probability: number; factors: TreeFactors };

/** 树干候选的区域范围（模板评估空间；mc 层诊断描述复用） */
export interface TreeRegionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** 脚下泥土层 y（baseY−1） */
  groundY: number;
  /** 区域顶 y（max(默认 10 层, 树顶+8)） */
  regionTop: number;
  /** 区域体积（格） */
  volume: number;
  /** 底部层格数（区域水平面积） */
  bottomCells: number;
}

/** 树干候选的区域范围：链内全部原木 bbox ±2（金合欢斜干/大树加宽全数纳入），
 *  垂直自脚下泥土层到 max(默认 10, 树顶+8)。 */
export function treeRegionBounds(candidate: TrunkCandidate): TreeRegionBounds {
  const xs = candidate.logs.map((l) => l.x);
  const zs = candidate.logs.map((l) => l.z);
  const minX = Math.min(...xs) - REGION_PAD;
  const maxX = Math.max(...xs) + REGION_PAD;
  const minZ = Math.min(...zs) - REGION_PAD;
  const maxZ = Math.max(...zs) + REGION_PAD;
  const groundY = candidate.baseY - 1;
  const regionTop = Math.max(candidate.baseY + DEFAULT_REGION_HEIGHT - 1, candidate.topY + CANOPY_MARGIN);
  const bottomCells = (maxX - minX + 1) * (maxZ - minZ + 1);
  const volume = bottomCells * (regionTop - groundY + 1);
  return { minX, maxX, minZ, maxZ, groundY, regionTop, volume, bottomCells };
}

/**
 * 评估树干候选的树形概率（小树/大树共用模板，参数按型区分）。
 *
 * 区域模板：链内全部原木 bbox 向各边延伸 2 格（金合欢斜干/大树加宽全数纳入），
 * 垂直自脚下泥土层到 max(默认 10, 树顶+8)。期望结构：底部泥土 → 原木 →
 * 树叶（自 baseY+1 起，厚 ≥2 层的团，与树干连通）→ 其余空气。
 *
 * @param candidate 树干候选（extractTrunkCandidates 输出）
 * @param cellKind 区域方块查询（世界访问的唯一入口）
 * @returns 评估结论（accepted + 概率 + 因子分解 / 拒绝原因）
 */
export function evaluateTree(candidate: TrunkCandidate, cellKind: CellKindFn): TreeVerdict {
  const { minX, maxX, minZ, maxZ, groundY, regionTop, bottomCells } = treeRegionBounds(candidate);

  const footSet = new Set(candidate.footprint.map((c) => `${c.x},${c.z}`));

  let bottomGround = 0;
  let underGround = 0;
  let foreign = 0;
  let leafCount = 0;
  let leafMinY = Number.POSITIVE_INFINITY;
  let leafMaxY = Number.NEGATIVE_INFINITY;
  const leafKeys = new Set<string>();
  const logKeys = new Set<string>(); // 区域原木（A 因子连通骨架——含枝干原木）

  for (let y = groundY; y <= regionTop; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const kind = cellKind(x, y, z);
        if (y === groundY) {
          // 底部层：自然地面为期望（含脚下支撑检查）。**自然附属（红树根）也算
          // 支撑**——红树根是红树的支撑地基（实测：整片红树林脚下是根，G=0 全拒）
          if (kind === "ground") {
            bottomGround++;
          }
          if (kind === "ground" || kind === "aux") {
            if (footSet.has(`${x},${z}`)) underGround++;
          }
          continue;
        }
        if (kind === "log") {
          logKeys.add(`${x},${y},${z}`);
          continue;
        }
        if (kind === "leaf") {
          if (y >= candidate.baseY + LEAF_MIN_LAYER_OFFSET) {
            leafCount++;
            leafMinY = Math.min(leafMinY, y);
            leafMaxY = Math.max(leafMaxY, y);
            leafKeys.add(`${x},${y},${z}`);
          }
          continue;
        }
        if (kind === "foreign") {
          // 只算"非自然"异物（木板/玻璃/圆石/石砖等建筑方块）。自然地面
          // （草/泥/沙/水/天然岩石…）在地面层以上视为**地形**（山坡/山体），
          // 不算异物——游戏实测教训：山坡真树树空间 grass/dirt 5-37 块全被误杀
          foreign++;
        }
      }
    }
  }

  // ── 因子计算 ──
  const G = underGround === candidate.footprint.length
    ? GROUND_SOFT_BASE + GROUND_SOFT_RANGE * (bottomGround / bottomCells)
    : 0;
  const L = leafCount === 0 ? 0 : Math.min(leafCount / (candidate.kind === "small" ? LEAF_TARGET_SMALL : LEAF_TARGET_BIG), 1);
  const spanY = leafCount === 0 ? 0 : leafMaxY - leafMinY + 1;
  const C = leafCount === 0 ? 0 : spanY >= 2 ? 1 : THIN_CANOPY_FACTOR;
  const F = Math.max(0, 1 - foreign / FOREIGN_KILL_COUNT);
  const H = Math.min((candidate.topY - candidate.baseY + 1) / TRUNK_HEIGHT_NORM, 1);

    // A：树冠连通——从贴原木的树叶 BFS（**区域原木可通行**：枝干原木是树冠
    // 骨架，雨林大树实测枝干切断叶连通 A=0.62 被误杀；浮空叶板无原木可依 → 0）。
    // 主干连通团占比 ≥ A_DOMINANT_THRESHOLD 即视为"树冠长在树上"= 1——
    // 窗口截断/邻树树冠混入窗口边缘造成的少量"不连通"不惩罚（游戏实测）。
    let A = 0;
    if (leafCount > 0) {
      const nodeKeys = new Set<string>([...logKeys, ...leafKeys]);
      const adjacency = new Map<string, string[]>();
      for (const key of nodeKeys) {
        const [nx, ny, nz] = key.split(",").map(Number) as [number, number, number];
        const nbrs: string[] = [];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nk = `${nx + dx},${ny + dy},${nz + dz}`;
              if (nodeKeys.has(nk)) nbrs.push(nk);
            }
          }
        }
        adjacency.set(key, nbrs);
      }
      const visited = new Set<string>();
      const queue: string[] = [];
      for (const key of leafKeys) {
        if ((adjacency.get(key) ?? []).some((n) => logKeys.has(n))) {
          visited.add(key);
          queue.push(key);
        }
      }
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const n of adjacency.get(cur) ?? []) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
      let connectedLeaves = 0;
      for (const key of leafKeys) {
        if (visited.has(key)) connectedLeaves++;
      }
      const connectedFraction = leafCount === 0 ? 0 : connectedLeaves / leafCount;
      A = connectedFraction >= A_DOMINANT_THRESHOLD ? 1 : connectedFraction;
    }

  const probability = G * L * C * F * H * A;
  const factors: TreeFactors = { G, L, C, F, H, A };
  const common = { kind: candidate.kind, probability, factors };

  if (G === 0) return { accepted: false, reason: "no-ground", ...common };
  if (L === 0) return { accepted: false, reason: "no-canopy", ...common };
  if (probability < TREE_PROBABILITY_THRESHOLD) return { accepted: false, reason: "low-prob", ...common };
  return {
    accepted: true,
    ...common,
    // 树冠全部树叶坐标（整数格坐标；资源转换点统一转 blockCenter）
    leafs: [...leafKeys].map((k) => {
      const [x, y, z] = k.split(",").map(Number) as [number, number, number];
      return { x, y, z };
    }),
  };
}

// ─── 树资源点坐标 ──────────────────────────────────────

/** 方块中心坐标（blockCenter）：整数方块坐标 + 0.5 —— 世界内方块的实际中心点 */
export function blockCenter(x: number, y: number, z: number): Vec3 {
  return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
}

/**
 * 树中心坐标（blockCenter）：最低层左下角锚点原木的方块中心——
 * 小树即单根原木中心；大树取 2×2 底部 4 根中的左下角（min 角）那一根。
 * 站立/砍树/锁表的锚点。
 */
export function treeCenter(candidate: TrunkCandidate): Vec3 {
  const bottom = candidate.logs.filter((l) => l.y === candidate.baseY);
  return blockCenter(
    Math.min(...bottom.map((l) => l.x)),
    candidate.baseY,
    Math.min(...bottom.map((l) => l.z)),
  );
}

/** 树资源唯一 ID（由树中心坐标构建——取整数锚点 tree@(x,y,z)，每树唯一） */
export function treeResourceId(center: Vec3): string {
  return `tree@(${Math.floor(center.x)},${Math.floor(center.y)},${Math.floor(center.z)})`;
}

// ─── 扫描汇总 ──────────────────────────────────────────

/**
 * 树资源（扫描结果；后续砍伐/锁表/通知的输入）。
 * ⚠️ 存储坐标制：本资源点全部方块坐标（base/top/footprint/logs/leafs）
 * 均为中心坐标制（整数格坐标 + 0.5）——数据源统一，消费方直接可用。
 */
export interface TreeResource {
  /** 资源唯一 ID（由树中心坐标构建：tree@(x,y,z)——每树唯一） */
  id: string;
  /** 大树/小树 */
  kind: TreeKind;
  /** 树形概率（0-1；选树优先级，由近到远排序后取第一个） */
  probability: number;
  /** 因子分解（校准/调试） */
  factors: TreeFactors;
  /** 树中心坐标（blockCenter：最低层锚点原木的方块中心；站立/砍树/锁表锚点） */
  base: Vec3;
  /** 最高原木中心坐标（blockCenter） */
  top: Vec3;
  /** 底部支撑格（blockCenter；支撑层检查/站立点派生用） */
  footprint: Vec3[];
  /** 链内全部原木坐标（blockCenter；砍伐输入） */
  logs: TreeLog[];
  /** 树冠全部树叶坐标（blockCenter；数量 = leafs.length） */
  leafs: Vec3[];
}

/** 被拒候选（idle 缺因诊断用；含因子分解——定位哪个因子拖低概率） */
export interface TreeReject {
  kind: TreeKind;
  /** 树中心坐标（blockCenter） */
  base: Vec3;
  reason: TreeRejectReason;
  probability: number;
  /** 因子分解（如 F=0.53 → 异物击杀） */
  factors: TreeFactors;
}

/** 树资源扫描结果 */
export interface TreeScanResult {
  /** 通过判定的树（origin 提供时由近到远排序） */
  trees: TreeResource[];
  /** 被拒候选（诊断） */
  rejected: TreeReject[];
}

/** 水平距离（格；寻路/排序用） */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 候选批量评估结果 */
export interface CandidateEvaluation {
  /** 通过判定的树资源 */
  trees: TreeResource[];
  /** 被拒候选（诊断） */
  rejected: TreeReject[];
  /** 与输入 candidates 同序的评估结论（mc 层诊断描述用，避免二次评估） */
  verdicts: TreeVerdict[];
}

/** 区域方块查询构建器（逐候选构建——mc 层按候选区域建批量缓存后评估，
 *  避免区域模板逐格 getBlock；core 测试直接用 CellKindFn） */
export type CellKindBuilder = (candidate: TrunkCandidate, bounds: TreeRegionBounds) => CellKindFn;

/**
 * 候选批量评估（scanTreeResources 内部复用；mc 层诊断直调——
 * 逐候选描述需要 verdicts 与 candidates 一一对应）。
 */
export function evaluateCandidates(candidates: TrunkCandidate[], cellKind: CellKindFn): CandidateEvaluation {
  return evaluateCandidatesWith(candidates, () => cellKind);
}

/**
 * 逐候选构建区域查询的批量评估（mc 层扫描管线用）：每候选先按自身区域
 * bounds 构建方块查询（如批量 getBlocks 缓存），再评估——评估的方块
 * 访问完全收敛到构建器，公式不变。
 */
export function evaluateCandidatesCached(
  candidates: TrunkCandidate[],
  buildCellKind: CellKindBuilder
): CandidateEvaluation {
  return evaluateCandidatesWith(candidates, buildCellKind);
}

/** 批量评估主体（两个入口共用） */
function evaluateCandidatesWith(
  candidates: TrunkCandidate[],
  buildCellKind: CellKindBuilder
): CandidateEvaluation {
  const trees: TreeResource[] = [];
  const rejected: TreeReject[] = [];
  const verdicts: TreeVerdict[] = [];
  for (const candidate of candidates) {
    const bounds = treeRegionBounds(candidate);
    const verdict = evaluateTree(candidate, buildCellKind(candidate, bounds));
    verdicts.push(verdict);
    const base: Vec3 = treeCenter(candidate);
    // 存储坐标制：输出全部转 blockCenter（内部候选为整数格）
    const top: Vec3 = blockCenter(
      Math.max(...candidate.logs.map((l) => l.x)),
      candidate.topY,
      Math.max(...candidate.logs.map((l) => l.z)),
    );
    if (verdict.accepted) {
      trees.push({
        id: treeResourceId(base),
        kind: verdict.kind,
        probability: verdict.probability,
        factors: verdict.factors,
        base,
        top,
        footprint: candidate.footprint.map((c) => blockCenter(c.x, c.y, c.z)),
        logs: candidate.logs.map((l) => ({ x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5, woodId: l.woodId })),
        leafs: verdict.leafs.map((c) => blockCenter(c.x, c.y, c.z)),
      });
    } else {
      rejected.push({ kind: verdict.kind, base, reason: verdict.reason, probability: verdict.probability, factors: verdict.factors });
    }
  }
  return { trees, rejected, verdicts };
}

/**
 * 树资源扫描（核心入口）：原木坐标 → 树干提取 → 小树/大树两套概率评估 →
 * 通过判定者按距离由近到远排序（origin 为假人位置时）。
 *
 * @param logs 扫描到的原木（mc 层 getBlocks 结果）
 * @param cellKind 区域方块查询
 * @param origin 排序原点（假人位置；缺省不排序）
 * @returns 树资源列表（近→远）+ 被拒候选诊断
 */
export function scanTreeResources(logs: TreeLog[], cellKind: CellKindFn, origin?: Vec3): TreeScanResult {
  const { trees, rejected } = evaluateCandidates(extractTrunkCandidates(logs), cellKind);
  if (origin) {
    trees.sort((a, b) => horizontalDistance(origin, a.base) - horizontalDistance(origin, b.base));
  }
  return { trees, rejected };
}

// ─── 坐标集评估（纯算术：原木/树叶两个坐标集 → 树判定） ──

/**
 * 坐标数字编码（Set<number> 快于 Set<string>——零字符串分配，
 * 大范围扫描几十万次坐标查询时性能差距达数量级）。
 * 编码：x,y,z 各偏移 4096 后按 2^12 进制合并（z 低 12 位、y 中 12 位、x 高位移）。
 */
export function coordKey(x: number, y: number, z: number): number {
  return (x + 4096) * 16777216 + (y + 4096) * 4096 + (z + 4096);
}

/** 数字 key → 坐标（诊断用） */
export function keyToCoord(key: number): { x: number; y: number; z: number } {
  const z = (key % 4096) - 4096;
  const y = (Math.floor(key / 4096) % 4096) - 4096;
  const x = Math.floor(key / 16777216) - 4096;
  return { x, y, z };
}
// 由 mc 层一次性 getBlocks 采集坐标集（每类方块一次，零 getBlock），
// 评估只做集合运算（has 判定/邻接 BFS）——不再按候选区域查询世界。
// G（地面）/F（纯净度）因子依赖其他方块类型，坐标集方案缺省视为 1
// （可经 options 注入——如另采地面坐标集时恢复 G）。

/** 坐标集评估因子（简化版：不含 G/F） */
export interface TreeSetFactors {
  /** 树冠叶量（区域内树叶数 / 目标叶量） */
  L: number;
  /** 树冠形状（厚 ≥2 层 = 1；单层薄板 = 0.4） */
  C: number;
  /** 树干高度（≥4 格满值） */
  H: number;
  /** 树冠与树干连通（贴原木树叶 BFS 连通比例） */
  A: number;
}

/** 坐标集评估结论 */
export type TreeSetVerdict =
  | { accepted: true; kind: TreeKind; probability: number; factors: TreeSetFactors; leafs: Vec3[] }
  | { accepted: false; reason: "no-canopy" | "low-prob"; kind: TreeKind; probability: number; factors: TreeSetFactors };

/** 坐标集评估选项 */
export interface TreeSetEvalOptions {
  /** 大树直接接受（2×2 恒等段特征明显，无需树叶判定；缺省 true） */
  bigDirectAccept?: boolean;
  /** 小树/大树树冠叶量目标（缺省 10/20，与 cellKind 版一致） */
  leafTargetSmall?: number;
  leafTargetBig?: number;
  /** 树冠形状薄板因子（缺省 0.4） */
  thinCanopyFactor?: number;
  /** 树干高度归一基数（缺省 4） */
  trunkHeightNorm?: number;
  /** 概率阈值（缺省 0.8） */
  threshold?: number;
  /** 区域水平扩展（缺省 2——与 REGION_PAD 一致） */
  pad?: number;
  /** 区域顶余量（缺省 8——与 CANOPY_MARGIN 一致） */
  topMargin?: number;
  /** 区域默认高度（缺省 10） */
  defaultHeight?: number;
}

/**
 * 坐标集纯算术树评估：候选树干 + 树叶坐标集 → 树冠/连通/形状/高度因子。
 * 零世界查询——区域内树叶计数与连通 BFS 全部在 Set 内运算。
 * @param candidate 树干候选（extractTrunkCandidates 输出）
 * @param leafSet 树叶坐标集（数字编码 key）
 * @param options 评估参数（缺省与 cellKind 版一致）
 */
export function evaluateTreeFromSets(
  candidate: TrunkCandidate,
  leafSet: ReadonlySet<number>,
  options: TreeSetEvalOptions = {},
): TreeSetVerdict {
  const leafTarget = candidate.kind === "small" ? (options.leafTargetSmall ?? LEAF_TARGET_SMALL) : (options.leafTargetBig ?? LEAF_TARGET_BIG);
  const pad = options.pad ?? REGION_PAD;
  const topMargin = options.topMargin ?? CANOPY_MARGIN;
  const defaultHeight = options.defaultHeight ?? DEFAULT_REGION_HEIGHT;
  const thinCanopy = options.thinCanopyFactor ?? THIN_CANOPY_FACTOR;
  const heightNorm = options.trunkHeightNorm ?? TRUNK_HEIGHT_NORM;
  const threshold = options.threshold ?? TREE_PROBABILITY_THRESHOLD;

  // 区域范围：原木 bbox ± pad，垂直 baseY-1 .. max(baseY+默认高-1, topY+余量)
  const xs = candidate.logs.map((l) => l.x);
  const zs = candidate.logs.map((l) => l.z);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const regionTop = Math.max(candidate.baseY + defaultHeight - 1, candidate.topY + topMargin);

  // ── 区域内树叶坐标统计（纯集合 has 判定；大树直接接受也复用——资源点携带真实树叶数据） ──
  let leafCount = 0;
  let leafMinY = Number.POSITIVE_INFINITY;
  let leafMaxY = Number.NEGATIVE_INFINITY;
  const leafKeysInRegion: number[] = [];
  for (let y = candidate.baseY + LEAF_MIN_LAYER_OFFSET; y <= regionTop; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const key = coordKey(x, y, z);
        if (leafSet.has(key)) {
          leafCount++;
          if (y < leafMinY) leafMinY = y;
          if (y > leafMaxY) leafMaxY = y;
          leafKeysInRegion.push(key);
        }
      }
    }
  }

  // ── 大树直接接受：2×2 原木垂直向上（恒等段）特征已足够明显，无需树叶判定 ──
  // ⚠️ 高度门槛：高 < 4 层（H < 阈值）不直接接受——矮 2×2 柱（装饰/树桩）走树叶评估或拒绝
  if (candidate.kind === "big" && options.bigDirectAccept !== false) {
    const H = Math.min((candidate.topY - candidate.baseY + 1) / heightNorm, 1);
    if (H >= threshold) {
      const factors: TreeSetFactors = { L: 1, C: 1, H, A: 1 };
      return {
        accepted: true, kind: "big", probability: H, factors,
        leafs: leafKeysInRegion.map(keyToCoord),
      };
    }
    // 矮 2×2：落到正常评估（依赖树叶）
  }

  // ── 因子计算（纯算术） ──
  const L = leafCount === 0 ? 0 : Math.min(leafCount / leafTarget, 1);
  const spanY = leafCount === 0 ? 0 : leafMaxY - leafMinY + 1;
  const C = leafCount === 0 ? 0 : spanY >= 2 ? 1 : thinCanopy;
  const H = Math.min((candidate.topY - candidate.baseY + 1) / heightNorm, 1);

  // A：树冠连通——从贴原木的树叶 BFS（26 邻，全部在 leafSet 内判定）
  let A = 0;
  if (leafCount > 0) {
    const logKeys = new Set(candidate.logs.map((l) => coordKey(l.x, l.y, l.z)));
    const visited = new Set<number>();
    const queue: number[] = [];
    const seedCheck = (key: number): void => {
      // 该树叶 26 邻内是否有候选原木（数字 key 零分配）
      const { x, y, z } = keyToCoord(key);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            if (logKeys.has(coordKey(x + dx, y + dy, z + dz))) {
              visited.add(key);
              queue.push(key);
              return;
            }
          }
        }
      }
    };
    for (const key of leafKeysInRegion) seedCheck(key);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const { x, y, z } = keyToCoord(cur);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nk = coordKey(x + dx, y + dy, z + dz);
            if (leafSet.has(nk) && !visited.has(nk)) {
              visited.add(nk);
              queue.push(nk);
            }
          }
        }
      }
    }
    let connectedLeaves = 0;
    for (const key of leafKeysInRegion) {
      if (visited.has(key)) connectedLeaves++;
    }
    const connectedFraction = connectedLeaves / leafCount;
    A = connectedFraction >= A_DOMINANT_THRESHOLD ? 1 : connectedFraction;
  }

  const probability = L * C * H * A;
  const factors: TreeSetFactors = { L, C, H, A };
  const common = { kind: candidate.kind, probability, factors };
  if (L === 0) return { accepted: false, reason: "no-canopy", ...common };
  if (probability < threshold) return { accepted: false, reason: "low-prob", ...common };
  return { accepted: true, ...common, leafs: leafKeysInRegion.map(keyToCoord) };
}

// ─── 无属性聚类变体（坐标集方案：纯位置，零 getBlock） ──
// 实际世界"砍树就是树"——不需要 wood_id 属性分流（异种交织极少见）；
// 水平原木（倒下的树/横梁）由几何天然排除：单层横排成不了垂直链。

/**
 * 无属性树干提取：输入纯坐标（无 woodId），全部原木按同型聚类。
 * 水平原木（倒下树/横梁）天然被丢弃——单层横排无法垂直成链。
 * @param logs 原木坐标（x/y/z 即可）
 */
export function extractTrunkCandidatesSimple(logs: Array<{ x: number; y: number; z: number }>): TrunkCandidate[] {
  return extractTrunkCandidates(logs.map((l) => ({ x: l.x, y: l.y, z: l.z, woodId: "" })));
}
