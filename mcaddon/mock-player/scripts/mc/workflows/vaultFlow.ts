// ─── 宝库工作流（mc/workflows，完整实现内聚 + 事件驱动循环） ──
// 宝库模式 = 基于事件的持续交互循环（用户规格 1.3.10/1.3.11，类似劫掠模式）：
//
//   开启/上线/重生/重连 → startVaultTask：启动 per-bot VaultTask（挂假人
//   独立引擎）——scan（半径 15 搜索最近宝库）→ navigate（持续看向 + 一次性
//   导航到宝库旁站立点，r<2 且视线命中宝库）→ interact（识别普通/不详 →
//   按类型选钥匙换主手 → 交互 → 记录钥匙总量基准）→ wait（纯事件驱动）。
//
//   等待 = 纯事件驱动（无轮询）：playerInventoryItemChange 钥匙单槽
//   「数量被 -1 了」且「-1 后不是空手」→ 延迟 1tick 总量基准对比
//     → 背包钥匙总量减少 = 开箱成功（唯一权威判定，用户拍板）
//     → handle.success()（任务完成）+ workflowVaultOpened 领域事件
//     → 订阅方通知附近真实玩家 + safeReconnect 安全重连
//     → onOnline 重新 startVaultTask（新实体重新寻路，可重复开同一宝库）
//   ⚠️ 换钥匙（槽间移动）/给钥匙/手动拆分：单槽变化但总量不变或清空槽
//     → 绝不误判。
//
// ⚠️ 不判断宝库是否开过：重连后是新实体，同一宝库可重复开，直到钥匙用完。
// ⚠️ 多假人并发：任务句柄按 botName 键控，互不干扰。

import { world, system, type Player, ItemStack, Container, PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { Workflow } from "../../core/service/Workflow";
import { BotRecord } from "../../core/model/Types";
import { BOT_TAG, TAG_VAULT_MODE } from "../../core/tags/BotTags";
import { BotUiEvent } from "../../core/events/UiEvents";
import { workflowVaultOpened, type WorkflowVaultOpenedEvent } from "../../core/events/WorkflowEvents";
import { BotEvents } from "../../core/events/DomainEvents";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { botManager } from "../bot/BotManager";
import type { MockBot } from "../bot/MockBot";
import { vaultTask, type VaultTaskHandle } from "../bot/tasks";
import { setTags } from "../features/setTags";
import { safeReconnect } from "../features/pendingRespawn";

// ─── 可用的宝库钥匙 ──────────────────────────────────

const KEY_ITEMS = new Set(["minecraft:trial_key", "minecraft:ominous_trial_key"]);

/** 是否为宝库钥匙 */
function isVaultKey(typeId: string): boolean {
  return KEY_ITEMS.has(typeId);
}

const KEY_LABELS: Record<string, string> = {
  "minecraft:trial_key": "普通钥匙",
  "minecraft:ominous_trial_key": "不详钥匙",
};

// ─── 活跃任务句柄（按 botName 键控，多假人并发） ───────

/** 活跃宝库任务的句柄（事件判定读 baseline、标记 success） */
const activeVaultHandles = new Map<string, VaultTaskHandle>();

// ─── 工作流定义（生命周期 + 事件驱动循环，无常驻引擎） ──

/** 宝库工作流：寻路最近宝库 → 开箱（钥匙 -1 且非空 + 总量基准判定）→ 重连 → 继续 */
export const vaultFlow: Workflow = {
  name: "vault-mode",
  description: "宝库模式：自动寻路到最近宝库并开启，钥匙消耗事件驱动重连循环",

  init(): void {
    // 1. 开箱成功领域事件 → 通知附近玩家 + 安全重连 + 重开任务
    workflowVaultOpened.subscribe(handleVaultOpened);
    // 2. 钥匙消耗检测（事件驱动 + 基准对比）：钥匙单槽 -1 且非空 → 延迟 1tick 总量对比
    world.afterEvents.playerInventoryItemChange.subscribe(handleInventoryChange);
    // 3. 假人上线/重生 → 恢复开箱任务
    BotEvents.botOnline.subscribe((e) => system.run(() => startVaultTaskIfTagged(e.botName)));
    BotEvents.botRespawn.subscribe((e) => system.run(() => startVaultTaskIfTagged(e.botName)));
    // 4. 行为菜单提交事件：宝库标签已由 UI 先落库 → 开始开箱周期
    BotUiEvent.behaviorSubmitted.subscribe((e) => {
      if (e.tags.includes(TAG_VAULT_MODE.value)) {
        const record = botRegistry.get(e.botName);
        if (record && (!record.online || record.death)) {
          // 假人不在线：上线后自动开箱，此处先告知操作者
          (world.getEntity(e.playerId) as Player | undefined)?.sendMessage(
            `${color.playerName}[宝库] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动尝试开箱`,
          );
        }
        vaultFlow.start(e.botName);
      }
    });
  },

  start(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    // 无标签则补加（兜底：命令等非 UI 路径开启）；标签已有（UI 先落库）不重复写
    if (!record.tags.includes(TAG_VAULT_MODE.value)) {
      record.tags.push(TAG_VAULT_MODE.value);
      saveCoordinator.saveRecord(record);
    }
    if (record.online && !record.death) {
      startVaultTask(record);
    }
  },

  stop(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    // ⚠️ 统一走 setTags（标签修改唯一渠道）：实体同步 + 持久化统一
    setTags(record, record.tags.filter((t) => t !== TAG_VAULT_MODE.value));
    // 清理句柄 + 取消任务（停止导航）
    activeVaultHandles.delete(botName);
    const bot = botManager.get(botName);
    if (bot && bot.activeTaskId === "vault") {
      bot.cancelTask();
    }
  },

  isRunning(botName?: string): boolean {
    if (!botName) return false;
    const record = botRegistry.get(botName);
    return !!record && record.tags.includes(TAG_VAULT_MODE.value) && record.online && !record.death;
  },
};

// ─── 任务启动（开启/上线/重生/重连/重试） ─────────────

/** 标签已开启的假人上线/重生 → 恢复开箱任务 */
function startVaultTaskIfTagged(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record || !record.tags.includes(TAG_VAULT_MODE.value)) return;
  if (!record.online || record.death) return;
  startVaultTask(record);
}

/**
 * 启动 per-bot 宝库任务（幂等：已有 vault 任务跳过）。
 * 任务完成（交互成功判定触发）→ 句柄清理；重连循环由 workflowVaultOpened 驱动。
 */
function startVaultTask(record: BotRecord): void {
  const bot = botManager.getOrCreate(record);
  if (bot.activeTaskId === "vault") return;

  const { task, handle } = vaultTask(bot, {
    onNotify: (message) => throttledNotify(bot, record, message),
  });
  activeVaultHandles.set(record.name, handle);
  bot.startTask(task, (id) => {
    if (id === "vault") {
      activeVaultHandles.delete(record.name);
      console.info(`[MockPlayer] 宝库 ${record.name} 开箱任务完成（等待重连循环）`);
    }
  });
  console.info(`[MockPlayer] 宝库 ${record.name} 开箱任务已启动（扫描→寻路→交互→事件判定）`);
}

// ─── 钥匙消耗判定（事件驱动 + 总量基准对比） ───────────

/**
 * 钥匙消耗检测（用户拍板）：宝库假人背包钥匙单槽
 * 「数量被 -1 了」且「-1 后不是空手」→ 延迟 1tick 用**总量基准**对比。
 * ⚠️ 判定权威 = 交互基准存在 + 背包钥匙总量减少：
 *   - 换钥匙（槽间移动）：单槽 -1 但总量不变或清空槽 → 忽略
 *   - 开箱消耗：恰好 -1 且槽非空 + 总量减少 → 判定成功（事件 → 重连）
 *   - 物品互换/回收/死亡掉落：无交互基准（baseline 未设置）→ 忽略
 */
function handleInventoryChange(event: PlayerInventoryItemChangeAfterEvent): void {
  try {
    const { player, itemStack, beforeItemStack } = event;
    if (!player.hasTag(BOT_TAG)) return;
    const handle = activeVaultHandles.get(player.name);
    if (!handle) return; // 非宝库任务假人
    if (!beforeItemStack || !isVaultKey(beforeItemStack.typeId)) return;
    // 只考虑「数量被 -1 了」：恰好 -1（含 1→0 清空 = 正常消耗；整组拿走差 >1 排除）。
    // ⚠️ 不能排除「-1 后空手」——主手 1 把钥匙开箱后主手必空（最常见场景），
    //    清空槽是移走还是消耗由下方的**总量基准**最终判定（权威）。
    const afterAmount = itemStack?.amount ?? 0;
    if (beforeItemStack.amount - afterAmount !== 1) return; // 恰好 -1（排除其它变化）
    // 交互基准（刚交互过才可能开箱）
    if (handle.baseline === undefined) return;

    const botName = player.name;
    // ⚠️ 延迟 1 tick：等槽间移动（换钥匙）完成后再对比总量
    system.run(() => {
      try {
        const h = activeVaultHandles.get(botName);
        if (!h || h.baseline === undefined) return;
        const total = countKeyTotal(player as SimulatedPlayer);
        if (total === undefined || total >= h.baseline) {
          console.info(`[MockPlayer] 宝库 ${botName} 钥匙槽 -1 但总量未减少（槽间移动/拆分），忽略`);
          return;
        }
        // 判定成功！
        h.baseline = undefined; // 消费基准，防重复判定
        const keyType = h.keyType || "minecraft:trial_key";
        console.info(`[MockPlayer] 宝库 ${botName} 开箱成功判定（钥匙恰好 -1 + 总量减少）`);
        // 任务完成标记（引擎下一次 tick → isDone → onComplete 清理句柄）
        h.success();
        // 领域事件 → 订阅方通知附近玩家 + 安全重连
        workflowVaultOpened.trigger({ botName, keyType, remaining: total });
      } catch (e: any) {
        console.warn(`[MockPlayer] 宝库钥匙消耗判定异常: ${e?.message ?? e}`);
      }
    });
  } catch (e: any) {
    console.warn(`[MockPlayer] 宝库钥匙消耗检测异常: ${e?.message ?? e}`);
  }
}

/** 统计假人背包+主手的钥匙总量（实体失效/读不到容器返回 undefined——不能当作 0 误判） */
function countKeyTotal(bot: SimulatedPlayer): number | undefined {
  try {
    const inv = bot.getComponent("minecraft:inventory") as { container?: Container } | undefined;
    const container = inv?.container;
    if (!container) return undefined;
    let total = 0;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && isVaultKey(item.typeId)) total += item.amount;
    }
    return total;
  } catch {
    return undefined;
  }
}

// ─── 开箱成功事件（通知 + 重连 + 重开任务） ─────────────

function handleVaultOpened(e: WorkflowVaultOpenedEvent): void {
  try {
    const record = botRegistry.get(e.botName);
    if (!record || !record.tags.includes(TAG_VAULT_MODE.value)) return;
    // 重连/死亡中不重复触发（safeReconnect 内部亦有互斥）
    if (!record.online || record.death) return;

    const keyInfo: KeyInfo = {
      typeId: e.keyType,
      label: KEY_LABELS[e.keyType] ?? e.keyType.replace("minecraft:", ""),
      count: e.remaining,
      totalInInventory: e.remaining,
    };

    console.info(`[MockPlayer] 宝库 ${e.botName} 开箱成功，开始重连循环`);
    safeReconnect(record, {
      onOffline: () => {
        // 重连期间句柄保留（任务已完成待清理）；无额外动作
      },
      onOnline: (fresh, r) => {
        // 通知附近真实玩家
        notifyNearestPlayer(fresh, r, keyInfo);
        // 下一次开启：重连后新实体重新寻路（可重复开同一宝库）
        startVaultTask(r);
      },
    });
  } catch (e: any) {
    console.warn(`[MockPlayer] 宝库开箱事件处理异常: ${e?.message ?? e}`);
  }
}

// ─── 提示节流（同一假人 10 秒内只提醒一次，首次必发） ──

const notifyCooldownAt = new Map<string, number>();
const NOTIFY_COOLDOWN = 200; // 200 tick ≈ 10 秒

function throttledNotify(bot: MockBot, record: BotRecord, message: string): void {
  const now = system.currentTick;
  const last = notifyCooldownAt.get(record.name) ?? 0;
  // ⚠️ 首次必发（last=0 不节流）：世界启动早期 tick<200 时 `now - 0 < 200` 会吞掉首次提示
  if (last !== 0 && now - last < NOTIFY_COOLDOWN) return;
  notifyCooldownAt.set(record.name, now);
  nearestPlayer(bot.getEntity(), record.name)?.sendMessage(`${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}${message}`);
}

/** 假人所在维度最近的在线真实玩家（排除假人自己；失败返回 undefined） */
function nearestPlayer(bot: SimulatedPlayer | undefined, excludeName: string): Player | undefined {
  if (!bot) return undefined;
  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;
    for (const p of players) {
      if (p.name === excludeName) continue;
      const dist = distance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    return nearest ?? undefined;
  } catch {
    return undefined;
  }
}

// ─── 钥匙信息与通知（附近真实玩家） ──────────────────

interface KeyInfo {
  typeId: string;
  label: string;
  count: number;
  totalInInventory: number;
}

function notifyNearestPlayer(bot: SimulatedPlayer, record: BotRecord, keyInfo: KeyInfo | null): void {
  try {
    const players = world.getPlayers();
    let nearest: Player | null = null;
    let minDist = Infinity;

    for (const p of players) {
      if (p.name === record.name) continue;
      const dist = distance(bot.location, p.location);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }

    if (!nearest) return;

    if (keyInfo) {
      nearest.sendMessage(
        `${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手中还有 ${color.info}${keyInfo.totalInInventory} ${color.playerName}${keyInfo.label}${color.muted}（手持 ${color.info}${keyInfo.count}${color.muted}）`,
      );
    } else {
      nearest.sendMessage(`${color.playerName}[宝库] ${color.success}${record.name} ${color.muted}手上没有钥匙，请放入钥匙到主手`);
    }
  } catch {
    // 通知失败不影响主流程
  }
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
