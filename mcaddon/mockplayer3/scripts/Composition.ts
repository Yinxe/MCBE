// ─── 装配根（composition root：跨层依赖图唯一体） ──────────────────
// RecordStore/SaveGate/ItemVault/EntityOps/Spawner 在此构造一次，按构造序注入
// application；main.ts 与 interface 一律从 services 取用，不得各自 new（多实例=双写者）。

import { ItemVault } from "./engine/ItemVault";
import { RecordStore } from "./engine/RecordStore";
import { SaveGate } from "./engine/SaveGate";
import { Migrator } from "./engine/Migrator";
import { EntityOps } from "./engine/EntityOps";
import { PanelOps } from "./engine/PanelOps";
import { Spawner } from "./engine/Spawner";
import { entityGateway } from "./engine/EntityGateway";
import { botClickGuard } from "./engine/ClickGuard";
import { gaze } from "./engine/Gaze";
import { handler } from "./engine/Handler";
import { projectileTracker } from "./engine/ProjectileTracker";
import { toolGuard } from "./engine/ToolGuard";
import { forgetToolAlert } from "./engine/ToolKit";
import { clock } from "./engine/Clock";
import { setAtomicHooks } from "./engine/Hooks";
import { setAuxCompletedListener } from "./engine/AuxQueue";
import { BotEventBus } from "./application/Events";
import { Mailbox } from "./application/Mailbox";
import { Runtime } from "./application/Runtime";
import { Modes } from "./application/Modes";
import { Lifecycle } from "./application/Lifecycle";
import { Scheduler } from "./application/Scheduler";
import { WorkTransfer } from "./application/WorkTransfer";
import type { CapabilityHost } from "./application/Capabilities/Common";
import { MineCap } from "./application/Capabilities/Mine";
import { PlaceCap } from "./application/Capabilities/Place";
import { AttackCap } from "./application/Capabilities/Attack";
import { FollowCap } from "./application/Capabilities/Follow";
import { FishingCap } from "./application/Capabilities/Fishing";
import { WanderCap } from "./application/Capabilities/Wander";
import { RaidCap } from "./application/Capabilities/Raid";
import { VaultCap } from "./application/Capabilities/Vault";
import { HarvestCap } from "./application/Capabilities/Harvest";
import { CustomActionCap } from "./application/Capabilities/CustomAction";
import { ActionLibrary } from "./application/ActionLibrary";
import { ActionStore } from "./engine/ActionStore";

const recordStore = new RecordStore();
const runtime = new Runtime();
const saveGate = new SaveGate(recordStore, { isDebug: () => runtime.config.debugLog });
const vault = new ItemVault(recordStore);
const migrator = new Migrator(saveGate, vault);
const ops = new EntityOps(vault);
const panelOps = new PanelOps(vault);
const spawner = new Spawner();
const events = new BotEventBus();
const mailbox = new Mailbox();
const modes = new Modes(runtime, saveGate, events);
const transfer = new WorkTransfer(runtime, ops);
// 自定义动作：动作表走独立 DP 键（mp:action:<id>）——档案每次对账整条读写，动作表只在编辑/运行时才需要
const actionStore = new ActionStore();
const actions = new ActionLibrary(actionStore);
const lifecycle = new Lifecycle(runtime, saveGate, vault, ops, spawner, modes, events, mailbox, transfer);
const scheduler = new Scheduler(runtime, saveGate, modes, ops, transfer);

export const services = {
  recordStore,
  runtime,
  saveGate,
  vault,
  migrator,
  ops,
  panelOps,
  spawner,
  events,
  mailbox,
  modes,
  lifecycle,
  scheduler,
  transfer,
  actions,
} as const;

// ─── 在线实时落盘 ──

/** 恢复期守卫：SPAWNING/RESTORING/DYING 阶段的变更不写仓 */
function itemsSavable(botId: number): boolean {
  const session = runtime.session(botId);
  return !!session && session.epoch >= 1 && (session.state === "ACTIVE" || session.state === "WORKING");
}

/** 世界库存单格变化 → 单格直写物品仓 */
export function persistInventorySlot(botId: number, slot: number): void {
  if (!itemsSavable(botId)) return;
  ops.saveInventorySlotNow(botId, slot);
}

/** 装备面变化 → 逐槽指纹复查，无变化不写入 */
export function persistEquipmentCheck(botId: number): void {
  if (!itemsSavable(botId)) return;
  ops.syncEquipmentDedup(botId);
}

// ─── 误点拦截判定 ──

/**
 * 假人发起的方块点击该不该取消（桥在 before 回调内同步取结论）。
 * 只读全局配置与交互许可记录，不碰世界；假人未在册一律保守放行。
 * @param botName - 点击发起者名字（桥只上达纯数据）
 * @param blockTypeId - 被点方块 typeId
 * @returns true = 拦下这次点击
 */
export function decideBotBlockClick(botName: string, blockTypeId: string): boolean {
  const config = runtime.config;
  const botId = entityGateway.botIdOfName(botName);
  if (botId === undefined) return false;
  const blocked = botClickGuard.decide(botId, blockTypeId);
  if (blocked && config.debugLog) console.info(`[mockplayer3] 误点拦截 ${botName} → ${blockTypeId}`);
  return blocked;
}

// ─── 能力注册（Modes 目录逐个注入；未注册模式拒启不静默） ──

const capHost: CapabilityHost = {
  autoStop: (botId, reason) => {
    const record = runtime.record(botId);
    if (record?.ownerKey) ops.notifyPlayer(record.ownerKey, `假人 ${record.name}：${reason}，已自动回到空闲`, "warn");
    modes.change(botId, "none", clock.now());
  },
  releaseFollow: (botId) => {
    const record = runtime.record(botId);
    if (record?.followTarget) {
      record.followTarget = null;
      saveGate.saveRecord(record);
    }
  },
};
modes.register(new MineCap(runtime));
modes.register(new PlaceCap());
modes.register(new AttackCap());
modes.register(new FollowCap(runtime, ops, capHost));
modes.register(new FishingCap(runtime, ops, events));
modes.register(new WanderCap(runtime, ops));
modes.register(new RaidCap(runtime, events, capHost, saveGate));
modes.register(new VaultCap(runtime, ops, (botId) => lifecycle.systemReconnect(botId)));
// 采集按 CollectorSpec 一对象一模式单例；id 沿用 harvest_<kind>，命令/面板/存档零改动
modes.register(new HarvestCap(runtime, capHost, "wood"));
modes.register(new CustomActionCap(runtime, actions, ops, panelOps));

// ─── 原子钩子装配（背包变更走 SaveGate 增量、领域事件走总线） ──

setAtomicHooks({
  onInventoryChanged: (botId) => {
    saveGate.mark(runtime.session(botId) ?? null, ["inventory"]);
    const name = runtime.record(botId)?.name;
    if (name !== undefined) events.emit("botInventoryChanged", { botId, name });
  },
  onEquipChanged: (botId, slot) => {
    saveGate.mark(runtime.session(botId) ?? null, ["equipment"]);
    const name = runtime.record(botId)?.name;
    if (name !== undefined) events.emit("botEquipSlotChanged", { botId, name, slot });
  },
  onProjectileClaimed: (info) => events.emit("botProjectileClaimed", info),
  onToolGuardFired: (botId, message) => {
    const name = runtime.record(botId)?.name;
    if (name !== undefined) events.emit("botToolGuardFired", { botId, name, message });
  },
  onMiningNoTool: (botId, toolLabel) => {
    const record = runtime.record(botId);
    if (!record) return;
    const text = `定点挖掘遇到需要${toolLabel}的方块，背包无合适工具，已徒手继续`;
    console.warn(`[mockplayer3] no-tool bot=${record.name}: ${toolLabel}`);
    if (record.ownerKey) ops.notifyPlayer(record.ownerKey, `假人 ${record.name}：${text}`, "warn");
  },
});

// ─── 共享辅助常加载完成外发（通知主人归 Notify 渲染） ──

setAuxCompletedListener((e) =>
  events.emit("auxCompleted", {
    botId: e.botId,
    name: e.botName,
    ownerKey: e.ownerKey,
    dimId: e.dimensionId,
    location: e.location,
    radius: e.radius,
    success: e.success,
    reason: e.reason,
  })
);

// ─── 投掷物认主生命周期联动（上线/重生夺回、下线回退、反查表维护） ──

events.on("botOnline", ({ botId, name }) => {
  const entityId = runtime.session(botId)?.entityId;
  if (entityId) projectileTracker.trackOnline(entityId, name);
  projectileTracker.rebind(botId);
});
events.on("botRespawn", ({ botId, name }) => {
  const entityId = runtime.session(botId)?.entityId;
  if (entityId) projectileTracker.trackOnline(entityId, name);
  projectileTracker.rebind(botId);
});
events.on("botOffline", ({ botId, name }) => {
  projectileTracker.untrackBot(name);
  projectileTracker.release(botId);
  toolGuard.forget(botId);
  forgetToolAlert(botId); // 无工具报警冷却态不留存亡会话
  handler.forget(botId);
  ops.forgetEquipBaselines(botId);
  gaze.forget(botId); // 注视任务不留存亡会话
  botClickGuard.forget(botId); // 误点许可窗不留存亡会话（botId 会被复用，不得继承旧窗）
  transfer.forget(botId); // 工作箱巡检/告警态同上
});
events.on("botDeleted", ({ botId }) => {
  entityGateway.forget(botId);
  runtime.forgetRaidState(botId); // 劫掠状态只随删假人清，防同名重建继承
  runtime.forgetVaultState(botId); // 宝库流程状态同上
  runtime.harvestGrounds.forgetBot(botId); // 采集地点池与扫描标记同上
  actions.forget(botId); // 自定义动作：动作表、版本号与运行状态一并清（旧版漏了这步）
  runtime.forgetMined(botId); // 挖掘产物台账同上（工作箱搬运判据依赖它）
});
