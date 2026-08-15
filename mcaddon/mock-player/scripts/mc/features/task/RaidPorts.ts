// ─── 劫掠任务端口实现（mc/features/task） ─────────────────
// RaidPorts 的 mc 适配（core/tasks/RaidTask 声明决策契约）。
// **事件驱动黑板 + 树决策**：
//   - effectAdd 订阅更新"最近英雄事件时刻"（lastHeroTick）+ 触发公共信号
//     （BotEvents.raidStarted / raidVictory）+ 一次性卡死提醒
//   - 树每 10 tick 经 sense() 读取：效果状态实时查询实体、药水数实时扫描——
//     袭击等待（分钟级）零轮询负担（条件全 false 时等待分支无副作用）
// ⚠️ 语义（用户拍板 713e8da）：纯事件驱动 + 一次性卡死提醒（只发消息，
//    零恢复机制）；无药水自动关模式（disableRaidMode）。
// 决策逻辑全部在 core/tasks/RaidTask（可单测），本文件只做副作用。

import { system, world, type Container, type Effect, type EffectAddAfterEvent, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { RaidDrinkResult, RaidIdleReason, RaidKnowledge, RaidPorts } from "../../../tasks/RaidTask";
import {
  BAD_OMEN, RAID_OMEN, VILLAGE_HERO, DRINK_DURATION, RAID_TRUCE_TICKS,
  isOminousBottle, classifyRaidEffect,
} from "../../../rules/RaidRules";
import {
  raidStarted, raidVictory, raidPhase, initialRaidPhaseState,
  type RaidPhase, type RaidPhaseState,
} from "../../../tasks/RaidTask";
import { TAG_RAID_MODE } from "../../../tags/BotTags";
import type { BotRecord } from "../../../model/Types";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { resolveBotPlayer } from "../../adapters/PlayerGateway";
import { syncEntityTags } from "../../adapters/EntityTags";

// ─── 全局状态 ──────────────────────────────────────────

/** 正在异步饮用不祥之瓶的假人（防止重复触发饮用链） */
const drinking = new Set<string>();
/** 本次会话劫掠胜利次数（仅内存，不持久化） */
const victoryCounts = new Map<string, number>();
/** 最近村庄英雄效果事件 tick（胜利处理窗口与幂等判定） */
const lastHeroTick = new Map<string, number>();
/** 已处理的英雄事件 tick（handleVictory 幂等：防 removeEffect 失败重复叠加） */
const handledHeroTick = new Map<string, number>();
/** 已转化为袭击之兆的 tick（不祥之兆结束检查防误报：转化后袭击酝酿/进行中无兆头 ≠ 不在村庄） */
const convertedToRaidTick = new Map<string, number>();
/** 获得袭击之兆的 tick（袭击即将开始；30 秒后 buff 结束 = 袭击完全开始） */
const raidOmenSince = new Map<string, number>();
/** 袭击阶段状态（每假人一份；阶段通知用，不干预核心流程） */
const raidPhaseStates = new Map<string, RaidPhaseState>();
/** 阶段通知半径（格）：附近玩家（主人不受距离限制） */
const NOTIFY_RADIUS = 64;
/** 通知节流（tick，≈10 秒） */
const notifyAt = new Map<string, number>();
const NOTIFY_COOLDOWN_TICKS = 200;

let raidPortsReady = false;

// ─── 初始化（main.ts worldLoad 后调用一次） ──────────────

/**
 * 初始化劫掠机制：effectAdd 监听不祥之兆/袭击之兆/村庄英雄 →
 * 更新事件状态 + 触发领域事件（raidStarted / raidVictory / raidPhase）+ 一次性提醒。
 * 幂等守卫防重复订阅（对齐 initTridentTracker 模式）。
 */
export function initRaidPorts(): void {
  if (raidPortsReady) return;
  raidPortsReady = true;
  world.afterEvents.effectAdd.subscribe(handleEffectAdd);
}

/**
 * 清理假人劫掠状态（删除假人时调用）：胜利计数/事件时刻/阶段估算/饮用互斥，
 * 防止同名重建假人继承旧状态。
 */
export function cleanupRaidMode(botName: string): void {
  victoryCounts.delete(botName);
  lastHeroTick.delete(botName);
  handledHeroTick.delete(botName);
  convertedToRaidTick.delete(botName);
  raidOmenSince.delete(botName);
  raidPhaseStates.delete(botName);
  drinking.delete(botName);
}

// ─── 事件监听 ──────────────────────────────────────────

function handleEffectAdd(e: EffectAddAfterEvent): void {
  try {
    const effect = e.effect;
    const typeId = (effect?.typeId as string | undefined) ?? "";
    const amp = effect?.amplifier ?? 0;
    const name = e.entity?.nameTag ?? "";
    const record = botRegistry.get(name);

    // 调试：所有 MockPlayer 假人的效果事件都打印，确认村庄英雄等效果真实 typeId
    if (record) {
      console.info(`[MockPlayer] ${name} 效果事件 typeId=${typeId || "(空)"} Lv.${amp}`);
    }

    if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
    if (!typeId) return;

    const kind = classifyRaidEffect(typeId);
    if (!kind) return;

    if (kind === "raid-omen") {
      // ⚠️ 转化时刻记录：不祥之兆结束检查据此区分"已转化（袭击酝酿/进行中）"
      //    与"未转化（不在村庄）"——袭击开始后 raid_omen 移除但无兆头 ≠ 不在村庄
      convertedToRaidTick.set(name, system.currentTick);
      // ⚠️ 袭击即将开始：获得袭击之兆 = 30 秒后 buff 结束、袭击完全开始
      //    （基岩版机制：袭击之兆 0:30，结束后在获得位置触发袭击）
      raidOmenSince.set(name, system.currentTick);
      // ⚠️ **劫掠开始信号**（用户规格 1.1.67）：只有转化为袭击之兆才是真正的劫掠
      //    开始——不祥之兆可能 100 分钟挂着（不在村庄）或转化为试炼之兆，不算劫掠
      raidStarted.trigger({ botName: name, amplifier: amp });
      const loc = e.entity.location;
      setRaidPhase(name, "pre-trigger", "预触发：获得袭击之兆，30 秒后袭击完全开始");
      console.info(
        `[MockPlayer] ${name} 袭击即将开始（袭击之兆 30 秒后完全开始）——触发点 (${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)})`,
      );
      scheduleRaidStartCheck(name);
      scheduleTruceCheck(name);
      return;
    }

    // 不祥之兆 = 喝瓶成功（在村庄内会转化为袭击之兆；也可能试炼之兆/100 分钟挂着）
    if (kind === "bad-omen") {
      scheduleBadOmenEndCheck(name); // 30 秒后检查是否转化为袭击之兆（不在村庄提醒）
      return;
    }

    // 村庄英雄 = 袭击胜利：记录事件时刻（树经 sense 读取，窗口内执行胜利处理）
    if (kind === "village-hero") {
      lastHeroTick.set(name, system.currentTick);
      raidVictory.trigger({ botName: name, amplifier: amp });
    }
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠效果监听异常: ${err}`);
  }
}

// ─── 端口实现 ────────────────────────────────────────────

export const raidPorts: RaidPorts = {
  isBotAvailable(botName: string): boolean {
    const record = botRegistry.get(botName);
    return !!record && record.online && !record.death;
  },

  sense(botName: string): RaidKnowledge {
    const bot = resolveBotPlayer(botName);
    if (!bot || !bot.isValid) {
      return {
        effects: { badOmen: false, raidOmen: false, villageHero: false },
        bottles: 0,
        lastHeroEventTick: -Infinity,
      };
    }
    return {
      effects: {
        badOmen: hasEffect(bot, BAD_OMEN),
        raidOmen: hasEffect(bot, RAID_OMEN),
        villageHero: hasEffect(bot, VILLAGE_HERO),
      },
      bottles: countBottles(bot),
      lastHeroEventTick: lastHeroTick.get(botName) ?? -Infinity,
    };
  },

  async drinkBottle(botName: string): Promise<RaidDrinkResult> {
    const record = botRegistry.get(botName);
    const bot = resolveBotPlayer(botName);
    if (!record || !bot || !bot.isValid) return "error";
    if (drinking.has(botName)) return "error"; // 互斥：饮用中不重复触发

    // ⚠️ 防御：清理残留村庄英雄（正常流程胜利处理已移除；事件丢失残留会断
    //    effectAdd 检测链——喝瓶前兜底清理，失败不影响喝瓶）
    try {
      if (hasEffect(bot, VILLAGE_HERO)) {
        bot.removeEffect(VILLAGE_HERO as any);
        console.info(`[MockPlayer] 劫掠模式 ${botName} 清理残留村庄英雄`);
      }
    } catch {
      /* 清理失败不影响喝瓶 */
    }

    const container = safeGetContainer(bot);
    if (!container) return "error";

    const targetSlot = bot.selectedSlotIndex ?? 0;

    // ① 主手已是药水 → 直接喝
    const mainhand = container.getItem(targetSlot);
    if (mainhand && isOminousBottle(mainhand.typeId)) {
      return drinkBottleAsync(bot, record, targetSlot, null);
    }

    // ② 主手不是药水 → 记录主手 → 找药水互换
    const bottleSlot = findOminousBottleSlot(container);
    if (bottleSlot === -1) {
      // ⚠️ 无瓶自动关模式（原 raidMode 语义）：刷袭击 farm 无瓶无意义
      disableRaidMode(botName, record, "背包里没有不祥之瓶了，请补充后重新开启劫掠模式");
      return "no-bottle";
    }
    if (bottleSlot === targetSlot) {
      return drinkBottleAsync(bot, record, targetSlot, null); // 防御分支
    }

    try {
      const bottle = container.getItem(bottleSlot);
      container.setItem(targetSlot, bottle); // 药水 → 主手
      container.setItem(bottleSlot, mainhand); // 主手原物品 → 药水原槽（互换）
    } catch (e) {
      console.warn(`[MockPlayer] 劫掠模式 ${botName} 互换药水失败: ${e}`);
      return "error";
    }
    return drinkBottleAsync(bot, record, targetSlot, { slot: bottleSlot });
  },

  handleVictory(botName: string): void {
    const record = botRegistry.get(botName);
    if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;

    // ⚠️ 幂等：已处理过当前英雄事件（removeEffect 失败残留时防重复叠加/刷屏）
    const last = lastHeroTick.get(botName) ?? 0;
    if ((handledHeroTick.get(botName) ?? 0) >= last) return;
    handledHeroTick.set(botName, last);

    const bot = resolveBotPlayer(botName);
    const alive = bot && bot.isValid && !record.death ? bot : undefined;
    processVictory(record, alive);
  },

  idle(botName: string, reason: RaidIdleReason): void {
    if (reason === "waiting") return; // 袭击中/胜利待处理：静默等待（零通知）
    // no-bottle：drinkBottle 已自动关模式并通知；此处兜底（关闭失败时提醒）
    const record = botRegistry.get(botName);
    const bot = resolveBotPlayer(botName);
    if (!record || !bot) return;
    notifyThrottled(bot, record.name, "背包里没有不祥之瓶了，请补充后重新开启劫掠模式");
  },
};

// ─── 胜利处理 ────────────────────────────────────────────

/** 处理一场袭击胜利：计胜 → 世界消息 → 村庄英雄叠加给主人 → 移除假人英雄 */
function processVictory(record: BotRecord, bot: SimulatedPlayer | undefined): void {
  const botName = record.name;

  const wins = (victoryCounts.get(botName) ?? 0) + 1;
  victoryCounts.set(botName, wins);
  setRaidPhase(botName, "victory", `胜利：获得村庄英雄，本次劫掠胜利（第 ${wins} 胜）`);

  const amplifier = bot ? (tryGetEffect(bot, VILLAGE_HERO)?.amplifier ?? 0) : 0;
  world.sendMessage(
    `${color.muted}[${color.success}假人${color.muted}] ${color.success}${botName} 获得村庄英雄 Lv.${amplifier + 1}，本次劫掠胜利！` +
      `${color.muted}（第 ${wins} 胜）`,
  );

  if (!bot) return;

  // ⚠️ 村庄英雄持续 40 分钟，不主动移除则下一次胜利不会重新触发 effectAdd →
  //    检测链断。移除前先把剩余时长叠加给主人。
  grantVillageHeroToOwner(bot, record);

  try {
    bot.removeEffect(VILLAGE_HERO as any);
  } catch (err) {
    console.warn(`[MockPlayer] ${botName} 移除村庄英雄失败: ${err}`);
  }
  // 下一瓶由树自然触发（下 tick 无兆头 + 有药水 → 喝瓶分支）
}

/** 把假人身上的村庄英雄叠加给主人：主人已有 → 剩余时长相加、等级取高 */
function grantVillageHeroToOwner(bot: SimulatedPlayer, record: BotRecord): void {
  const ownerName = record.ownerName;
  if (!ownerName) return;
  try {
    const hero = bot.getEffect(VILLAGE_HERO as any);
    if (!hero) return;

    const owner = world.getPlayers({ name: ownerName })[0];
    if (!owner || !owner.isValid) {
      world.sendMessage(
        `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${record.name} 的村庄英雄未能转移：主人 ${ownerName} 不在线`,
      );
      return;
    }

    const own = tryGetEffect(owner, VILLAGE_HERO);
    const duration = Math.min(hero.duration + (own?.duration ?? 0), 20_000_000);
    const amplifier = Math.max(hero.amplifier, own?.amplifier ?? 0);

    owner.addEffect(VILLAGE_HERO as any, duration, { amplifier });
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 的村庄英雄已叠加给 ${ownerName}` +
        `${color.muted}（Lv.${amplifier + 1}，合计约 ${Math.round(duration / 1200)} 分钟）`,
    );
  } catch (err) {
    console.warn(`[MockPlayer] ${record.name} 村庄英雄转移给主人失败: ${err}`);
  }
}

// ─── 袭击阶段（事件驱动，通知玩家） ─────────────────────
// 阶段仅由核心事件驱动（预触发/开始/胜利/停战）——波次/冷却/生成估算已移除
// （用户实测无用，2.0.0）。每次阶段变化：状态 + 日志 + raidPhase 事件 +
// **通知玩家**（主人不受距离限制 + 附近 64 格玩家，Set 去重）。

/** 设置/更新袭击阶段（状态 + 日志 + 领域事件 + 通知玩家；不参与核心流程决策） */
function setRaidPhase(botName: string, phase: RaidPhase, detail: string): void {
  const prev = raidPhaseStates.get(botName) ?? initialRaidPhaseState();
  if (prev.phase === phase) return; // 同阶段不重复
  raidPhaseStates.set(botName, { ...prev, phase });
  console.info(`[MockPlayer] 劫掠 ${botName} 阶段 → ${detail}`);
  raidPhase.trigger({ botName, phase, detail });
  // 通知玩家：主人（无论距离）+ 附近玩家（NOTIFY_RADIUS 内，排除假人自己），去重
  const bot = resolveBotPlayer(botName);
  if (bot) notifyRaidPhase(bot, botName, detail);
}

/** 阶段通知：主人 + 附近玩家（Set 去重——主人在附近时不重复发送） */
function notifyRaidPhase(bot: SimulatedPlayer, botName: string, detail: string): void {
  try {
    const record = botRegistry.get(botName);
    const targets = new Set<Player>();
    if (record?.ownerName) {
      const owner = world.getPlayers({ name: record.ownerName })[0];
      if (owner) targets.add(owner);
    }
    for (const p of world.getPlayers()) {
      if (p.name === botName) continue;
      const dx = p.location.x - bot.location.x;
      const dz = p.location.z - bot.location.z;
      if (Math.hypot(dx, dz) <= NOTIFY_RADIUS) targets.add(p);
    }
    const msg = `${color.playerName}[劫掠] ${color.success}${botName} ${color.muted}${detail}`;
    for (const t of targets) t.sendMessage(msg);
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// ─── 一次性检查（非轮询，只记录/提醒） ──────────────────
// ⚠️ 基岩版药水机制（用户规格 1.1.63）：
//   - 喝不祥之瓶 → 不祥之兆（bad_omen）
//   - **不在村庄/试炼之地**：bad_omen 挂 **100 分钟**（不转化，袭击不触发）
//   - **在村庄/试炼之地内喝**：bad_omen 转化为**袭击之兆（raid_omen，30 秒）**→ 袭击
//   - **已有凶兆不转化**：带着 bad_omen 进村庄不会自动转化，需在村庄内**重复喝**才转化
//   - 袭击中阶段（raid_omen 或袭击进行中）不喝药水（树 canDrink + raidWaiting 保证）

/** 转化等待检查窗口（tick）：喝瓶后 30 秒 = 600 tick 内未转化为袭击之兆 → 不在村庄 */
const CONVERT_CHECK_TICKS = 600;
/** 袭击之兆持续时间（tick）：基岩版 raid_omen 30 秒 = 600 tick；结束后袭击完全开始 */
const RAID_OMEN_DURATION_TICKS = 600;

/**
 * 停战检查（一次性，非轮询）：袭击持续 40 分钟未结束 → 平局中止（通知 + 记录）。
 * 排程于获得袭击之兆时（+ 48000 tick ≈ 40 分钟）。
 * ⚠️ 新一轮袭击已开始（raidOmenSince 更新）→ 旧排程作废跳过，防误报。
 */
function scheduleTruceCheck(botName: string): void {
  const scheduledAt = system.currentTick;

  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
      // 新一轮袭击已开始 → 跳过（旧排程作废）
      if ((raidOmenSince.get(botName) ?? 0) > scheduledAt) return;
      // 当前已是胜利阶段（已结算）→ 跳过
      const state = raidPhaseStates.get(botName) ?? initialRaidPhaseState();
      if (state.phase === "victory") return;
      setRaidPhase(botName, "truce", "停战：袭击 40 分钟未结束，平局中止");
    } catch (err) {
      console.warn(`[MockPlayer] 劫掠停战检查异常: ${err}`);
    }
  }, RAID_TRUCE_TICKS);
}

/**
 * 袭击完全开始检查（一次性，非轮询）：获得袭击之兆 30 秒后——
 * buff 结束（实体不再带袭击之兆）= 袭击已完全开始（基岩版机制：
 * 袭击之兆结束后在玩家获得效果的位置开始袭击）。
 * ⚠️ 2.8.0 无 effectRemove 事件，用一次性定时检测记录"袭击完全开始"。
 *    带袭击之兆本身是正常状态（30 秒后必然触发袭击），不报警。
 */
function scheduleRaidStartCheck(botName: string): void {
  const scheduledAt = system.currentTick;

  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
      const bot = resolveBotPlayer(botName);
      if (!bot || !bot.isValid) return;

      // buff 已结束 → 袭击完全开始（记录；若期间已胜利则无影响）
      if (!hasEffect(bot, RAID_OMEN)) {
        console.info(`[MockPlayer] ${botName} 袭击之兆已结束，袭击完全开始`);
        setRaidPhase(botName, "started", "袭击完全开始！");
      }
      // buff 仍在（异常，游戏机制下 30 秒后必然开始）→ 仅记录，不打扰玩家
      else {
        console.warn(`[MockPlayer] ${botName} 袭击之兆超时未结束（${RAID_OMEN_DURATION_TICKS}tick 后仍在）`);
      }
    } catch (err) {
      console.warn(`[MockPlayer] 劫掠袭击开始检查异常: ${err}`);
    }
  }, RAID_OMEN_DURATION_TICKS);
}

/**
 * 不在村庄检查（一次性，非轮询）：喝瓶 30 秒后——
 * **未转化为袭击之兆**（bad_omen 挂着 100 分钟是正常的，转化只发生在
 * 村庄/试炼之地内喝）→ 假人不在村庄/试炼之地范围 → **通知主人**。
 * ⚠️ 只发消息，零恢复动作；已有凶兆不会自动转化，需玩家把假人带到
 *    村庄/试炼之地后**重新开启劫掠模式**（树重建 → 在村庄内喝 → 转化）。
 */
function scheduleBadOmenEndCheck(botName: string): void {
  const scheduledAt = system.currentTick;

  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
      const bot = resolveBotPlayer(botName);
      if (!bot || !bot.isValid) return;

      // 已转化（本次喝瓶之后出现过袭击之兆）→ 袭击酝酿/进行中 → 正常，跳过
      if ((convertedToRaidTick.get(botName) ?? 0) > scheduledAt) return;
      // 袭击之兆还在（转化后尚未开始）→ 正常，跳过
      if (hasEffect(bot, RAID_OMEN)) return;

      // 未转化 → 假人不在村庄/试炼之地（bad_omen 100 分钟挂着不会转化）→ 通知主人
      world.sendMessage(
        `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName} 不祥之兆未转化为袭击之兆——` +
          `${color.muted}假人不在村庄/试炼之地范围内，袭击不会触发。请把假人带到村庄/试炼之地后重新开启劫掠模式`,
      );
    } catch (err) {
      console.warn(`[MockPlayer] 劫掠不在村庄检查异常: ${err}`);
    }
  }, CONVERT_CHECK_TICKS);
}

// ─── 饮用不祥之瓶（Promise 协程） ────────────────────────

/** 异步饮用链：蓄力 → 按住 1.6s → 松开 → 互换过的把主手换回 → resolve */
function drinkBottleAsync(
  bot: SimulatedPlayer,
  record: BotRecord,
  slot: number,
  swap: { slot: number } | null,
): Promise<RaidDrinkResult> {
  return new Promise((resolve) => {
    const botName = record.name;
    drinking.add(botName);
    bot.selectedSlotIndex = slot;

    // 蓄力饮用（等 2 tick 让实体就绪）
    system.runTimeout(() => {
      // ⚠️ 实体有效性防护：异步回调时实体可能已死亡/下线/重建（旧引用失效）
      if (!bot.isValid) {
        drinking.delete(botName);
        resolve("error");
        return;
      }

      let used = false;
      try {
        used = bot.useItemInSlot(slot);
      } catch (e) {
        console.warn(`[MockPlayer] 劫掠模式 ${botName} useItemInSlot 异常: ${e}`);
      }
      if (!used) {
        drinking.delete(botName);
        if (swap) swapBackMainhand(bot, slot, swap);
        resolve("error");
        return;
      }

      // 等待饮用动画完成后松开（不祥之瓶需按住 ~1.6s 才消耗完）
      system.runTimeout(() => {
        try {
          if (bot.isValid) bot.stopUsingItem();
        } catch {
          /* ignore */
        }
        if (swap) swapBackMainhand(bot, slot, swap);
        drinking.delete(botName);
        console.info(`[MockPlayer] 劫掠模式 ${botName} 已喝下不祥之瓶`);
        resolve("drunk");
      }, DRINK_DURATION);
    }, 2);
  });
}

/** 把互换过的主手换回：药水原槽存放主手原物品，饮用成功则清空该槽、被打断则把残留药水放回 */
function swapBackMainhand(bot: SimulatedPlayer, slot: number, swap: { slot: number }): void {
  try {
    const container = safeGetContainer(bot);
    if (!container) return;

    const current = container.getItem(slot);
    const saved = container.getItem(swap.slot);

    if (current && isOminousBottle(current.typeId)) {
      // 饮用被打断：药水仍在选中槽 → 放回原药水槽，主手原物品放回选中槽
      container.setItem(swap.slot, current);
      container.setItem(slot, saved ?? undefined);
    } else {
      // 饮用成功：药水已消耗，选中槽空 → 主手原物品从药水原槽放回，并清空药水原槽
      container.setItem(slot, saved ?? undefined);
      container.setItem(swap.slot, undefined);
    }
    bot.selectedSlotIndex = slot;
  } catch (e) {
    console.warn(`[MockPlayer] 劫掠模式恢复主手失败: ${e}`);
  }
}

// ─── 工具函数 ──────────────────────────────────────────

function safeGetContainer(bot: SimulatedPlayer): Container | undefined {
  try {
    const inv = bot.getComponent("minecraft:inventory") as { container?: Container } | undefined;
    return inv?.container;
  } catch {
    return undefined;
  }
}

function findOminousBottleSlot(container: Container): number {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && isOminousBottle(item.typeId)) return i;
  }
  return -1;
}

/** 背包不祥之瓶总数 */
function countBottles(bot: SimulatedPlayer): number {
  const container = safeGetContainer(bot);
  if (!container) return 0;
  let total = 0;
  try {
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item && isOminousBottle(item.typeId)) total += item.amount;
    }
  } catch {
    return 0;
  }
  return total;
}

/** 检测效果（getEffect 对不存在/不支持的 ID 抛异常 → 视为无该效果） */
function hasEffect(bot: SimulatedPlayer | Player, effectId: string): boolean {
  return tryGetEffect(bot, effectId) !== undefined;
}

/** 读取效果对象（无该效果/读取抛错返回 undefined） */
function tryGetEffect(bot: SimulatedPlayer | Player, effectId: string): Effect | undefined {
  try {
    return bot.getEffect(effectId as any);
  } catch {
    return undefined;
  }
}

/** 关闭劫掠模式（移除标签即停用；劫掠为独立开关，与其它行为可共存） */
function disableRaidMode(botName: string, record: BotRecord, message?: string): void {
  record.tags = record.tags.filter((t) => t !== TAG_RAID_MODE.value);
  saveCoordinator.saveRecord(record);

  const bot = resolveBotPlayer(botName);
  if (bot) syncEntityTags(bot, record.tags);

  if (message) {
    world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName}: ${message}`);
  }
}

/** 节流通知（同一个 bot 10 秒内只提醒一次） */
function notifyThrottled(bot: SimulatedPlayer, botName: string, message: string): void {
  const now = system.currentTick;
  const last = notifyAt.get(botName) ?? 0;
  if (now - last < NOTIFY_COOLDOWN_TICKS) return;
  notifyAt.set(botName, now);
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName}: ${message}`);
}
