// ─── 劫掠模式（事件驱动） ──────────────────────────────
// 假人持续刷袭击（raid）farm：喝不祥之瓶 → 触发袭击 → 击败袭击获得村庄英雄 → 再喝下一瓶
//
// 完全事件驱动，无 tick 轮询（不再有 runRaidCycle / 行为引擎周期调用）：
//   开启/上线/重生 → startRaidMode 喝第一瓶
//   喝下成功       → 获得不祥之兆 → 触发 raidStarted（袭击开始）
//   袭击获胜       → 获得村庄英雄 → 触发 raidVictory → 订阅者喝下一瓶
//
// 劫掠信号（raidStarted / raidVictory）定义在 core/events/DomainEvents（假人模块私有）。
// 规则常量/识别（不祥之瓶、效果分类、饮用与卡死阈值）在 core/service/RaidRules。
// 与假人加载模式无关（普通/强加载均可 useItemInSlot 使用物品）。

import { Container, EffectAddAfterEvent, Entity, Player, system, world } from "@minecraft/server";
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
  BAD_OMEN,
  RAID_OMEN,
  VILLAGE_HERO,
  DRINK_DURATION,
  RAID_STUCK_TICKS,
  isOminousBottle,
  classifyRaidEffect,
} from "../../core/service/RaidRules";

// ─── 全局状态 ──────────────────────────────────────────

/** 正在异步饮用不祥之瓶的假人（防止重复触发饮用链） */
const drinking = new Set<string>();

/** 本次会话劫掠胜利次数（仅内存，与假人绑定，不持久化；重启后清零） */
const victoryCounts = new Map<string, number>();

/** 最近一次劫掠胜利的 tick（仅内存，用于卡死检查区分「本瓶尚未触发」与「上一瓶已胜利进入下一瓶」） */
const lastVictoryTick = new Map<string, number>();

let raidEventsReady = false;

// ─── 公开 API ──────────────────────────────────────────

/**
 * 初始化劫掠事件系统。由 main.ts 在 worldLoad 后调用一次：
 *   1. effectAdd 监听不祥之兆/袭击之兆/村庄英雄 → 触发 raidStarted / raidVictory
 *   2. 订阅 raidVictory → 喝下一瓶不祥之瓶
 *   3. 订阅假人上线/复活 → 喝第一瓶（替代 playerJoin/playerSpawn 硬编码调用）
 */
export function initRaidModeEffects(): void {
  if (raidEventsReady) return;
  raidEventsReady = true;

  world.afterEvents.effectAdd.subscribe(handleEffectAdd);
  BotEvents.raidVictory.subscribe(handleRaidVictory);
  BotEvents.botOnline.subscribe((e) => startRaidMode(e.botName));
  BotEvents.botRespawn.subscribe((e) => startRaidMode(e.botName));
}

/**
 * 启动劫掠模式：喝下一瓶不祥之瓶（首次开启 / 续瓶 / 死亡重生恢复）。
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

    // 袭击之兆施加瞬间 = 劫掠位置被标记（官方存于玩家数据 raid_omen_position），打印坐标辅助验证
    if (kind === "raid-omen") {
      const loc = e.entity.location;
      console.info(
        `[MockPlayer] ${name} 袭击之兆 → 袭击触发点 (${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)})（≈ raid_omen_position）`
      );
      probeRaidOmenDp(e.entity, name);
      return;
    }

    // 不祥之兆 = 喝瓶成功，袭击即将开始
    if (kind === "bad-omen") {
      BotEvents.raidStarted.trigger({ botName: name, amplifier: amp });
      scheduleRaidStuckCheck(name);
      return;
    }

    // 村庄英雄 = 袭击胜利
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

    // 胜利次数累加（仅内存，不持久化）
    const wins = (victoryCounts.get(e.botName) ?? 0) + 1;
    victoryCounts.set(e.botName, wins);
    // 记录胜利时刻，供卡死检查区分「本瓶尚未触发」与「已胜利进入下一瓶」
    lastVictoryTick.set(e.botName, system.currentTick);

    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.success}${e.botName} 获得村庄英雄 Lv.${e.amplifier}，本次劫掠胜利！` +
      `${color.muted}（第 ${wins} 胜）`
    );

    const bot = resolveBotPlayer(e.botName);
    if (!bot || !bot.isValid || record.death) return;

    // ⚠️ 村庄英雄持续 40 分钟，不主动移除的话效果一直挂着：下一次袭击胜利不会重新触发
    //    effectAdd（效果已存在，无法重新获取）→ 检测链断掉。移除后下一次胜利会重新施加。
    try {
      bot.removeEffect(VILLAGE_HERO as any);
    } catch (err) {
      console.warn(`[MockPlayer] ${e.botName} 移除村庄英雄失败: ${err}`);
    }

    drinkNextBottle(bot, record); // 进入下一瓶
  } catch (err) {
    console.warn(`[MockPlayer] 劫掠胜利处理异常: ${err}`);
  }
}

/** 喝瓶后 1 分钟仍带不祥之兆 → 袭击未触发，提醒玩家（一次性的，非轮询） */
function scheduleRaidStuckCheck(botName: string): void {
  // 记录排程时刻；若在这之后已胜利（进入下一瓶）则本检查作废
  const scheduledAt = system.currentTick;

  system.runTimeout(() => {
    try {
      const record = botRegistry.get(botName);
      if (!record || !record.tags.includes(TAG_RAID_MODE.value)) return;
      const bot = resolveBotPlayer(botName);
      if (!bot || !bot.isValid) return;

      // 这瓶之后已胜利过（自动进入下一瓶，正握着新不祥之兆）→ 正常推进，跳过
      if ((lastVictoryTick.get(botName) ?? 0) > scheduledAt) return;

      // 1 分钟后仍带不祥/袭击之兆 → 袭击未触发
      if (hasEffect(bot, BAD_OMEN) || hasEffect(bot, RAID_OMEN)) {
        world.sendMessage(
          `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName} 带不祥之兆超 1 分钟仍未触发袭击` +
          `，请确认假人在村庄内且非和平难度`
        );
      }
    } catch (err) {
      console.warn(`[MockPlayer] 劫掠卡死检查异常: ${err}`);
    }
  }, RAID_STUCK_TICKS);
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
  try {
    return bot.getEffect(effectId as any) !== undefined;
  } catch {
    return false;
  }
}

/**
 * 延迟几秒从玩家动态属性探测官方 raid_omen_position。
 * 机制验证：官方文档称袭击位置存于玩家数据（NBT 整数数组），而 getDynamicProperty 只支持
 * 标量/Vector3 不支持数组——此探测用于确认该字段是否被暴露为可读的动态属性。
 * 若能读到则打印坐标；否则打印全部动态属性 key 供排查。
 */
function probeRaidOmenDp(entity: Entity, name: string): void {
  system.runTimeout(() => {
    try {
      if (!entity.isValid) return;
      const player = entity as Player;

      let direct: string;
      try {
        direct = JSON.stringify(player.getDynamicProperty("raid_omen_position"));
      } catch (e) {
        direct = `读取抛错: ${e}`;
      }

      let ids: string[];
      try {
        ids = player.getDynamicPropertyIds();
      } catch (e) {
        console.warn(`[MockPlayer] DP 探测 ${name} 枚举 key 失败: ${e}`);
        return;
      }

      const raidish = ids.filter((id) => /raid|omen|position|village/i.test(id));
      console.info(
        `[MockPlayer] DP 探测 ${name} → raid_omen_position=${direct}` +
        ` | 相关 key=${JSON.stringify(raidish)} | 全部 ${ids.length} 个 key=${JSON.stringify(ids)}`
      );
    } catch (e) {
      console.warn(`[MockPlayer] DP 探测 ${name} 失败: ${e}`);
    }
  }, 80); // 延迟 4 秒：若游戏稍后才写入该字段，多等几秒再读
}

/** 关闭劫掠模式（移除标签即停用；劫掠为独立开关，与其它行为可共存，不额外切回空闲） */
function disableRaidMode(botName: string, record: BotRecord, message?: string): void {
  record.tags = record.tags.filter((t) => t !== TAG_RAID_MODE.value);
  saveCoordinator.saveRecord(record);

  const bot = resolveBotPlayer(botName);
  if (bot) syncEntityTags(bot, record.tags);

  if (message) {
    world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName}: ${message}`);
  }
}