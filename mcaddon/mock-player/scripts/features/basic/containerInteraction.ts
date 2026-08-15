// ─── 假人与容器交互（mc 层） ─────────────────────────────
// withContainer：假人与指定坐标的容器交互——**看向容器**（扭头朝向）→ 回调
// 自由取放（取什么/存什么由其他功能模块自由发挥）。
//
// ⚠️ 机制决策（用户规格 2.1.11）：**不做开箱/关箱交互**——interact()/stopInteracting()
//    对模拟玩家的开箱动画支持不完整（同一实体只有首次能播放 lid 动画，引擎
//    方块实体 NBT IsOpened 无 Script API 可复位），**直接操作容器内容**
//    （minecraft:inventory 组件读写不依赖容器打开状态）。"扭头看向容器"
//    保留（假人面向容器操作更真实）。
//
// 约定（用户规格）：
//   - 写操作固定 **每 2 tick 一次**（异步方法内部**先操作后等待**，防冲突
//     且避免等待窗口被其他插入操作覆盖槽位）；**读操作不等待**（无副作用）
//   - 容器类型：任何带 minecraft:inventory 组件的方块（箱子/木桶/潜影盒
//     及 16 色变种，组件判定自动覆盖，无需枚举 ID）

import { system, world } from "@minecraft/server";
import type { BlockInventoryComponent, Container, ItemStack } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import type { Vec3 } from "../../rules/Types";
import { BOT_TAG } from "../../rules/BotTags";
import { botRegistry } from "../../bootstrap/context";
import { lookAt } from "./PoseGateway";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { waitTicks } from "../utils";

// ─── 常量 ────────────────────────────────────────────────

/** 格子操作最小间隔（tick，用户规格：每 2 tick 操作一个格子，防冲突） */
const SLOT_OP_INTERVAL_TICKS = 2;

// ─── 结果类型 ────────────────────────────────────────────

/** 容器交互结果：ok=完成 / offline=假人不可用 / not-container=目标不是容器 / error=执行异常 */
export type ContainerOpResult = "ok" | "offline" | "not-container" | "error";

// ─── 容器访问（格子操作固定 2 tick 间隔） ────────────────

/** 容器访问句柄：读不等待、写操作自动 2 tick 间隔（其他模块在此自由取放） */
export interface ContainerAccess {
  /** 底层容器（高级操作直连） */
  readonly container: Container;
  /** 容器尺寸（格数） */
  readonly size: number;
  /** 取物（读操作，不等待；该格无物品返回 undefined） */
  getItem(slot: number): Promise<ItemStack | undefined>;
  /** 存物（写操作，先操作后等待 2 tick；item 省略 = 清空该格） */
  setItem(slot: number, item?: ItemStack): Promise<void>;
  /** 搬移整叠到目标容器（写操作，先操作后等待 2 tick；目标容器自动找空位），返回被搬走的物品 */
  transferItem(fromSlot: number, toContainer: Container): Promise<ItemStack | undefined>;
}

/** 构造容器访问：**读操作不等待、写操作先操作后等待**（固定 2 tick 间隔防冲突；
 *  ⚠️ 先等待再写会在等待窗口被其他插入操作（漏斗等）抢先写入，setItem 反而
 *  覆盖——先写基于调用时刻状态立即生效；读无副作用不需要限速） */
function createThrottledAccess(container: Container): ContainerAccess {
  return {
    container,
    get size(): number {
      return container.size;
    },
    async getItem(slot: number): Promise<ItemStack | undefined> {
      return container.getItem(slot); // 读操作：无副作用，不等待
    },
    async setItem(slot: number, item?: ItemStack): Promise<void> {
      container.setItem(slot, item);
      await waitTicks(SLOT_OP_INTERVAL_TICKS);
    },
    async transferItem(fromSlot: number, toContainer: Container): Promise<ItemStack | undefined> {
      const moved = container.transferItem(fromSlot, toContainer);
      await waitTicks(SLOT_OP_INTERVAL_TICKS);
      return moved;
    },
  };
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 假人与容器交互：看向容器（扭头朝向）→ 回调自由取放（格子写操作自动
 * 2 tick 间隔）。**直接操作容器内容，不做开箱/关箱交互**（模拟玩家开箱
 * 动画引擎支持不完整，详见文件头）。
 *
 * @param botName - 假人名
 * @param pos     - 容器方块坐标
 * @param action  - 取放回调（ContainerAccess 自由发挥：getItem/setItem/transferItem）
 * @returns 交互结果（not-container 可换目标重试；error 可重试）
 */
export async function withContainer(
  botName: string,
  pos: Vec3,
  action: (access: ContainerAccess) => Promise<void>
): Promise<ContainerOpResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return "offline";

  // 看向容器（用户规格：扭头看向容器保留——假人面向容器操作）
  try {
    lookAt(bot, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
  } catch (e) {
    console.warn(`[MockPlayer] withContainer ${botName} lookAt error: ${e}`);
  }

  // 直接操作容器内容（组件判定：箱子/木桶/潜影盒等任何带 inventory 组件的方块）
  let access: ContainerAccess | undefined;
  try {
    const block = bot.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
    const inv = block?.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
    if (inv?.container) access = createThrottledAccess(inv.container);
  } catch (e) {
    console.warn(`[MockPlayer] withContainer ${botName} component error: ${e}`);
    return "error";
  }
  if (!access) {
    console.warn(`[MockPlayer] withContainer ${botName} not-container (${pos.x}, ${pos.y}, ${pos.z})`);
    return "not-container";
  }

  // 回调自由取放
  try {
    await action(access);
    return "ok";
  } catch (e) {
    console.warn(`[MockPlayer] withContainer ${botName} action error: ${e}`);
    return "error";
  }
}
