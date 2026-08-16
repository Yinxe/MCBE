// ─── 劫掠模式（事件驱动轻量模块） ────────────────────────
// 用户拍板：劫掠只是"监听事件 → 喝药 → 监听事件 → 回药"的简单循环，
// 不配作为 task（原 legacy/ai/RaidTask 行为树 + RaidPorts 端口架构已废除）。
// 重写为**纯事件驱动**：effectAdd 直接驱动状态流转，无树、无端口、
// 无 10 tick 感知轮询。
//
// 循环（全部事件/时机驱动，零轮询）：
//   ① 开启/上线/胜利后 → startRaidCycle：可喝（无兆头+有药水+未等待）→ 喝瓶协程
//   ② 喝瓶成功 → 置 session.waiting（等袭击/胜利——兆头消失也不重复喝）+ bad_omen 出现
//   ③ bad_omen → 30 秒一次性转化检查（未转化 → 不在村庄提醒，只发消息）
//   ④ raid_omen（村庄内转化）→ raidStarted + 阶段预触发 + 30 秒袭击开始检查
//   ⑤ village_hero → raidVictory + 胜利处理（计胜/叠加主人/移除英雄）→ 清 waiting → 回到 ①
//   ⑥ 无药水 → 自动关模式（setWorkMode("none")）
//
// 触发时机（事件钩子，替代旧引擎轮询对账）：
//   - botWorkModeChanged（setWorkMode 落库后）：workMode=raid → 启动；≠raid → 停止
//   - botOnline（上线/复活/重启后）：workMode=raid → 启动循环
//   - botOffline：清周期等待（下线中断 → 上线重新喝）
//
// 每假人状态收敛在 RaidSession（sessions 单 Map 管理），领域事件在
// RaidEvents.ts。⚠️ 语义约束全部保留（用户实测拍板）：纯事件驱动 +
// 一次性卡死提醒（零恢复机制）；只在启动/胜利后喝；无药水自动关模式；
// 阶段通知（预触发/开始/胜利/停战）；已有凶兆不转化需重开模式再喝。

import { system, world, type Container, type Effect, type EffectAddAfterEvent, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import {
  BAD_OMEN, RAID_OMEN, VILLAGE_HERO, DRINK_DURATION, RAID_TRUCE_TICKS,
  isOminousBottle, classifyRaidEffect, canDrinkRaid, diagnoseRaidIdle,
  type RaidEffectState,
} from "../../rules/RaidRules";
import { setWorkMode } from "../state/behavior";
import type { BotRecord } from "../../rules/Types";
import { botRegistry } from "../../bootstrap/context";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { BotEvents } from "../../events/DomainEvents";
import { BotUiEvent } from "../../events/UiEvents";
import { raidStarted, raidVictory, raidPhase, type RaidPhase } from "./RaidEvents";

// ─── 常量 ──────────────────────────────────────────────

/** 通知节流（tick，≈10 秒） */
const NOTIFY_COOLDOWN_TICKS = 200;
/** 无瓶重试检查间隔（tick，≈10 秒）：低频兜底——补瓶后自动喝（事件钩子
 *  覆盖开启/上线/胜利后，唯"开启时无瓶 → 补瓶"无事件唤醒，用一次性排程链） */
const NO_BOTTLE_RETRY_TICKS = 200;
/** 阶段通知半径（格）：附近玩家（主人不受距离限制） */
const NOTIFY_RADIUS = 64;
/** 转化等待检查窗口（tick）：喝瓶后 30 秒 = 600 tick 内未转化为袭击之兆 → 不在村庄 */
const CONVERT_CHECK_TICKS = 600;
/** 袭击之兆持续时间（tick）：基岩版 raid_omen 30 秒 = 600 tick；结束后袭击完全开始 */
const RAID_OMEN_DURATION_TICKS = 600;

// ─── 会话状态（每假人一份，单 Map 管理） ────────────────
// 原 9 个平行 Map/Set 收敛为 RaidSession——字段即状态，清理/停止只删 Map 项。

/** 一个假人的劫掠会话状态 */
class RaidSession {
  /** 本周期已喝过（等袭击/胜利；胜利处理/下线时清除 → 允许下一瓶） */
  waiting = false;
  /** 饮用协程进行中（防重复触发饮用链） */
  drinking = false;
  /** 本次会话劫掠胜利次数（仅内存，不持久化） */
  victories = 0;
  /** 最近村庄英雄效果事件 tick（胜利处理幂等判定） */
  lastHeroTick = -Infinity;
  /** 已处理的英雄事件 tick（防 removeEffect 失败重复叠加） */
  handledHeroTick = -Infinity;
  /** 已转化为袭击之兆的 tick（不祥之兆结束检查防误报：转化后袭击酝酿/进行中
   *  无兆头 ≠ 不在村庄） */
  convertedToRaidTick = -Infinity;
  /** 获得袭击之兆的 tick（袭击即将开始；30 秒后 buff 结束 = 袭击完全开始） */
  raidOmenSince = -Infinity;
  /** 袭击阶段（通知用，不干预核心流程） */
  phase: RaidPhase = "idle";
  /** 通知节流时刻 */
  notifyAt = 0;
}

/** botName → 劫掠会话 */
const sessions = new Map<string, RaidSession>();

/** 取会话（不存在则创建——惰性，仅 raid 模式假人进入流程时创建） */
function sessionOf(botName: string): RaidSession {
  let s = sessions.get(botName);
  if (!s) {
    s = new RaidSession();
    sessions.set(botName, s);
  }
  return s;
}

/** 取会话（无会话返回 undefined——避免无谓创建） */
function sessionIf(botName: string): RaidSession | undefined {
  return sessions.get(botName);
}

// ─── 类型 ──────────────────────────────────────────────

/** 喝瓶结果 */
export type RaidDrinkResult = "drunk" | "no-bottle" | "error";

/** 主手互换记录（药水原槽位——饮用后换回用） */
interface BottleSwap {
  slot: number;
}

// ─── 初始化（main.ts worldLoad 后调用一次） ──────────────

/**
 * 初始化劫掠模式（幂等）：effectAdd 监听（兆头/英雄 → 流程推进）+
 * 生命周期/工作模式/行为菜单订阅（启动/停止循环 + 不在线提示）。
 */
export function initRaidMode(): void {
  if (raidModeReady) return;
  raidModeReady = true;

  world.afterEvents.effectAdd.subscribe(handleEffectAdd);

  // 上线/复活（含服务器重启后假人重新生成）→ workMode=raid → 启动循环
  BotEvents.botOnline.subscribe((e) => startRaidCycle(e.botName));

  // 下线 → 清周期等待（下线中断本周期 → 上线重新喝第一瓶）
  BotEvents.botOffline.subscribe((e) => {
    const s = sessionIf(e.botName);
    if (s) s.waiting = false;
  });

  // 工作模式变更（setWorkMode 落库后发布）：raid → 启动；其它 → 停止
  BotEvents.botWorkModeChanged.subscribe((e) => {
    if (e.workMode === "raid") {
      startRaidCycle(e.botName);
    } else {
      stopRaidMode(e.botName);
    }
  });

  // 行为菜单提交：开启劫掠但不在线 → 提示（在线场景由 botWorkModeChanged 启动循环）
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    if (e.workMode !== "raid") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const record = botRegistry.get(e.botName);
    if (record && (!record.online || record.death)) {
      player.sendMessage(
        `${color.playerName}[劫掠] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动喝第一瓶`,
      );
    }
  });
}

let raidModeReady = false;

/** 清理假人劫掠会话（删除假人时调用）：防同名重建假人继承旧状态 */
export function cleanupRaidMode(botName: string): void {
  sessions.delete(botName);
}

/** 停止循环（切到其它工作模式）：清周期等待 + 释放饮用互斥。
 *  ⚠️ 排程检查回调内有 workMode 守卫，自然失效；阶段/计数状态保留
 *    （与旧实现一致，仅删除假人时清）。 */
function stopRaidMode(botName: string): void {
  const s = sessionIf(botName);
  if (!s) return;
  s.waiting = false;
  s.drinking = false;
}

// ─── 启动循环（喝瓶判定 + 协程） ────────────────────────

/**
 * 启动一轮劫掠循环：可喝（无兆头 + 有药水 + 未在周期等待）→ 喝瓶协程。
 * 事件钩子幂等（多次触发自然去重：drinking 互斥 + 条件判定）。
 * 不可喝时诊断：无药水 → 通知（节流）+ 排程低频重试（补瓶后自动喝）；
 * 袭击中/周期等待 → 静默（等事件唤醒）。
 */
function startRaidCycle(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record || record.workMode !== "raid") return;
  const s = sessionOf(botName);
  if (s.drinking) return; // 饮用中不重复触发
  const bot = resolveBotPlayer(botName);
  if (!bot || !bot.isValid) return;
  const effects = readRaidEffects(bot);
  const bottles = countBottles(bot);
  if (!canDrinkRaid(effects, bottles, s.waiting)) {
    // 无药水 → 提醒（节流）+ 低频重试（补瓶后自动喝）；其余原因静默等待
    if (diagnoseRaidIdle(effects, bottles, s.waiting) === "no-bottle") {
      notifyThrottled(bot, botName, "背包里没有不祥之瓶了，请补充（补充后自动继续）");
      scheduleNoBottleRetry(botName);
    }
    return;
  }
  void drinkBottle(botName);
}

/** 无瓶低频重试（一次性排程链：10 秒后重试；模式已关/已喝 → 终止） */
function scheduleNoBottleRetry(botName: string): void {
  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || record.workMode !== "raid") return;
      const s = sessionIf(botName);
      if (!s || s.waiting || s.drinking) return;
      startRaidCycle(botName); // 内部 canDrink 判定：有瓶 → 喝；无瓶 → 再通知+再排程
    } catch {
      /* 忽略 */
    }
  }, NO_BOTTLE_RETRY_TICKS);
}

/** 喝瓶协程：互斥 → 换瓶/直接喝 → 饮用链；成功 → 置周期等待（等袭击/胜利） */
async function drinkBottle(botName: string): Promise<void> {
  const record = botRegistry.get(botName);
  const bot = resolveBotPlayer(botName);
  if (!record || !bot || !bot.isValid) return;

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
  if (!container) return;
  const targetSlot = bot.selectedSlotIndex ?? 0;

  // ① 主手已是药水 → 直接喝
  const mainhand = container.getItem(targetSlot);
  if (mainhand && isOminousBottle(mainhand.typeId)) {
    return finishDrink(botName, await drinkBottleAsync(bot, botName, targetSlot, null));
  }

  // ② 主手不是药水 → 记录主手 → 找药水互换
  const bottleSlot = findOminousBottleSlot(container);
  if (bottleSlot === -1) {
    // ⚠️ 无瓶自动关模式：刷袭击 farm 无瓶无意义
    disableRaidMode(botName, record, "背包里没有不祥之瓶了，请补充后重新开启劫掠模式");
    return;
  }
  if (bottleSlot === targetSlot) {
    return finishDrink(botName, await drinkBottleAsync(bot, botName, targetSlot, null)); // 防御分支
  }

  try {
    const bottle = container.getItem(bottleSlot);
    container.setItem(targetSlot, bottle); // 药水 → 主手
    container.setItem(bottleSlot, mainhand); // 主手原物品 → 药水原槽（互换）
  } catch (e) {
    console.warn(`[MockPlayer] 劫掠模式 ${botName} 互换药水失败: ${e}`);
    return;
  }
  return finishDrink(botName, await drinkBottleAsync(bot, botName, targetSlot, { slot: bottleSlot }));
}

/** 饮用结果收尾：成功 → 置周期等待（模式已关则跳过——stopRaidMode 竞态防护） */
function finishDrink(botName: string, result: RaidDrinkResult): void {
  if (result !== "drunk") return;
  const record = botRegistry.get(botName);
  if (record?.workMode === "raid") sessionOf(botName).waiting = true;
}

// ─── 效果事件监听（核心循环驱动） ───────────────────────

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

    if (!record || record.workMode !== "raid") return;
    if (!typeId) return;

    const kind = classifyRaidEffect(typeId);
    if (!kind) return;

    if (kind === "raid-omen") {
      // ⚠️ 转化时刻记录：不祥之兆结束检查据此区分"已转化（袭击酝酿/进行中）"
      //    与"未转化（不在村庄）"——袭击开始后 raid_omen 移除但无兆头 ≠ 不在村庄
      const s = sessionOf(name);
      s.convertedToRaidTick = system.currentTick;
      // ⚠️ 袭击即将开始：获得袭击之兆 = 30 秒后 buff 结束、袭击完全开始
      //    （基岩版机制：袭击之兆 0:30，结束后在获得位置触发袭击）
      s.raidOmenSince = system.currentTick;
      // ⚠️ **劫掠开始信号**：只有转化为袭击之兆才是真正的劫掠开始——
      //    不祥之兆可能 100 分钟挂着（不在村庄）或转化为试炼之兆，不算劫掠
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

    // 村庄英雄 = 袭击胜利：记录事件时刻 + 胜利处理（幂等）→ 完成后自动喝下一瓶
    if (kind === "village-hero") {
      sessionOf(name).lastHeroTick = system.currentTick;
      raidVictory.trigger({ botName: name, amplifier: amp });
      // 延迟一拍处理（effectAdd 回调内避免世界操作风险——removeEffect/addEffect）
      system.run(() => handleVictory(name));
    }
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠效果监听异常: ${err}`);
  }
}

// ─── 胜利处理 ────────────────────────────────────────────

/** 胜利处理（幂等：已处理过当前英雄事件 → 跳过；防 removeEffect 失败重复叠加） */
function handleVictory(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record || record.workMode !== "raid") return;
  const s = sessionOf(botName);

  if (s.handledHeroTick >= s.lastHeroTick) return;
  s.handledHeroTick = s.lastHeroTick;

  const bot = resolveBotPlayer(botName);
  const alive = bot && bot.isValid && !record.death ? bot : undefined;
  processVictory(record, alive);
}

/** 处理一场袭击胜利：计胜 → 世界消息 → 村庄英雄叠加给主人 → 移除假人英雄 →
 *  清周期等待 → 喝下一瓶（回药循环） */
function processVictory(record: BotRecord, bot: SimulatedPlayer | undefined): void {
  const botName = record.name;
  const s = sessionOf(botName);
  s.victories += 1;

  setRaidPhase(botName, "victory", `胜利：获得村庄英雄，本次劫掠胜利（第 ${s.victories} 胜）`);

  const amplifier = bot ? (tryGetEffect(bot, VILLAGE_HERO)?.amplifier ?? 0) : 0;
  botBroadcast(
    `${color.success}${botName} 获得村庄英雄 Lv.${amplifier + 1}，本次劫掠胜利！` +
      `${color.muted}（第 ${s.victories} 胜）`,
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

  // 下一瓶：清周期等待 → 事件钩子语义（胜利后重新喝）
  s.waiting = false;
  startRaidCycle(botName);
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
      botBroadcast(`${color.warn}${record.name} 的村庄英雄未能转移：主人 ${ownerName} 不在线`);
      return;
    }

    const own = tryGetEffect(owner, VILLAGE_HERO);
    const duration = Math.min(hero.duration + (own?.duration ?? 0), 20_000_000);
    const amplifier = Math.max(hero.amplifier, own?.amplifier ?? 0);

    owner.addEffect(VILLAGE_HERO as any, duration, { amplifier });
    botBroadcast(
      `${color.success}${record.name} 的村庄英雄已叠加给 ${ownerName}` +
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
  const s = sessionOf(botName);
  if (s.phase === phase) return; // 同阶段不重复
  s.phase = phase;
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
// ⚠️ 基岩版药水机制（用户规格）：
//   - 喝不祥之瓶 → 不祥之兆（bad_omen）
//   - **不在村庄/试炼之地**：bad_omen 挂 **100 分钟**（不转化，袭击不触发）
//   - **在村庄/试炼之地内喝**：bad_omen 转化为**袭击之兆（raid_omen，30 秒）**→ 袭击
//   - **已有凶兆不转化**：带着 bad_omen 进村庄不会自动转化，需在村庄内**重复喝**才转化
//   - 袭击中阶段（raid_omen 或袭击进行中）不喝药水（canDrinkRaid + waiting 保证）

/**
 * 一次性排程检查（非轮询）：延迟 ticks 后执行 check，公共守卫统一处理
 * （模式已关跳过 + 异常隔离），check 内只写具体判定。scheduledAt 供
 * "本次排程之后发生的事件"比较（旧排程作废判定）。
 */
function scheduleOnce(botName: string, ticks: number, label: string, check: (scheduledAt: number) => void): void {
  const scheduledAt = system.currentTick;
  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || record.workMode !== "raid") return;
      check(scheduledAt);
    } catch (err) {
      console.warn(`[MockPlayer] 劫掠${label}检查异常: ${err}`);
    }
  }, ticks);
}

/**
 * 停战检查：袭击持续 40 分钟未结束 → 平局中止（通知 + 记录）。
 * ⚠️ 新一轮袭击已开始（raidOmenSince 更新）→ 旧排程作废跳过，防误报。
 */
function scheduleTruceCheck(botName: string): void {
  scheduleOnce(botName, RAID_TRUCE_TICKS, "停战", (at) => {
    const s = sessionOf(botName);
    if (s.raidOmenSince > at) return; // 新一轮袭击已开始 → 旧排程作废
    if (s.phase === "victory") return; // 当前已是胜利阶段（已结算）
    setRaidPhase(botName, "truce", "停战：袭击 40 分钟未结束，平局中止");
  });
}

/**
 * 袭击完全开始检查：获得袭击之兆 30 秒后——buff 结束（实体不再带袭击之兆）
 * = 袭击已完全开始（基岩版机制：袭击之兆结束后在玩家获得效果的位置开始袭击）。
 * ⚠️ 2.8.0 无 effectRemove 事件，用一次性定时检测记录"袭击完全开始"。
 *    带袭击之兆本身是正常状态（30 秒后必然触发袭击），不报警。
 */
function scheduleRaidStartCheck(botName: string): void {
  scheduleOnce(botName, RAID_OMEN_DURATION_TICKS, "袭击开始", () => {
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
  });
}

/**
 * 不在村庄检查：喝瓶 30 秒后——**未转化为袭击之兆**（bad_omen 挂着 100 分钟
 * 是正常的，转化只发生在村庄/试炼之地内喝）→ 假人不在村庄/试炼之地范围 →
 * **通知主人**。⚠️ 只发消息，零恢复动作；已有凶兆不会自动转化，需玩家把
 * 假人带到村庄/试炼之地后**重新开启劫掠模式**（workMode 重选 raid →
 * startRaidCycle → 在村庄内喝 → 转化）。
 */
function scheduleBadOmenEndCheck(botName: string): void {
  scheduleOnce(botName, CONVERT_CHECK_TICKS, "不在村庄", (at) => {
    const s = sessionOf(botName);
    if (s.convertedToRaidTick > at) return; // 已转化（本次喝瓶之后出现过袭击之兆）→ 正常
    const bot = resolveBotPlayer(botName);
    if (!bot || !bot.isValid) return;
    if (hasEffect(bot, RAID_OMEN)) return; // 袭击之兆还在（转化后尚未开始）→ 正常

    // 未转化 → 假人不在村庄/试炼之地（bad_omen 100 分钟挂着不会转化）→ 通知主人
    botBroadcast(
      `${color.warn}${botName} 不祥之兆未转化为袭击之兆——` +
        `${color.muted}假人不在村庄/试炼之地范围内，袭击不会触发。请把假人带到村庄/试炼之地后重新开启劫掠模式`,
    );
  });
}

// ─── 饮用不祥之瓶（Promise 协程） ────────────────────────

/** 异步饮用链：蓄力 → 按住 1.6s → 松开 → 互换过的把主手换回 → resolve */
function drinkBottleAsync(
  bot: SimulatedPlayer,
  botName: string,
  slot: number,
  swap: BottleSwap | null,
): Promise<RaidDrinkResult> {
  return new Promise((resolve) => {
    const s = sessionOf(botName);
    s.drinking = true;
    bot.selectedSlotIndex = slot;

    // 蓄力饮用（等 2 tick 让实体就绪）
    system.runTimeout(() => {
      // ⚠️ 实体有效性防护：异步回调时实体可能已死亡/下线/重建（旧引用失效）
      if (!bot.isValid) {
        s.drinking = false;
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
        s.drinking = false;
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
        s.drinking = false;
        console.info(`[MockPlayer] 劫掠模式 ${botName} 已喝下不祥之瓶`);
        resolve("drunk");
      }, DRINK_DURATION);
    }, 2);
  });
}

/** 把互换过的主手换回：药水原槽存放主手原物品，饮用成功则清空该槽、被打断则把残留药水放回 */
function swapBackMainhand(bot: SimulatedPlayer, slot: number, swap: BottleSwap): void {
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

/** 读取效果状态（决策输入） */
function readRaidEffects(bot: SimulatedPlayer): RaidEffectState {
  return { badOmen: hasEffect(bot, BAD_OMEN), raidOmen: hasEffect(bot, RAID_OMEN) };
}

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

/** 关闭劫掠模式（无瓶自动关：setWorkMode("none") 唯一渠道 → 落库 +
 *  botWorkModeChanged → stopRaidMode 停止循环） */
function disableRaidMode(botName: string, record: BotRecord, message?: string): void {
  setWorkMode(record, "none");
  if (message) botBroadcast(`${color.warn}${botName}: ${message}`);
}

/** 节流通知（同一个 bot 10 秒内只提醒一次） */
function notifyThrottled(bot: SimulatedPlayer, botName: string, message: string): void {
  const now = system.currentTick;
  const s = sessionOf(botName);
  if (now - s.notifyAt < NOTIFY_COOLDOWN_TICKS) return;
  s.notifyAt = now;
  botBroadcast(`${color.warn}${botName}: ${message}`);
}

/** 假人公告（世界消息统一前缀） */
function botBroadcast(text: string): void {
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${text}`);
}
