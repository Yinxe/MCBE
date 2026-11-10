// ─── 常加载服务（F-20） ────────────────────────────────────────────
// 命名：mpa:aux:shared（上线辅助：单名全局共享、用完即释、永不独占）/ mpa:<botId>:sc
// （单区块档，下线保活）/ mpa:<botId>:wa（工作档，作业中的漫游保活）。键含 botId 不含显示名。
// 圆形档一律走 `tickingarea add circle <x> <y> <z> <半径> <name>` 命令（2.8.0 Manager API 只有
// 矩形 from/to，凑不出圆）。半径按 v2 口径"模拟N"：4/6/8 区块（配置 auxTickingRadius），
// 默认模拟4；r=4 实测实占 49 区块列（dx²+dz²≤r² 口径）。容量上限等创建失败直接返回原因，
// 由调用方警告，不做降档回退；上下线流程本身不因常加载失败而中断。
// 双域清理：Manager 与命令共享同一注册表（同名必冲突）——卸载先 Manager 域、失败命令域兜底。
// 位置换算纯几何（floor 除 16），全程不 getBlock（F-20：早期读块污染加载）；
// 对外一律维度 id（application 层禁持 Dimension 句柄）。

import { system, world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";

/** 本模组区域前缀（孤儿清扫判据） */
export const AREA_PREFIX = "mpa:";

/** 管理员手工区域前缀（mp:chunkarea add——持久意图，不参与孤儿清扫） */
export const MANUAL_PREFIX = "mpm:";

/** 共享上线辅助区名（单名循环复用） */
export const SHARED_AUX_NAME = "mpa:aux:shared";

/** 圆形档默认半径（区块，模拟4）；tickingarea add circle 命令侧上限按 v2 实测放到 8 */
export const CIRCLE_RADIUS_CHUNKS = 4;
export const MAX_RADIUS_CHUNKS = 8;

/** 工作档重划阈值（区块）：脚位区块距中心切比雪夫距离达此值即换心 */
export const WORK_RECENTER_CHUNKS = 2;

/** 下线保活卸载节拍：2s 配套卸载 + 4s 强制兜底 */
export const KEEPALIVE_RELEASE_TICKS = 40;
export const KEEPALIVE_FORCE_RELEASE_TICKS = 80;

/** 下线宽限卸载时长（tick）——实体消失与区块卸载解耦的落盘余量 */
export const RELEASE_GRACE_TICKS = KEEPALIVE_RELEASE_TICKS;

/** 区域名可用字符（命令引号内安全：无空格/引号/控制符） */
const AREA_NAME_RE = /^[A-Za-z0-9_:;.-]+$/;

/** 维度短标（区域名组件）：已知维度用固定缩写，其余取命名空间末段净化 */
export function dimShort(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld":
      return "ow";
    case "minecraft:nether":
      return "ne";
    case "minecraft:the_end":
      return "te";
  }
  const seg = (dimId.split(":").pop() ?? dimId).replace(/[^a-z0-9_]/gi, "").toLowerCase();
  return seg.slice(0, 12) || "x";
}

/** 单区块档区域名（下线保活） */
export function singleChunkAreaName(botId: number): string {
  return `${AREA_PREFIX}${botId}:sc`;
}

/** 工作档区域名（作业中漫游保活：让脚边区块在采集期间持续加载） */
export function workAreaName(botId: number): string {
  return `${AREA_PREFIX}${botId}:wa`;
}

/** 中心点 → 单区块包围盒（块坐标；y 固定 0，区域语义按区块列） */
function singleChunkBox(center: Vector3): { from: Vector3; to: Vector3 } {
  const cx = Math.floor(center.x / 16);
  const cz = Math.floor(center.z / 16);
  return { from: { x: cx * 16, y: 0, z: cz * 16 }, to: { x: cx * 16 + 15, y: 0, z: cz * 16 + 15 } };
}

export type EnsureResult = { ok: true; name: string } | { ok: false; reason: string };

export class TickingAreaService {
  /**
   * 共享上线辅助档：圆档半径按配置（模拟4/6/8，区块）。单名全局共享——调用方（AuxQueue）
   * FIFO 串行保证同刻仅一个在场。创建失败（含容量上限）直接返回原因。
   */
  ensureAuxShared(dimId: string, center: Vector3, radiusChunks: number): EnsureResult {
    return this.createCircle(SHARED_AUX_NAME, dimId, center, radiusChunks);
  }

  /** 确保单区块档（下线保活等精细场景）——单区块即矩形 1×1，走 Manager API */
  async ensureSingleChunk(botId: number, dimId: string, center: Vector3): Promise<EnsureResult> {
    const name = singleChunkAreaName(botId);
    const dim = this.dimension(dimId);
    if (!dim) return { ok: false, reason: `维度不可用 ${dimId}` };
    try {
      if (world.tickingAreaManager.hasTickingArea(name)) return { ok: true, name };
      const box = singleChunkBox(center);
      await world.tickingAreaManager.createTickingArea(name, { dimension: dim, from: box.from, to: box.to });
      return { ok: true, name };
    } catch (e: any) {
      return { ok: false, reason: e?.message ?? String(e) };
    }
  }

  /**
   * 确保工作档（作业中漫游保活）：以当前作业中心为心，圆 r=4（半径跟扫描盒 ±16 格口径，
   * 不随配置变）。工作档名按 botId 单例——换中心即先双域清同名再重建（同名区不随
   * hasTickingArea 短路移动，故此处显式释放旧块）。创建失败直接返回原因，不降档。
   */
  ensureWorkArea(botId: number, dimId: string, center: Vector3): EnsureResult {
    const name = workAreaName(botId);
    this.release(name, dimId); // 搬迁：同名区不随 hasTickingArea 短路移动，先清一次
    return this.createCircle(name, dimId, center, CIRCLE_RADIUS_CHUNKS);
  }

  /**
   * 管理员手工常加载（mp:chunkarea add）：圆档，半径缺省模拟4、可到 8；名加 mpm: 前缀
   * （不与自动档冲突、免孤儿清扫）。
   */
  ensureManual(
    areaName: string,
    dimId: string,
    center: Vector3,
    radiusChunks: number = CIRCLE_RADIUS_CHUNKS
  ): EnsureResult {
    const name = `${MANUAL_PREFIX}${areaName}`;
    if (!AREA_NAME_RE.test(name))
      return { ok: false, reason: `区域名字符不合法（仅限字母数字与 _ : ; . -）: ${areaName}` };
    return this.createCircle(name, dimId, center, radiusChunks);
  }

  /**
   * 卸载区域（双域清理）：Manager 域尝试删除；不在 Manager 域（命令创建/
   * 崩溃残留的同名项）视为该域已净，再以命令域兜底确认。
   * @param dimId 命令域兜底的执行维度 id（区域所在维度）
   */
  release(name: string, dimId: string): boolean {
    let managerClear = false;
    try {
      if (world.tickingAreaManager.hasTickingArea(name)) {
        world.tickingAreaManager.removeTickingArea(name);
      }
      managerClear = true;
    } catch {
      // Manager 域失败 → 走命令兜底
    }
    const dim = this.dimension(dimId);
    if (managerClear) {
      // 同名可能仍存于命令域注册表（F-20 双域共享）：兜底移除，命令不可用
      // （未开作弊/早期）吞——Manager 域已净即达成主要目的
      try {
        dim?.runCommand(`tickingarea remove "${name}"`);
      } catch {
        // 忽略
      }
      return true;
    }
    try {
      dim?.runCommand(`tickingarea remove "${name}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 宽限卸载：disconnect 前申请、宽限自申请时刻起算——实体消失与区块卸载解耦，
   * 留出盘与残留交互余量。
   */
  scheduleRelease(name: string, dimId: string, delayTicks: number = RELEASE_GRACE_TICKS): void {
    system.runTimeout(
      () => {
        this.release(name, dimId);
      },
      Math.max(1, Math.floor(delayTicks))
    );
  }

  /**
   * worldLoad 孤儿清扫：本模块前缀且不属于存活集合的区域全部
   * 卸载。Manager 域枚举 + 对命令域同名兜底（release 内建）。
   * @param liveNames 存活区域名（在线会话的 aux/sc 名集合）
   * @returns 清扫数
   */
  cleanupOrphans(liveNames: ReadonlySet<string>): number {
    let removed = 0;
    const orphans: { name: string; dimId: string }[] = [];
    try {
      for (const area of world.tickingAreaManager.getAllTickingAreas()) {
        if (area.identifier.startsWith(AREA_PREFIX) && !liveNames.has(area.identifier)) {
          orphans.push({ name: area.identifier, dimId: area.dimension.id });
        }
      }
    } catch (e: any) {
      console.error(`[mockplayer3] 区域枚举失败（孤儿清扫跳过）: ${e?.message ?? e}`);
      return 0;
    }
    for (const { name, dimId } of orphans) {
      if (this.release(name, dimId)) removed++;
    }
    if (removed > 0) console.warn(`[mockplayer3] 孤儿常加载清扫 ${removed} 个`);
    return removed;
  }

  // ─── 私有 ──

  private dimension(dimId: string): Dimension | undefined {
    try {
      return world.getDimension(dimId);
    } catch {
      return undefined;
    }
  }

  /** 圆档创建（命令路径，半径 1~8 区块）；同名短路；异常先双域清一次再重试一趟，仍失败才报错 */
  private createCircle(name: string, dimId: string, center: Vector3, radiusChunks: number): EnsureResult {
    if (!Number.isInteger(radiusChunks) || radiusChunks < 1 || radiusChunks > MAX_RADIUS_CHUNKS)
      return { ok: false, reason: `常加载半径不合法（需 1~${MAX_RADIUS_CHUNKS} 区块整数）: ${radiusChunks}` };
    const dim = this.dimension(dimId);
    if (!dim) return { ok: false, reason: `维度不可用 ${dimId}` };
    const add = `tickingarea add circle ${Math.floor(center.x)} ${Math.floor(center.y)} ${Math.floor(center.z)} ${radiusChunks} "${name}"`;
    try {
      if (world.tickingAreaManager.hasTickingArea(name)) return { ok: true, name };
      dim.runCommand(add);
      return { ok: true, name };
    } catch (e: any) {
      const first = e?.message ?? String(e);
      try {
        this.release(name, dimId);
        dim.runCommand(add);
        return { ok: true, name };
      } catch (e2: any) {
        return { ok: false, reason: `${first}; ${e2?.message ?? e2}` };
      }
    }
  }
}

/** 进程级单例 */
export const tickingAreas = new TickingAreaService();
