// ─── 采集地注册表（domain 纯结构） ──────────────────────────────
// 按 (维度, 采集对象) 键控的点池 + 扫描节流；采集点是方块列，地形天然自去重，无需覆盖盒/并区几何。
// 只保三件事：同池共享、单飞行扫描标、同域扫描节流；进程内存活（随 Runtime 同寿）。

import type { HarvestKindId, HarvestPoint } from "./HarvestRules";
import { HARVEST_GROUND_SCAN_THROTTLE_TICKS, harvestPoolKey } from "./HarvestRules";
import { SharedPool } from "./Pool";
import { ownerBotId } from "./Session";

/** 单个采集地：点池 + 域级扫描节流戳 */
interface Ground {
  readonly pool: SharedPool<HarvestPoint>;
  lastScanAt: number;
}

export class HarvestGrounds {
  private readonly grounds = new Map<string, Ground>();

  /** 取域池（惰性建——能力侧 PICK/SCAN 唯一寻址入口） */
  pool(dimId: string, kind: HarvestKindId): SharedPool<HarvestPoint> {
    return this.ground(harvestPoolKey(dimId, kind)).pool;
  }

  /** 域扫描是否到点（同 (维度,对象) 节流，防多假人同 tick 各扫一遍） */
  scanDue(
    dimId: string,
    kind: HarvestKindId,
    now: number,
    cooldownTicks = HARVEST_GROUND_SCAN_THROTTLE_TICKS
  ): boolean {
    const g = this.grounds.get(harvestPoolKey(dimId, kind));
    return !g || now - g.lastScanAt >= cooldownTicks;
  }

  markScanned(dimId: string, kind: HarvestKindId, now: number): void {
    this.ground(harvestPoolKey(dimId, kind)).lastScanAt = now;
  }

  /**
   * 假人删除时清理（挂在 botDeleted 事件上）：归还其历次会话占着的列与扫描标，
   * 顺带丢弃彻底空净的域池（防注册表膨胀）。池的归属键是会话键 `s<botId>#<seq>`，
   * 不能按 botId 字符串直取，判据经 domain/ownerBotId 解析。
   */
  forgetBot(botId: number): void {
    const notMine = (owner: string): boolean => ownerBotId(owner) !== botId;
    for (const [key, g] of [...this.grounds]) {
      g.pool.sweepClaims(notMine);
      g.pool.sweepScanToken(notMine);
      const st = g.pool.stats();
      if (st.free === 0 && st.claimed === 0 && st.blacklisted === 0) this.grounds.delete(key);
    }
  }

  /** 诊断快照（面板/日志）：池深/占用/黑名单 + 上轮扫描时刻 */
  stats(
    dimId: string,
    kind: HarvestKindId
  ): { free: number; claimed: number; blacklisted: number; lastScanAt: number } {
    const g = this.grounds.get(harvestPoolKey(dimId, kind));
    if (!g) return { free: 0, claimed: 0, blacklisted: 0, lastScanAt: 0 };
    return { ...g.pool.stats(), lastScanAt: g.lastScanAt };
  }

  private ground(key: string): Ground {
    let g = this.grounds.get(key);
    if (!g) {
      g = { pool: new SharedPool<HarvestPoint>(), lastScanAt: 0 };
      this.grounds.set(key, g);
    }
    return g;
  }
}
