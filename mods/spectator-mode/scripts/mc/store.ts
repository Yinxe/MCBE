// ── 持久化:全局配置(世界 DP) + 灵魂锚点(玩家 DP) ──
// 约定:玩家相关状态(灵魂锚点)一律只存玩家动态属性(不落世界),
// 这样每个玩家的旁观状态跟人走,离线时也随世界存档保留,重连即可恢复。
import { world, type Player } from "@minecraft/server";
import { CONFIG_KEYS, clampMaxDistance, defaultConfig } from "../core/config";
import type { SpConfig, SoulAnchor } from "../core/types";

/**
 * 玩家动态属性键:灵魂锚点 JSON(重连恢复用)。
 *
 * 与 `core/config.ts` 的 `sp:*` 同理,刻意沿用上游键名以延续旧存档里
 * 「以灵魂状态离线」的锚点,详见该文件的键名注释。
 */
export const SOUL_KEY = "sp:soul";

/**
 * 玩家动态属性键:进入灵魂出窍前的夜视快照(JSON)。
 *
 * 夜视是模组赠送的效果,不得消耗玩家自己的夜视时长,因此必须在进入时
 * 快照 `{amplifier, durationTicks}`,回归时**原样**恢复。
 * **不记录进入时刻**:`Effect.duration` 只给总时长、不给剩余时长,而本需求下
 * 灵魂阶段停留多久对结果无影响,记录时间基准只会引入重连后
 * `system.currentTick` 重置的误差源。
 */
export const NIGHT_VISION_KEY = "sp:nvSave";

/** 进入灵魂出窍前的夜视状态快照 */
export interface NightVisionSnapshot {
  /** 效果强度(Jump Boost II → 1) */
  amplifier: number;
  /** 进入那一刻的效果总时长(ticks);非正数表示无限时长 */
  durationTicks: number;
}

/** 读取全局配置(DP 缺失或损坏时回退默认值) */
export function readConfig(): SpConfig {
  const enabledRaw = world.getDynamicProperty(CONFIG_KEYS.enabled);
  const distanceRaw = world.getDynamicProperty(CONFIG_KEYS.maxDistance);
  const showLinkRaw = world.getDynamicProperty(CONFIG_KEYS.showLink);
  const nightVisionRaw = world.getDynamicProperty(CONFIG_KEYS.nightVision);
  const fallback = defaultConfig();
  return {
    enabled: typeof enabledRaw === "boolean" ? enabledRaw : fallback.enabled,
    maxDistance: typeof distanceRaw === "number" ? clampMaxDistance(distanceRaw) : fallback.maxDistance,
    showLink: typeof showLinkRaw === "boolean" ? showLinkRaw : fallback.showLink,
    nightVision: typeof nightVisionRaw === "boolean" ? nightVisionRaw : fallback.nightVision,
  };
}

/** 写入全局配置(maxDistance 会先钳制) */
export function writeConfig(config: SpConfig): void {
  world.setDynamicProperty(CONFIG_KEYS.enabled, config.enabled);
  world.setDynamicProperty(CONFIG_KEYS.maxDistance, clampMaxDistance(config.maxDistance));
  world.setDynamicProperty(CONFIG_KEYS.showLink, config.showLink);
  world.setDynamicProperty(CONFIG_KEYS.nightVision, config.nightVision);
}

/**
 * 读取玩家灵魂锚点。
 * @param player - 目标玩家
 * @returns 锚点;无记录或数据损坏时返回 undefined
 */
export function readSoulAnchor(player: Player): SoulAnchor | undefined {
  const raw = player.getDynamicProperty(SOUL_KEY);
  if (typeof raw !== "string") return undefined;
  try {
    const a = JSON.parse(raw) as Partial<SoulAnchor>;
    if (
      typeof a.dimensionId === "string" &&
      typeof a.gameMode === "string" &&
      Number.isFinite(a.x) &&
      Number.isFinite(a.y) &&
      Number.isFinite(a.z)
    ) {
      return {
        x: a.x!,
        y: a.y!,
        z: a.z!,
        dimensionId: a.dimensionId,
        gameMode: a.gameMode,
      };
    }
  } catch {
    // 数据损坏 → 按无锚点处理
  }
  return undefined;
}

/** 写入玩家灵魂锚点 */
export function writeSoulAnchor(player: Player, anchor: SoulAnchor): void {
  player.setDynamicProperty(SOUL_KEY, JSON.stringify(anchor));
}

/** 清除玩家灵魂锚点 */
export function clearSoulAnchor(player: Player): void {
  player.setDynamicProperty(SOUL_KEY);
}

/**
 * 读取玩家进入灵魂出窍前的夜视快照。
 * @param player - 目标玩家
 * @returns 快照;无记录或数据损坏时返回 undefined
 */
export function readNightVisionSnapshot(player: Player): NightVisionSnapshot | undefined {
  const raw = player.getDynamicProperty(NIGHT_VISION_KEY);
  if (typeof raw !== "string") return undefined;
  try {
    const s = JSON.parse(raw) as Partial<NightVisionSnapshot>;
    if (typeof s.amplifier === "number" && Number.isFinite(s.amplifier) && typeof s.durationTicks === "number") {
      return { amplifier: s.amplifier, durationTicks: s.durationTicks };
    }
  } catch {
    // 数据损坏 → 按无快照处理(回归时移除夜视)
  }
  return undefined;
}

/** 写入玩家夜视快照(仅玩家 DP,不落世界) */
export function writeNightVisionSnapshot(player: Player, snapshot: NightVisionSnapshot): void {
  player.setDynamicProperty(NIGHT_VISION_KEY, JSON.stringify(snapshot));
}

/** 清除玩家夜视快照 */
export function clearNightVisionSnapshot(player: Player): void {
  player.setDynamicProperty(NIGHT_VISION_KEY);
}
