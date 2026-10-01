// ─── 生命周期上下文（DI 容器） ───────────────────
// 集中持有生命周期编排所需的一切外部依赖。
// 构造时一次性注入，避免组件各自 import 全局单例导致的循环依赖与隐式耦合。
// 组件通过 onRegister(ctx) 拿到上下文，或在 hook 参数中拿到 ctx（显式依赖，利于测试替身注入）。

import type { ItemStack } from "@minecraft/server";
import type { BotRegistry } from "../service/BotRegistry";
import type { BotStore } from "../service/port/BotStore";
import type { McConfigStore } from "../service/port/McConfigStore";
import type { SaveCoordinator } from "../bootstrap/save";
import type { InventoryStorage } from "../features/inventoryStorage";

export interface LifecycleContext {
  /** 注册表（内存 + 持久化写穿的唯一真源） */
  readonly registry: BotRegistry;
  /** 持久化后端（NBT 木桶阵列 / InMemory 替身） */
  readonly store: BotStore<ItemStack>;
  /** 全局配置（配额/管理员/冷却） */
  readonly configStore: McConfigStore;
  /** 保存协调器（写唯一入口） */
  readonly save: SaveCoordinator;
  /** 库存存储（增量保存 + 指纹对账） */
  readonly inventory: InventoryStorage;
  /** 重连中标记（playerLeave 抑制消息、per-bot 串行） */
  readonly reconnecting: Set<string>;
}
