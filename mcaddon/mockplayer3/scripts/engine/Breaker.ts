// ─── 破坏原子（定点破坏 / 射线掘进 / 沿列连破） ─────────────────
// breakAt 定点持续破坏（对准→每 tick 敲→轮询判断是否破坏成功）；bore 常驻射线掘进
// （目标恒=射线第一命中格，块间零空挡）；chain 沿列连破（破坏成功同拍换格继续挥）。
// breakBlock 不传 direction——引擎默认方向即可；液体不挡引擎射线——须把流入
// 液体判为原块已破坏，否则会越过液体继续挖目标后方的无关方块；传送后引擎
// 可能不打断挖掘——finally 必 stopBreakingBlock；视线读取失败（undefined）
// 不误判，继续原目标。

import type { Vec3 } from "../domain/Coords";
import { distance3d } from "../domain/Coords";
import type { CancelToken } from "../domain/Cancellation";
import type { RayHit } from "./Atomic";
import { blockCenterIn, botOf, botValid, rayHit, readBlockIn, sleepTicks } from "./Atomic";
import { LookDuration } from "@minecraft/server-gametest";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

/** 破坏结果（退出状态全枚举） */
export type BreakResult = "broken" | "far" | "aborted" | "offline" | "busy" | "blocked";

/** 破坏选项（决策在调用方能力，本原子只管敲与判） */
export interface BreakOptions {
  /** 3D 距离自检上限（引擎不限制距离，须显式判定） */
  maxDistance?: number;
  /** 状态轮询间隔（读块/距离有开销，不每 tick 做） */
  pollTicks?: number;
  /** 跳过对准阶段（连续同向破坏省 5t 停顿；目标方向变化时不可传） */
  skipLook?: boolean;
  /** 视线复核（自动挖掘开启）：射线目标≠原目标 → blocked，调用方先挖阻挡块 */
  requireLineOfSight?: boolean;
  /** 每块破坏前一次的工具策略钩子（换镐等）；异常不影响破坏 */
  ensureTool?: (botId: number, blockTypeId: string) => void;
  token?: CancelToken;
  /** pollTicks 粒度自定义放弃（不可破方块防护责任在调用方——原子无超时） */
  shouldStop?: () => boolean;
}

/** 常驻射线掘进选项（bore） */
export interface BoreOptions {
  /** 射线长度上限（格）：目标恒为准星射线 ≤maxDistance 的第一命中块 */
  maxDistance: number;
  /** 候选白名单（不可挖/技术方块不下手——挥空会永远破不掉） */
  isCandidate: (blockTypeId: string) => boolean;
  /**
   * 目标格切换回调（breaking 租约等互斥归调用方）：换格/开挥前调用，
   * 返回 true=该格已可挥；射线移开/无目标时回调 null（归还占用）。
   */
  onTarget: (loc: Vec3 | null) => boolean;
  /** 无目标/实体瞬态失效时的停挥重探间隔（默认 10t） */
  idleTicks?: number;
  /** 挥击节拍（tick，默认 1=引擎下限；挖掘取 2） */
  swingTicks?: number;
  /** 每格开挥前一次的工具策略钩子（换镐等，按命中格 typeId 选主手工具）；异常不影响掘进 */
  ensureTool?: (botId: number, blockTypeId: string) => void;
  /**
   * 确认破坏成功一格的回调（挖掘产物账本数据源）：目标格从"在挖"换成新格时
   * 若旧格观测已消失，带旧格开挥时观测到的方块 typeId 回调一次；异常不影响掘进。
   */
  onBroken?: (blockTypeId: string) => void;
  /** 取消令牌（能力 stop 即断；必填——常驻协程唯一退出口） */
  token: CancelToken;
}

/** 沿列连破选项（chain，资源采集专用） */
export interface ChainOptions {
  /** 起始格（能力侧已贴靠到位并复核存在的当前格；首格扭头 5t 仅此一次，换格重瞄不占时） */
  start: Vec3;
  /** 3D 距离自检上限（格，引擎不限制距离，须显式判定；出圈=far 交调用方再贴靠） */
  maxDistance: number;
  /**
   * 单格破坏进度上限（tick，默认 300）：同一格连续挥击超此仍未消失即判 "stuck" 退出。
   * maxDistance 是策略自检距，不代表引擎真的够得着（模拟玩家实际够距可能更小），也无破坏超时；
   * 缺此护栏时遇在自检距内却破不掉的格会每 tick 空挥永不返回、假人永久停摆。
   */
  cellBreakBudgetTicks?: number;
  /** 该方块类型是否仍是采集对象（同列下一格非目标 → "dead"，本列已无可挖；读不到单列 "unreadable"，不判列尽） */
  isTarget: (blockTypeId: string) => boolean;
  /** 同列下一格：给当前格，返回继续同一列的下一格（方向由调用方 digOrder 决定，本原子不关心列形状） */
  nextCell: (cur: Vec3) => Vec3;
  /**
   * 列续航上限判据（换格前调用，返回 true=本列到此为止，按 dead 收场）：
   * 安全护栏（脚下列/坑深）等需要假人当下位置的截断由调用方喂入。
   */
  limit?: (cur: Vec3, next: Vec3, bot: Vec3) => boolean;
  /**
   * breaking 逐格租约回调（互斥归属由调用方判定）：起始与每次换到列内下一格时收到当前格，
   * 返回 true=已可挥；退出时收到 null（末格由 chain 的 finally 自动归还）。
   */
  onCell: (loc: Vec3 | null) => boolean;
  /** 每成功破坏一格的附加回调（磁吸、进度统计），换到同列下一格的同一拍前调用；回调异常不拦连破 */
  onBroken: (loc: Vec3) => void;
  /** 每格开挥前一次的工具策略钩子（换镐等）；异常不影响破坏 */
  ensureTool?: (botId: number, blockTypeId: string) => void;
  /** 取消令牌（能力 stop 即断；常驻连破唯一退出口） */
  token: CancelToken;
}

/** 连破结果：状态 + 停留格 + 本轮处理格数（onBroken 已逐格调用过） */
export interface ChainOutcome {
  status: "dead" | "far" | "stuck" | "unreadable" | "nolease" | "busy" | "offline" | "aborted";
  /** dead=最后处理格；far=超距的同列下一格（或漂移后的当前格）；stuck=自检距内迟迟破不掉的当前格；unreadable=读不到的格（区块未加载）；nolease=租约被占的格；其余 null */
  cell: Vec3 | null;
  /** 本轮处理掉的格数 */
  broken: number;
}

/** 液体流入=原块已被破坏（消失判定含液体——防续挖后方无关方块） */
const LIQUID_IDS: ReadonlySet<string> = new Set([
  "minecraft:water",
  "minecraft:flowing_water",
  "minecraft:lava",
  "minecraft:flowing_lava",
]);

function isGone(id: string | undefined): boolean {
  return id === undefined || id === "" || id === "minecraft:air" || LIQUID_IDS.has(id);
}

export class Breaker {
  /** 按 botId 互斥的进行中破坏 */
  private readonly active = new Set<number>();

  /**
   * 定点持续破坏：对准（可选）→ 每 tick 敲 → 目标消失止。
   * @param loc - 方块整数格坐标（内部再 floor 兜底）
   */
  async breakAt(botId: number, loc: Vec3, opts: BreakOptions = {}): Promise<BreakResult> {
    const target = blockFloorOf(loc);
    const maxDistance = opts.maxDistance ?? 6;
    const pollTicks = opts.pollTicks ?? 5;
    if (opts.token?.cancelled || opts.shouldStop?.()) return "aborted";
    if (this.active.has(botId)) return "busy";
    let bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    this.active.add(botId);
    try {
      if (isGone(readBlockId(bot, target))) return "broken";
      // 距离判定用方块整数角点（中心 +0.5 会使各方向容差偏移 ~0.87 格）；
      // lookAt 才用引擎权威块中心
      if (distance3d(bot.location, target) > maxDistance) return "far";
      if (!opts.skipLook) {
        const center = blockCenterIn(bot.dimension, target);
        if (!center) return "aborted";
        try {
          // 必须 Continuous——Instant 约 2s 后引擎自动回正朝向，长耗时方块挖到一半视线就移开了
          bot.lookAtLocation(center, LookDuration.Continuous);
        } catch {
          /* lookAt 失败不拦破坏 */
        }
        await sleepTicks(5, opts.token);
        if (opts.token?.cancelled) return "aborted";
      }
      // 循环内不再 lookAt——视线全程稳定指向目标，射线不因转头偏移
      // 节拍：每 1t 敲一次；重活（失效/距离/消失/视线/shouldStop/工具策略）
      // 按 pollTicks 粒度做（读块/距离有开销，不每 tick 做）；token 每 tick 查
      let elapsed = 0;
      for (;;) {
        if (opts.token?.cancelled) return "aborted";
        if (elapsed % pollTicks === 0) {
          if (opts.shouldStop?.()) return "aborted";
          bot = botOf(botId);
          if (!bot || !botValid(bot)) return "offline"; // 每轮刷新（重连/重生后旧句柄失效）
          const id = readBlockId(bot, target);
          if (isGone(id)) return "broken";
          if (distance3d(bot.location, target) > maxDistance) return "far";
          if (opts.requireLineOfSight) {
            const sight = this.viewBlock(bot, maxDistance);
            if (
              sight &&
              (sight.location.x !== target.x || sight.location.y !== target.y || sight.location.z !== target.z)
            )
              return "blocked";
            // sight undefined（视线读取失败）不误判——继续挖原目标
          }
          try {
            opts.ensureTool?.(botId, id ?? "minecraft:unknown");
          } catch {
            /* 工具策略异常不影响破坏；失败按不切换处理 */
          }
        }
        try {
          bot.breakBlock(target);
        } catch {
          /* 敲击失败静默，下 tick 重试 */
        }
        await sleepTicks(1, opts.token);
        elapsed++;
      }
    } finally {
      this.active.delete(botId);
      const fresh = botOf(botId); // 取最新句柄——破坏中重连/重生后初始实体可能失效
      try {
        fresh?.stopBreakingBlock();
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 常驻射线掘进：目标恒=射线当前命中格，块碎后下一拍自然落到后方块改挥，
   * 没有破坏成功轮询造成的盲窗，块间不调 stopBreakingBlock（逐格进度独立）。
   * 首见候选格 lookAt Continuous 锚定 + 5t 扭头，此后永不重瞄；目标恒为射线
   * 第一命中块，不存在越过它去挖后方方块的情况。
   * 永不自行退出：无候选/同格被占/实体瞬态失效一律停挥短等，唯一出口=token。
   */
  async bore(botId: number, opts: BoreOptions): Promise<void> {
    const idleTicks = opts.idleTicks ?? 10;
    const swingTicks = Math.max(1, Math.floor(opts.swingTicks ?? 1));
    if (this.active.has(botId)) {
      // 与 breakAt 同一互斥域
      return;
    }
    this.active.add(botId);
    let lastLoc: Vec3 | null = null;
    let lastHitId = "";
    let held = false;
    let aimed = false;
    let toolEnsured = false;
    let lastEid: string | null = null;
    // 结算"在挖格已消失=破坏成立"：换格/丢靶/实体替换/退出四条清格路径共用同一判定
    const settleBroken = (b: SimulatedPlayer | null | undefined): void => {
      if (!b || lastLoc === null || lastHitId === "" || !isGone(readBlockId(b, lastLoc))) return;
      try {
        opts.onBroken?.(lastHitId);
      } catch {
        /* 回调异常不影响掘进 */
      }
    };
    try {
      while (!opts.token.cancelled) {
        const bot = botOf(botId);
        if (!bot || !botValid(bot)) {
          if (lastLoc !== null) {
            opts.onTarget(null);
            lastLoc = null;
            held = false;
          }
          await sleepTicks(idleTicks, opts.token);
          continue;
        }
        // 实体被替换（换实体/重生）后句柄 .id 变化，旧句柄的 lookAt 锚定失效：复位重瞄标记并回首格重锚
        if (bot.id !== lastEid) {
          lastEid = bot.id;
          aimed = false;
          if (lastLoc !== null) {
            settleBroken(bot);
            opts.onTarget(null);
          }
          lastLoc = null;
          held = false;
        }
        const hit = rayHit(bot, opts.maxDistance);
        if (!hit || !opts.isCandidate(hit.id)) {
          if (lastLoc !== null) {
            settleBroken(bot); // 破穿到空洞/水面前的最后一块也要结算（常是矿格）
            opts.onTarget(null);
            lastLoc = null;
            held = false;
          }
          await sleepTicks(idleTicks, opts.token); // 射线够着处无可挖目标——停挥，隔 idleTicks 再重探
          continue;
        }
        const loc = hit.location;
        const moved = lastLoc === null || lastLoc.x !== loc.x || lastLoc.y !== loc.y || lastLoc.z !== loc.z;
        if (moved || !held) {
          held = opts.onTarget(loc); // 换格先归还旧格再申领新格（占用归属由调用方判定）
          if (moved) {
            // 块碎后射线下一拍自然落到后方格：旧格此刻已消失=破坏成立，
            // 用旧格在挖时记下的 typeId 回调产物账（转头离开≠破坏——旧格还在就不报）
            settleBroken(bot);
            lastLoc = loc;
            toolEnsured = false; // 新格重选工具（含旧工具已坏、需从背包换候选的情形）
            if (!aimed) {
              try {
                bot.lookAtLocation(hit.center, LookDuration.Continuous);
              } catch {
                /* lookAt 失败不拦破坏 */
              }
              aimed = true;
              await sleepTicks(5, opts.token); // 首格扭头到位再开挥
              continue;
            }
          }
        }
        lastHitId = hit.id; // 本格仍在挖/刚破完——换格判定用当下观测（须在 continue 之后路径上）
        if (!held) {
          await sleepTicks(1, opts.token); // 同格租约暂被他人持有（偶发）——1t 快速重试，不打断掘进节奏
          continue;
        }
        // 换装每格只做一次（新格或首瞄后开挥拍触发）：全背包扫描选优，逐 tick 调用会拖慢掘进
        if (!toolEnsured) {
          try {
            opts.ensureTool?.(botId, hit.id);
          } catch {
            /* 工具策略异常不影响掘进；失败按不切换处理 */
          }
          toolEnsured = true;
        }
        try {
          bot.breakBlock(loc); // 按 swingTicks 节拍挥（1t 为引擎下限）
        } catch {
          /* 敲击失败静默，下拍射线重判 */
        }
        await sleepTicks(swingTicks, opts.token);
      }
    } finally {
      this.active.delete(botId);
      settleBroken(botOf(botId)); // 令牌取消时末格可能刚破未观测——退出前补一次判定
      if (lastLoc !== null || held) opts.onTarget(null); // 经回调归还末格占用，避免租约残留
      try {
        botOf(botId)?.stopBreakingBlock(); // 仅退出时收尾（掘进全程不 stop）
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 沿列连破（资源采集专用）：首格 lookAt Continuous 锚定 + 5t 扭头后开挥；
   * 破坏成功的同一拍调用 onBroken、换到同列下一格并对新格重瞄（breakBlock
   * 按坐标挥击不吃视线，重瞄纯视觉），块间无 sleep、无 stopBreakingBlock。
   * 退出=本列无可挖目标（dead）/出圈（far，调用方贴靠闭环）/读不到（unreadable，区块未加载
   * 非列尽，调用方留点复采）/格被占（nolease）/offline/aborted；finally 归还末格租约并唯一一次 stopBreakingBlock。
   */
  async chain(botId: number, opts: ChainOptions): Promise<ChainOutcome> {
    if (this.active.has(botId)) {
      // 与 breakAt/bore 同一互斥域
      return { status: "busy", cell: null, broken: 0 };
    }
    this.active.add(botId);
    let cell = blockFloorOf(opts.start);
    let broken = 0;
    const budget = Math.max(1, Math.floor(opts.cellBreakBudgetTicks ?? 300));
    let cellElapsed = 0; // 当前格已挥击 tick 数，换格归零，超 budget 判 stuck
    let toolEnsured = false; // 本格是否已换装；换格归零。ensureTool 每格开挥前跑一次全背包选优，非每 tick
    try {
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) return { status: "offline", cell: null, broken };
      if (!opts.onCell(cell)) return { status: "nolease", cell, broken };
      if (distance3d(bot.location, cell) > opts.maxDistance) return { status: "far", cell, broken };
      const center = blockCenterIn(bot.dimension, cell);
      if (center) {
        try {
          bot.lookAtLocation(center, LookDuration.Continuous);
        } catch {
          /* lookAt 失败不拦破坏 */
        }
      }
      await sleepTicks(5, opts.token); // 首格扭头到位再开挥（换格重瞄见下，不占时）
      for (;;) {
        if (opts.token.cancelled) return { status: "aborted", cell: null, broken };
        const cur = botOf(botId);
        if (!cur || !botValid(cur)) return { status: "offline", cell: null, broken };
        const id = readBlockId(cur, cell);
        if (id === undefined) {
          // 读块失败（区块未加载 / getBlock 抛）≠ 本格已被破坏：不得计 onBroken、不得推进，
          // 否则一棵只是暂时读不到的整株原木会被判"已采毕"、由调用方 spent 从共享池移除（"树也看不完"）。
          // 交调用方短期跳本会话、点位留池待区块加载后复采。
          return { status: "unreadable", cell, broken };
        }
        if (isGone(id)) {
          // 本格确认已破坏（空气/液体/空）：同一拍调用 onBroken 结算，随后立即换到同列下一格（零空挡所在）
          try {
            opts.onBroken(cell);
          } catch {
            /* 附加回调异常不拦连破 */
          }
          broken++;
          const nxt = blockFloorOf(opts.nextCell(cell));
          if (opts.limit?.(cell, nxt, cur.location)) return { status: "dead", cell, broken };
          const nid = readBlockId(cur, nxt);
          if (nid === undefined) return { status: "unreadable", cell: nxt, broken }; // 下一格读不到=区块未加载，非列尽
          if (!opts.isTarget(nid)) return { status: "dead", cell, broken };
          if (distance3d(cur.location, nxt) > opts.maxDistance) return { status: "far", cell: nxt, broken };
          if (!opts.onCell(nxt)) return { status: "nolease", cell: nxt, broken };
          const nxtCenter = blockCenterIn(cur.dimension, nxt);
          if (nxtCenter) {
            try {
              cur.lookAtLocation(nxtCenter, LookDuration.Continuous);
            } catch {
              /* lookAt 失败不拦破坏 */
            }
          }
          cell = nxt;
          cellElapsed = 0;
          toolEnsured = false;
          continue;
        }
        if (distance3d(cur.location, cell) > opts.maxDistance) return { status: "far", cell, broken };
        // 在自检距内不代表引擎真破得掉：同格迟迟不消失（疑超实际够距/实不可破）达预算即 stuck 退出，
        // 否则 breakBlock 每 tick 空挥、isGone 恒假、本协程永不 resolve → 假人永久停摆。
        if (++cellElapsed > budget) return { status: "stuck", cell, broken };
        // 换装每格只做一次：ensureTool 内部全背包扫描选优，逐 tick 调用在单格久攻不下时
        // 累计成大量读块与持物交互，低 TPS 下拖慢调度；目标格 typeId 在破尽前不变，
        // 故一次选优即覆盖本格全程。
        if (!toolEnsured) {
          try {
            opts.ensureTool?.(botId, id ?? "minecraft:unknown");
          } catch {
            /* 工具策略异常不影响破坏；失败按不切换处理 */
          }
          toolEnsured = true;
        }
        try {
          cur.breakBlock(cell);
        } catch {
          /* 敲击失败静默，下拍重试 */
        }
        await sleepTicks(1, opts.token);
      }
    } finally {
      this.active.delete(botId);
      opts.onCell(null); // 经回调归还末格占用，避免租约残留
      try {
        botOf(botId)?.stopBreakingBlock(); // 仅退出时收尾（连破全程不 stop）
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 引擎射线读准星方块（默认跳过可穿过方块；失败 undefined） */
  viewBlock(botId: number, maxDistance: number): RayHit | undefined;
  viewBlock(bot: SimulatedPlayer, maxDistance: number): RayHit | undefined;
  viewBlock(subject: SimulatedPlayer | number, maxDistance: number): RayHit | undefined {
    const bot = typeof subject === "number" ? botOf(subject) : subject;
    if (!bot || !botValid(bot)) return undefined;
    return rayHit(bot, maxDistance);
  }
}

function blockFloorOf(p: Vec3): Vec3 {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function readBlockId(bot: SimulatedPlayer, loc: Vec3): string | undefined {
  return readBlockIn(bot.dimension, loc)?.id;
}

/** 进程级单例 */
export const breaker = new Breaker();
