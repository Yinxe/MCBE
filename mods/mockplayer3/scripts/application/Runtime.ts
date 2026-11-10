// ─── 运行时注册表（状态唯一权威所在层） ────────────────────────────
// records = 记录的进程内内存本体（写经 SaveGate 落 DP，读零成本）；sessions = 在线会话表。
// 状态判定：有会话 → session.state；无会话 → 记录派生 OFFLINE/REGISTERED。
// declaredOnline 只是重启对账声明，不是运行时权威。

import type { BotRecord } from "../domain/Record";
import type { GlobalConfig } from "../domain/Config";
import { defaultConfig } from "../domain/Config";
import type { LifecycleIntent, LifecycleState, TransitResult } from "../domain/State";
import { transit } from "../domain/State";
import { Session } from "../domain/Session";
import { FishingZones } from "../domain/FishingZone";
import { HarvestGrounds } from "../domain/HarvestGrounds";
import type { RaidFlowState } from "../domain/RaidRules";
import { createRaidFlowState } from "../domain/RaidRules";
import type { VaultFlowState } from "../domain/VaultRules";
import { createVaultFlowState } from "../domain/VaultRules";
import { singleChunkAreaName, workAreaName } from "../engine/TickingAreas";
import { clock } from "../engine/Clock";

export class Runtime {
  readonly records = new Map<number, BotRecord>();
  readonly sessions = new Map<number, Session>();
  /** 全局配置活体（装配期 loadConfig 覆盖；管理员改动就地替换） */
  config: GlobalConfig = defaultConfig();
  /** 钓鱼区注册表：钓点就近复用/16 格并区/空区消散；仅进程内存活 */
  readonly fishingZones = new FishingZones();
  /** 采集地注册表：按 (维度,对象) 键控点池 + 域级扫描节流；仅进程内存活 */
  readonly harvestGrounds = new HarvestGrounds();
  /** 劫掠会话状态按假人键控：切模式/下线不清计数与阶段，仅删假人清 */
  private readonly raidStates = new Map<number, RaidFlowState>();
  /** 宝库流程状态按假人键控：跨重连存活（开箱目标保留到重连继续），仅删假人清 */
  private readonly vaultStates = new Map<number, VaultFlowState>();
  private sessionSeq = 0;

  /** 取劫掠状态（惰性创建，仅 raid 流程进入时建） */
  raidState(botId: number): RaidFlowState {
    let s = this.raidStates.get(botId);
    if (!s) {
      s = createRaidFlowState();
      this.raidStates.set(botId, s);
    }
    return s;
  }

  forgetRaidState(botId: number): void {
    this.raidStates.delete(botId);
  }

  /** 取宝库流程状态（惰性创建，仅宝库流程进入时建） */
  vaultState(botId: number): VaultFlowState {
    let s = this.vaultStates.get(botId);
    if (!s) {
      s = createVaultFlowState();
      this.vaultStates.set(botId, s);
    }
    return s;
  }

  forgetVaultState(botId: number): void {
    this.vaultStates.delete(botId);
  }

  /**
   * 挖掘产物账本（botId → 本进程挖过的方块 id）：工作箱搬运在 mine 模式按
   * "挖过的方块→其掉落"筛背包，用户塞进背包的杂物不会被搬走。
   * 仅进程内存活；下线保留（背包物品跨下线还在），删假人清。
   */
  private readonly minedLedger = new Map<number, Set<string>>();

  recordMined(botId: number, blockTypeId: string): void {
    let set = this.minedLedger.get(botId);
    if (!set) {
      set = new Set();
      this.minedLedger.set(botId, set);
    }
    set.add(blockTypeId);
  }

  minedOf(botId: number): Iterable<string> {
    return this.minedLedger.get(botId) ?? [];
  }

  forgetMined(botId: number): void {
    this.minedLedger.delete(botId);
  }

  // ─── 记录 ──

  setRecords(list: BotRecord[]): void {
    this.records.clear();
    for (const r of list) this.records.set(r.botId, r);
  }

  record(botId: number): BotRecord | undefined {
    return this.records.get(botId);
  }

  // ─── 会话 ──

  session(botId: number): Session | undefined {
    return this.sessions.get(botId);
  }

  /** 上线管线入口：建立 SPAWNING 会话（epoch=0，SaveGate 天然挡常规写） */
  newSession(botId: number): Session {
    const session = new Session(botId, `s${botId}#${++this.sessionSeq}`, clock.now());
    session.state = "SPAWNING";
    this.sessions.set(botId, session);
    return session;
  }

  destroySession(botId: number): void {
    this.sessions.delete(botId);
  }

  sessionByEntityId(entityId: string): Session | undefined {
    for (const s of this.sessions.values()) {
      if (s.entityId === entityId) return s;
    }
    return undefined;
  }

  // ─── 状态机 ──

  /** 当前生命周期态（botId 无任何痕迹 → null=不存在） */
  stateOf(botId: number): LifecycleState | null {
    const s = this.sessions.get(botId);
    if (s) return s.state;
    const r = this.records.get(botId);
    if (!r) return null;
    if (r.declaredOnline || r.updatedAt !== r.createdAt) return "OFFLINE";
    return "REGISTERED";
  }

  /** 状态迁移（会话态就地更新；无会话时仅判定，会话建立由管线负责） */
  transitTo(botId: number, intent: LifecycleIntent): TransitResult | null {
    const state = this.stateOf(botId);
    if (state === null) return null;
    const result = transit(state, intent);
    if (!result.noop) {
      const s = this.sessions.get(botId);
      if (s) s.state = result.next;
    }
    return result;
  }

  // ─── 统计与寻址辅助 ──

  findBotIdByName(name: string): number | undefined {
    for (const r of this.records.values()) {
      if (r.name === name) return r.botId;
    }
    return undefined;
  }

  /** 该主人名下在线假人数（在线配额判定，不含本次） */
  onlineCountForOwner(ownerKey: string): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (this.records.get(s.botId)?.ownerKey === ownerKey) n++;
    }
    return n;
  }

  /** 该键名下已创建假人总数（创建配额判定，含离线） */
  createdCount(ownerKey: string): number {
    let n = 0;
    for (const r of this.records.values()) {
      if (r.ownerKey === ownerKey) n++;
    }
    return n;
  }

  /** 全服在线假人数 */
  globalOnlineCount(): number {
    return this.sessions.size;
  }

  /** 在线会话实体 id 集合（名字仲裁保护位——同名在线假人=占用，不 disconnect） */
  protectedEntityIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const s of this.sessions.values()) {
      if (s.entityId) ids.add(s.entityId);
    }
    return ids;
  }

  /** 存活区域名集合（孤儿清扫白名单；共享辅助名不在列） */
  liveAreaNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const s of this.sessions.values()) {
      names.add(singleChunkAreaName(s.botId)); // 下线保活/在途单区块档
      const st = this.stateOf(s.botId);
      if (st === "ACTIVE" || st === "WORKING") names.add(workAreaName(s.botId)); // 作业中工作保活档
    }
    return names;
  }
}
