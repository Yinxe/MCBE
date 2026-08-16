// ─── Bot 类（OOP 原子能力封装） ─────────────────────────
// 假人对象的统一入口：持有 BotRecord + 惰性解析 SimulatedPlayer 实体，
// 封装全部原子能力方法（导航/体态/装备/背包/使用/状态/查询/生命周期）。
//
// 设计原则：
//   - 构造只接受 botName（或 record），实体/容器按需惰性解析（不缓存过期引用）
//   - 所有世界操作 try-catch 防御：不可用/未加载返回 false/undefined，不抛错
//   - 面向对象：能力即方法（bot.navigateTo / bot.swapMainhand / bot.isAvailable）
//   - 领域事件解耦保留：装备/行为变化仍触发 BotEvents（订阅方不变）
//   - 与旧函数式 features 并存过渡：迁移完成后旧函数退役

import type { Container, Dimension, Entity, ItemStack, Player, Vector3, World } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../rules/Types";
import { BOT_TAG } from "../rules/tags/BotTags";
import type { BotRegistry } from "../service/BotRegistry";

// ─── 常量 ──────────────────────────────────────────────

/**
 * ⚠️ 惰性加载说明：本文件被 node 测试编译（tsconfig.test.json include），
 * 测试环境无 @minecraft/server 运行时模块——顶部 import 会导致测试加载失败。
 * 因此世界依赖统一走下方 lazy 加载器，仅在方法实际调用时 require。
 * （Bot.ts 不进测试编译，可安全顶部 import，见 Bot.ts。）
 */

/** 统一惰性加载器：@minecraft/server 运行时模块（首次调用才 require） */
function mc(): typeof import("@minecraft/server") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@minecraft/server") as typeof import("@minecraft/server");
}

/** world 单例（经统一惰性加载器） */
function world(): World {
  return mc().world;
}

// ─── Bot 类 ────────────────────────────────────────────

export class BotCore {
  /** 假人唯一名（= SimulatedPlayer name） */
  readonly name: string;

  /** 记录注册表（构造函数注入——测试可注入 InMemory 替身；mc 单例由调用方提供） */
  private readonly registry: BotRegistry;

  /**
   * @param name 假人名（须已存在于注册表）
   * @param registry 记录注册表（必须注入：mc 层传全局单例，测试传 InMemory 替身）
   * @throws 记录不存在时抛出（调用方应先用 registry 校验）
   */
  constructor(name: string, registry: BotRegistry) {
    if (!registry.get(name)) throw new Error(`Bot 记录不存在: ${name}`);
    this.name = name;
    this.registry = registry;
  }

  // ─── 记录访问 ────────────────────────────────────────

  /** 当前持久记录（每次实时读取，避免过期引用） */
  get record(): BotRecord {
    const r = this.registry.get(this.name);
    if (!r) throw new Error(`Bot 记录不存在: ${this.name}`);
    return r;
  }

  /** 在线且未死亡 */
  get isAvailable(): boolean {
    const r = this.record;
    return r.online && !r.death;
  }

  /** 是否死亡 */
  get isDeath(): boolean {
    return this.record.death;
  }

  /** 是否在线（含死亡在线） */
  get isOnline(): boolean {
    return this.record.online;
  }

  /** 持久标签列表 */
  get tags(): string[] {
    return this.record.tags;
  }

  // ─── 实体解析（持有 + 生命周期守卫） ─────────────────

  /** 实体缓存（有效生命周期内持有——在线且未死亡时必然有效） */
  private entityRef: SimulatedPlayer | undefined;

  /**
   * 假人实体（**有效生命周期内持有**）：
   * 仅在 isAvailable（在线且未死亡）时返回；内部缓存 + isValid 双守卫——
   *   命中缓存且有效 → 直接返回（零查询）；
   *   缓存失效/缺失 → 经 botCache 解析（TTL 缓存 + botOffline 立即失效）。
   * 死亡/下线 → isAvailable false → 返回 undefined（引用自然失效）；
   * 重连（实体替换）→ 旧引用 isValid=false → 自动重解析。
   * 惰性 require 保持测试构建零 mc 顶层依赖。
   */
  get entity(): SimulatedPlayer | undefined {
    if (!this.isAvailable) return undefined;
    if (this.entityRef?.isValid) return this.entityRef;
    try {
      this.entityRef = lazy.resolveBotCached(this.name);
    } catch {
      // 测试环境无 @minecraft 运行时 → 视为无实体（不抛错）
      this.entityRef = undefined;
    }
    return this.entityRef;
  }

  /** 手动清空实体引用（下线/删除等场景；getter 守卫已保证安全，此方法供显式清理） */
  clearEntity(): void {
    this.entityRef = undefined;
  }

  /** 实体所在维度（无实体 → undefined） */
  get dimension(): import("@minecraft/server").Dimension | undefined {
    return this.entity?.dimension;
  }

  /** 当前位置（无实体 → undefined） */
  get location(): Vector3 | undefined {
    return this.entity?.location;
  }

  /** 背包容器（主背包 36 格；无实体 → undefined） */
  get container(): Container | undefined {
    return this.entity?.getComponent("minecraft:inventory")?.container;
  }

  /** 当前主手槽 */
  get handSlot(): number {
    return this.entity?.selectedSlotIndex ?? 0;
  }

  /** 主手物品 */
  get mainhandItem(): import("@minecraft/server").ItemStack | undefined {
    const c = this.container;
    if (!c) return undefined;
    return c.getItem(this.handSlot) ?? undefined;
  }

  // ─── 原子能力：导航（委托 features/basic/move，见 Bot.ts 门面） ──
  // ⚠️ navigateTo 不在本层实现：导航为耗时异步能力（while+await 循环监测位置、
  //    多状态返回），属于 mc 副作用功能，已下沉至 features/basic/move.navigateBot，
  //    Bot 门面（Bot.ts）委托。本层保持纯逻辑/轻量原子能力。

  /** 停止移动 */
  stopMoving(): void {
    try {
      this.entity?.stopMoving();
    } catch { /* ignore */ }
  }

  /** 传送（跨维度时用世界侧 TP） */
  teleportTo(location: Vector3, dimensionId?: string): boolean {
    const bot = this.entity;
    if (!bot) return false;
    try {
      if (dimensionId && dimensionId !== bot.dimension.id) {
        const dim = world().getDimension(dimensionId);
        dim.getEntities({ location, maxDistance: 1 });
      }
      bot.teleport(location);
      return true;
    } catch {
      return false;
    }
  }

  // ─── 原子能力：体态 ──────────────────────────────────

  /** 潜行（true=潜行）——同步 record 与实体 */
  setSneaking(sneaking: boolean): boolean {
    const bot = this.entity;
    if (!bot) return false;
    try {
      this.record.isSneaking = sneaking;
      bot.isSneaking = sneaking;
      this.syncTagsToEntity();
      return true;
    } catch {
      return false;
    }
  }

  /** 看向目标点 */
  lookAt(target: Vector3): boolean {
    const bot = this.entity;
    if (!bot) return false;
    try {
      bot.lookAtLocation(target);
      return true;
    } catch {
      return false;
    }
  }

  // ─── 原子能力：背包/装备 ─────────────────────────────

  /** 读取指定槽物品 */
  getItem(slot: number): import("@minecraft/server").ItemStack | undefined {
    const c = this.container;
    if (!c) return undefined;
    try {
      return c.getItem(slot) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** 写入指定槽（undefined = 清空） */
  setItem(slot: number, item?: import("@minecraft/server").ItemStack): boolean {
    const c = this.container;
    if (!c) return false;
    try {
      c.setItem(slot, item);
      return true;
    } catch {
      return false;
    }
  }

  /** 交换两槽 */
  swapSlots(a: number, b: number): boolean {
    const c = this.container;
    if (!c) return false;
    try {
      const itemA = c.getItem(a);
      const itemB = c.getItem(b);
      c.setItem(a, itemB);
      c.setItem(b, itemA);
      return true;
    } catch {
      return false;
    }
  }

  /** 主手槽设置 */
  setMainhandSlot(slot: number): boolean {
    const bot = this.entity;
    if (!bot) return false;
    try {
      bot.selectedSlotIndex = slot;
      return true;
    } catch {
      return false;
    }
  }

  // ─── 原子能力：标签 ──────────────────────────────────

  /** 是否有标签 */
  hasTag(tag: string): boolean {
    return this.record.tags.includes(tag);
  }

  /** 添加标签（改 record + 同步实体，走 setTags 语义） */
  addTag(tag: string): void {
    const tags = this.record.tags;
    if (tags.includes(tag)) return;
    tags.push(tag);
    this.syncTagsToEntity();
  }

  /** 移除标签 */
  removeTag(tag: string): void {
    const tags = this.record.tags;
    const idx = tags.indexOf(tag);
    if (idx < 0) return;
    tags.splice(idx, 1);
    this.syncTagsToEntity();
  }

  /** 实体标签与记录同步（mc 适配惰性加载——避免测试构建解析 mc 层） */
  private syncTagsToEntity(): void {
    const bot = this.entity;
    if (!bot) return;
    try {
      lazy.syncEntityTags(bot, this.record.tags);
    } catch { /* ignore */ }
  }

  // ─── 原子能力：状态查询 ──────────────────────────────

  /** 3D 距离（无实体 → Infinity） */
  distanceTo(target: Vector3): number {
    const loc = this.location;
    if (!loc) return Number.POSITIVE_INFINITY;
    return Math.hypot(loc.x - target.x, loc.y - target.y, loc.z - target.z);
  }

  /** 是否可被操作（在线/未死亡/实体存在） */
  isOperable(): boolean {
    return this.isAvailable && !!this.entity;
  }

  /** 实体是否仍有效（世界侧） */
  get isEntityValid(): boolean {
    const e = this.entity;
    return !!e && e.isValid;
  }

}

// ─── Bot 解析工具（BotCore 层：纯逻辑可用，mc 层有同名扩展） ──

/**
 * 安全解析 BotCore（记录不存在 → undefined，不抛错）。
 * @param name 假人名
 * @param registry 记录注册表（mc 层传全局单例；测试传 InMemory 替身）
 */
export function resolveBot(name: string, registry: BotRegistry): BotCore | undefined {
  try {
    return new BotCore(name, registry);
  } catch {
    return undefined;
  }
}

/**
 * 强制解析 BotCore（记录不存在 → 抛错）。
 * @param name 假人名
 * @param registry 记录注册表（mc 层传全局单例；测试传 InMemory 替身）
 */
export function requireBot(name: string, registry: BotRegistry): BotCore {
  return new BotCore(name, registry);
}

// ─── 统一惰性加载器（mc 适配模块，测试环境不可加载——仅在方法调用时 require） ──

/**
 * BotCore 依赖的 mc 适配模块统一惰性加载：
 *   - PlayerGateway.resolveBotPlayer（实体解析）
 *   - features/basic/EntityTags.syncEntityTags（标签同步）
 * 顶部 import 会使 node 测试加载 BotCore 时 require @minecraft 失败，
 * 因此集中在此按需加载（测试不调用世界方法 → 不触发 require）。
 */
const lazy = {
  get resolveBotCached(): typeof import("../features/ai/botCache").resolveBotCached {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../features/ai/botCache").resolveBotCached;
  },
  get resolveBotPlayer(): typeof import("./PlayerGateway").resolveBotPlayer {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./PlayerGateway").resolveBotPlayer;
  },
  get syncEntityTags(): typeof import("../features/basic/EntityTags").syncEntityTags {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../features/basic/EntityTags").syncEntityTags;
  },
};
