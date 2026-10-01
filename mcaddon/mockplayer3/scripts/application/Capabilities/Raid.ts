// ─── 劫掠能力 ──────────────────────────────────────────────────────
// 袭击之兆直接 buff 覆盖：开张过三道闸门（难度非和平/有瓶/有村庄）即扣一瓶进持续相位，
// 期间每 RAID_OMEN_GRANT_INTERVAL_TICKS 施一次短时效兆头不断档；此后每次胜利再扣一瓶，
// 扣不动或闸门失效即清兆头落空闲，原因回传主人。
// 开张不播报：能否引发袭击、能否打赢都不由本能力决定（假人须在场挂机、袭击生物需由
// 假人击杀），故游戏内唯一一条劫掠消息是胜利本身；开张只留 console 事实。
// 胜场持久化在 BotRecord.raidVictories；劫掠状态挂 Runtime.raidState（botId 键控，
// 切模式/下线不清、仅删假人清）；effectAdd 事件仅用于识别村庄英雄（胜利信号）。
// F-18：tick 同步短小，施加/扣瓶各一次原子调用，等待唯一经 nextWakeAt；实体瞬态只跳过本拍。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { BotRecord } from "../../domain/Record";
import type { Session } from "../../domain/Session";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import {
  classifyRaidEffect,
  diagnoseRaidGate,
  heroOwnerOfflineNotice,
  heroTransferredNotice,
  HERO_GRANT_FAILED_MESSAGE,
  NO_BOTTLE_MESSAGE,
  RAID_OMEN_GRANT_INTERVAL_TICKS,
  raidVictoryReport,
  mergeVillageHero,
} from "../../domain/RaidRules";
import type { EffectInfo, HeroTransfer, RaidVictoryFee } from "../../domain/RaidRules";
import type { BotEventBus } from "../Events";
import type { Runtime } from "../Runtime";
import type { SaveGate } from "../../engine/SaveGate";
import {
  botAlive,
  botVillageHero,
  clearRaidOmens,
  countBottles,
  grantRaidOmen,
  grantVillageHero,
  notifyOwner,
  notifyOwnerAndNearby,
  playerVillageHero,
  realPlayerOnline,
  removeBotVillageHero,
  scanVillagePresence,
  spendBottle,
  broadcastWorld,
  readDifficulty,
} from "../../engine/RaidOps";
import { mover } from "../../engine/Mover";
import { clock } from "../../engine/Clock";
import type { CapabilityHost } from "./Common";

type RaidCapPhase = "SUSTAIN";

/** 阶段通知半径（主人不限距离） */
const RAID_NOTIFY_RADIUS = 64;
/** 心跳醒距（< hands 租约 TTL 100t；租约续期与节拍判定都靠它） */
const RAID_HEARTBEAT_TICKS = 50;

/** 劫掠行为（record.workMode=raid） */
export class RaidCap implements Capability {
  readonly id = "raid" as const;

  constructor(
    private readonly runtime: Runtime,
    private readonly events: BotEventBus,
    private readonly host: CapabilityHost,
    private readonly saveGate: SaveGate
  ) {
    // 村庄英雄=胜利唯一信号（桥已限假人实体；兆头事件本能力不关心）
    events.on("botEffectAdded", (ev) => this.handleEffect(ev.botId, ev.typeId));
  }

  requires(): LeaseRequest[] {
    return [{ kind: "hands" }];
  }

  start(session: Session, now: number): string | undefined {
    if (!session.capability) return "能力上下文缺失";
    // 前置闸门开张时一次判清：不合格即拒启，Modes 把 workMode 写回 none 并回显原因；不挂低频重判
    const fail = this.tryOpen(session.botId, now);
    if (fail !== undefined) return fail;
    this.setPhase(session, 1, "SUSTAIN", now); // grantAt=now：下一拍即施首轮兆头
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap) return;
    if (this.runtime.record(session.botId) === undefined) return; // 记录已移除：停摆（管线收会话）
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    const botId = session.botId;
    const st = this.runtime.raidState(botId);
    if (!st.sustaining) {
      // 持续位丢失（重新挂载失败/切模式竞态）：回炉重开，前置不合格即 autoStop 落空闲
      this.reopen(session, now);
      return;
    }
    if (now >= st.grantAt) {
      // 实体不在场（死亡/下线瞬态）：grantAt 不推进、不施兆头、不置停，按心跳复查，回到场即到点续施
      if (!botAlive(botId)) {
        this.setPhase(session, RAID_HEARTBEAT_TICKS, "SUSTAIN", now);
        return;
      }
      st.grantAt = now + RAID_OMEN_GRANT_INTERVAL_TICKS;
      if (!grantRaidOmen(botId)) {
        const record = this.runtime.record(botId);
        console.warn(`[mockplayer3] ${record?.name ?? botId} 袭击之兆施加失败（本拍跳过）`);
      }
      // 待移除村庄英雄随本节拍（100t）低频重试：效果已不在身或移除成功即清标记
      if (st.heroRemovalPending && (botVillageHero(botId) === undefined || removeBotVillageHero(botId))) {
        st.heroRemovalPending = false;
      }
    }
    this.setPhase(session, Math.min(RAID_HEARTBEAT_TICKS, Math.max(1, st.grantAt - now)), "SUSTAIN", now);
  }

  stop(session: Session, _now: number): void {
    // 撤持续位 + 清兆头；胜场在记录上，raidState 仅删假人才清
    const st = this.runtime.raidState(session.botId);
    st.sustaining = false;
    clearRaidOmens(session.botId);
  }

  // ─── 开张（闸门 → 扣瓶 → 进持续） ──

  /**
   * 闸门 → 扣启动瓶 → 置持续。不产生退出动作：不合格只回传中文原因，
   * 由调用侧处置（start 交 Modes 拒启 / reopen 走 autoStop，均落空闲）。
   * @param botId 假人 ID
   * @param now 时钟 tick（进入持续后到点即施首轮兆头）
   * @returns 不合格原因；全过返回 undefined
   */
  private tryOpen(botId: number, now: number): string | undefined {
    const record = this.runtime.record(botId);
    if (!record) return "假人记录不存在";
    // 判序成本升序：难度/瓶数为廉价读，慢操作村庄扫描仅在两道放行后执行
    const gate = diagnoseRaidGate(readDifficulty(), countBottles(botId), () => scanVillagePresence(botId));
    if (!gate.ok) {
      console.warn(`[mockplayer3] ${record.name} 劫掠未启动：${gate.message}`);
      clearRaidOmens(botId); // 上一轮残留兆头不留挂身
      return gate.message;
    }
    // 闸门全过才收瓶费：启动扣一瓶
    if (!spendBottle(botId)) {
      console.warn(`[mockplayer3] ${record.name} 劫掠未启动：${NO_BOTTLE_MESSAGE}`);
      return NO_BOTTLE_MESSAGE; // 判定后瓶被拿走/写失败——同无瓶处置
    }
    // 残留村庄英雄挂身会断下一次胜利的 effectAdd 链，启动前先清（失败置待移除标记，心跳重试）
    const st = this.runtime.raidState(botId);
    if (botVillageHero(botId) !== undefined && !removeBotVillageHero(botId)) {
      st.heroRemovalPending = true;
      console.warn(`[mockplayer3] ${record.name} 启动前清理残留村庄英雄失败（心跳重试）`);
    }
    st.sustaining = true;
    st.grantAt = now; // 到点即施，首轮不等间隔
    // 开张不做游戏内播报：能否开袭、能否打赢都不由本能力保证，只有胜利才发消息
    const bottlesLeft = countBottles(botId);
    console.info(`[mockplayer3] ${record.name} 劫掠已开张：本瓶已扣，剩余 ${bottlesLeft} 瓶`);
    return undefined;
  }

  /** 持续位丢失自愈：重新开张，前置条件不再满足即清兆头 + 落空闲 */
  private reopen(session: Session, now: number): void {
    const botId = session.botId;
    const record = this.runtime.record(botId);
    if (!record || record.workMode !== "raid") return;
    const fail = this.tryOpen(botId, now);
    if (fail !== undefined) {
      this.haltIdle(botId, record, fail);
      return;
    }
    this.setPhase(session, 1, "SUSTAIN", now); // 重新开张同样到点即施
  }

  /** 前置不满足即停落空闲：撤持续位 + 清兆头 + autoStop——Modes 写穿 workMode=none 并向主人告知原因 */
  private haltIdle(botId: number, record: BotRecord, message: string): void {
    this.runtime.raidState(botId).sustaining = false;
    clearRaidOmens(botId);
    console.warn(`[mockplayer3] ${record.name} 劫掠停止：${message}`);
    this.host.autoStop(botId, message);
  }

  // ─── 效果事件分流（只处理村庄英雄效果） ──

  private handleEffect(botId: number, typeId: string): void {
    try {
      const record = this.runtime.record(botId);
      if (!record || record.workMode !== "raid") return;
      if (!typeId) return;
      if (classifyRaidEffect(typeId) !== "village-hero") return; // 兆头自施，事件不参与决策
      const st = this.runtime.raidState(botId);
      st.lastHeroTick = clock.now();
      clock.after(1, () => this.handleVictory(botId)); // 延迟一拍出事件回调上下文
    } catch (e: any) {
      console.warn(`[mockplayer3] 劫掠效果监听异常: ${e?.message ?? e}`);
    }
  }

  // ─── 胜利处理（累计胜场 → 扣瓶 → 英雄等级叠给主人 → 播报） ──

  private handleVictory(botId: number): void {
    try {
      const record = this.runtime.record(botId);
      if (!record) return; // 记录已删：没有可写入的对象
      const st = this.runtime.raidState(botId);
      // 胜场计数不看当前 workMode：after(1) 执行前才切模式的迟到事件照样计数并清理英雄
      if (st.handledHeroTick >= st.lastHeroTick) return; // 幂等（防 removeEffect 失败重复叠加）
      st.handledHeroTick = st.lastHeroTick;

      const alive = botAlive(botId);
      record.raidVictories += 1; // 累积胜场持久化（跨会话/重启）
      if (!this.saveGate.saveRecord(record)) console.warn(`[mockplayer3] ${record.name} 劫掠胜场落盘失败`);

      // 实体不在场只累计胜场，不读背包/不移除/不扣瓶（不在场读瓶恒 0，等下一次事件）
      if (!alive) {
        const report = raidVictoryReport(record.name, 0, record.raidVictories, undefined, "absent");
        this.notifyStatus(record, "victory", report);
        return;
      }

      // 每次胜利扣一瓶；扣瓶先于播报，报的是扣后余额
      const charged = st.sustaining ? spendBottle(botId) : false;
      const hero = botVillageHero(botId);

      // 村庄英雄一律清除（挂身不移除则下次胜利不再触发 effectAdd，整条信号链断掉），
      // 清除前先尽力叠给主人；叠失败不保留——本轮胜场已记账，英雄让位给下一轮信号
      const transfer = this.grantHeroToOwner(record, hero);
      if (!removeBotVillageHero(botId)) {
        st.heroRemovalPending = true;
        console.warn(`[mockplayer3] ${record.name} 移除村庄英雄失败（心跳重试）`);
      }
      const fee: RaidVictoryFee = charged ? "charged" : "unpaid";
      const bottlesLeft = countBottles(botId);
      const report = raidVictoryReport(record.name, bottlesLeft, record.raidVictories, hero, fee);
      this.notifyStatus(record, "victory", report);
      if (transfer === "grantFailed") notifyOwner(record.ownerKey, `[劫掠] ${HERO_GRANT_FAILED_MESSAGE}`, "warn");

      // 扣不起 = 瓶尽：清兆头停止施加并落空闲（胜场与英雄已计入并转移，本轮胜利不作废）
      if (st.sustaining && !charged) {
        this.haltIdle(botId, record, NO_BOTTLE_MESSAGE);
        return;
      }
      if (charged) st.grantAt = clock.now(); // 续上兆头，覆盖不断档
    } catch (e: any) {
      console.warn(`[mockplayer3] 劫掠胜利处理异常 bot=${botId}: ${e?.message ?? e}`);
    }
  }

  /**
   * 把假人身上的村庄英雄叠给主人：已有 → 时长相加（封顶）、等级取高。
   * 只负责转移，清除由调用侧无条件执行（英雄留着会断下次胜利的信号）。
   * @param hero 调用侧已读到的假人英雄效果（不可读 undefined）
   * @returns 转移结果，调用侧据此决定是否另发一条消息
   */
  private grantHeroToOwner(record: BotRecord, hero: EffectInfo | undefined): HeroTransfer {
    if (!hero) return "noHeroOnBot";
    const ownerName = record.ownerKey;
    if (!ownerName) return "noOwner";
    if (!realPlayerOnline(ownerName)) {
      broadcastWorld(heroOwnerOfflineNotice(record.name, ownerName));
      return "ownerOffline";
    }
    const merged = mergeVillageHero(hero, playerVillageHero(ownerName));
    if (!grantVillageHero(ownerName, merged)) {
      console.warn(`[mockplayer3] ${record.name} 村庄英雄叠加给 ${ownerName} 失败（效果写入失败）`);
      return "grantFailed";
    }
    broadcastWorld(heroTransferredNotice(record.name, ownerName, merged));
    return "transferred";
  }

  // ─── 私有小件 ──

  /**
   * 里程碑播报（胜利一次，天然不重复，无需去重）：日志 + 主人（不限距离）与
   * 附近 64 格真人去重送达；假人离场取不到站位快照时退回主人私信，消息不丢。
   * @param phase 语义标签（日志前缀用；不参与状态判定）
   */
  private notifyStatus(record: BotRecord, phase: string, detail: string): void {
    console.info(`[mockplayer3] 劫掠 ${record.name} ${phase} → ${detail}`);
    const text = `[劫掠] ${record.name} ${detail}`;
    const self = mover.snapshotOf(record.botId);
    if (!self) {
      notifyOwner(record.ownerKey, text);
      return;
    }
    // 维度取实体当下真值（record.dimensionId 是下线/设家点快照，跨维传送后播报会喊到空维）
    notifyOwnerAndNearby(record.ownerKey, self.dimensionId, self.location, RAID_NOTIFY_RADIUS, text);
  }

  private setPhase(session: Session, wakeDelay: number, name: RaidCapPhase, now: number): void {
    const cap = session.capability;
    if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
  }
}
