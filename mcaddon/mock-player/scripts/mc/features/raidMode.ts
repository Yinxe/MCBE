// ─── 劫掠模式（事件驱动 + 兜底巡检） ──────────────────
// 假人持续刷袭击（raid）farm：喝不祥之瓶 → 触发袭击 → 击败袭击获得村庄英雄 → 再喝下一瓶
//
// 以事件驱动为主（无 tick 轮询），辅以 30 秒一次的兜底巡检（raidModeSweep）：
//   开启/上线/重生 → startRaidMode 喝第一瓶
//   喝下成功       → 获得不祥之兆 → 触发 raidStarted（袭击开始）→ 记录袭击预期窗口
//   袭击获胜       → 获得村庄英雄 → 触发 raidVictory → 订阅者把英雄叠加给主人并喝下一瓶
//   胜利但无英雄   → 巡检发现「无任何效果 + 窗口过期 + 附近无袭击者」→ 兜底续喝下一瓶
//   英雄事件丢失   → 巡检发现假人挂着村庄英雄却未处理 → 补记胜利并续瓶
//
// 劫掠信号（raidStarted / raidVictory）定义在 core/events/DomainEvents（假人模块私有）。
// 规则常量/识别（不祥之瓶、效果分类、饮用/卡死/巡检阈值）在 core/service/RaidRules。
// 与假人加载模式无关（普通/强加载均可 useItemInSlot 使用物品）。

import { Container, Effect, EffectAddAfterEvent, Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { resolveBotPlayer } from "../adapters/PlayerGateway";
import { syncEntityTags } from "../adapters/EntityTags";
import { BotEvents } from "../../core/events/DomainEvents";
import type { RaidVictoryEvent } from "../../core/events/DomainEvents";
import { TAG_RAID_MODE } from "../../core/tags/BotTags";
import { BotRecord } from "../../core/model/Types";
import {
  createRaidSession,
  advanceRaidSession,
  type RaidSession,
  type RaidWorldState,
} from "../../core/service/RaidSession";
import {
  BAD_OMEN,
  RAID_OMEN,
  VILLAGE_HERO,
  RAIDER_TYPE_IDS,
  DRINK_DURATION,
  RAID_SWEEP_TICKS,
  RAID_EXPECT_TICKS,
  RAID_FORCE_COOLDOWN,
  isOminousBottle,
  classifyRaidEffect,
} from "../../core/service/RaidRules";

// ─── 全局状态 ──────────────────────────────────────────

/** 正在异步饮用不祥之瓶的假人（防止重复触发饮用链） */
const drinking = new Set<string>();

/** 本次会话劫掠胜利次数（仅内存，与假人绑定，不持久化；重启后清零） */
const victoryCounts = new Map<string, number>();

/** 劫掠会话（每启用劫掠的在线假人一个，状态机推进——见 core/service/RaidSession） */
const raidSessions = new Map<string, RaidSession>();

/** 卡死提醒节流（warn-stuck 每 2 分钟最多一次，防刷屏） */
const lastWarnTick = new Map<string, number>();

let raidEventsReady = false;

// ─── 公开 API ──────────────────────────────────────────

/**
 * 初始化劫掠事件系统。由 main.ts 在 worldLoad 后调用一次：
 *   1. effectAdd 监听不祥之兆/袭击之兆/村庄英雄 → 触发 raidStarted / raidVictory
 *   2. 订阅 raidVictory → 把村庄英雄叠加给主人并喝下一瓶不祥之瓶
 *   3. 订阅假人上线/复活 → 喝第一瓶（替代 playerJoin/playerSpawn 硬编码调用）
 *   4. 30 秒一次兜底巡检 → 恢复事件驱动链的断裂（胜利无英雄/英雄事件丢失/喝瓶静默失败）
 */
export function initRaidModeEffects(): void {
  if (raidEventsReady) return;
  raidEventsReady = true;

  world.afterEvents.effectAdd.subscribe(handleEffectAdd);
  BotEvents.raidVictory.subscribe(handleRaidVictory);
  BotEvents.botOnline.subscribe((e) => startRaidMode(e.botName));
  BotEvents.botRespawn.subscribe((e) => startRaidMode(e.botName));
  // 下线/死亡 → 清理会话（状态机只服务在线假人；上线/重生时重建）
  BotEvents.botOffline.subscribe((e) => removeRaidSession(e.botName));
  BotEvents.botDeath.subscribe((e) => removeRaidSession(e.botName));
  system.runInterval(raidModeSweep, RAID_SWEEP_TICKS);
}

/** 移除假人的劫掠会话（关模式/下线/死亡时清理内存） */
function removeRaidSession(botName: string): void {
  raidSessions.delete(botName);
  drinking.delete(botName);
}

/**
 * 清理假人劫掠状态（删除假人时调用）：胜利计数/胜利时刻/饮用中标记/袭击窗口/续瓶冷却，
 * 防止同名重建假人继承旧胜利次数或残留饮用互斥。
 */
export function cleanupRaidMode(botName: string): void {
  victoryCounts.delete(botName);
  drinking.delete(botName);
  raidSessions.delete(botName);
  lastWarnTick.delete(botName);
}

/**
 * 启动劫掠模式：创建会话并喝下一瓶不祥之瓶（首次开启 / 续瓶 / 死亡重生恢复）。
 * 幂等：已在喝、已有不祥之兆排队、假人不在线/死亡时安全跳过。
 * 由「行为表单开启劫掠开关」「假人上线」「假人重生」三处触发。
 */
export function startRaidMode(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) return;
  if (!record.tags.includes(TAG_RAID_MODE.value)) return; // 模式未开启
  if (record.death || !record.online) return;

  const bot = resolveBotPlayer(botName);
  if (!bot || !bot.isValid) return;

  // 会话不存在 → 新建（drinking 阶段）；存在（重连/重生）→ 保持状态继续
  if (!raidSessions.has(botName)) {
    raidSessions.set(botName, createRaidSession(botName, system.currentTick));
  }
  drinkNextBottle(bot, record);
}

// ─── 事件监听 ──────────────────────────────────────────

function handleEffectAdd(e: EffectAddAfterEvent): void {
  try {
    const effect = e.effect;
    const typeId = (effect?.typeId as string | undefined) ?? "";
    const amp = effect?.amplifier ?? 0;
    const name = e.entity?.nameTag ?? "";
    const record = botRegistry.get(name);

    // 调试：所有 MockPlayer 假人的效果事件都打印，用于确认村庄英雄等效果的真实 typeId/displayName
    if (record) {
      console.info(
        `[MockPlayer] ${name} 效果事件 typeId=${typeId || "(空)"} displayName=${effect?.displayName ?? "?"} Lv.${amp}`
      );
    }

    if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
    if (!typeId) return;

    // core 规则：效果类型分类（袭击之兆/不祥之兆/村庄英雄）
    const kind = classifyRaidEffect(typeId);
    if (!kind) return;

    // 袭击之兆 = 袭击开始 → raiding 阶段（设定预期窗口）
    if (kind === "raid-omen") {
      const loc = e.entity.location;
      console.info(
        `[MockPlayer] ${name} 袭击之兆 → 袭击触发点 (${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)})（≈ raid_omen_position）`
      );
      const session = raidSessions.get(name);      if (session) {
        session.phase = "raiding";
        session.phaseSince = system.currentTick;
        session.windowUntil = system.currentTick + RAID_EXPECT_TICKS;
      }
      return;
    }

    // 不祥之兆 = 喝瓶成功，袭击即将开始 → 状态机推进到 bad-omen 阶段
    if (kind === "bad-omen") {
      BotEvents.raidStarted.trigger({ botName: name, amplifier: amp });
      const session = raidSessions.get(name);
      if (session) {
        session.phase = "bad-omen";
        session.phaseSince = system.currentTick;
      }
      return;
    }

    // 村庄英雄 = 袭击胜利（事件正常路径；丢失由巡检 claim-victory 兜底）
    if (kind === "village-hero") {
      BotEvents.raidVictory.trigger({ botName: name, amplifier: amp });
    }
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠效果监听异常: ${err}`);
  }
}

function handleRaidVictory(e: RaidVictoryEvent): void {
  try {
    const record = botRegistry.get(e.botName);
    if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;

    const bot = resolveBotPlayer(e.botName);
    const alive = bot && bot.isValid && !record.death ? bot : undefined;
    processVictory(record, e.amplifier, alive, false);
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠胜利处理异常: ${err}`);
  }
}

/**
 * 处理一场袭击胜利：计胜 → 把村庄英雄叠加给主人 → 移除假人英雄 → 喝下一瓶。
 * viaSweep=true 表示兜底巡检补记（假人身上挂着村庄英雄但 effectAdd 事件丢失）。
 */
function processVictory(record: BotRecord, amplifier: number, bot: SimulatedPlayer | undefined, viaSweep: boolean): void {
  const botName = record.name;

  // 胜利次数累加（仅内存，不持久化）
  const wins = (victoryCounts.get(botName) ?? 0) + 1;
  victoryCounts.set(botName, wins);
  const session = raidSessions.get(botName);
  if (session) {
    session.wins = wins;
    // 胜利处理完成后进入下一瓶（drinking 阶段）
    session.phase = "drinking";
    session.phaseSince = system.currentTick;
  }

  if (viaSweep) {
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName} 的村庄英雄事件丢失，` +
      `${color.success}兜底补记本次袭击胜利${color.muted}（第 ${wins} 胜）`
    );
  } else {
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.success}${botName} 获得村庄英雄 Lv.${amplifier}，本次劫掠胜利！` +
      `${color.muted}（第 ${wins} 胜）`
    );
  }

  if (!bot) return;

  // ⚠️ 村庄英雄持续 40 分钟，不主动移除的话效果一直挂着：下一次袭击胜利不会重新触发
  //    effectAdd（效果已存在，无法重新获取）→ 检测链断掉。移除前先把剩余时长叠加给主人。
  grantVillageHeroToOwner(bot, record);

  try {
    bot.removeEffect(VILLAGE_HERO as any);
  } catch (err) {
    console.warn(`[MockPlayer] ${botName} 移除村庄英雄失败: ${err}`);
  }

  drinkNextBottle(bot, record); // 进入下一瓶
}

/**
 * 把假人身上的村庄英雄叠加给主人：主人已有 → 剩余时长相加、等级取高；没有 → 直接给。
 * 不依赖引擎的刷新语义，用 getEffect 读剩余时长（tick）后显式相加再 addEffect。
 */
function grantVillageHeroToOwner(bot: SimulatedPlayer, record: BotRecord): void {
  const ownerName = record.ownerName;
  if (!ownerName) return;

  try {
    const hero = bot.getEffect(VILLAGE_HERO as any);
    if (!hero) return;

    const owner = world.getPlayers({ name: ownerName })[0];
    if (!owner || !owner.isValid) {
      world.sendMessage(
        `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${record.name} 的村庄英雄未能转移：主人 ${ownerName} 不在线`
      );
      return;
    }

    const own = tryGetEffect(owner, VILLAGE_HERO);
    // 叠加时长：主人已有英雄则剩余时长相加；等级取高（不覆盖主人更高等级）
    const duration = Math.min(hero.duration + (own?.duration ?? 0), 20_000_000);
    const amplifier = Math.max(hero.amplifier, own?.amplifier ?? 0);

    owner.addEffect(VILLAGE_HERO as any, duration, { amplifier });
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 的村庄英雄已叠加给 ${ownerName}` +
      `${color.muted}（Lv.${amplifier + 1}，合计约 ${Math.round(duration / 1200)} 分钟）`
    );
  } catch (err) {
    console.warn(`[MockPlayer] ${record.name} 村庄英雄转移给主人失败: ${err}`);
  }
}

// ─── 兜底巡检（session 状态机驱动） ────────────────────
// 每 30 秒对每个劫掠会话推进状态机（core advanceRaidSession 纯逻辑），
// 采集世界状态 → 产出动作 → 执行副作用。事件链任何断裂都由状态机判定恢复：
//   1. 袭击结束但没拿到村庄英雄（未参与击杀）→ 窗口过期 + 无袭击者 → 重喝（修复死锁）
//   2. 挂着村庄英雄但 effectAdd 丢失 → claim-victory 补记胜利
//   3. 喝瓶静默失败 → drinking 超时无效果 → 重喝
//   4. 带不祥之兆久未触发袭击 → warn-stuck 提醒（效果过期后自动重喝）
//   5. 无瓶 → stop 模式

function raidModeSweep(): void {
  try {
    const now = system.currentTick;
    for (const [botName, session] of [...raidSessions.entries()]) {
      try {
        const record = botRegistry.get(botName);
        if (!record || !record.tags.includes(TAG_RAID_MODE.value)) {
          raidSessions.delete(botName); // 模式已关/记录缺失 → 清理会话
          continue;
        }
        if (record.death || !record.online) continue; // 下线/死亡由事件清理，双保险
        const bot = resolveBotPlayer(botName);
        if (!bot || !bot.isValid) continue;

        // 采集世界状态（状态机输入）
        const container = safeGetContainer(bot);
        const worldState: RaidWorldState = {
          now,
          hasBadOmen: hasEffect(bot, BAD_OMEN),
          hasRaidOmen: hasEffect(bot, RAID_OMEN),
          hasVillageHero: !!tryGetEffect(bot, VILLAGE_HERO),
          hasRaiderNearby: hasRaiderNearby(bot),
          hasBottle: !!container && findOminousBottleSlot(container) !== -1,
        };

        const { session: next, action } = advanceRaidSession(session, worldState);
        raidSessions.set(botName, next);

        switch (action.type) {
          case "drink":
            drinkNextBottle(bot, record);
            break;
          case "claim-victory": {
            const hero = tryGetEffect(bot, VILLAGE_HERO);
            processVictory(record, hero?.amplifier ?? 0, bot, true);
            break;
          }
          case "warn-stuck": {
            // 节流：2 分钟最多提醒一次
            if (now - (lastWarnTick.get(botName) ?? 0) >= RAID_FORCE_COOLDOWN) {
              lastWarnTick.set(botName, now);
              world.sendMessage(
                `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName} 带不祥之兆久未触发袭击` +
                `，请确认假人在村庄内且非和平难度（效果过期后将自动重喝）`
              );
            }
            break;
          }
          case "stop":
            disableRaidMode(botName, record, "背包里没有不祥之瓶了，请补充后重新开启劫掠模式");
            break;
          case "none":
            break;
        }
      } catch (err) {
        console.warn(`[MockPlayer] 劫掠巡检 ${botName} 异常: ${err}`);
      }
    }
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠巡检异常: ${err}`);
  }
}

/** 附近 128 格内是否有袭击参与生物（掠夺者/卫道士/唤魔者/劫掠兽/女巫）。
 *  逐 typeId 查询合并而非 families 一次匹配的原因见 core/service/RaidRules 的 RAIDER_TYPE_IDS 说明
 *  （原版无 raider 家族、illager 族只含 3/5、families 数组是 AND 语义、2.8.0 无 typeIds 数组字段）。
 *  有袭击者在附近 → 视为袭击仍在进行，巡检不续瓶（避免同一时刻开两场袭击）。查询失败按「有袭击者」保守处理。 */
function hasRaiderNearby(bot: SimulatedPlayer): boolean {
  try {
    for (const typeId of RAIDER_TYPE_IDS) {
      const raiders = bot.dimension.getEntities({
        type: typeId,
        location: bot.location,
        maxDistance: 128,
      });
      if (raiders.length > 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// ─── 饮用不祥之瓶 ──────────────────────────────────────
// 主手是药水 → 直接喝；主手不是药水 → 记录主手 → 找药水互换 → 喝 → 喝成功/被打断后主手换回。
// 全程 try-catch + 实体有效性防护（死亡/下线/重连瞬间实体失效）。

function drinkNextBottle(bot: SimulatedPlayer, record: BotRecord): void {
  const botName = record.name;
  if (drinking.has(botName)) return;
  if (!bot.isValid) return;

  // 已有不祥之兆/袭击之兆排队 → 一场袭击已在酝酿，不重复喝
  if (hasEffect(bot, BAD_OMEN) || hasEffect(bot, RAID_OMEN)) return;

  const container = safeGetContainer(bot);
  if (!container) return;

  const targetSlot = bot.selectedSlotIndex ?? 0;

  // ① 主手已是药水 → 直接喝
  const mainhand = container.getItem(targetSlot);
  if (mainhand && isOminousBottle(mainhand.typeId)) {
    drinkBottle(bot, record, targetSlot, null);
    return;
  }

  // ② 主手不是药水 → 记录主手 → 找药水互换
  const bottleSlot = findOminousBottleSlot(container);
  if (bottleSlot === -1) {
    disableRaidMode(botName, record, "背包里没有不祥之瓶了，请补充后重新开启劫掠模式");
    return;
  }
  if (bottleSlot === targetSlot) {
    // 防御：主手不是药水却药水在选中槽（理论上到不了这里）
    drinkBottle(bot, record, targetSlot, null);
    return;
  }

  try {
    const bottle = container.getItem(bottleSlot);
    container.setItem(targetSlot, bottle);       // 药水 → 主手
    container.setItem(bottleSlot, mainhand);     // 主手原物品 → 药水原槽（互换）
  } catch (e) {
    console.warn(`[MockPlayer] 劫掠模式 ${botName} 互换药水失败: ${e}`);
    return;
  }
  drinkBottle(bot, record, targetSlot, { slot: bottleSlot });
}

/** 异步饮用链：蓄力 → 按住 1.6s → 松开 → 互换过的把主手换回 */
function drinkBottle(
  bot: SimulatedPlayer,
  record: BotRecord,
  slot: number,
  swap: { slot: number } | null,
): void {
  const botName = record.name;
  drinking.add(botName);
  bot.selectedSlotIndex = slot;

  // 蓄力饮用（等 2 tick 让实体就绪）
  system.runTimeout(() => {
    // ⚠️ 实体有效性防护：异步回调时实体可能已死亡/下线/重建（旧引用失效）
    if (!bot.isValid) {
      drinking.delete(botName);
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
      return;
    }

    // 等待饮用动画完成后松开（不祥之瓶需按住 ~1.6s 才消耗完）
    system.runTimeout(() => {
      try {
        if (bot.isValid) bot.stopUsingItem();
      } catch {}

      if (swap) swapBackMainhand(bot, slot, swap);
      drinking.delete(botName);
      console.info(`[MockPlayer] 劫掠模式 ${botName} 已喝下不祥之瓶`);
    }, DRINK_DURATION);
  }, 2);
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
      // 饮用成功：药水已消耗，选中槽空 → 主手原物品从药水原槽放回，并清空药水原槽（避免复制）
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
    const inv = bot.getComponent("minecraft:inventory") as any;
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

/**
 * 检测效果：直接使用精确 ID（含命名空间前缀）。
 * getEffect 对不存在/不支持的 ID 抛异常 → 视为无该效果。
 */
function hasEffect(bot: SimulatedPlayer, effectId: string): boolean {
  return tryGetEffect(bot, effectId) !== undefined;
}

/** 读取效果对象（无该效果/读取抛错返回 undefined，与 hasEffect 同套防护） */
function tryGetEffect(bot: SimulatedPlayer | Player, effectId: string): Effect | undefined {
  try {
    return bot.getEffect(effectId as any);
  } catch {
    return undefined;
  }
}

/** 关闭劫掠模式（移除标签即停用；劫掠为独立开关，与其它行为可共存，不额外切回空闲） */
function disableRaidMode(botName: string, record: BotRecord, message?: string): void {
  record.tags = record.tags.filter((t) => t !== TAG_RAID_MODE.value);
  saveCoordinator.saveRecord(record);

  // 清理会话（关模式后状态机不再服务该假人）
  raidSessions.delete(botName);
  drinking.delete(botName);

  const bot = resolveBotPlayer(botName);
  if (bot) syncEntityTags(bot, record.tags);

  if (message) {
    world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName}: ${message}`);
  }
}