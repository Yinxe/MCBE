// ─── 劫掠原子（效果读取/扣瓶/袭击之兆施加清理/播报通知） ──────────
// 全部 try-catch 绕行（区块/句柄瞬态）。
// 袭击之兆不喝瓶：grantRaidOmen 一次 addEffect(RAID_OMEN, 4 秒)，能力层每
// 5 秒续施形成覆盖；瓶费记账用 spendBottle（第一个瓶子减量/清槽+报脏）。
// 村庄英雄胜利后必须移除：40 分钟挂身则下次胜利不再触发 effectAdd。
// 世界写前后须查实体有效性——失效句柄抛 "entity being invalid"。

import { world, BlockVolume } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import type { EffectInfo, VillageScan } from "../domain/RaidRules";
import {
  BAD_OMEN,
  BED_BLOCK_IDS,
  isOminousBottle,
  RAID_OMEN,
  RAID_OMEN_GRANT_AMPLIFIER,
  RAID_OMEN_GRANT_DURATION_TICKS,
  VILLAGE_HERO,
  VILLAGER_TYPE,
} from "../domain/RaidRules";
import { botOf, botValid, inventoryContainer } from "./Atomic";
import { entityGateway } from "./EntityGateway";
import { inventoryChanged } from "./Hooks";

// ─── 实体在场 ──

/** 假人实体可操作（离线/死亡瞬态 false——胜利处理"离场只记账不转移"判定源） */
export function botAlive(botId: number): boolean {
  const bot = botOf(botId);
  return bot !== null && botValid(bot);
}

// ─── 效果读取（getEffect 对不存在/不支持 ID 抛异常 → 视为无该效果） ──

function effectInfoOf(target: Player, effectId: string): EffectInfo | undefined {
  try {
    const eff = target.getEffect(effectId);
    if (!eff) return undefined;
    return { amplifier: eff.amplifier, duration: eff.duration ?? 0 };
  } catch {
    return undefined;
  }
}

// ─── 村庄兆头读写 ──

/**
 * 施加一次袭击之兆（4 秒）——到期即开袭，能力层每 5 秒续施形成覆盖。
 * @returns 成功 true；实体瞬态/addEffect 抛错 false（本拍跳过，下拍再来）
 */
export function grantRaidOmen(botId: number): boolean {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return false;
  try {
    bot.addEffect(RAID_OMEN, RAID_OMEN_GRANT_DURATION_TICKS, { amplifier: RAID_OMEN_GRANT_AMPLIFIER });
    return true;
  } catch {
    return false;
  }
}

/** 清除劫掠相关兆头（不祥之兆 + 袭击之兆）——停机/停摆时不留 buff 挂身 */
export function clearRaidOmens(botId: number): void {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return;
  for (const id of [RAID_OMEN, BAD_OMEN]) {
    try {
      bot.removeEffect(id);
    } catch {
      /* 效果不存在/句柄瞬态——清理尽力而为 */
    }
  }
}

/** 假人身上的村庄英雄（无/不可读 undefined） */
export function botVillageHero(botId: number): EffectInfo | undefined {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return undefined;
  return effectInfoOf(bot, VILLAGE_HERO);
}

/** 主人是否在线（村庄英雄转移的"不在线"播报分支判定源） */
export function realPlayerOnline(playerName: string): boolean {
  return entityGateway.findRealPlayer(playerName) !== undefined;
}

/** 主人身上的村庄英雄（离线/无 undefined） */
export function playerVillageHero(playerName: string): EffectInfo | undefined {
  const player = entityGateway.findRealPlayer(playerName);
  if (!player) return undefined;
  return effectInfoOf(player, VILLAGE_HERO);
}

/** 移除假人村庄英雄（胜利后必移——40 分钟挂着则下次胜利不重新触发 effectAdd） */
export function removeBotVillageHero(botId: number): boolean {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return false;
  try {
    bot.removeEffect(VILLAGE_HERO);
    return true;
  } catch {
    return false;
  }
}

/** 把合并后的村庄英雄授予主人（离线/异常 false） */
export function grantVillageHero(playerName: string, info: EffectInfo): boolean {
  const player = entityGateway.findRealPlayer(playerName);
  if (!player) return false;
  try {
    player.addEffect(VILLAGE_HERO, Math.floor(info.duration), { amplifier: info.amplifier });
    return true;
  } catch {
    return false;
  }
}

// ─── 不祥之瓶 ──

/** 背包不祥之瓶总数（不可读按 0——保守判无瓶） */
export function countBottles(botId: number): number {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return 0;
  const container = inventoryContainer(bot);
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

/**
 * 扣一瓶不祥之瓶（记账式瓶费：启动一瓶、此后每胜一瓶）。
 * 对背包第一个瓶子做最小改动：堆叠 >1 减量、=1 清槽；不换位、不碰主手。
 * 写入成功即报脏。
 * @returns 扣到 true；无瓶/容器不可读/写失败 false（调用侧据此停止施加）
 */
export function spendBottle(botId: number): boolean {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return false;
  const container = inventoryContainer(bot);
  if (!container) return false;
  try {
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item || !isOminousBottle(item.typeId)) continue;
      if (item.amount > 1) {
        item.amount -= 1;
        container.setItem(i, item);
      } else {
        container.setItem(i, undefined);
      }
      inventoryChanged(botId);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ─── 村庄存在感知（施加前先判附近有无村民/床） ──

/** 全局难度字符串（Difficulty 枚举值；读取失败 ""——domain 闸保守放行） */
export function readDifficulty(): string {
  try {
    return world.getDifficulty();
  } catch {
    return "";
  }
}

/** 村民水平搜索半径（格）：村庄半径口径 32 格（一次 type 过滤半径查询） */
const VILLAGER_SCAN_RADIUS = 32;
/**
 * 床批量采样立方半径（格）：x/z 16、y 8——y 取更厚会把 getBlocks 体积抬到
 * 5 万格而成慢日志源。
 */
const BED_SCAN_XZ = 16;
const BED_SCAN_Y = 8;

/**
 * 扫描假人附近村庄标志（村民实体一次半径查询 + 床一次 getBlocks）。
 * 命中即短路不计数；任一查询抛异常 unreadable=true（区块未加载 ≠ 没有村庄，
 * 由 domain judgeVillagePresence 保守放行）。
 */
export function scanVillagePresence(botId: number): VillageScan {
  const out: VillageScan = { villagers: 0, beds: 0, unreadable: false };
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) {
    out.unreadable = true;
    return out;
  }
  let dim;
  let loc;
  try {
    dim = bot.dimension;
    loc = bot.location;
  } catch {
    out.unreadable = true;
    return out;
  }
  try {
    for (const e of dim.getEntities({ type: VILLAGER_TYPE, location: loc, maxDistance: VILLAGER_SCAN_RADIUS })) {
      out.villagers = 1;
      break;
    }
  } catch {
    out.unreadable = true;
  }
  if (out.villagers === 0) {
    try {
      const volume = new BlockVolume(
        {
          x: Math.floor(loc.x) - BED_SCAN_XZ,
          y: Math.max(-64, Math.floor(loc.y) - BED_SCAN_Y),
          z: Math.floor(loc.z) - BED_SCAN_XZ,
        },
        {
          x: Math.floor(loc.x) + BED_SCAN_XZ,
          y: Math.min(320, Math.floor(loc.y) + BED_SCAN_Y),
          z: Math.floor(loc.z) + BED_SCAN_XZ,
        }
      );
      const found = dim.getBlocks(volume, { includeTypes: [...BED_BLOCK_IDS] });
      out.beds = found.getBlockLocationIterator().next().done ? 0 : 1;
    } catch {
      out.unreadable = true;
    }
  }
  return out;
}

// ─── 播报 ──

/** 世界公告（`[假人] ` 前缀；劫掠是全局事件级消息） */
export function broadcastWorld(text: string): void {
  try {
    world.sendMessage(`[假人] ${text}`);
  } catch {
    /* 广播失败不影响主流程 */
  }
}

/**
 * 主人私信：只按名字寻址，不依赖假人实体快照——假人离场（死亡/下线瞬态）时
 * 这一路是消息能送到主人的唯一路径。
 */
export function notifyOwner(ownerName: string | null, text: string): void {
  if (!ownerName) return;
  const owner = entityGateway.findRealPlayer(ownerName);
  if (!owner) return;
  try {
    owner.sendMessage(text);
  } catch {
    /* 瞬态失效 */
  }
}

/**
 * 阶段通知：主人（无论距离）+ 附近玩家（radius 内，排除假人自己），
 * 按实体 id 去重——主人在附近时不重复发送。
 */
export function notifyOwnerAndNearby(
  ownerName: string | null,
  dimId: string,
  center: Vec3,
  radius: number,
  text: string
): void {
  const targets = new Map<string, Player>();
  if (ownerName) {
    const owner = entityGateway.findRealPlayer(ownerName);
    if (owner) targets.set(owner.id, owner);
  }
  for (const p of entityGateway.realPlayersNear(dimId, center, radius)) {
    targets.set(p.id, p);
  }
  for (const p of targets.values()) {
    try {
      p.sendMessage(text);
    } catch {
      /* 瞬态失效 */
    }
  }
}
