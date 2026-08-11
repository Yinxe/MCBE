// ─── 劫掠模式 ──────────────────────────────────────────
// 假人在指定区域内自动循环：喝不祥之瓶 → 等劫掠 → 扫怪物 → 喝下一瓶
//
// 状态机：
//   DRINK → WAITING → RAID_ACTIVE → CHECK_END → POST_RAID → DRINK
//
// 开始判定：Bad Omen 消失（Raid Omen 倒计时结束 = 劫掠触发），随后宽限期等待怪物刷出
// 结束判定：区域内怪物消失 30 秒（> 波次间隔 15 秒）确认劫掠结束
// 区域 X/Y/Z（默认 20/50/20）：检测范围 + 边界粒子显示
// 由行为引擎每 10 tick 调用 runRaidCycle

import { Container, Entity, ItemStack, system, Vector3, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord, RaidAreaConfig } from "./core/types";
import { TAG_RAID_MODE, TAG_IDLE, syncEntityTags } from "./core/tags";
import { botRegistry, resolveBotPlayer, saveBotRecord } from "./core/persistence";

// ─── 常量 ──────────────────────────────────────────────

const OMINOUS_BOTTLE_ID = "minecraft:ominous_bottle";

/** 不祥之兆效果 ID */
const BAD_OMEN = "minecraft:bad_omen";

/** 物品类型匹配：兼容带/不带命名空间前缀（Script API typeId 恒带前缀，双保险） */
function isOminousBottle(typeId: string): boolean {
  return typeId === OMINOUS_BOTTLE_ID || typeId === "ominous_bottle" || typeId.endsWith(":ominous_bottle");
}

/** 劫掠怪物类型 ID */
const RAID_MOB_TYPES: ReadonlySet<string> = new Set([
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:evoker",
  "minecraft:ravager",
  "minecraft:witch",
  "minecraft:vex",
]);

/** 等待劫掠开始超时：1 分钟 = 1200 tick（喝药水获得 Bad Omen 后计时；含 Raid Omen 30秒转换 + 读条，超时仍未开始 → 提示玩家） */
const WAITING_TIMEOUT = 1200;
/** 劫掠结束确认等待：30 秒 = 600 tick（> 波次间隔 15秒，避免误判） */
const RAID_END_CONFIRM = 600;
/** 劫掠开始宽限期：30 秒 = 600 tick（Bad Omen 消失判定开始很快，第 1 波怪物刷出有读条延迟，宽限期内不判结束） */
const RAID_GRACE = 600;
/** 劫掠结束后延迟喝下一瓶：2 秒 = 40 tick */
const POST_RAID_DELAY = 40;
/** 边界粒子绘制间隔：10 tick */
const BOUNDARY_INTERVAL = 10;

// ─── 状态类型 ──────────────────────────────────────────

type RaidState = "DRINK" | "WAITING" | "RAID_ACTIVE" | "CHECK_END" | "POST_RAID";

interface RaidSession {
  state: RaidState;
  /** 喝药水前保存的主手槽位 */
  savedSlot: number;
  /** 喝药水前保存的主手物品 */
  savedItem: ItemStack | null;
  /** 状态开始的 tick（超时计算用） */
  stateStartTick: number;
  /** 劫掠区域中心坐标（开启时记录） */
  center: Vector3;
  /** 边界显示 interval ID */
  boundaryIntervalId?: number;
  /** 喝药水异步链进行中（防止 runRaidCycle 重复触发） */
  drinking?: boolean;
}

/**
 * 初始化劫掠效果监听（验证/加速用）。
 * 订阅 effectAdd：假人获得村庄英雄 → 聊天框提示 + 劫掠模式直接判定胜利。
 * 由 main.ts 在 worldLoad 后调用一次。
 */
let effectsInitialized = false;

export function initRaidModeEffects(): void {
  if (effectsInitialized) return;
  effectsInitialized = true;

  world.afterEvents.effectAdd.subscribe(
    (e: any) => {
      const { effect, entity } = e;
      const typeId = effect?.typeId as string | undefined;
      // 村庄英雄（兼容带/不带命名空间前缀）
      if (typeId !== "minecraft:village_hero" && typeId !== "village_hero") return;

      // 必须是假人（botRegistry 有记录）
      const record = botRegistry.get(entity?.nameTag ?? "");
      if (!record) return;

      world.sendMessage(
        `${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 获得村庄英雄 Lv.${effect.amplifier}（${Math.floor((effect.duration ?? 0) / 20)}秒）`
      );
      console.info(`[MockPlayer] effectAdd 村庄英雄 → ${record.name} Lv.${effect.amplifier}`);

      // 劫掠模式 RAID_ACTIVE 中 → 直接判定劫掠胜利（加速结束）
      const session = sessions.get(record.name);
      if (session && session.state === "RAID_ACTIVE") {
        session.state = "POST_RAID";
        session.stateStartTick = system.currentTick;
        world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 劫掠胜利！`);
      }
    },
    { entityTypes: ["player"] }
  );
}

// ─── 全局状态 ──────────────────────────────────────────

const sessions = new Map<string, RaidSession>();

// ─── 公开 API ──────────────────────────────────────────

/**
 * 初始化劫掠模式会话。
 * 由 tags.ts 在玩家提交行为表单且选中劫掠模式时调用。
 * 假人离线时也会保存配置，上线后行为引擎自动启动（runRaidCycle 恢复会话）。
 * @param config 玩家配置的区域参数（半尺寸）
 */
export function initRaidSession(botName: string, config: RaidAreaConfig): void {
  const record = botRegistry.get(botName);
  if (!record) return;

  // ⚠️ 强加载模式限制：SimulatedPlayer 无法使用物品（useItemInSlot 不可用），劫掠模式喝不了药水 → 拒绝启动
  if (record.spawnMode === "chunkload") {
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${record.name} 劫掠模式只能在普通模式使用` +
      `（强加载模式无法使用物品），已拒绝启动。请切换为普通模式，或搭配强加载假人一起使用`
    );
    // 回滚标签：移除劫掠模式，恢复 idle（避免 runRaidCycle 再次检测到标签重复提示）
    record.tags = record.tags.filter((t) => t !== TAG_RAID_MODE.value);
    if (!record.tags.includes(TAG_IDLE.value)) record.tags.push(TAG_IDLE.value);
    saveBotRecord(record);
    const bot = resolveBotPlayer(botName);
    if (bot) syncEntityTags(bot, record.tags);
    return;
  }

  // 1. 无条件保存配置（即使假人离线，上线后自动启动）
  record.raidConfig = config;
  saveBotRecord(record);

  // 2. 假人不在线/死亡 → 只保存配置，等待上线后 runRaidCycle 自动创建会话
  const bot = resolveBotPlayer(botName);
  if (!bot || record.death) {
    console.info(`[MockPlayer] 劫掠模式配置已保存 ${botName}（假人离线，上线后自动启动）`);
    return;
  }

  // 3. 假人在线：设置重生点为当前位置
  record.respawnPoint = {
    location: bot.location,
    dimension: bot.dimension.id,
    rotation: bot.getRotation(),
    lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
  };
  saveBotRecord(record);

  // 4. 创建会话
  const session: RaidSession = {
    state: "DRINK",
    savedSlot: bot.selectedSlotIndex,
    savedItem: null,
    stateStartTick: system.currentTick,
    center: { ...bot.location },
  };
  sessions.set(botName, session);

  // 5. 启动边界显示
  if (config.showBoundary) {
    startBoundary(botName, session, config);
  }

  console.info(`[MockPlayer] 劫掠模式初始化 ${botName} 区域(${config.x * 2}x${config.y * 2}x${config.z * 2})`);
}

/**
 * 清理劫掠模式会话。
 * 由行为引擎检测到标签移除时调用。
 */
export function cleanupRaidSession(botName: string): void {
  const session = sessions.get(botName);
  if (!session) return;

  // 停止边界显示
  stopBoundary(botName);

  // 尝试恢复主手
  const bot = resolveBotPlayer(botName);
  if (bot) {
    restoreMainhand(bot, session);
  }

  sessions.delete(botName);
  console.info(`[MockPlayer] 劫掠模式清理 ${botName}`);
}

/**
 * 检查假人是否有活跃的劫掠会话。
 */
export function hasRaidSession(botName: string): boolean {
  return sessions.has(botName);
}

/**
 * 劫掠模式主循环——由行为引擎每 10 tick 调用。
 */
export function runRaidCycle(bot: SimulatedPlayer, record: BotRecord): void {
  const botName = record.name;

  // 实体有效性防护（死亡/下线瞬间）
  if (!bot.isValid) return;

  // ⚠️ 强加载模式限制：无法使用物品（喝药水不可用），提示并切回 idle
  if (record.spawnMode === "chunkload") {
    world.sendMessage(
      `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${record.name} 劫掠模式只能在普通模式使用` +
      `（强加载模式无法使用物品），已停止劫掠。请切换为普通模式后重新开启`
    );
    switchToIdle(botName, record);
    return;
  }

  // 标签已移除 → 清理退出
  if (!bot.hasTag(TAG_RAID_MODE.value)) {
    cleanupRaidSession(botName);
    return;
  }

  // 获取或创建会话
  let session = sessions.get(botName);
  if (!session) {
    // 重启世界后恢复：从持久化配置重建会话
    if (!record.raidConfig) {
      // 没有配置 → 切回 idle
      switchToIdle(botName, record, "劫掠区域未配置，请重新设置");
      return;
    }
    session = {
      state: "DRINK",
      savedSlot: bot.selectedSlotIndex,
      savedItem: null,
      stateStartTick: system.currentTick,
      center: { ...bot.location },
    };
    sessions.set(botName, session);
    if (record.raidConfig.showBoundary) {
      startBoundary(botName, session, record.raidConfig);
    }
  }

  if (!record.raidConfig) return;

  // 检查假人是否死亡
  if (record.death) return;

  // 执行当前状态
  switch (session.state) {
    case "DRINK":
      doDrink(bot, record, session);
      break;
    case "WAITING":
      doWaiting(bot, record, session);
      break;
    case "RAID_ACTIVE":
      doRaidActive(bot, record, session);
      break;
    case "CHECK_END":
      doCheckEnd(bot, record, session);
      break;
    case "POST_RAID":
      doPostRaid(session);
      break;
  }
}

// ─── 状态处理 ──────────────────────────────────────────

function doDrink(bot: SimulatedPlayer, record: BotRecord, session: RaidSession): void {
  // 喝药水异步链进行中，跳过（防止每 10 tick 重复触发）
  if (session.drinking) return;

  // ⚠️ 实体有效性防护：死亡/下线瞬间实体失效，getComponent 会抛异常（曾导致每 10 tick 刷错误）
  if (!bot.isValid) return;
  let container: Container | undefined;
  try {
    container = getContainer(bot);
  } catch {
    return;
  }
  if (!container) return;

  // 扫描背包找不祥之瓶
  const bottleSlot = findOminousBottleSlot(container);
  if (bottleSlot === -1) {
    world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 背包里没有不祥之瓶了，请补充后重新开启标签`);
    switchToIdle(record.name, record);
    return;
  }

  // 标记饮用中（防重复触发）
  session.drinking = true;

  // 保存当前主手
  session.savedSlot = bot.selectedSlotIndex;
  session.savedItem = container.getItem(session.savedSlot) ?? null;

  // 把药水换到主手（容器操作包 try-catch，实体失效时可能抛）
  try {
    if (bottleSlot !== session.savedSlot) {
      const bottleItem = container.getItem(bottleSlot);
      container.setItem(session.savedSlot, bottleItem);
      container.setItem(bottleSlot, undefined);
    }
    bot.selectedSlotIndex = session.savedSlot;
  } catch (e) {
    console.warn(`[MockPlayer] 劫掠模式 ${record.name} 换药水失败: ${e}`);
    session.drinking = false;
    return;
  }

  // 蓄力饮用
  system.runTimeout(() => {
    // ⚠️ entity invalid 防护：异步回调时实体可能已死亡/下线/重建（旧引用失效）
    if (!bot.isValid) {
      session.drinking = false;
      console.warn(`[MockPlayer] 劫掠模式 ${record.name} 喝药水时实体已失效，跳过`);
      return;
    }

    let used = false;
    try {
      used = bot.useItemInSlot(session.savedSlot);
    } catch (e) {
      console.warn(`[MockPlayer] 劫掠模式 ${record.name} useItemInSlot 异常: ${e}`);
    }
    if (!used) {
      console.warn(`[MockPlayer] 劫掠模式 ${record.name} useItemInSlot 失败`);
      session.drinking = false;
      restoreMainhand(bot, session);
      return;
    }

    // 等待饮用动画（1.6 秒 ≈ 32 tick）
    system.runTimeout(() => {
      try { if (bot.isValid) bot.stopUsingItem(); } catch {}

      // 恢复主手（内部有 try-catch 和有效性兜底）
      restoreMainhand(bot, session);
      session.drinking = false;

      // 实体已失效（死亡/下线）→ 放弃本次验证，下次循环重试
      if (!bot.isValid) {
        console.warn(`[MockPlayer] 劫掠模式 ${record.name} 饮用后实体已失效，下次重试`);
        return;
      }

      // 验证不祥之兆是否获得：未获得 → 药水未生效，回到 DRINK 重试（下次循环）
      if (!hasEffect(bot, BAD_OMEN)) {
        console.warn(`[MockPlayer] 劫掠模式 ${record.name} 药水未生效（无 Bad Omen），重试`);
        return;
      }

      // 切换到等待状态（此时 Bad Omen 已确认存在，之后消失 = 劫掠开始）
      session.state = "WAITING";
      session.stateStartTick = system.currentTick;
      console.info(`[MockPlayer] 劫掠模式 ${record.name} 已喝下不祥之瓶（Bad Omen 生效）`);
    }, 32);
  }, 2);
}

function doWaiting(bot: SimulatedPlayer, record: BotRecord, session: RaidSession): void {
  // Bad Omen 消失 = Raid Omen 倒计时结束 = 劫掠已开始
  if (!hasEffect(bot, BAD_OMEN)) {
    session.state = "RAID_ACTIVE";
    session.stateStartTick = system.currentTick; // 重置计时：宽限期从劫掠开始算起
    console.info(`[MockPlayer] 劫掠模式 ${record.name} Bad Omen 消失，劫掠开始`);
    return;
  }

  // 超时检查：Bad Omen 一直存在 → 劫掠未触发（可能不在村庄范围内）
  const elapsed = system.currentTick - session.stateStartTick;
  if (elapsed < WAITING_TIMEOUT) return;

  // 超时：提示并停止
  world.sendMessage(
    `${color.muted}[${color.success}假人${color.muted}] ${color.warn}${record.name} 未检测到劫掠开始` +
    `，请确认假人是否在村庄内，并考虑更换假人位置。请重新开启标签`
  );
  switchToIdle(record.name, record);
}

function doRaidActive(bot: SimulatedPlayer, record: BotRecord, session: RaidSession): void {
  // 宽限期：Bad Omen 消失判定开始很快，第 1 波怪物刷出有读条延迟（约 5-15 秒），
  // 宽限期内不扫怪物不判结束，等怪物刷出
  const elapsed = system.currentTick - session.stateStartTick;
  if (elapsed < RAID_GRACE) return;

  // 怪物扫描：区域内无怪物 → 进入确认（波次间隔 15 秒，600 tick 确认足够区分）
  const mobs = scanRaidMobs(bot, record.raidConfig!);
  if (mobs.length === 0) {
    session.state = "CHECK_END";
    session.stateStartTick = system.currentTick;
    console.info(`[MockPlayer] 劫掠模式 ${record.name} 区域内无怪物，开始确认劫掠结束（30秒）`);
  }
}

function doCheckEnd(bot: SimulatedPlayer, record: BotRecord, session: RaidSession): void {
  // 怪物再次出现（下一波开始）→ 劫掠继续
  const mobs = scanRaidMobs(bot, record.raidConfig!);
  if (mobs.length > 0) {
    session.state = "RAID_ACTIVE";
    console.info(`[MockPlayer] 劫掠模式 ${record.name} 怪物再次出现，劫掠继续`);
    return;
  }

  // 30 秒持续无怪物 → 劫掠结束
  const elapsed = system.currentTick - session.stateStartTick;
  if (elapsed < RAID_END_CONFIRM) return;

  session.state = "POST_RAID";
  session.stateStartTick = system.currentTick;
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 劫掠结束`);
  console.info(`[MockPlayer] 劫掠模式 ${record.name} 劫掠结束确认`);
}

function doPostRaid(session: RaidSession): void {
  const elapsed = system.currentTick - session.stateStartTick;
  if (elapsed < POST_RAID_DELAY) return;

  // 准备喝下一瓶
  session.state = "DRINK";
  console.info(`[MockPlayer] 劫掠模式 准备喝下一瓶`);
}

// ─── 工具函数 ──────────────────────────────────────────

function getContainer(bot: SimulatedPlayer): Container | undefined {
  const inv = bot.getComponent("minecraft:inventory") as any;
  return inv?.container;
}

function findOminousBottleSlot(container: Container): number {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && isOminousBottle(item.typeId)) return i;
  }
  return -1;
}

/**
 * 检测效果：兼容带/不带命名空间前缀两种 ID 格式。
 * 部分 Script API 版本 getEffect 只认短 ID（"bad_omen"），部分认完整 ID（"minecraft:bad_omen"），双格式都试。
 */
function hasEffect(bot: SimulatedPlayer, effectId: string): boolean {
  const candidates = effectId.includes(":") ? [effectId, effectId.split(":")[1]] : [effectId, `minecraft:${effectId}`];
  for (const id of candidates) {
    try {
      if (bot.getEffect(id as any) !== undefined) return true;
    } catch {
      // 该格式不支持，试下一种
    }
  }
  return false;
}

/** 扫描区域内劫掠怪物（结束判定用） */
function scanRaidMobs(bot: SimulatedPlayer, config: RaidAreaConfig): Entity[] {
  const c = bot.location;
  const maxDist = Math.sqrt(config.x * config.x + config.y * config.y + config.z * config.z);

  try {
    const entities = bot.dimension.getEntities({ location: c, maxDistance: maxDist });
    return entities.filter((e) => {
      if (!RAID_MOB_TYPES.has(e.typeId)) return false;
      const dx = Math.abs(e.location.x - c.x);
      const dy = Math.abs(e.location.y - c.y);
      const dz = Math.abs(e.location.z - c.z);
      return dx <= config.x && dy <= config.y && dz <= config.z;
    });
  } catch {
    return [];
  }
}

/** 恢复主手物品 */
function restoreMainhand(bot: SimulatedPlayer, session: RaidSession): void {
  try {
    const container = getContainer(bot);
    if (!container) return;

    const current = container.getItem(session.savedSlot);
    const isBottle = current ? isOminousBottle(current.typeId) : false;

    if (session.savedItem) {
      // 有保存的物品 → 放回去
      if (isBottle) {
        // 药水还没喝完（被打断），找个空位放
        const empty = findEmptySlot(container, session.savedSlot);
        if (empty !== -1) container.setItem(empty, current);
        else container.setItem(session.savedSlot, undefined);
      }
      container.setItem(session.savedSlot, session.savedItem);
    } else {
      // 没有保存的物品 → 清空主手的药水
      if (isBottle) container.setItem(session.savedSlot, undefined);
    }

    bot.selectedSlotIndex = session.savedSlot;
  } catch (e) {
    console.warn(`[MockPlayer] 劫掠模式恢复主手失败: ${e}`);
  }
}

function findEmptySlot(container: Container, exclude: number): number {
  for (let i = 0; i < container.size; i++) {
    if (i !== exclude && !container.getItem(i)) return i;
  }
  return -1;
}

/** 切换到 idle 并清理 */
function switchToIdle(botName: string, record: BotRecord, message?: string): void {
  record.tags = record.tags.filter((t) => t !== TAG_RAID_MODE.value);
  if (!record.tags.includes(TAG_IDLE.value)) record.tags.push(TAG_IDLE.value);
  saveBotRecord(record);

  const bot = resolveBotPlayer(botName);
  if (bot) syncEntityTags(bot, record.tags);

  cleanupRaidSession(botName);

  if (message) {
    world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.warn}${botName}: ${message}`);
  }
}

// ─── 边界粒子显示 ──────────────────────────────────────

function startBoundary(botName: string, session: RaidSession, config: RaidAreaConfig): void {
  stopBoundary(botName);

  const intervalId = system.runInterval(() => {
    const bot = resolveBotPlayer(botName);
    if (!bot) { stopBoundary(botName); return; }

    const c = session.center;
    const x = config.x;
    const y = config.y;
    const z = config.z;

    // 12 条棱线
    // 底面 4 条
    spawnEdgeParticles(bot, c, -x, -y, -z, x, -y, -z);
    spawnEdgeParticles(bot, c, x, -y, -z, x, -y, z);
    spawnEdgeParticles(bot, c, x, -y, z, -x, -y, z);
    spawnEdgeParticles(bot, c, -x, -y, z, -x, -y, -z);
    // 顶面 4 条
    spawnEdgeParticles(bot, c, -x, y, -z, x, y, -z);
    spawnEdgeParticles(bot, c, x, y, -z, x, y, z);
    spawnEdgeParticles(bot, c, x, y, z, -x, y, z);
    spawnEdgeParticles(bot, c, -x, y, z, -x, y, -z);
    // 竖直 4 条
    spawnEdgeParticles(bot, c, -x, -y, -z, -x, y, -z);
    spawnEdgeParticles(bot, c, x, -y, -z, x, y, -z);
    spawnEdgeParticles(bot, c, x, -y, z, x, y, z);
    spawnEdgeParticles(bot, c, -x, -y, z, -x, y, z);
  }, BOUNDARY_INTERVAL);

  session.boundaryIntervalId = intervalId;
}

function stopBoundary(botName: string): void {
  const session = sessions.get(botName);
  if (session?.boundaryIntervalId !== undefined) {
    system.clearRun(session.boundaryIntervalId);
    session.boundaryIntervalId = undefined;
  }
}

/** 在一条棱线上均匀撒粒子 */
function spawnEdgeParticles(
  bot: SimulatedPlayer,
  center: Vector3,
  ox1: number, oy1: number, oz1: number,
  ox2: number, oy2: number, oz2: number,
): void {
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = center.x + ox1 + (ox2 - ox1) * t;
    const y = center.y + oy1 + (oy2 - oy1) * t;
    const z = center.z + oz1 + (oz2 - oz1) * t;
    try {
      bot.dimension.spawnParticle("minecraft:falling_dust_top_snow_particle", { x, y, z });
    } catch {}
  }
}
