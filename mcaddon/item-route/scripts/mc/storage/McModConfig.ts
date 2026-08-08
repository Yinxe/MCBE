// ─── 模组全局配置：速度上限/全局开关/信物/建仓限制/引导标记 ──
// 单键 `ir2:modcfg`（overwrite + hash）存 ModConfigData，内存缓存一份副本；
// setter 写穿透落盘。引导标记走独立 per-player 键 `ir2:guide_seen:{playerName}`
// （v1 口径：每个玩家各自看一次新手引导）。
// 建仓限制（maxWarehouseVolume/maxWarehousesPerPlayer）在装配时喂给
// WarehouseService.limits，作为建仓时的边界校验（见 services/WarehouseService）。
import type { ShardStore } from "./ShardStore";
import type { WarehouseSpec } from "../../core/services/WarehouseService";
import { defaultMenuInfo } from "../../core/data/MenuInfo";

const CONFIG_KEY = "ir2:modcfg";
const GUIDE_SEEN_KEY = "ir2:guide_seen:"; // 每玩家独立（v1 按玩家标记）
const SPEED_MIN = 1;
const SPEED_MAX = 40; // 与 core Scheduler clamp 一致

export interface ModConfigData {
  globalEnabled: boolean;
  globalSpeedLimit: number;
  tokenItemId: string;
  /** 单仓最大规格（各轴最大边长，v1 口径：规格限制而非体积格数，默认 32×16×32） */
  maxWarehouseSpec: WarehouseSpec;
  /** 每玩家最多仓库数（v1 默认 1） */
  maxWarehousesPerPlayer: number;
  /** 单仓最大容器数（v1 默认 100，建仓/重扫/放置注册时校验） */
  maxContainers: number;
  /** 菜单信息元素开关（key → 是否显示；默认全开；渲染方按它跳过计算） */
  menuInfo: Record<string, boolean>;
}

export const DEFAULT_MOD_CONFIG: ModConfigData = {
  globalEnabled: true,
  globalSpeedLimit: 8, // 全局"最快速度"下限（tick 越小越快）；默认与仓库默认速度 8 一致 → 默认不额外限速
  tokenItemId: "minecraft:wooden_hoe",
  maxWarehouseSpec: { x: 32, y: 16, z: 32 },
  maxWarehousesPerPlayer: 1,
  maxContainers: 100,
  menuInfo: defaultMenuInfo(),
};

/** 信物可选列表（OPConfigUI 下拉；对齐 v1 smartwarehouse ModConfigStore.TOKEN_OPTIONS 的物品清单） */
export const TOKEN_OPTIONS = [
  "minecraft:wooden_hoe",
  "minecraft:stick",
  "minecraft:parrot_spawn_egg",
  "minecraft:nautilus_shell",
  "minecraft:disc_fragment_5",
  "minecraft:nether_star",
  "minecraft:blaze_powder",
  "minecraft:feather",
  "minecraft:flint",
  "minecraft:blaze_rod",
  "minecraft:breeze_rod",
  "minecraft:arrow",
];

/**
 * 模组全局配置：单键 `ir2:modcfg`（overwrite + hash）存 ModConfigData，内存缓存一份副本；
 * setter 写穿透落盘；getter 读内存。引导标记走独立 per-player 键 `ir2:guide_seen:{playerName}`。
 * ⚠️ 早执行安全：`create()` 只建默认值不读 DP（Phase 2 顶层用）；持久化值须 Phase 4 `refresh()` 读取。
 * 建仓限制（maxWarehouseVolume/maxWarehousesPerPlayer）装配时喂给 WarehouseService.limits。
 */
export class McModConfig {
  private data: ModConfigData;

  private constructor(
    private readonly shards: ShardStore,
    data: ModConfigData
  ) {
    this.data = data;
  }

  /**
   * Phase 2（模块加载顶层）用：只建默认值、**不读 DP**。
   * ⚠️ world.getDynamicProperty 在"早执行"（世界加载前）调用会抛
   * `cannot be used in early execution`——持久化值必须由 Phase 4 refresh() 读取。
   */
  static create(shards: ShardStore): McModConfig {
    return new McModConfig(shards, { ...DEFAULT_MOD_CONFIG });
  }

  /** 读取持久化配置（测试/Phase 4 用；早执行不可调用） */
  static load(shards: ShardStore): McModConfig {
    const cfg = new McModConfig(shards, { ...DEFAULT_MOD_CONFIG });
    cfg.refresh();
    return cfg;
  }

  /** Phase 4（世界加载后）读取持久化配置并合并（早执行不可用） */
  refresh(): void {
    this.applyData(this.shards.read<ModConfigData>(CONFIG_KEY));
  }

  private applyData(data: ModConfigData | undefined): void {
    this.data = {
      globalEnabled: data?.globalEnabled ?? DEFAULT_MOD_CONFIG.globalEnabled,
      globalSpeedLimit: McModConfig.clamp(data?.globalSpeedLimit ?? DEFAULT_MOD_CONFIG.globalSpeedLimit),
      tokenItemId: data?.tokenItemId ?? DEFAULT_MOD_CONFIG.tokenItemId,
      maxWarehouseSpec: data?.maxWarehouseSpec ?? DEFAULT_MOD_CONFIG.maxWarehouseSpec,
      maxWarehousesPerPlayer: data?.maxWarehousesPerPlayer ?? DEFAULT_MOD_CONFIG.maxWarehousesPerPlayer,
      maxContainers: data?.maxContainers ?? DEFAULT_MOD_CONFIG.maxContainers,
      // 菜单信息开关：旧档缺字段 → 落到默认（全开）
      menuInfo: data?.menuInfo ?? defaultMenuInfo(),
    };
  }

  get globalEnabled(): boolean {
    return this.data.globalEnabled;
  }
  get globalSpeedLimit(): number {
    return this.data.globalSpeedLimit;
  }
  get tokenItemId(): string {
    return this.data.tokenItemId;
  }
  get maxWarehouseSpec(): WarehouseSpec {
    return this.data.maxWarehouseSpec;
  }
  get maxWarehousesPerPlayer(): number {
    return this.data.maxWarehousesPerPlayer;
  }
  get maxContainers(): number {
    return this.data.maxContainers;
  }
  /** 菜单信息元素开关态（key → boolean；默认全开） */
  get menuInfo(): Record<string, boolean> {
    return { ...this.data.menuInfo };
  }

  /** 批量更新菜单信息开关（局部合并：未传 key 保留当前值，写穿落盘） */
  setMenuInfo(next: Record<string, boolean>): void {
    this.data.menuInfo = { ...this.data.menuInfo, ...next };
    this.save();
  }

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

  /** 修改单仓最大规格（各轴最大边长，v1 OPConfigUI 下拉可配） */
  setMaxWarehouseSpec(spec: WarehouseSpec): void {
    this.data.maxWarehouseSpec = spec;
    this.save();
  }

  /** 修改每玩家最多仓库数（v1 OPConfigUI slider 可配） */
  setMaxWarehousesPerPlayer(count: number): void {
    this.data.maxWarehousesPerPlayer = count;
    this.save();
  }

  /** 修改单仓最大容器数（v1 OPConfigUI 下拉可配） */
  setMaxContainers(count: number): void {
    this.data.maxContainers = count;
    this.save();
  }

  /** 是否信物物品 */
  isToken(itemTypeId: string): boolean {
    return itemTypeId === this.data.tokenItemId;
  }

  /** 新手引导是否已看过（按玩家独立 DP 键，v1 口径） */
  hasSeenGuide(playerName: string): boolean {
    return this.shards.read<boolean>(GUIDE_SEEN_KEY + playerName) ?? false;
  }

  markSeenGuide(playerName: string): void {
    this.shards.write(GUIDE_SEEN_KEY + playerName, true, "overwrite");
  }

  private static clamp(speed: number): number {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed)));
  }

  private save(): void {
    this.shards.write(CONFIG_KEY, this.data, "overwrite");
  }
}
