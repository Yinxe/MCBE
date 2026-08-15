// ─── mc 层运行时装配上下文 ──────────────────────────────
// mc 层组合根的产物：core BotRegistry 单例 + NBT 木桶阵列持久化后端。
// main.ts（4-Phase 组合根）最先 import 本模块完成装配；
// mc 层各模块直接 import 这里的单例（等价于旧 persistence.ts 的模块级 botRegistry）。
// core 层测试不经过此处：测试自行构造 `new BotRegistry(new InMemoryBotStore())`。

import { BotRegistry } from "../../service/BotRegistry";
import { McBotStore } from "../adapters/McBotStore";
import { McConfigStore } from "../adapters/McConfigStore";
import { SaveCoordinator } from "./save";
import { InventoryStorage } from "../features/inventoryStorage";

/** 假人持久化后端（NBT 木桶阵列：真实 ItemStack 完整 NBT；绑定表独立存储，与记录解耦；读操作直接使用，写操作统一走 saveCoordinator） */
export const botStore = new McBotStore();

/** 假人注册表（内存 + 持久化写穿） */
export const botRegistry = new BotRegistry(botStore);

/** 全局配置（默认配额/逐人配额/管理员名单；worldLoad 后需 refresh()） */
export const configStore = new McConfigStore();

/** 库存存储（事件驱动增量保存 + 对账 + 恢复；worldLoad 后需 register() 订阅装备槽事件） */
export const inventoryStorage = new InventoryStorage(botRegistry, botStore);

/** 保存协调器：所有持久化写的统一入口 */
export const saveCoordinator = new SaveCoordinator(botRegistry, botStore, inventoryStorage);
