// ─── 模组全局配置：globalSpeedLimit + 全局分拣开关（overwrite + hash） ──
import type { ShardStore } from "./ShardStore";

const CONFIG_KEY = "ir2:modcfg";
const SPEED_MIN = 1;
const SPEED_MAX = 40; // 与 core Scheduler clamp 一致

export interface ModConfigData {
  globalEnabled: boolean;
  globalSpeedLimit: number;
}

export const DEFAULT_MOD_CONFIG: ModConfigData = { globalEnabled: true, globalSpeedLimit: 20 };

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
    });
  }

  get globalEnabled(): boolean { return this.data.globalEnabled; }
  get globalSpeedLimit(): number { return this.data.globalSpeedLimit; }

  setGlobalEnabled(enabled: boolean): void {
    this.data.globalEnabled = enabled;
    this.save();
  }

  setGlobalSpeedLimit(speed: number): void {
    this.data.globalSpeedLimit = McModConfig.clamp(speed);
    this.save();
  }

  private static clamp(speed: number): number {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed)));
  }

  private save(): void {
    this.shards.write(CONFIG_KEY, this.data, "overwrite");
  }
}