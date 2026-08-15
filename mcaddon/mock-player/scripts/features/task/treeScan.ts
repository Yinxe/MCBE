// ─── 树资源扫描（mc 层） ─────────────────────────────
// 世界接入：getBlocks 显式列出自然原木集（includeTypes 无通配符，见
// core/rules/TreeRules）→ woodId 归一（log/log2 读 wood_type state；
// mangrove_log/cherry_log/pale_oak_log 按 typeId 截取）→ **水平原木过滤**
// （pillar_axis = x/z 的原木是倒下的树/横梁——不参与计算，见下）→
// cellKind 区域查询直查真实世界 → 逐候选详细描述（诊断输出，可整段复制）。
//
// ⚠️ cellKind **不做扫描盒截断**：区域查询是完整世界访问，边界树的评估
// 区域完整、无评分偏差。截断只发生在"树干在扫描范围外"的树——其原木
// 根本不在输入列表里，本就不归本次扫描负责。
//
// ⚠️ 水平原木（pillar_axis = x/z）一律过滤：倒下的树（横卧原木地物）与
// 人造建筑/横梁同构，不参与树判定；且躺靠活树的倒树若并入输入，会与活树
// 树干同层合并成大组导致活树被提取丢弃。竖直原木（含金合欢斜干、2×2、
// 大树加宽枝干）不受影响；被过滤的水平枝干由砍伐阶段以树干种子 BFS 补全。

import { BlockVolume } from "@minecraft/server";
import type { Block, Dimension } from "@minecraft/server";

import {
  classifyTreeBlock,
  evaluateCandidatesCached,
  extractTrunkCandidates,
  treeRegionBounds,
  TREE_AUX_TYPE_IDS,
  TREE_GROUND_TYPE_IDS,
  TREE_LEAF_TYPE_IDS,
  TREE_LOG_TYPE_IDS,
  TREE_PLANT_TYPE_IDS,
  type CellKindFn,
  type TreeBlockKind,
  type TreeLog,
  type TreeRegionBounds,
  type TreeReject,
  type TreeResource,
  type TreeVerdict,
} from "../../rules/tree/TreeRules";
import type { TrunkCandidate } from "../../rules/tree/TreeRules";
import type { Vec3 } from "../../rules/Types";

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
  /** 树干候选（与 verdicts 同序） */
  candidates: TrunkCandidate[];
  /** 逐候选详细描述行（可直接复制回排障） */
  lines: string[];
  /** 参与计算的垂直原木数 */
  logsFound: number;
  /** 被过滤的水平原木数（倒下的树/横梁） */
  horizontalFiltered: number;
  /** 扫描中心/半径 */
  center: Vec3;
  radius: number;
}

/**
 * 单个候选的详细诊断描述（区域范围/计数/异物 typeId 明细/因子/结论）。
 * 区域方块直查维度，与评估同源（classifyTreeBlock），读数即评估读数。
 */
function describeCandidate(
  candidate: TrunkCandidate,
  verdict: TreeVerdict,
  dimension: Dimension,
  origin: Vec3
): string[] {
  const b = treeRegionBounds(candidate);
  const footSet = new Set(candidate.footprint.map((c) => `${c.x},${c.z}`));
  const counts = { log: 0, leaf: 0, air: 0, aux: 0, foreign: 0, groundAbove: 0, bottomGround: 0, underGround: 0 };
  let leafMinY = Number.POSITIVE_INFINITY;
  let leafMaxY = Number.NEGATIVE_INFINITY;
  const foreignByType = new Map<string, number>();
  try {
    for (let y = b.groundY; y <= b.regionTop; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        for (let z = b.minZ; z <= b.maxZ; z++) {
          const block = dimension.getBlock({ x, y, z });
          const typeId = block?.typeId ?? "";
          const kind = classifyTreeBlock(typeId);
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
            // 与 core 评估口径一致：只算"非自然"异物；地上泥土 = 地形，单独计数仅作参考
            counts.foreign++;
            foreignByType.set(typeId, (foreignByType.get(typeId) ?? 0) + 1);
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

/** 树扫描选项 */
export interface TreeScanOptions {
  /**
   * 是否生成逐候选诊断行（describeCandidate 整遍区域遍历，开销≈评估本身）。
   * 仅诊断命令需要；感知路径（砍树感受器/工作流补扫）传 false——诊断行
   * 白算会翻倍扫描耗时（3.3.10 性能修复）。
   */
  includeDiagnostics?: boolean;
  /**
   * 第一轮定位扫描的 Y 轴层数（上下各 yBand 层，用户规格 3.3.13：**不看
   * 高度，先确认树干分布在什么位置**——薄层定位便宜，横向范围可宽）。
   */
  yBand?: number;
}

// ─── 第一轮定位 + 第二轮评估（3.3.13 用户规格：薄层定位 → 树坐标补全 →
//     按树批量评估；方块读取代价从"全高度 61³ + 逐候选逐格读"降到
//     "薄层 61×61×7 + 每列向上探测 + 每候选 3 次批量 getBlocks"） ───

/** 第一轮定位扫描 Y 轴层数（上下各 3 层） */
const SCAN_Y_BAND = 3;
/** 树干向上补全探测上限（格，防超高建筑/异常结构） */
const TRUNK_PROBE_LIMIT = 40;

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

/** 有效自然原木 id（第一轮定位扫描用——剔除无效旧 id） */
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

/**
 * 按候选区域构建方块分类缓存（批量 getBlocks 填充，评估时零逐格读）。
 * 区域 volume 裁剪到世界高度 [-64, 320]；裁剪外的格子 = 未命中 = foreign
 * （与逐格 getBlock 越界返回 undefined → foreign 语义一致）。
 * **批量失败回退逐格**（3.3.17）：引擎拒绝批量查询（数量/无效 id）时
 * 兜底逐格 getBlock——保证评估正确性，绝不让扫描静默全拒。
 */
function buildRegionCellKind(dimension: Dimension, bounds: TreeRegionBounds): CellKindFn {
  const cache = new Map<string, TreeBlockKind>();
  let bulkOk = true;
  try {
    const volume = new BlockVolume(
      { x: bounds.minX, y: Math.max(-64, bounds.groundY), z: bounds.minZ },
      { x: bounds.maxX, y: Math.min(320, bounds.regionTop), z: bounds.maxZ }
    );
    for (const batch of NATURAL_BATCHES) {
      const found = dimension.getBlocks(volume, { includeTypes: [...batch] });
      for (const loc of found.getBlockLocationIterator()) {
        const block = dimension.getBlock(loc);
        if (block) cache.set(`${loc.x},${loc.y},${loc.z}`, classifyTreeBlock(block.typeId));
      }
    }
  } catch (e: any) {
    // 批量查询失败（数量/无效 id 被引擎拒绝）→ 打印原因 + 回退逐格（正确性兜底）
    console.error(`[MockPlayer] 树区域批量缓存失败，回退逐格: ${e?.message ?? e}`);
    bulkOk = false;
  }
  if (bulkOk) {
    return (x, y, z) => cache.get(`${x},${y},${z}`) ?? ("foreign" as const);
  }
  // 回退：逐格读取（与批量缓存前语义完全一致）
  return (x, y, z) => {
    try {
      const block = dimension.getBlock({ x, y, z });
      return classifyTreeBlock(block?.typeId ?? "");
    } catch {
      return "foreign" as const;
    }
  };
}

/**
 * 扫描 center 周围 radius 格（立方体）内的树资源，并生成逐候选详细诊断。
 *
 * **两轮扫描（3.3.13 用户规格）**：
 *   ① 第一轮定位：薄层（Y 上下 yBand=3 层）getBlocks 查原木——不看高度，
 *      先确认树干分布在什么位置（薄层便宜，横向可宽）；
 *   ② 树干补全：每列从薄层最高原木**向上**探测到树冠（树顶标志=树叶）、
 *      从最低原木**向下**探测到地面（树底标志=泥土）——收齐薄层 ±3 外的
 *      树顶/树桩原木（树的坐标在第一轮已确定，不需要再全区域扫描）；
 *   ③ 第二轮评估：对每棵候选树按自身区域批量 getBlocks 建分类缓存
 *      （自然方块分批白名单，未命中 = foreign），core 公式原样计算——
 *      每棵树只做 3 次批量查询，不再逐格 getBlock。
 * 结果按到 center 水平距离由近到远排序，拒绝候选带诊断原因 + 因子分解。
 *
 * @param center 扫描中心（假人/玩家位置）
 * @param dimension 扫描维度
 * @param radius 扫描半径（格，立方体半边长）
 * @param options 扫描选项（includeDiagnostics 缺省 true——命令路径）
 * @returns 树资源列表 + 拒绝诊断 + 逐候选详细描述行
 */
export function scanTreesNear(
  center: Vec3,
  dimension: Dimension,
  radius: number,
  options: TreeScanOptions = {}
): TreeScanDetail {
  const yBand = options.yBand ?? SCAN_Y_BAND;
  let logs: TreeLog[] = [];
  let horizontalFiltered = 0;
  try {
    // ① 第一轮定位：薄层（Y ±yBand）——不看高度，先确认树干分布
    const volume = new BlockVolume(
      { x: center.x - radius, y: center.y - yBand, z: center.z - radius },
      { x: center.x + radius, y: center.y + yBand, z: center.z + radius }
    );
    const trunkColumns = new Map<string, { x: number; z: number; minY: number; topY: number }>();
    // 第一轮定位：只传有效原木 id（3.3.19：此前含无效旧 id log/log2——
    // 引擎拒绝会导致整轮扫描失败被吞成空 → 砍树不动）
    const intersection = dimension.getBlocks(volume, { includeTypes: [...VALID_LOG_TYPE_IDS] });
    for (const loc of intersection.getBlockLocationIterator()) {
      const block = dimension.getBlock(loc);
      if (!block) continue;
      if (isHorizontalLog(block)) {
        horizontalFiltered++;
        continue; // 倒下的树/横梁不参与计算
      }
      const key = `${loc.x},${loc.z}`;
      const col = trunkColumns.get(key);
      if (!col) {
        trunkColumns.set(key, { x: loc.x, z: loc.z, minY: loc.y, topY: loc.y });
      } else {
        if (loc.y > col.topY) col.topY = loc.y;
        if (loc.y < col.minY) col.minY = loc.y;
      }
      logs.push({ x: loc.x, y: loc.y, z: loc.z, woodId: woodIdOf(block) });
    }
    // ② 树干补全（用户规格 3.3.14：向上找树顶、向下找树底）：
    //    向上——从薄层最高原木探测到树冠（首个非原木，标志=树叶），收齐树顶原木；
    //    向下——从薄层最低原木探测到地面（首个非原木，标志=泥土），收齐树底/
    //    树桩原木（薄层 ±3 外看不到的部分）。树坐标第一轮已定，无需全区域扫描；
    //    水平原木（枝干/横梁）跳过不计数，非原木即到标志。
    for (const col of trunkColumns.values()) {
      // 向上：树顶标志 = 树叶（首个非原木）
      let y = col.topY + 1;
      let probed = 0;
      while (probed < TRUNK_PROBE_LIMIT) {
        const b = dimension.getBlock({ x: col.x, y, z: col.z });
        if (!b || !(TREE_LOG_TYPE_IDS as readonly string[]).includes(b.typeId)) break;
        if (!isHorizontalLog(b)) {
          logs.push({ x: col.x, y, z: col.z, woodId: woodIdOf(b) });
        }
        y++;
        probed++;
      }
      // 向下：树底标志 = 泥土（首个非原木）
      y = col.minY - 1;
      probed = 0;
      while (probed < TRUNK_PROBE_LIMIT) {
        const b = dimension.getBlock({ x: col.x, y, z: col.z });
        if (!b || !(TREE_LOG_TYPE_IDS as readonly string[]).includes(b.typeId)) break;
        if (!isHorizontalLog(b)) {
          logs.push({ x: col.x, y, z: col.z, woodId: woodIdOf(b) });
        }
        y--;
        probed++;
      }
    }
  } catch (e) {
    console.warn(`[MockPlayer] treeScan error: ${e}`);
    return { trees: [], rejected: [], candidates: [], lines: [], logsFound: 0, horizontalFiltered: 0, center, radius };
  }

  // ③ 第二轮评估：聚类/成链/段切分（core 复用）→ 逐候选按区域批量缓存评估
  const candidates = extractTrunkCandidates(logs);
  const { trees, rejected, verdicts } = evaluateCandidatesCached(candidates, (candidate, bounds) =>
    buildRegionCellKind(dimension, bounds)
  );
  trees.sort((a, b) => Math.hypot(a.base.x - center.x, a.base.z - center.z) - Math.hypot(b.base.x - center.x, b.base.z - center.z));

  // 逐候选详细描述（诊断输出；verdicts 与 candidates 同序；由命令侧写入内容日志）
  // includeDiagnostics=false（感知路径）：跳过——描述遍历整遍区域，开销≈评估本身
  const lines: string[] = [];
  if (options.includeDiagnostics !== false) {
    for (let i = 0; i < candidates.length; i++) {
      lines.push(...describeCandidate(candidates[i]!, verdicts[i]!, dimension, center));
    }
  }
  return { trees, rejected, candidates, lines, logsFound: logs.length, horizontalFiltered, center, radius };
}
