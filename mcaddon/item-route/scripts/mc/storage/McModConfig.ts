// ─── 模组全局配置：速度上限/全局开关/信物/引导标记（overwrite + hash） ──
import type { ShardStore } from "./ShardStore";

const CONFIG_KEY = "ir2:modcfg";
const GUIDE_SEEN_KEY = "ir2:guide_seen:"; // 每玩家独立（v1 按玩家标记）
const SPEED_MIN = 1;
const SPEED_MAX = 40; // 与 core Scheduler clamp 一致

export interface ModConfigData {
  globalEnabled: boolean;
  globalSpeedLimit: number;
  tokenItemId: string;
  /** 单仓最大体积（格，v1 默认 32×32×16） */
  maxWarehouseVolume: number;
  /** 每玩家最多仓库数（v1 默认 1） */
  maxWarehousesPerPlayer: number;
}

export const DEFAULT_MOD_CONFIG: ModConfigData = {
  globalEnabled: true,
  globalSpeedLimit: 20,
  tokenItemId: "minecraft:wooden_hoe",
  maxWarehouseVolume: 16_384,
  maxWarehousesPerPlayer: 1,
};

/** 信物可选列表（ConfigUI 下拉） */
export const TOKEN_OPTIONS = [
  "minecraft:wooden_hoe",
  "minecraft:stick",
  "minecraft:parrot_spawn_egg",
  "minecraft:nautilus_shell",
  "minecraft:music_disc_11",
  "minecraft:nether_star",
  "minecraft:blaze_powder",
];

export class McModConfig {
  private data: ModConfigData;

  private constructor(
    private readonly shards: ShardStore,
    data: ModConfigData
  ) {
    this.data = data;
  }

  static load(shards: ShardStore): McModConfig {
    const data = shards.read<ModConfigData>(CONFIG_KEY);
    return new McModConfig(shards, {
      globalEnabled: data?.globalEnabled ?? DEFAULT_MOD_CONFIG.globalEnabled,
      globalSpeedLimit: McModConfig.clamp(data?.globalSpeedLimit ?? DEFAULT_MOD_CONFIG.globalSpeedLimit),
      tokenItemId: data?.tokenItemId ?? DEFAULT_MOD_CONFIG.tokenItemId,
      maxWarehouseVolume: data?.maxWarehouseVolume ?? DEFAULT_MOD_CONFIG.maxWarehouseVolume,
      maxWarehousesPerPlayer: data?.maxWarehousesPerPlayer ?? DEFAULT_MOD_CONFIG.maxWarehousesPerPlayer,
    });
  }

  get globalEnabled(): boolean { return this.data.globalEnabled; }
  get globalSpeedLimit(): number { return this.data.globalSpeedLimit; }
  get tokenItemId(): string { return this.data.tokenItemId; }
  get maxWarehouseVolume(): number { return this.data.maxWarehouseVolume; }
  get maxWarehousesPerPlayer(): number { return this.data.maxWarehousesPerPlayer; }

  setGlobalEnabled(enabled: boolean): void {
    this.data.globalEnabled = enabled;
    this.save();
  }

  setGlobalSpeedLimit(speed: number): void {
    this.data.globalSpeedLimit = McModConfig.clamp(speed);
    this.save();
  }

  /** 更换信物物品 */
  setTokenItemId(itemId: string): void {
    this.data.tokenItemId = itemId;
    this.save();
  }

  /** 是否信物物品 */
  isToken(itemTypeId: string): boolean {
    return itemTypeId === this.data.tokenItemId;
  }

  /** 新手引导是否已看过（按玩家独立 DP 键，v1 口径） */
  hasSeenGuide(playerId: string): boolean {
    return this.shards.read<boolean>(GUIDE_SEEN_KEY + playerId) ?? false;
  }

  markSeenGuide(playerId: string): void {
    this.shards.write(GUIDE_SEEN_KEY + playerId, true, "overwrite");
  }

  private static clamp(speed: number): number {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed)));
  }

  private save(): void {
    this.shards.write(CONFIG_KEY, this.data, "overwrite");
  }
}