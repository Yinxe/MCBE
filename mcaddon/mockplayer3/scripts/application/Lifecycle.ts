// ─── 生命周期管线（application，唯一编排者） ──────────────────────
// 对外意图入口：create / online / offline / reconnect / remove、三个世界事件对账
// （handle*）、startupReconcile、开关与设置直写。
// 纪律：
// - 管线经 Mailbox 按 botId 串行化，重复意图幂等合并；
// - 唯一例外 handleDeath——respawn 必须在 entityDie 回调窗口内同步完成（F-04），
//   核心段不进邮箱，后半段用 clock.after(20t) 排入；
// - 持久化经 SaveGate，实体触碰经 EntityOps/Spawner 原子（botId 寻址，跨层零句柄）；
// - 每一步失败自清现场（断开/区域释放/状态回退），绝不留半吊子会话。

import type { BotRecord, BotSwitches, HomePoint, WorkMode } from "../domain/Record";
import { createRecord } from "../domain/Record";
import type { Vec3 } from "../domain/Coords";
import type { Viewer } from "../domain/Permissions";
import { canCreate, canGoOnline, canManage, onlineQuotaFor } from "../domain/Permissions";
import { normalizeChestName } from "../domain/WorkChest";
import { UNLIMITED_QUOTA } from "../domain/Config";
import { storageUnavailableReason } from "../domain/Compat";
import { reconcileStartup, stateFlags } from "../domain/State";
import { normalizeBotName, validateBotName, playerKey } from "../domain/Identity";
import { levelFromTotalXp } from "../domain/XpMath";
import { clock } from "../engine/Clock";
import { gaze } from "../engine/Gaze";
import { entityGateway } from "../engine/EntityGateway";
import { projectileTracker } from "../engine/ProjectileTracker";
import { customDimensionFailure } from "../engine/Rig";
import { singleChunkAreaName, tickingAreas, KEEPALIVE_FORCE_RELEASE_TICKS } from "../engine/TickingAreas";
import { enqueueAux } from "../engine/AuxQueue";
import { probeWorkChest, workChests } from "../engine/WorkChests";
import type { EntityOps, ReclaimSelection } from "../engine/EntityOps";
import type { ItemVault } from "../engine/ItemVault";
import type { SaveGate } from "../engine/SaveGate";
import type { Spawner } from "../engine/Spawner";
import type { Session } from "../domain/Session";
import type { ActionResult, ReclaimOutcome } from "./types";
import type { BotEventBus, OfflineCause } from "./Events";
import type { Mailbox } from "./Mailbox";
import type { Modes } from "./Modes";
import type { Runtime } from "./Runtime";
import type { WorkTransfer } from "./WorkTransfer";

/** disconnect 后名字异步释放的等待（1s），过早重建会撞名 */
const RECONNECT_DELAY_TICKS = 20;
/** respawn() 后实体就位的等待 */
const RESPAWN_TAIL_TICKS = 20;

export class Lifecycle {
  /** 下线执行中标记（自己 disconnect 触发的 playerLeave 要忽略，避免重复下线） */
  private readonly offlineInFlight = new Set<number>();

  constructor(
    private readonly runtime: Runtime,
    private readonly saveGate: SaveGate,
    private readonly vault: ItemVault,
    private readonly ops: EntityOps,
    private readonly spawner: Spawner,
    private readonly modes: Modes,
    private readonly events: BotEventBus,
    private readonly mailbox: Mailbox,
    private readonly transfer: WorkTransfer
  ) {}

  // ─── 创建 / 删除 ──

  /** 邮箱回执归一：null=意图被替换/作废/任务抛穿，转为可展示的失败 */
  private settled(p: Promise<ActionResult | null>): Promise<ActionResult> {
    return p.then((r) => r ?? { ok: false, reason: "意图被替换或管线内部异常" });
  }

  /** 建档：不生成实体——创建即 REGISTERED，上线是独立意图 */
  create(viewer: Viewer, rawName: string, home: HomePoint, dimensionId: string): ActionResult {
    const cfg = this.runtime.config;
    const cc = canCreate(viewer, this.runtime.createdCount(viewer.key), cfg);
    if (!cc.ok) return { ok: false, reason: cc.reason };
    const regionId = this.vault.ensureRegionId();
    // 失败原因必须能照做：版本门禁结论优先，其次注册异常原文
    if (!regionId)
      return { ok: false, reason: storageUnavailableReason(customDimensionFailure(), this.vault.lastRegisterError()) };
    const botId = this.saveGate.allocateBotId();
    const { record, nameError } = createRecord({
      botId,
      rawName,
      ownerKey: viewer.key,
      home,
      dimensionId,
      regionId,
      now: Date.now(),
    });
    if (nameError) return { ok: false, reason: nameError };
    // 创建即开自动重生（记录级开关 mp:respawn 可关）
    record.switches.autoRespawn = true;
    if (this.runtime.records.has(botId)) return { ok: false, reason: "身份计数器异常（botId 已有记录）" };
    if (this.saveGate.lookupBotId(record.name) !== undefined)
      return { ok: false, reason: `名字 ${record.name} 已被占用` };
    this.saveGate.claimName(record.name, botId);
    if (!this.saveGate.saveRecord(record)) {
      this.saveGate.releaseName(record.name);
      return { ok: false, reason: "记录写入失败" };
    }
    this.runtime.records.set(botId, record);
    return { ok: true, botId, name: record.name };
  }

  /** 删除：在线先走下线管线，再"先取物后删仓最后删键" */
  remove(viewer: Viewer, botId: number): Promise<ActionResult> {
    const record = this.runtime.record(botId);
    if (!record) return Promise.resolve({ ok: false, reason: "假人不存在" });
    if (!canManage(viewer, record, this.runtime.config)) {
      return Promise.resolve({ ok: false, reason: "只有主人或管理员可删除该假人" });
    }
    return this.settled(
      this.mailbox.post(botId, "delete", async () => {
        if (this.runtime.session(botId)) await this.doOffline(botId, "command", viewer.key);
        return this.doDelete(viewer, botId);
      })
    );
  }

  private doDelete(viewer: Viewer, botId: number): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    // 仓内物品+经验交付操作者（takeAll 同时删绑定表——唯一槽位释放路径）；
    // 成功私信"回收自"明细，失败仅私信不阻断删除
    try {
      const r = this.ops.deliverVaultToPlayer(viewer.key, botId, record.experience.totalXp);
      const parts: string[] = [];
      if (r.items > 0) parts.push(`${r.items} 件物品`);
      if (r.overflow > 0) parts.push(`${r.overflow} 件溢出掉落`);
      if (r.xp > 0) parts.push(`${r.xp} XP（Lv.${levelFromTotalXp(r.xp).level}）`);
      if (parts.length > 0) this.ops.notifyPlayer(viewer.key, `§7回收自 §e${record.name}§7: ${parts.join("、")}`);
    } catch (e) {
      this.ops.notifyPlayer(
        viewer.key,
        `§c回收 ${record.name} 物品时出错: ${e instanceof Error ? e.message : String(e)}`,
        "error"
      );
    }
    this.saveGate.deleteRecord(botId);
    this.saveGate.releaseName(record.name);
    // 区域立即释放（删除是确定意图，不留宽限；共享辅助名由队列自管不在此列）
    tickingAreas.release(singleChunkAreaName(botId), record.dimensionId);
    this.runtime.records.delete(botId);
    this.mailbox.forget(botId);
    console.warn(`[mockplayer3] 已删除 ${record.name}（操作者=${viewer.key}）`);
    this.events.emit("botDeleted", { botId, name: record.name });
    return { ok: true };
  }

  // ─── 上线管线 ──

  /** 上线管线。systemFlow=系统代投：免主人权限门、配额按主人键判定 */
  online(viewer: Viewer, botId: number, systemFlow = false): Promise<ActionResult> {
    return this.settled(this.mailbox.post(botId, "online", () => this.doOnline(viewer, botId, systemFlow)));
  }

  private async doOnline(viewer: Viewer, botId: number, systemFlow: boolean): Promise<ActionResult> {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!systemFlow && !canManage(viewer, record, this.runtime.config)) {
      return { ok: false, reason: "只有主人或管理员可操作该假人" };
    }
    // 0. 前置：状态机裁决（在途态幂等回执）
    const state = this.runtime.stateOf(botId);
    if (state === "ACTIVE" || state === "WORKING") return { ok: true };
    if (state === "SPAWNING" || state === "RESTORING" || state === "DYING") {
      return { ok: false, reason: "上线/死亡处理进行中" };
    }
    const t = this.runtime.transitTo(botId, "online");
    if (!t || t.noop) return { ok: false, reason: `当前状态不可上线（${state ?? "?"}）` };
    // 1. 在线配额
    const quota = canGoOnline(viewer, this.runtime.onlineCountForOwner(viewer.key), this.runtime.config);
    if (!quota.ok) {
      console.warn(`[mockplayer3] 上线失败 ${record.name}: ${quota.reason}`);
      return { ok: false, reason: quota.reason };
    }

    const session = this.runtime.newSession(botId); // SPAWNING，epoch=0
    const areaDimId = record.dimensionId;

    // 2. 名字仲裁：清幽灵+等释放，必须在生成前完成
    const arb = await this.spawner.arbitrateName(record.name, this.runtime.protectedEntityIds());
    if (!arb.ok) {
      this.abortOnline(botId, session, arb.reason);
      return { ok: false, reason: arb.reason };
    }
    // 3. 常加载不参与上线：共享辅助队列改在上线完成后步骤 10 异步入队
    if (!this.pipelined(session)) {
      this.abortOnline(botId, session, "上线被更高优先级事件接管");
      return { ok: false, reason: "上线被更高优先级事件接管" };
    }
    // 4/5. 装置生成 + 验名（引擎加 "(N)" 即销毁重试，绝不留幽灵）
    const out = await this.spawner.spawn({
      botId,
      name: record.name,
      position: record.home.position,
      dimensionId: areaDimId,
      yaw: record.home.yaw,
      pitch: record.home.pitch,
      protectedEntityIds: this.runtime.protectedEntityIds(),
    });
    if (!out.ok) {
      this.abortOnline(botId, session, out.reason);
      return { ok: false, reason: out.reason };
    }
    if (this.runtime.session(botId) !== session) {
      // 死亡接管：实体已归死亡管线，此处只让路不拆台
      console.warn(`[mockplayer3] 上线让位 ${record.name}: 上线期间发生死亡，交由死亡管线`);
      return { ok: false, reason: "上线期间发生死亡，交由死亡管线" };
    }
    // 6. 会话建立（entityId 登记 → RESTORING）
    session.entityId = out.entityId;
    this.runtime.transitTo(botId, "spawned");
    // 7. 物品恢复 + 指纹对账 + 状态回放
    const imp = this.ops.importItems(botId);
    if (!imp.ok) {
      this.abortOnline(botId, session, `物品恢复失败: ${imp.reason}`);
      return { ok: false, reason: imp.reason };
    }
    if (session.state !== "RESTORING") {
      console.warn(`[mockplayer3] 上线让位 ${record.name}: 上线期间状态被接管`);
      return { ok: false, reason: "上线期间状态被接管" };
    }
    this.ops.applyTags(botId, record.tags);
    this.ops.restoreExperience(botId, record.experience);
    this.ops.applyEffects(botId, record.effects);
    const rp = record.respawnPoint ?? {
      position: record.home.position,
      yaw: record.home.yaw,
      pitch: record.home.pitch,
      dimensionId: areaDimId,
    };
    this.ops.setSpawnPoint(botId, rp.position, rp.dimensionId);
    this.ops.setSneaking(botId, record.switches.sneaking);
    // 8. epoch 提交（此后 SaveGate 放行常规写；声明在线与清死亡标注同笔落）
    session.epoch = 1;
    this.runtime.transitTo(botId, "restored"); // ACTIVE
    record.declaredOnline = true;
    record.deathMark = false;
    this.saveGate.saveRecord(record);
    // 9. 模式重新挂载 + 回执（成功播报归调用方；此处只在模式恢复失败时提醒发起者，防静默降级）
    const attach = this.modes.attachAfterRestore(botId, clock.now());
    // 有界视线校正：生成窗引擎锁视角，settle 每 4t 拉回身体朝向，对准/超时/实体失效即止
    gaze.startSettle(botId);
    this.events.emit("botOnline", { botId, name: record.name, ownerKey: record.ownerKey });
    if (!attach.ok)
      this.ops.notifyPlayer(
        viewer.key,
        `假人 ${record.name} 已上线，但模式恢复失败（${attach.reason}），已回到空闲`,
        "warn"
      );
    // 10. 共享辅助常加载入队（非阻塞、用完即释、宝库模式豁免；半径取配置 auxTickingRadius，
    // 0=关闭；位置取实体现点——读不到即跳过）
    const auxRadius = this.runtime.config.auxTickingRadius;
    if (record.workMode !== "vault" && auxRadius > 0) {
      const live = this.ops.readPose(botId);
      if (live)
        enqueueAux({
          botId,
          botName: record.name,
          ownerKey: record.ownerKey,
          location: live.position,
          dimensionId: live.dimensionId,
          radius: auxRadius,
        });
    }
    console.warn(
      `[mockplayer3] 上线完成 ${record.name}（维度=${areaDimId} 模式=${record.workMode} @ ${Math.floor(record.home.position.x)},${Math.floor(record.home.position.y)},${Math.floor(record.home.position.z)})`
    );
    return { ok: true };
  }

  /** 上线管线是否仍持有裁决权（会话未被死亡/异常接管） */
  private pipelined(session: Session): boolean {
    return (
      this.runtime.session(session.botId) === session && (session.state === "SPAWNING" || session.state === "RESTORING")
    );
  }

  /** 上线半途失败的唯一清场路径（幂等：无实体不动 disconnect；常加载不再参与上线，无区域可清） */
  private abortOnline(botId: number, session: Session, reason: string): void {
    const record = this.runtime.record(botId);
    console.warn(`[mockplayer3] 上线失败 ${record?.name ?? botId}: ${reason}`);
    this.modes.stopCurrent(session, clock.now());
    if (session.entityId) this.ops.disconnect(botId, session.entityId);
    this.runtime.transitTo(botId, "abortSpawn");
    this.runtime.destroySession(botId);
    this.saveGate.forgetSession(botId);
    if (record) {
      record.declaredOnline = false;
      this.saveGate.saveRecord(record);
    }
  }

  // ─── 下线管线 ──

  offline(botId: number, cause: OfflineCause = "command", notifyKey?: string): Promise<ActionResult> {
    return this.settled(this.mailbox.post(botId, "offline", async () => await this.doOffline(botId, cause, notifyKey)));
  }

  /** 下线核心（邮箱任务体串行执行；await 仅在下线保活申请一处；步骤序即注释序） */
  private async doOffline(botId: number, cause: OfflineCause, notifyKey?: string): Promise<ActionResult> {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    const session = this.runtime.session(botId);
    if (!session) {
      // 幂等成功 + 声明归一（重启后声明残留的收敛点）
      if (record.declaredOnline) {
        record.declaredOnline = false;
        this.saveGate.saveRecord(record);
      }
      return { ok: true };
    }
    this.offlineInFlight.add(botId);
    const now = clock.now();
    // 1. 冻结撤能力（租约必撤，能力 stop 幂等）；工作箱搬运同步冻结——
    // 必须先于物品导出，否则"导出后又搬进箱"会造成仓与箱各一份
    this.modes.stopCurrent(session, now);
    this.transfer.suspend(botId);
    // 2. 导出"有什么存什么"（姿态→home、物品→仓、经验/效果→记录字段）
    const pose = this.ops.readPose(botId);
    if (pose) {
      record.home = { position: pose.position, yaw: pose.yaw, pitch: pose.pitch };
      record.dimensionId = pose.dimensionId;
      record.switches.sneaking = pose.sneaking; // 下线回读实体潜行真值入库，声明位可能滞后
    }
    this.ops.exportItems(botId);
    const exp = this.ops.captureExperience(botId);
    if (exp) record.experience = exp;
    record.effects = this.ops.captureEffects(botId);
    const wasDying = session.state === "DYING";
    // 3. 关键点全量写——必须先于 disconnect（F-26 的时序封堵）
    this.saveGate.checkpoint(session, record, "offline");
    // 4. 下线保活 + 宽限卸载（disconnect 前申请单区块保活，失败仍继续下线；宝库模式不参与常加载）
    if (record.workMode !== "vault") {
      const keep = await tickingAreas.ensureSingleChunk(botId, record.dimensionId, record.home.position);
      if (!keep.ok) console.warn(`[mockplayer3] 下线前保活失败 ${record.name}: ${keep.reason}（仍继续下线）`);
      tickingAreas.scheduleRelease(singleChunkAreaName(botId), record.dimensionId);
      tickingAreas.scheduleRelease(singleChunkAreaName(botId), record.dimensionId, KEEPALIVE_FORCE_RELEASE_TICKS);
    }
    // 5. 销毁会话
    this.runtime.transitTo(botId, "offline");
    this.runtime.destroySession(botId);
    this.saveGate.forgetSession(botId);
    // 6. disconnect（名字异步释放，归还在下次仲裁）
    this.ops.disconnect(botId);
    record.declaredOnline = false;
    if (wasDying) record.deathMark = true;
    this.saveGate.saveRecord(record);
    // 7. 唯一 botOffline 通知
    this.events.emit("botOffline", { botId, name: record.name, cause });
    if (notifyKey) this.ops.notifyPlayer(notifyKey, `假人 ${record.name} 已下线`);
    console.warn(`[mockplayer3] 下线完成 ${record.name}（原因=${cause}${wasDying ? "，死亡定档" : ""}）`);
    this.offlineInFlight.delete(botId);
    return { ok: true };
  }

  /** 重连：下线 + 20t 名字释放 + 上线；同标签合并防双击 */
  reconnect(viewer: Viewer, botId: number): Promise<ActionResult> {
    return this.settled(
      this.mailbox.post(botId, "reconnect", async () => {
        await this.doOffline(botId, "reconnect", viewer.key);
        await new Promise<void>((resolve) => clock.after(RECONNECT_DELAY_TICKS, () => resolve()));
        return await this.doOnline(viewer, botId, false);
      })
    );
  }

  /**
   * 能力驱动的自助重连（宝库开箱成功后自断重连）：系统意图不经玩家侧——无在途守卫
   * 回执、下线不打扰主人播报；权限取主人键 + 系统授权（无主假人亦可完成重连），
   * 配额计入主人名下。在途互斥由调用方负责（宝库能力 RECONNECT 阶段不再交互）。
   */
  systemReconnect(botId: number): void {
    const record = this.runtime.record(botId);
    if (!record) return;
    // 系统代投：免主人权限门，配额按主人键判定
    const key = record.ownerKey ?? "";
    const viewer: Viewer = { key, isOp: entityGateway.realPlayerIsOp(key) };
    void this.mailbox.post(botId, "reconnect", async () => {
      await this.doOffline(botId, "reconnect");
      await new Promise<void>((resolve) => clock.after(RECONNECT_DELAY_TICKS, () => resolve()));
      await this.doOnline(viewer, botId, true);
    });
  }

  // ─── 死亡管线（entityDie 回调窗口内同步段，F-04） ──

  handleDeath(entityId: string, entityName: string): void {
    // 实体 id 优先（会话登记），名字兜底（管线尚未写 entityId 时死亡）；
    // 真人死亡/无会话幽灵由 session/record 守卫排除
    const botId = this.runtime.sessionByEntityId(entityId)?.botId ?? this.runtime.findBotIdByName(entityName);
    if (botId === undefined) return;
    const session = this.runtime.session(botId);
    const record = this.runtime.record(botId);
    if (!session || !record) return;

    const now = clock.now();
    console.warn(`[mockplayer3] 死亡 ${record.name}（自动重生=${record.switches.autoRespawn ? "开" : "关"}）`);
    this.modes.stopCurrent(session, now);
    this.runtime.transitTo(botId, "death"); // → DYING
    // 窗口内快照：有什么存什么（F-27；death 通道 epoch<1 亦放行）
    this.ops.exportItems(botId, entityId);
    const pose = this.ops.readPose(botId, entityId);
    if (pose) {
      // 死亡窗口读到的旋转是引擎垂死值（逐 tick 锁回）：只取位置/维度，yaw/pitch 保留冻结快照
      record.home = { position: pose.position, yaw: record.home.yaw, pitch: record.home.pitch };
      record.dimensionId = pose.dimensionId;
    }
    const exp = this.ops.captureExperience(botId, entityId);
    if (exp) record.experience = exp;
    record.effects = this.ops.captureEffects(botId, entityId);
    this.saveGate.checkpoint(session, record, "death");
    entityGateway.invalidate(botId);
    this.events.emit("botDeath", { botId, name: record.name, autoRespawn: record.switches.autoRespawn });

    if (record.switches.autoRespawn) {
      const r = this.ops.respawn(botId, entityId); // 窗口内唯一合法调用点
      if (r.ok) {
        this.runtime.transitTo(botId, "respawn"); // DYING → RESTORING（冻结）
        clock.after(RESPAWN_TAIL_TICKS, () => this.respawnTail(botId));
        return;
      }
      // 引擎拒绝重生 → 播报"自动重生失败"，再走离线死亡兜底
      console.warn(`[mockplayer3] 自动重生被拒 ${record.name}: ${r.reason}`);
      this.events.emit("botRespawnFailed", { botId, name: record.name, stage: "reject", reason: r.reason });
    }
    this.finalizeDeathOffline(botId, session, record);
  }

  private finalizeDeathOffline(botId: number, session: Session, record: BotRecord): void {
    record.deathMark = true;
    record.declaredOnline = false;
    this.runtime.transitTo(botId, "offline");
    this.runtime.destroySession(botId);
    this.saveGate.forgetSession(botId);
    this.mailbox.forget(botId);
    this.ops.disconnect(botId, session.entityId ?? undefined);
    tickingAreas.scheduleRelease(singleChunkAreaName(botId), record.dimensionId);
    tickingAreas.scheduleRelease(singleChunkAreaName(botId), record.dimensionId, KEEPALIVE_FORCE_RELEASE_TICKS);
    this.saveGate.saveRecord(record);
    this.events.emit("botOffline", { botId, name: record.name, cause: "death" });
  }

  /** 自动重生的后半段：RESTORING 冻结已持续到此刻；不重新导入物品 */
  private respawnTail(botId: number): void {
    const session = this.runtime.session(botId);
    const record = this.runtime.record(botId);
    if (!session || !record || session.state !== "RESTORING") return;
    if (!this.ops.isPresent(botId, session.entityId ?? undefined)) {
      // 复活后半段实体已失效 → 播报后走死亡离线兜底
      console.warn(`[mockplayer3] 自动重生失败 ${record.name}（尾段）: 实体失效（重生窗口后消失）`);
      this.events.emit("botRespawnFailed", {
        botId,
        name: record.name,
        stage: "tail",
        reason: "实体失效（重生窗口后消失）",
      });
      this.finalizeDeathOffline(botId, session, record);
      return;
    }
    const rp = record.respawnPoint ?? {
      position: record.home.position,
      yaw: record.home.yaw,
      pitch: record.home.pitch,
      dimensionId: record.dimensionId,
    };
    // 身体朝向经 teleport rotation 设置（F-01；注视是租约不在此恢复）
    this.ops.teleportTo(botId, rp.position, rp.dimensionId, rp.yaw, rp.pitch, session.entityId ?? undefined);
    this.ops.applyTags(botId, record.tags);
    this.ops.setSneaking(botId, record.switches.sneaking);
    gaze.startSettle(botId); // teleport 定型身体朝向后校正视线
    this.runtime.transitTo(botId, "restored"); // RESTORING → ACTIVE
    console.warn(`[mockplayer3] 自动重生完成 ${record.name}（模式=${record.workMode}）`);
    this.events.emit("botRespawn", { botId, name: record.name });
    const attach = this.modes.attachAfterRestore(botId, clock.now());
    // 复活后重新挂载能力失败同样记日志（前置条件在 start 里判，不合格即落空闲）；
    // 与上线流程同一做法，不留静默降级
    if (!attach.ok && record.ownerKey)
      this.ops.notifyPlayer(
        record.ownerKey,
        `假人 ${record.name} 已重生，但模式恢复失败（${attach.reason}），已回到空闲`,
        "warn"
      );
  }

  // ─── 世界事件对账（事件只报告，管线只在此被确认/纠正） ──

  handleSpawn(entityId: string, playerName: string, initialSpawn: boolean): void {
    const botId = this.runtime.findBotIdByName(playerName);
    if (botId === undefined) return; // 名字无档：非我方命名空间（桥已滤未标记实体）
    const session = this.runtime.session(botId);
    if (session) {
      entityGateway.invalidate(botId);
      if (!session.entityId) session.entityId = entityId;
      return;
    }
    // 无会话却出现我方标记实体 = 幽灵（重启残留/死亡未释放）——立即释放。
    // 桥只转发 BOT 标记实体，此处绝不可能误伤真人。
    this.ops.releaseGhosts(playerName, this.runtime.protectedEntityIds());
    void initialSpawn;
  }

  handleLeave(playerName: string, playerId: string): void {
    // 名字失配（改名竞态等）按实体 id 找回会话
    const botId = this.runtime.findBotIdByName(playerName) ?? this.runtime.sessionByEntityId(playerId)?.botId;
    if (botId === undefined) {
      // 真人离开：主人下线联动（记录开关 ∨ 全局默认，名下在线假人逐个下线）
      const key = playerKey(playerName);
      const cfg = this.runtime.config;
      for (const r of this.runtime.records.values()) {
        if (r.ownerKey !== key) continue;
        if (!(r.switches.ownerDownOffline || cfg.ownerDownOfflineDefault)) continue;
        if (!this.runtime.session(r.botId)) continue;
        void this.offline(r.botId, "ownerLeave");
      }
      return;
    }
    if (this.offlineInFlight.has(botId)) return; // 自家 disconnect 的正常回声，吞
    const session = this.runtime.session(botId);
    if (!session) return; // 下线后的迟到事件
    // 旧实体回声过滤：离开事件的实体不是当前会话实体 = 重连期间旧实体的迟到回声，绝不下线新实体
    if (session.entityId && playerId !== session.entityId) return;
    if (session.epoch < 1) {
      // 上线在途异常跌落：撤销管线（epoch 守卫已挡住一切物品写，无需快照）
      const record = this.runtime.record(botId);
      console.warn(`[mockplayer3] 上线在途离场 ${record?.name ?? playerName}（撤销管线，异常跌落定档离线）`);
      this.modes.stopCurrent(session, clock.now());
      this.ops.disconnect(botId);
      tickingAreas.scheduleRelease(singleChunkAreaName(botId), record?.dimensionId ?? "minecraft:overworld");
      tickingAreas.scheduleRelease(
        singleChunkAreaName(botId),
        record?.dimensionId ?? "minecraft:overworld",
        KEEPALIVE_FORCE_RELEASE_TICKS
      );
      this.runtime.transitTo(botId, "abortSpawn");
      this.runtime.destroySession(botId);
      this.saveGate.forgetSession(botId);
      this.mailbox.forget(botId);
      if (record) {
        record.declaredOnline = false;
        this.saveGate.saveRecord(record);
      }
      this.events.emit("botOffline", { botId, name: record?.name ?? playerName, cause: "abnormal" });
      return;
    }
    // 在线异常离场 = 按正常下线管线走（有什么存什么）
    void this.offline(botId, "abnormal");
  }

  handleJoin(playerName: string): void {
    const botId = this.runtime.findBotIdByName(playerName);
    if (botId === undefined) return;
    // 真人进场的对账不在这里——playerJoin 时客户端还在加载屏（F-05），就绪拍另有其口。
    entityGateway.invalidate(botId); // 重加入实体已换新，缓存必废（F-05）
    // 引擎自发重连不经上线管线=空背包在线——对账职责在此收口，新躯体恢复物品/标签/经验/效果
    void this.mailbox.post(botId, "restore", () => Promise.resolve(this.restoreRejoined(botId)));
    // 无加入消息抑制 API——假人重连广播为已知差异（不改行为）
  }

  /** 重加入恢复（邮箱任务体；一切"非我方管线发起"的实体替换的唯一收敛点） */
  private restoreRejoined(botId: number): ActionResult {
    const session = this.runtime.session(botId);
    const record = this.runtime.record(botId);
    if (!session || !record) return { ok: true }; // 已离线/删除：启动对账兜底
    if (session.epoch < 1) return { ok: true }; // 上线在途：其步骤 7 正在恢复
    if (session.state !== "ACTIVE" && session.state !== "WORKING") return { ok: true }; // 死亡/离线程自行裁决
    const bot = entityGateway.resolveBot(botId);
    if (!bot) return { ok: true }; // 实体未就位：生成/对账链兜底
    if (session.entityId && session.entityId !== bot.id) projectileTracker.trackOffline(session.entityId);
    session.entityId = bot.id; // 旧 id 不清——leave 回声过滤会挡新实体的离开事件
    projectileTracker.trackOnline(bot.id, record.name);
    const imp = this.ops.importItems(botId);
    if (!imp.ok) {
      console.warn(`[mockplayer3] 重连恢复物品失败 ${record.name}: ${imp.reason}`);
      return { ok: false, reason: imp.reason };
    }
    this.ops.applyTags(botId, record.tags);
    this.ops.restoreExperience(botId, record.experience);
    this.ops.applyEffects(botId, record.effects);
    this.ops.setSneaking(botId, record.switches.sneaking);
    const rp = record.respawnPoint ?? {
      position: record.home.position,
      yaw: record.home.yaw,
      pitch: record.home.pitch,
      dimensionId: record.dimensionId,
    };
    this.ops.setSpawnPoint(botId, rp.position, rp.dimensionId);
    gaze.startSettle(botId); // 实体替换=生成类节点，有界视线校正同款
    console.warn(`[mockplayer3] 引擎自发重连已恢复 ${record.name}（模式=${record.workMode}）`);
    return { ok: true };
  }

  // ─── 启动对账 ──

  /**
   * worldLoad 全量对账：记录入内存、票据/绑定互验清孤儿、在线声明按
   * reconcileStartup 归一——引擎假人不跨重启存活，落盘在线声明恒归一为离线。
   */
  startupReconcile(): void {
    const records = this.saveGate.loadAll();
    this.runtime.setRecords(records);
    this.runtime.config = this.saveGate.loadConfig();

    const index = this.saveGate.loadNameIndex();
    for (const [name, botId] of index) {
      if (!this.runtime.records.has(botId)) this.saveGate.releaseName(name);
    }
    for (const r of this.runtime.records.values()) {
      if (index.get(r.name) !== r.botId) this.saveGate.claimName(r.name, r.botId);
    }
    for (const botId of this.saveGate.listBindingBotIds()) {
      if (!this.runtime.records.has(botId)) this.saveGate.deleteBinding(botId);
    }

    const claims = records.map((r) => ({
      botId: r.botId,
      declaredOnline: r.declaredOnline,
      deathMark: r.deathMark,
    }));
    for (const v of reconcileStartup(claims)) {
      const r = this.runtime.record(v.botId);
      if (!r) continue;
      if (r.declaredOnline !== v.declaredOnline || r.deathMark !== v.deathMark) {
        r.declaredOnline = v.declaredOnline;
        r.deathMark = v.deathMark;
        this.saveGate.saveRecord(r);
      }
    }
    const declared = claims.filter((c) => c.declaredOnline).length;
    console.warn(
      `[mockplayer3] 启动对账：记录 ${claims.length}，残留在线声明 ${declared}（死亡标注 ${claims.filter((c) => c.deathMark).length}）全部归一为离线`
    );
  }

  // ─── 认领 / 改名 / 回收 / 恢复 ──

  /** 无主假人自动认领：谁先管理谁为主人，先到先得；落败回滚不半途 */
  claimIfOwnerless(viewer: Viewer, botId: number): boolean {
    const record = this.runtime.record(botId);
    if (!record || record.ownerKey !== null) return false;
    record.ownerKey = viewer.key;
    if (!this.saveGate.saveRecord(record)) {
      record.ownerKey = null;
      return false;
    }
    console.info(`[mockplayer3] 自动认领 ${record.name} → ${viewer.key}`);
    return true;
  }

  /**
   * 改名：仅离线可用（在线改名 Player.name 只读会与记录名分裂——事件反查错主）；
   * 合法性/占用/真人撞名（原始名+规范化名双检）逐条前置；名字票据
   * release→claim→存败回滚（原子三段）；物品绑定表按 botId 寻址零迁移。
   */
  rename(viewer: Viewer, botId: number, rawName: string): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!canManage(viewer, record, this.runtime.config)) return { ok: false, reason: "只有主人或管理员可修改该假人" };
    const newName = normalizeBotName(rawName);
    if (newName === record.name) return { ok: true, botId, name: record.name };
    const nameError = validateBotName(newName);
    if (nameError) return { ok: false, reason: nameError };
    if (this.runtime.findBotIdByName(newName) !== undefined) return { ok: false, reason: `假人 ${newName} 已存在` };
    const protectedIds = this.runtime.protectedEntityIds();
    const raw = rawName.trim();
    if (raw !== newName && this.ops.inspectNameUsage(raw, protectedIds).real > 0) {
      return { ok: false, reason: `名字 ${raw} 与真实玩家相同，请更换名字` };
    }
    const usage = this.ops.inspectNameUsage(newName, protectedIds);
    if (usage.real + usage.ghosts > 0) return { ok: false, reason: `世界中已存在同名玩家实体 ${newName}，请更换名字` };
    const state = this.runtime.stateOf(botId);
    if (state && stateFlags(state).online) return { ok: false, reason: "请先将假人下线后再改名" };

    const oldName = record.name;
    this.saveGate.releaseName(oldName);
    this.saveGate.claimName(newName, botId);
    record.name = newName;
    if (!this.saveGate.saveRecord(record)) {
      this.saveGate.releaseName(newName);
      this.saveGate.claimName(oldName, botId);
      record.name = oldName;
      return { ok: false, reason: "改名失败" };
    }
    return { ok: true, botId, name: newName };
  }

  /** 跟随关系持久化（Follow 能力启动前提 record.followTarget——命令/UI 共用缝） */
  setFollowTarget(viewer: Viewer, botId: number, targetKey: string | null): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!canManage(viewer, record, this.runtime.config)) return { ok: false, reason: "只有主人或管理员可修改该假人" };
    record.followTarget = targetKey;
    return this.saveGate.saveRecord(record) ? { ok: true } : { ok: false, reason: "保存失败" };
  }

  // ─── 工作箱（面板经此三法读写注册表与绑定；持久化在 engine WorkChests） ──

  /** 开面板前置探查：点击格为普通箱子时返回箱 id/归一原点与已登记名称，否则 null */
  workChestPeek(dimId: string, loc: Vec3): { chestId: string; origin: Vec3; name: string } | null {
    const probe = probeWorkChest(dimId, loc);
    if (probe.status !== "ok") return null;
    return { chestId: probe.chestId, origin: probe.origin, name: workChests.get(probe.chestId)?.name ?? "" };
  }

  /** 绑定箱显示名（面板渲染绑定状态用）；未绑定或注册表无条目返回空串 */
  workChestName(chestId: string | null): string {
    return chestId ? (workChests.get(chestId)?.name ?? "") : "";
  }

  /**
   * 工作箱表单提交（信物+潜行+点击只开面板，写在此收口）：探查箱格 → 登记/改名 → 逐假人施加。
   * 勾选=绑到该箱（覆写旧绑定；同一箱允许多假人勾选共用）；取消勾选且现绑为该箱=解绑；名称留空保持原名。
   */
  applyWorkChestForm(
    viewer: Viewer,
    dimId: string,
    clicked: Vec3,
    rawName: string,
    choices: readonly { botId: number; on: boolean }[]
  ): { ok: boolean; reason?: string; bound: string[]; unbound: string[]; denied: string[] } {
    const out = {
      ok: false,
      reason: "" as string | undefined,
      bound: [] as string[],
      unbound: [] as string[],
      denied: [] as string[],
    };
    const probe = probeWorkChest(dimId, clicked);
    if (probe.status === "not-chest") {
      out.reason = "点击的方块不是普通木头箱子（木桶/陷阱箱不可作工作箱）";
      return out;
    }
    if (probe.status === "unreadable") {
      out.reason = "箱子区块读不到，请稍后再试";
      return out;
    }
    const name = normalizeChestName(rawName);
    const prev = workChests.get(probe.chestId);
    workChests.upsert({ id: probe.chestId, dimId, origin: probe.origin, name: name || prev?.name || "" });
    for (const c of choices) {
      const record = this.runtime.record(c.botId);
      if (!record) continue;
      if (!canManage(viewer, record, this.runtime.config)) {
        out.denied.push(record.name);
        continue;
      }
      const next = c.on ? probe.chestId : record.workChestId === probe.chestId ? null : record.workChestId;
      if (next === record.workChestId) continue;
      const before = record.workChestId;
      record.workChestId = next;
      if (!this.saveGate.saveRecord(record)) {
        record.workChestId = before;
        out.denied.push(`${record.name}（保存失败）`);
        continue;
      }
      (next ? out.bound : out.unbound).push(record.name);
    }
    out.ok = true;
    return out;
  }

  /** 重生点设为操作者位置：只更新位置、保留原朝向；实体侧 setSpawnPoint best-effort，失败不打扰玩家 */
  setRespawnHere(viewer: Viewer, botId: number): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!canManage(viewer, record, this.runtime.config)) return { ok: false, reason: "只有主人或管理员可修改该假人" };
    const probe = this.ops.playerProbe(viewer.key);
    if (!probe) return { ok: false, reason: "无法读取操作者位置" };
    const prev = record.respawnPoint ?? {
      position: record.home.position,
      yaw: record.home.yaw,
      pitch: record.home.pitch,
      dimensionId: record.dimensionId,
    };
    record.respawnPoint = {
      position: probe.location,
      yaw: prev.yaw,
      pitch: prev.pitch,
      dimensionId: probe.dimensionId,
    };
    if (!this.saveGate.saveRecord(record)) return { ok: false, reason: "保存失败" };
    if (this.runtime.session(botId)) this.ops.setSpawnPoint(botId, probe.location, probe.dimensionId);
    return { ok: true };
  }

  /**
   * 回收（mp:reclaim/面板共用意图）：在线走实体真值、死亡/离线走仓快照（双路收敛）；
   * 经邮箱与上下线串行（防 exportItems 竞态双发）。sel=回收子集（缺省全量）；
   * 记录经验仅在勾选回收经验时归零，部分回收不动经验。
   * 执行时操作者必须在线（交付对象）：排队期间掉线的意图直接改期，杜绝"已摘除却无人可交付"。
   */
  reclaim(viewer: Viewer, botId: number, sel?: ReclaimSelection): Promise<ReclaimOutcome> {
    const record = this.runtime.record(botId);
    if (!record) return Promise.resolve({ ok: false, reason: "假人不存在" });
    if (!canManage(viewer, record, this.runtime.config)) {
      return Promise.resolve({ ok: false, reason: "只有主人或管理员可回收该假人" });
    }
    return this.mailbox
      .post(botId, "reclaim", async (): Promise<ReclaimOutcome> => {
        if (!this.ops.isOnlinePlayer(viewer.key)) {
          return { ok: false, reason: "交付目标已离线，回收未执行" };
        }
        const rec = this.runtime.record(botId);
        if (!rec) return { ok: false, reason: "假人不存在" };
        const st = this.runtime.stateOf(botId);
        const live = st !== null && stateFlags(st).online && !stateFlags(st).death;
        // 仓不可信时离线回收直接改期——读旧仓态交付+写回失败=同物双发
        if (!live && !this.ops.vaultReadable(botId)) {
          return { ok: false, reason: "物品仓区块未加载（世界尚未就绪），请稍后再回收" };
        }
        const counts = live
          ? this.ops.reclaimFromEntity(viewer.key, botId, sel)
          : this.ops.reclaimFromVault(viewer.key, botId, rec.experience, sel);
        if (!counts) return { ok: false, reason: "无法在世界中找到该模拟玩家" };
        // 记录经验强制归零：实体清零可能失败，记录侧杜绝重复回收
        if (!sel || sel.xp) {
          rec.experience = { level: 0, progress: 0, totalXp: 0 };
          this.saveGate.saveRecord(rec);
        }
        return { ok: true, ...counts };
      })
      .then((r) => r ?? { ok: false, reason: "意图被替换或管线内部异常" });
  }

  /** 强制恢复：手动仓→实体重写 + 经验只增补（重名等恢复失败场景的补救口）。在线限定 */
  recover(viewer: Viewer, botId: number): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!canManage(viewer, record, this.runtime.config)) return { ok: false, reason: "只有主人或管理员可修改该假人" };
    if (!this.runtime.session(botId)) return { ok: false, reason: `假人 ${record.name} 不在线，请先上线` };
    const imp = this.ops.importItems(botId);
    if (!imp.ok) return { ok: false, reason: imp.reason };
    this.ops.restoreExperience(botId, record.experience);
    return { ok: true, name: record.name };
  }

  // ─── 结构直写设置（轻操作；均走 SaveGate.saveRecord） ──

  /** 记录级开关（sneaking 同步即时施加实体；autoRespawn/ownerDownOffline 纯记录） */
  setSwitch(botId: number, name: keyof BotSwitches, value: boolean): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    record.switches[name] = value;
    if (!this.saveGate.saveRecord(record)) return { ok: false, reason: "保存失败" };
    if (name === "sneaking") this.ops.setSneaking(botId, value);
    return { ok: true };
  }

  /** 家点设为当前位置（在线限定；home 是上线/离线的锚点真源） */
  setHomeHere(botId: number): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    const pose = this.ops.readPose(botId);
    if (!pose) return { ok: false, reason: "假人需在线才能设置家点" };
    record.home = { position: pose.position, yaw: pose.yaw, pitch: pose.pitch };
    record.dimensionId = pose.dimensionId;
    return this.saveGate.saveRecord(record) ? { ok: true } : { ok: false, reason: "保存失败" };
  }

  /** 切换工作模式（切换序列在 Modes；此处补权限与状态回执） */
  changeWorkMode(viewer: Viewer, botId: number, mode: WorkMode): ActionResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!canManage(viewer, record, this.runtime.config)) {
      return { ok: false, reason: "只有主人或管理员可修改该假人" };
    }
    const r = this.modes.change(botId, mode, clock.now());
    return r;
  }

  /**
   * 在线配额强制下线：配额降低/清除覆盖后，超出部分按名字序保留前 N 个下线。
   * @param ownerKey - 限定单主人；缺省全量
   * @returns 强制下线的假人数
   */
  enforceOnlineQuotas(ownerKey?: string): number {
    const groups = new Map<string, BotRecord[]>();
    for (const record of this.runtime.records.values()) {
      if (record.ownerKey === null) continue;
      if (ownerKey !== undefined && record.ownerKey !== ownerKey) continue;
      const st = this.runtime.stateOf(record.botId);
      if (!st || !stateFlags(st).online || stateFlags(st).death) continue;
      const list = groups.get(record.ownerKey) ?? [];
      list.push(record);
      groups.set(record.ownerKey, list);
    }
    let forced = 0;
    for (const [key, list] of groups) {
      // 主人配额豁免：adminKeys ∨ 在线真人 OP
      const quota = onlineQuotaFor({ key, isOp: entityGateway.realPlayerIsOp(key) }, this.runtime.config);
      if (quota >= UNLIMITED_QUOTA) continue;
      const ordered = [...list].sort((a, b) => a.name.localeCompare(b.name));
      for (const record of ordered.slice(quota)) {
        void this.offline(record.botId, "command");
        forced++;
      }
    }
    return forced;
  }
}
