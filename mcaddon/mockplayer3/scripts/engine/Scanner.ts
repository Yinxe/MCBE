// ─── 扫描器（RegionScanner 分切片扫描水面；SpotScanner 组装钓点候选） ──
// getBlocks 引擎约束：整卷 18.5k 格一次查询耗时 158ms，超过 50ms 慢操作阈值，
// 故按层分片（一片 ≈1089 格 ≈10ms），step 每 tick 只推进一片。
// includeTypes 含引擎不认识的 id（如 Java 版名）会让 getBlocks 整批抛错，
// 传给引擎前须先按 KNOWN_BLOCK_TYPES 剔除非法 id。
// 扫描区域覆盖到未加载区块时 getBlocks 的行为由 allowUnloadedChunks 决定：
// false（缺省，钓点扫描）——抛 UnloadedChunksError，切片异常标记 ok:false，调用方按
// 采集失败重试，不得播报"附近没有水面"；true（资源采集扫描）——只查已加载区块内的格、
// 跳过未加载部分不报错，未加载的边不拖垮整轮（假人游走时邻块未必已加载）。
// 判据唯一真源在 domain/composeStandCandidates：组装、候选出池前再校验、认领时
// 对照世界复查三路共用同一份读块缓存——两套判据不一致时，刚生成的钓点会在
// 第一次检查时就被判无效并移出池。
// 实体占用在组装期不剔除（逐候选 getEntities 查询会压垮单 tick），
// 统一留到认领时由 checkStand 查询当时世界状态判断。

import type { Vec3 } from "../domain/Coords";
import type { SpotCandidate, StandAudit, SupportProbe } from "../domain/FishingSpot";
import {
  FISH_COMPOSE_MAX_STANDS,
  SPOT_OCCUPY_RADIUS,
  auditStand,
  standAuditLabel,
  composeStandCandidates,
} from "../domain/FishingSpot";
import { coordKey } from "../domain/CoordSet";
import { SLOW_OP_MS } from "../domain/Perf";
import { BlockVolume, UnloadedChunksError } from "@minecraft/server";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import { dimensionOf, readBlockIn } from "./Atomic";
import type { Dimension } from "@minecraft/server";

export interface RegionRect {
  min: Vec3;
  max: Vec3;
}

/** 引擎认识的方块 id 表（与 Placer 同源） */
const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set<string>(Object.values(MinecraftBlockTypes) as string[]);

/** 认领时的复查结论（站位判据审计 + 实体占用） */
export interface StandCheck {
  verdict: "ok" | "invalid" | "occupied" | "unreadable";
  /** 判据原始观测（实体占用不改变站位结构结论，诊断信息仍可用） */
  audit: StandAudit;
}

/**
 * 单切片预算（格）：一次 getBlocks 调用至多覆盖这些格。整卷 18.5k 格耗时 158ms
 * 超慢操作阈值；一层一片 ≈1089 格 ≈10ms，step 每 tick 至多推进一片。
 */
export const SCAN_SLICE_CELLS = 1500;

/**
 * 传给引擎前的 id 预筛：includeTypes 含引擎不认识的 id 会让 getBlocks 整批抛错，
 * 并被误报成"区块没加载"；非法 id 点名记日志并剔除，合法 id 照常扫描。
 * @returns 合法 id 列表；全数非法时返回空数组（调用方按采集失败中止）
 */
function screenTypes(ids: readonly string[]): { valid: string[]; illegal: string[] } {
  const illegal = ids.filter((id) => !KNOWN_BLOCK_TYPES.has(id));
  if (illegal.length > 0)
    console.warn(`[mockplayer3] 扫描白名单含非法方块 id（getBlocks 会整批拒绝，已剔除）：${illegal.join(", ")}`);
  return { valid: ids.filter((id) => KNOWN_BLOCK_TYPES.has(id)), illegal };
}

/** 扫描区域 → 切片计划（y 升序；每层一片，宽×深超预算时沿 z 再切成多片） */
function slicePlan(min: Vec3, max: Vec3): RegionRect[] {
  const out: RegionRect[] = [];
  const width = max.x - min.x + 1;
  const rows = Math.max(1, Math.floor(SCAN_SLICE_CELLS / width));
  for (let y = min.y; y <= max.y; y++) {
    for (let z = min.z; z <= max.z; z += rows) {
      out.push({ min: { x: min.x, y, z }, max: { x: max.x, y, z: Math.min(max.z, z + rows - 1) } });
    }
  }
  return out;
}

/** 取整格键（水面集合与读块缓存共用这一种键式，其他地方不得另造格式） */
function cellKey(p: Vec3): string {
  return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
}

/** 单格观测读取器（组装缓存与出池前再校验共用的最小观测接口） */
export type CellRead = (p: Vec3) => SupportProbe | undefined;

/**
 * 世界观测注入接口：单测/仿真传入体素世界，生产缺省传入真实维度。
 * 本接口只提供世界读块，几何与判据全在 domain，不在此判断。
 */
export interface WorldProbe {
  /** 该区域内命中 includeTypes 的全部格（切片排定由扫描器负责） */
  cells(box: RegionRect, includeTypes: readonly string[]): Vec3[];
  /** 单格观测（undefined=读不到——未加载/越界，调用方保守视为无效） */
  read: CellRead;
}

/** 真实维度探针（一片一次 getBlocks ＋ 单格 getBlock；越界/瞬态=读不到）
 * @param allowUnloaded getBlocks 第三参：true=只查已加载区块内的格、未加载部分静默跳过
 *   （资源采集用，未加载边缘不该让整轮作废）；false=命中未加载即抛（钓点用，按失败重试）
 */
function dimensionProbe(dim: Dimension | undefined, allowUnloaded = false): WorldProbe {
  return {
    cells: (box, types) => {
      if (!dim) return [];
      const found = dim.getBlocks(new BlockVolume(box.min, box.max), { includeTypes: [...types] }, allowUnloaded);
      const out: Vec3[] = [];
      for (const loc of found.getBlockLocationIterator()) out.push({ x: loc.x, y: loc.y, z: loc.z });
      return out;
    },
    read: (p) => {
      if (!dim) return undefined;
      const info = readBlockIn(dim, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
      return info === undefined ? undefined : toProbe(info);
    },
  };
}

/** 逐 tick 分帧的区域扫描器（一次实例=一轮扫描；全部工作由 step 逐 tick 推进，done 是纯谓词） */
export class RegionScanner {
  private readonly dimId: string;
  private readonly probe: WorldProbe;
  /** 世界是否可达（维度解析失败且未注入探针＝采集失败，不是"附近没有水"） */
  private readonly usable: boolean;
  private readonly min: Vec3;
  private readonly max: Vec3;
  private readonly includeTypes: readonly string[];
  /** true=命中格需正上方精确空气（水面判据）；false=直接返回全部命中格（通用采集用：
   *  原木顶格常被树冠盖住，按顶格筛会整批误删；列内最高由调用方 domain 组装） */
  private readonly requireAirAbove: boolean;
  private readonly slices: RegionRect[];
  /** 下一个待采集切片（等于 slices.length 即采集阶段结束） */
  private sliceIdx = 0;
  /** 水面筛的中间结果：列键 → 该列当前最高水格（切片自低向高推进，后写入的更高） */
  private readonly columnTop = new Map<number, Vec3>();
  /** 列顶清单（全部切片采集完后生成，交付时逐格直读正上方筛水面） */
  private tops: Vec3[] | undefined;
  private topIdx = 0;
  /** requireAirAbove=false 时的直返队列 */
  private readonly hits: Vec3[] = [];
  private cursor = 0;
  /** 已交付命中数（内存只保留列顶表这一不变量，供仿真断言核对） */
  private delivered = 0;
  /** 采集是否可信：false=切片 getBlocks 异常——空命中不等于"没有水" */
  private collectedOk = true;
  /** 采集失败短原因（供播报玩家）：区块未加载/查询出错/白名单非法/维度不可得分开归因，
   *  播报须能指出属于哪一条 */
  private failShort = "";

  constructor(
    dimId: string,
    rect: RegionRect,
    includeTypes: readonly string[],
    opts: { requireAirAbove?: boolean; allowUnloaded?: boolean; probe?: WorldProbe } = {}
  ) {
    const dim = opts.probe ? undefined : dimensionOf(dimId);
    this.dimId = dimId;
    this.usable = opts.probe !== undefined || dim !== undefined;
    this.probe = opts.probe ?? dimensionProbe(dim, opts.allowUnloaded ?? false);
    this.min = { x: Math.floor(rect.min.x), y: Math.floor(rect.min.y), z: Math.floor(rect.min.z) };
    this.max = { x: Math.floor(rect.max.x), y: Math.floor(rect.max.y), z: Math.floor(rect.max.z) };
    const screened = opts.probe ? { valid: [...includeTypes], illegal: [] } : screenTypes(includeTypes);
    this.includeTypes = screened.valid;
    this.requireAirAbove = opts.requireAirAbove ?? true;
    this.slices = slicePlan(this.min, this.max);
    // 合法 id 被剔完＝没有任何可查询的方块类型（空 includeTypes 会返回区域内全部方块），当场判采集失败
    if (this.includeTypes.length === 0)
      this.abandon(
        "扫描白名单含非法方块 id",
        `白名单全数不在方块真值表：${screened.illegal.join(", ") || "（传入空表）"}`
      );
  }

  /** 实际扫描区域（构造期取整——钓鱼区覆盖范围据此建立，判据与扫描范围一致） */
  get rect(): RegionRect {
    return { min: this.min, max: this.max };
  }

  /** 采集＋交付是否全部结束（纯谓词：所有工作只在 step 里发生，读 done 不影响帧耗时） */
  get done(): boolean {
    if (this.sliceIdx < this.slices.length) return false;
    if (!this.requireAirAbove) return this.cursor >= this.hits.length;
    return this.topIdx >= (this.tops?.length ?? 0);
  }

  /** 采集结论（done 后读）：false=本轮切片异常，0 水面不可解读为"附近没有水" */
  get ok(): boolean {
    return this.collectedOk;
  }

  /** 采集失败短原因（ok=true 时为 ""；供播报点名是区块未加载还是查询出错） */
  get failReason(): string {
    return this.failShort;
  }

  /** 取出 ≤budget 个命中（本 tick 至多推进一个采集切片） */
  step(budget: number): Vec3[] {
    this.collectSlice();
    const out = this.requireAirAbove ? this.deliverSurface(budget) : this.hits.slice(this.cursor, this.cursor + budget);
    if (!this.requireAirAbove) this.cursor += out.length;
    this.delivered += out.length;
    return out;
  }

  /** 采集切片清单（单测/诊断：每片体积 ≤ SCAN_SLICE_CELLS，绝不一次查询整个区域） */
  get plan(): readonly RegionRect[] {
    return this.slices;
  }

  /** 已交付命中数（仿真核对：等于调用方攒下的水面数——不丢失、不重复交付） */
  get deliveredCount(): number {
    return this.delivered;
  }

  /**
   * 扫描所需总 tick 数：一片占一帧，水面筛另按读块预算分摊——扫描时长是设计量。
   * @remarks 分摊数按列顶数量计算，须在采集结束后读（此前列顶数还会增加）；
   *  调用方每 tick 调一次 step 直到 done，实际帧数天然等于本值。
   */
  scanTicks(budget: number): number {
    const slices = this.slices.length;
    if (!this.requireAirAbove) return slices;
    // 最后一片完成的当帧即开始水面筛（tops 就在这一刻生成），故分摊帧数比 ceil 少一帧
    return slices + Math.max(0, Math.ceil(this.columnTop.size / Math.max(1, budget)) - 1);
  }

  reset(): void {
    this.sliceIdx = 0;
    this.columnTop.clear();
    this.tops = undefined;
    this.topIdx = 0;
    this.hits.length = 0;
    this.cursor = 0;
    this.delivered = 0;
    this.collectedOk = true;
    this.failShort = "";
  }

  // ─── 私有 ──

  /** 采集阶段：本 tick 至多查询一片，命中当场并入列顶表 */
  private collectSlice(): void {
    if (!this.usable) {
      this.abandon("维度不可得", `维度 ${this.dimId} 解析失败`);
      return;
    }
    if (this.sliceIdx >= this.slices.length) return;
    const t0 = Date.now();
    const slice = this.slices[this.sliceIdx]!; // sliceIdx 越界已由上一行挡下
    this.sliceIdx++;
    let cells = 0;
    try {
      for (const loc of this.probe.cells(slice, this.includeTypes)) {
        cells++;
        if (!this.requireAirAbove) {
          this.hits.push({ x: loc.x, y: loc.y, z: loc.z });
          continue;
        }
        // 列内只保留最高格：满足水面判据的候选必然是列顶（纯算术比较，无需探块；
        // 空气判定留到交付时按格直读正上方，与出池前再校验同一观测源）
        const key = coordKey(loc.x, 0, loc.z);
        const cur = this.columnTop.get(key);
        if (cur === undefined || loc.y > cur.y) this.columnTop.set(key, { x: loc.x, y: loc.y, z: loc.z });
      }
    } catch (e: any) {
      // getBlocks allowUnloadedChunks 缺省 false：扫描区域覆盖到未加载区块即抛
      // UnloadedChunksError（d.ts 25602）——瞬态世界状态，与含非法 id 导致的
      // 整批拒绝分开归因。
      const unloaded = e instanceof UnloadedChunksError;
      this.abandon(
        unloaded ? "区块未加载" : "扫描查询出错",
        `切片 [${slice.min.x},${slice.min.y},${slice.min.z}]~[${slice.max.x},${slice.max.y},${slice.max.z}] ${
          unloaded ? "超出已加载区块（UnloadedChunksError）" : "查询抛"
        }：${e?.message ?? e}`
      );
      return;
    }
    if (this.requireAirAbove && this.sliceIdx >= this.slices.length) this.tops = [...this.columnTop.values()];
    const ms = Date.now() - t0;
    if (ms > SLOW_OP_MS)
      console.warn(
        `[mockplayer3] 慢操作：区域切片采集 ${ms}ms（本片命中 ${cells}，累计 ${this.requireAirAbove ? this.columnTop.size : this.hits.length}）`
      );
  }

  /**
   * 交付阶段：列顶 → 水面（要求正上方精确空气，cave_air 不算）。
   * budget 是读块预算：每个列顶一次单格读，未通过的格同样占用预算；1089 列顶约 4 tick 摊完。
   */
  private deliverSurface(budget: number): Vec3[] {
    const tops = this.tops;
    if (tops === undefined) return [];
    const out: Vec3[] = [];
    const t0 = Date.now();
    let reads = 0;
    while (reads < budget && this.topIdx < tops.length) {
      const cell = tops[this.topIdx]!; // 越界由循环条件挡下
      this.topIdx++;
      reads++;
      if (this.probe.read({ x: cell.x, y: cell.y + 1, z: cell.z })?.id === "minecraft:air") out.push(cell);
    }
    const ms = Date.now() - t0;
    if (ms > SLOW_OP_MS) console.warn(`[mockplayer3] 慢操作：水面筛 ${ms}ms（本步读 ${reads} 个列顶）`);
    return out;
  }

  /** 采集中止：标记不可信并清理状态（未加载区块等异常——空命中不得当成"没有资源"） */
  private abandon(short: string, detail: string): void {
    console.warn(`[mockplayer3] 区域扫描中止（标记采集失败）：${detail}`);
    this.collectedOk = false;
    this.failShort = short;
    this.sliceIdx = this.slices.length;
    this.tops = [];
    this.topIdx = 0;
    this.hits.length = 0; // 异常轮次的部分命中一并作废（ok=false＝调用方整轮丢弃）
    this.cursor = 0;
  }
}

/** 钓点组装服务 */
export class SpotScanner {
  /**
   * 全水域钓点组装（水面格 → 站位候选 → 排序）；几何与判据唯一真源在 domain/composeStandCandidates。
   * 本方法只提供观测：一份读块缓存（每格至多读一次）＋水面集合（邻水判定无需额外探块）；
   * 不查询实体，占用留到认领时由 checkStand 检查；候选出池前一律再过一遍 auditStand（此时缓存已充满）。
   * @param waterCells RegionScanner 产出的水面格（已筛正上方空气，不再重复此筛）
   * @param center 排序参照中心（一般是假人位置）
   * @param maxStands 站位复核预算：组装须在单 tick 内跑完，大水体不封顶会造成单帧卡顿
   * @param maxStandDist 站位距 center 的水平上限：必须在本层筛——排序先星级后距离，
   *   开放水面离岸越远星级越高（不筛就会被池容量上限挤掉全部近岸站位）；
   *   传认领半径 FISH_PICK_MAX_DIST 即与 PICK 同一判据
   * @param probe 世界观测注入（仿真/单测；缺省真实维度）
   */
  composeSpots(
    dimId: string,
    waterCells: Vec3[],
    center: Vec3,
    maxStands = FISH_COMPOSE_MAX_STANDS,
    maxStandDist?: number,
    probe?: WorldProbe
  ): SpotCandidate[] {
    const read = worldRead(dimId, probe);
    if (!read) return [];
    const t0 = Date.now();
    const surface = new Set<string>();
    for (const cell of waterCells) surface.add(cellKey(cell));
    // 组装与出池前再校验共用读块缓存：同一格至多读一次世界（读不到也记为 undefined 存进缓存）
    const memo = new Map<string, SupportProbe | undefined>();
    const block = (p: Vec3): SupportProbe | undefined => {
      const key = cellKey(p);
      if (memo.has(key)) return memo.get(key);
      const found = surface.has(key) ? { id: "minecraft:water", air: false, liquid: true } : read(p);
      memo.set(key, found);
      return found;
    };
    const composed = composeStandCandidates(
      waterCells,
      center,
      { isAir: (p) => block(p)?.id === "minecraft:air", support: (p) => block(p) },
      (p) => surface.has(cellKey(p)),
      maxStands,
      maxStandDist
    );
    const spots: SpotCandidate[] = [];
    let sample: string | undefined;
    for (const s of composed) {
      const audit = auditStand(s.stand, { block });
      if (audit.verdict === "ok") {
        spots.push(s);
        continue;
      }
      if (sample === undefined) sample = standAuditLabel(audit);
    }
    const dropped = composed.length - spots.length;
    if (dropped > 0)
      console.warn(
        `[mockplayer3] 钓点组装自证：${composed.length} 个候选经现场判据复核仅 ${spots.length} 个成立（剔除 ${dropped}，样例原因：${sample}）`
      );
    const ms = Date.now() - t0;
    if (ms > SLOW_OP_MS)
      console.warn(`[mockplayer3] 慢操作：钓点组装 ${ms}ms（水面 ${waterCells.length}，产出 ${spots.length}）`);
    return spots;
  }

  /**
   * 轻量抽查（约 11 次读块，成本远低于全量扫描）：指定站位是否可钓。
   * 站位判据即 auditStand（与组装末段出池前再校验同一次读），通过后叠加实体占用检查。
   */
  checkStand(dimId: string, stand: Vec3, excludeEntityId: string): StandCheck {
    const dim = dimensionOf(dimId);
    if (!dim)
      return { verdict: "unreadable", audit: { verdict: "unreadable", reason: "support-unreadable", waters: 0 } };
    const audit = standAudit(dimensionProbe(dim).read, stand);
    if (audit.verdict !== "ok") return { verdict: audit.verdict, audit };
    if (this.isOccupied(dim, floorCell(stand), excludeEntityId)) return { verdict: "occupied", audit };
    return { verdict: "ok", audit };
  }

  /**
   * 站位判据直读审计（不含实体占用；组装出池前再校验与认领时复查都走本方法）。
   * 支撑=站位下方一格；相邻水面按 SUPPORT_LEVEL_OFFSETS 两种布局检查，先查支撑层
   * （水面与岸齐平），查不到再下探一层（岸顶高出水面 1 格）——组装与复查的判据必须完全一致。
   * @param probe 世界观测注入（仿真/单测；缺省真实维度）
   */
  auditStand(dimId: string, stand: Vec3, probe?: WorldProbe): StandAudit {
    const read = worldRead(dimId, probe);
    if (read === undefined) return { verdict: "unreadable", reason: "support-unreadable", waters: 0 };
    return standAudit(read, stand);
  }

  // ─── 私有 ──

  /** 站位占用（半径 1 内任何实体都算——除查询者本体与鱼钩；实体不可读时保守判占用） */
  private isOccupied(dim: Dimension, cell: Vec3, excludeEntityId: string): boolean {
    try {
      const loc = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
      for (const e of dim.getEntities({ location: loc, maxDistance: SPOT_OCCUPY_RADIUS })) {
        try {
          if (e.id === excludeEntityId) continue;
          if (e.typeId === "minecraft:fishing_hook") continue;
          return true;
        } catch {
          return true; // 单实体瞬态——保守占用
        }
      }
      return false;
    } catch {
      return true;
    }
  }
}

function toProbe(info: { id: string; air: boolean; liquid: boolean }): SupportProbe {
  return { id: info.id, air: info.air, liquid: info.liquid };
}

/**
 * 单格世界观测（生产=真实维度、仿真=注入体素世界）。
 * 组装、出池前再校验、认领时复查三路都从这里取观测，判据没有分叉的可能。
 */
function worldRead(dimId: string, probe?: WorldProbe): CellRead | undefined {
  if (probe) return probe.read;
  const dim = dimensionOf(dimId);
  return dim === undefined ? undefined : dimensionProbe(dim).read;
}

/**
 * 站位判据的观测接入口——判据逻辑整体在 domain/auditStand（支撑/站位/头顶三读 +
 * 邻水环查 + 定案归因）；组装出池前再校验与认领时复查即同一函数。
 */
function standAudit(read: CellRead, stand: Vec3): StandAudit {
  return auditStand(stand, { block: read });
}

/** 站位格取整（面板/导航可传中心坐标，判据一律按方块格） */
function floorCell(stand: Vec3): Vec3 {
  return { x: Math.floor(stand.x), y: Math.floor(stand.y), z: Math.floor(stand.z) };
}

/** 进程级单例 */
export const spotScanner = new SpotScanner();
