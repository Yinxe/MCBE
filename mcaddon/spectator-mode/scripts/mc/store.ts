// ── 持久化：全局配置(世界 DP) + 灵魂锚点(玩家 DP) ──
// 约定：玩家相关状态（灵魂锚点）一律只存玩家动态属性（不落世界），
// 这样每个玩家的旁观状态跟人走，离线时也随世界存档保留，重连即可恢复。
import { world, type Player } from "@minecraft/server";
import { CONFIG_KEYS, clampMaxDistance, defaultConfig } from "../core/config";
import type { SpConfig, SoulAnchor } from "../core/types";

/** 玩家动态属性键：灵魂锚点 JSON（重连恢复用） */
const SOUL_KEY = "sp:soul";

/** 读取全局配置（DP 缺失或损坏时回退默认值） */
export function readConfig(): SpConfig {
  const enabledRaw = world.getDynamicProperty(CONFIG_KEYS.enabled);
  const distanceRaw = world.getDynamicProperty(CONFIG_KEYS.maxDistance);
  const showLinkRaw = world.getDynamicProperty(CONFIG_KEYS.showLink);
  const fallback = defaultConfig();
  return {
    enabled: typeof enabledRaw === "boolean" ? enabledRaw : fallback.enabled,
    maxDistance: typeof distanceRaw === "number" ? clampMaxDistance(distanceRaw) : fallback.maxDistance,
    showLink: typeof showLinkRaw === "boolean" ? showLinkRaw : fallback.showLink,
  };
}

/** 写入全局配置（maxDistance 会先钳制） */
export function writeConfig(config: SpConfig): void {
  world.setDynamicProperty(CONFIG_KEYS.enabled, config.enabled);
  world.setDynamicProperty(CONFIG_KEYS.maxDistance, clampMaxDistance(config.maxDistance));
  world.setDynamicProperty(CONFIG_KEYS.showLink, config.showLink);
}

/**
 * 读取玩家灵魂锚点。
 * @param player - 目标玩家
 * @returns 锚点；无记录或数据损坏时返回 undefined
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
