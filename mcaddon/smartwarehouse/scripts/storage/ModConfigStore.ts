/**
 * ============================================================================
 * ModConfigStore —— 模组全局配置存储（Dynamic Property）
 * ============================================================================
 *
 * 职责：
 * 1. 存储模组级别配置（当前仅信物物品 ID）
 * 2. 从 DynamicProperty 读写，内存缓存
 * 3. 提供信物选项列表和默认值
 * ============================================================================
 */

import { world } from "@minecraft/server";
import { ITEM_NAME_MAP } from "../data/ItemNameMap";

// ─── 常量 ───────────────────────────────────────────────────────

/** Dynamic Property 键名 */
const CONFIG_KEY = "sw:mod_config";

/** 默认信物物品 ID（关闭时为 null） */
const DEFAULT_TOKEN = "minecraft:wooden_hoe";

/**
 * 从 name-maps 查询中文名，没有则取原始 ID。
 *
 * @param typeId - 物品类型 ID
 * @returns 中文名或原始 ID
 */
function labelFromMap(typeId: string): string {
  return ITEM_NAME_MAP[typeId] ?? typeId;
}

/**
 * 信物选项列表（label 自动从 name-maps 获取中文名）。
 * 关闭选项的 itemId 为 null。
 */
export const TOKEN_OPTIONS: { label: string; itemId: string | null }[] = [
  { label: "§7关闭 (无信物)", itemId: null },
  { label: `§e${labelFromMap("minecraft:wooden_hoe")} (默认)`, itemId: "minecraft:wooden_hoe" },
  { label: `§a${labelFromMap("minecraft:stick")}`, itemId: "minecraft:stick" },
  { label: `§d${labelFromMap("minecraft:parrot_spawn_egg")}`, itemId: "minecraft:parrot_spawn_egg" },
  { label: `§b${labelFromMap("minecraft:nautilus_shell")}`, itemId: "minecraft:nautilus_shell" },
  { label: `§6${labelFromMap("minecraft:disc_fragment_5")}`, itemId: "minecraft:disc_fragment_5" },
  { label: `§b${labelFromMap("minecraft:nether_star")}`, itemId: "minecraft:nether_star" },
  { label: `§6${labelFromMap("minecraft:blaze_powder")}`, itemId: "minecraft:blaze_powder" },
  { label: `§f${labelFromMap("minecraft:feather")}`, itemId: "minecraft:feather" },
  { label: `§7${labelFromMap("minecraft:flint")}`, itemId: "minecraft:flint" },
  { label: `§6${labelFromMap("minecraft:blaze_rod")}`, itemId: "minecraft:blaze_rod" },
  { label: `§b${labelFromMap("minecraft:breeze_rod")}`, itemId: "minecraft:breeze_rod" },
  { label: `§f${labelFromMap("minecraft:arrow")}`, itemId: "minecraft:arrow" },
];

// ─── 选项常量 ──────────────────────────────────────────────────

/** 仓库最大体积选项列表（用于 UI 下拉框） */
export const VOLUME_OPTIONS: { label: string; value: number }[] = [
  { label: "16×16×16 (4,096 方块)", value: 16 * 16 * 16 },
  { label: "24×24×16 (9,216 方块)", value: 24 * 24 * 16 },
  { label: "32×32×16 (16,384 方块) 推荐", value: 32 * 32 * 16 },
  { label: "48×48×16 (36,864 方块)", value: 48 * 48 * 16 },
];

/** 单仓库最大容器数选项列表（用于 UI 下拉框） */
export const CONTAINER_OPTIONS: { label: string; value: number }[] = [
  { label: "50 个容器", value: 50 },
  { label: "100 个容器", value: 100 },
  { label: "200 个容器 推荐", value: 200 },
  { label: "512 个容器", value: 512 },
];

// ─── 类型 ───────────────────────────────────────────────────────

/** 模组配置数据结构 */
export interface ModConfig {
  /** 信物物品 ID，null 表示关闭 */
  tokenItemId: string | null;
  /** 单个仓库最大体积上限 */
  maxWarehouseVolume: number;
  /** 单个仓库最大容器数上限 */
  maxContainers: number;
}

/** 信物选项（用于 UI 下拉框） */
export interface TokenOption {
  label: string;
  itemId: string | null;
}

// ─── 仓储 ──────────────────────────────────────────────────────

/**
 * 模组全局配置仓储。
 *
 * 使用内存缓存 + DynamicProperty 持久化，读取时优先返回缓存，
 * 写入时同时更新缓存和持久化。
 */
export class ModConfigStore {
  private cached: ModConfig | null = null;

  /**
   * 加载配置（优先返回内存缓存）。
   */
  load(): ModConfig {
    if (this.cached) return this.cached;

    const raw = world.getDynamicProperty(CONFIG_KEY);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as Partial<ModConfig>;
        this.cached = {
          tokenItemId: parsed.tokenItemId ?? DEFAULT_TOKEN,
          maxWarehouseVolume: parsed.maxWarehouseVolume ?? 16384,
          maxContainers: parsed.maxContainers ?? 200,
        };
        return this.cached;
      } catch {
        // JSON 解析失败，使用默认值
      }
    }

    this.cached = { tokenItemId: DEFAULT_TOKEN, maxWarehouseVolume: 16384, maxContainers: 200 };
    return this.cached;
  }

  /**
   * 持久化配置并更新内存缓存。
   */
  save(config: ModConfig): void {
    this.cached = { ...config };
    world.setDynamicProperty(CONFIG_KEY, JSON.stringify(this.cached));
  }

  /**
   * 获取当前信物物品 ID。
   *
   * @returns 物品 ID 字符串，关闭时返回 null
   */
  getTokenId(): string | null {
    return this.load().tokenItemId;
  }

  /**
   * 设置信物物品 ID 并持久化。
   *
   * @param itemId - 物品 ID，传 null 关闭信物
   */
  setTokenId(itemId: string | null): void {
    const config = this.load();
    this.save({ ...config, tokenItemId: itemId });
  }

  /**
   * 检查玩家当前主手物品是否为信物。
   *
   * @param heldTypeId - 玩家主手物品的 typeId（undefined 表示空手）
   * @returns 是否匹配当前信物
   */
  isToken(heldTypeId: string | undefined): boolean {
    const tokenId = this.getTokenId();
    if (tokenId === null) return false; // 信物关闭，永不匹配
    return heldTypeId === tokenId;
  }

  /** 获取仓库最大扫描体积 */
  getMaxVolume(): number { return this.load().maxWarehouseVolume; }

  /** 获取单仓库最大容器数 */
  getMaxContainers(): number { return this.load().maxContainers; }

  /**
   * 使缓存失效，下次读取时从 DynamicProperty 重新加载。
   */
  invalidateCache(): void {
    this.cached = null;
  }
}
