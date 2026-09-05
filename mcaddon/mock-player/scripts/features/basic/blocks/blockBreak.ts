// ─── 方块破坏能力（mc 层） ─────────────────────────────
// breakBlockOnce：原子破坏单个方块（异步协程，直到该块消失）——功能完备：
//   - 工具策略注入：ensureTool 回调（每块破坏前调用一次，默认不换）
//   - 实时检测：实体有效性（isValid）/ 3D 距离 / 方块消失（pollTicks 轮询）
//   - 持续挖掘：每 1 tick 起手 breakBlock（自动挖掘同款实测有效；
//     **不传 direction**——引擎可选参数默认方向，2026-08-15 确认非必要）
//   - 并发防护：同一假人已有进行中的破坏 → **拒绝处理并返回当前状态 busy**
//   - 成功信号：方块被摧毁 → 返回 "broken"；全退出路径 stopBreakingBlock 清理
//   - 类型守卫：expectedTypeId 全程校验目标坐标方块类型——类型变化 → "changed"
//     不挖（定点破坏铁律：绝不把泥巴/石头当目标挖）
// breakBlockAt：定点持续破坏——目标坐标为唯一破坏点（expectedTypeId 类型守卫
//   + faceTowards 对准目标中心 + breakBlockOnce 原子破坏，直到目标消失）。
//   ⚠️ 不使用视线射线替代目标（旧版"看哪破哪"是挖泥巴/挖坑 BUG 根因）。
// 自动挖掘（TAG_AUTO_MINE）协程与 breakBlockAt 共用 viewBlock + breakBlockOnce。
//
// 用户规格（2026-08-14/15，含修正）：工具替换以回调注入、看向目标方块中心
// 等待扭头到位后循环内不再 lookAt、无超时（破到目标消失为止）。

import type { Block, Container, Dimension, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry } from "../../../bootstrap/context";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import type { CancelToken } from "../../../rules/utils/CancelToken";
import { faceTowards } from "../PoseGateway";
import { inventoryContainerOf } from "../items/ItemComponentRead";
import { waitTicks } from "../../utils";

// ─── 结果类型 ──────────────────────────────────────────

/** 破坏结果枚举（所有退出路径枚举化——switch 完备可查）：
 *  - broken：目标已被摧毁（成功信号，唯一成功态）
 *  - far：超距放弃（目标掉落/被推走/假人被传送）
 *  - aborted：主动取消/实体丢失（token 取消 or shouldStop 或实体失效）
 *  - offline：假人记录不可用（在线且未死亡才可挖）
 *  - busy：并发防护拒绝（同假人已有进行中的破坏）
 *  - blocked：视线复核开启时目标被遮挡（视线方块已不是目标——中途插入
 *    阻挡块；调用方应重新探测视线，先挖阻挡块而非"隔山打牛"）
 *  - changed：目标坐标上的方块类型与预期不符（被外部改动/衰亡替换等）——
 *    ⚠️ 定点破坏铁律：**绝不挖类型不符的方块**，调用方应跳过该目标重新探测
 */
export const BreakResult = {
  Broken: "broken",
  Far: "far",
  Aborted: "aborted",
  Offline: "offline",
  Busy: "busy",
  Blocked: "blocked",
  Changed: "changed",
} as const;

/** 破坏结果值（联合类型，由枚举派生——单源） */
export type BreakResultValue = (typeof BreakResult)[keyof typeof BreakResult];

/** 兼容别名：旧代码 type BreakResult 仍可用 */
export type BreakResult = BreakResultValue;

// ─── 常量 ──────────────────────────────────────────────

/** 默认最大挖掘距离（格，3D 自检——引擎不限制距离，须显式判定） */
const DEFAULT_MAX_DISTANCE = 6;
/** 默认状态检测间隔（tick） */
const DEFAULT_POLL_TICKS = 5;
/** 扭头等待（tick，=0.25 秒——用户规格：看向目标方块后等待扭头到位再进入循环） */
const LOOK_SETTLE_TICKS = 5;
/** busy 自旋上限（轮）：并发锁被其它破坏长期占用（如手动 /mp:breakblock）时放弃，
 *  防无限等待——10 轮 × pollTicks(5) ≈ 50 tick ≈ 2.5 秒 */
const BUSY_WAIT_LIMIT = 10;
/** 空气方块 ID（目标破坏判定） */
const AIR_BLOCK_ID = "minecraft:air";
/** 液体方块 ID（目标位置被液体填充 = 目标方块已破坏，不再继续破） */
const LIQUID_BLOCK_IDS = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"] as const;

/** 目标是否已"消失"（空气或液体——液体流入即原方块已破坏；液体不挡射线，
 *  若不判定会继续破坏目标后方的无关方块） */
function isGoneTypeId(typeId: string): boolean {
  return typeId === AIR_BLOCK_ID || (LIQUID_BLOCK_IDS as readonly string[]).includes(typeId);
}

// ─── 工具替换回调上下文 ────────────────────────────────

/** 工具替换回调上下文（每块破坏前注入；是否换工具完全由回调判断） */
export interface EnsureToolContext {
  /** 假人实体（SimulatedPlayer；读位置/状态） */
  bot: SimulatedPlayer;
  /** 假人背包容器（读槽位/工具/耐久；读不到时 undefined——回调可跳过工具处理） */
  container?: Container;
  /** 当前主手槽（selectedSlotIndex） */
  handSlot: number;
  /** 即将破坏的方块类型（射线方块——可能是路径上的障碍块，不一定是终点目标） */
  blockTypeId: string;
}

// ─── 选项 ──────────────────────────────────────────────

/** 单块破坏选项 */
export interface BreakOnceOptions {
  /** 工具替换策略回调（每块破坏前调用；是否换工具完全由回调判断；默认不切换） */
  ensureTool?: (ctx: EnsureToolContext) => Promise<void> | void;
  /** 最大挖掘距离（格，3D 自检） */
  maxDistance?: number;
  /** 状态检测间隔（tick，方块消失/距离/实体有效性检测；默认 5） */
  pollTicks?: number;
  /**
   * 取消令牌（推荐取消通道）：cancel() 后**每个 tick** 检测并立即返回
   * "aborted"（不等 pollTicks）；等待中的协程经 signal 立即唤醒。
   * 适用于"能力卸载即中止"的常驻破坏（定点挖掘等）。支持多协程共享。
   */
  token?: CancelToken;
  /**
   * 外部中止回调（向后兼容；每 pollTicks 检测一次；返回 true → 中止并返回
   * "aborted"）。用途同 token，二选一即可——新代码优先用 token。
   * 不传则保持"直到破坏"无超时语义。
   */
  shouldStop?: () => boolean;
  /**
   * 视线复核（默认 false）：持续破坏期间每 pollTicks 检测一次目标**仍是
   * 当前视线方块**——视线方块已不是目标（中途被插入方块遮挡）→ 中止返回
   * "blocked"。开启方（自动挖掘"视线挖方块"语义）收到 blocked 后重新探测，
   * 先挖阻挡块，杜绝隔山打牛；命令定点破坏（breakBlockAt）不开启。
   * 视线读取失败（viewBlock undefined）不误判，继续挖掘原目标。
   */
  requireLineOfSight?: boolean;
  /**
   * 预期方块类型（默认 undefined = 不校验）：破坏全程校验目标坐标上的方块
   * 类型保持一致——类型变化（非消失）→ 返回 "changed" 不挖。定点破坏铁律：
   * 只挖"坐标 + 类型"双重验证过的方块，杜绝把泥巴/石头当目标挖（挖坑 BUG 根治闸门）。
   */
  expectedTypeId?: string;
  /**
   * 跳过对准（默认 false = 破坏前 faceTowards 目标方块中心——身体朝向 +
   * 视线合一，引擎挖掘判定需要身体面向目标）：
   * true = **绝不动假人姿态/视角**——定点挖掘（无意识挂机）语义：用户已
   * 预先控体态/转头，视角是任务输入，任务期间保持原样；目标取自当前视线
   * 射线（probe 每轮重新探测），命中变化即自然衔接下一块。
   * 连续破坏同一方向（skipLook=true 探测结果不变）时省 5 tick 停顿更流畅；
   * 方向变化时不要传（须重新对准）。
   */
  skipLook?: boolean;
}

/** 持续破坏选项（breakBlockAt；skipLook 语义同上，自 BreakOnceOptions 继承） */
export interface BreakBlockOptions extends BreakOnceOptions {}

// ─── 工具 ──────────────────────────────────────────────

/**
 * 可取消等待：期待到期或被 token 取消（signal resolve）中**先到者**唤醒；
 * 无 token / 未取消 → 等价 waitTicks。用于破坏循环——cancel() 立即中断
 * 当前等待，不必等定时器到期（主动取消的核心）。
 */
function waitTicksSignal(ticks: number, token?: CancelToken): Promise<void> {
  if (!token) return waitTicks(ticks);
  return Promise.race([waitTicks(ticks), token.signal]);
}

/** 取消是否已请求（token 与 shouldStop 任一为真即取消） */
function isCancelled(token: CancelToken | undefined, shouldStop: (() => boolean) | undefined): boolean {
  return (token?.cancelled ?? false) || (shouldStop?.() ?? false);
}

/** 假人记录是否可用（在线且未死亡）——区分 offline（记录不可用）与 aborted（实体丢失） */
function botRegistryAlive(botName: string): boolean {
  const record = botRegistry.get(botName);
  return !!record && record.online && !record.death;
}

/** 3D 距离 */
function distance3d(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 读取方块（自动 floor；不可读/未加载返回 undefined） */
function readBlock(dimension: Dimension, pos: Vector3): Block | undefined {
  try {
    return dimension.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  } catch {
    return undefined;
  }
}

/** 方块是否已消失（undefined/空 typeId/空气/液体 → 不可读或已破坏） */
function blockGone(block: Block | undefined): boolean {
  if (!block) return true;
  const typeId = block.typeId;
  return typeId === "" || isGoneTypeId(typeId);
}

/**
 * 感知射线方块：读取假人**视角方向**射线命中的首个方块（引擎计算，
 * 无需自行算射线——用户拍板）。getBlockFromViewDirection 默认跳过可穿过
 * 方块（空气/藤蔓/花），返回第一个实心方块；目标被障碍挡住时返回障碍块。
 * center 用引擎权威值 `block.center()`（X/Y/Z 三轴中心）。
 * 读取失败返回 undefined → 调用方按目标块处理。
 * 供自动挖掘协程 / breakBlockAt 复用（单块破坏 breakBlockOnce 按指定坐标破，
 * 不做射线探测——探测是调用方的职责）。
 */
export function viewBlock(
  bot: SimulatedPlayer,
  maxDistance: number
): { typeId: string; location: Vector3; center: Vector3 } | undefined {
  try {
    const hit = bot.getBlockFromViewDirection({ maxDistance });
    if (hit && hit.block) {
      const loc = hit.block.location;
      return {
        typeId: hit.block.typeId,
        location: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) },
        center: hit.block.center(), // 引擎权威方块中心
      };
    }
  } catch {
    /* 读取失败回退目标块 */
  }
  return undefined;
}

/** 取假人背包容器（读不到返回 undefined） */
function botContainer(bot: SimulatedPlayer): Container | undefined {
  return inventoryContainerOf(bot);
}

// ─── 并发防护 ──────────────────────────────────────────

/** 同假人进行中的单块破坏（拒绝重复执行并返回 busy） */
const activeBreaks = new Set<string>();

// ─── 原子破坏单块（功能完备，可被持续破坏/自动挖掘复用） ──

/**
 * 原子破坏单个方块（异步协程，直到该块被摧毁）。
 * 功能完备：工具策略注入（ensureTool 每块一次）/ 实时检测（实体有效性、
 * 3D 距离、方块消失按 pollTicks 轮询）/ 持续挖掘（每 1 tick 起手，
 * 不传 direction）/ 并发防护（同假人重复执行 → 拒绝并返回 busy）/
 * 成功信号（broken）/ 全退出路径 stopBreakingBlock 清理。
 *
 * @param bot    假人实体（调用方持有；失效返回 aborted，由调用方重新解析）
 * @param loc    目标方块坐标（自动 floor）
 * @param options 选项（工具策略回调 / 距离 / 检测间隔）
 * @returns broken（已摧毁）/ far / aborted / busy（拒绝）
 */
export async function breakBlockOnce(
  bot: SimulatedPlayer,
  loc: Vector3,
  options: BreakOnceOptions = {}
): Promise<BreakResult> {
  const {
    ensureTool = () => undefined,
    maxDistance = DEFAULT_MAX_DISTANCE,
    pollTicks = DEFAULT_POLL_TICKS,
    token,
    shouldStop,
    requireLineOfSight = false,
    expectedTypeId,
    skipLook = false,
  } = options;
  const dimension = bot.dimension;
  const targetLoc: Vector3 = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };

  // ⚠️ 前置：token 已取消 → 立即返回 aborted（不进入破坏）
  if (isCancelled(token, shouldStop)) return "aborted";

  // 并发防护：同一假人已有进行中的破坏 → 拒绝处理，返回当前状态（busy）
  if (activeBreaks.has(bot.name)) return "busy";
  activeBreaks.add(bot.name);

  try {
    // 前置：目标可读检查（已消失 → 快路径 broken 成功信号）+ 类型守卫 +
    // 距离自检（超距放弃）
    const targetBlock = readBlock(dimension, targetLoc);
    if (blockGone(targetBlock)) return "broken";
    // ⚠️ 类型守卫：坐标上的方块已不是预期类型 → 不挖（定点破坏铁律）
    if (expectedTypeId && targetBlock!.typeId !== expectedTypeId) return "changed";
    if (distance3d(bot.location, targetLoc) > maxDistance) return "far";

    // 工具替换策略（每块一次，破坏前注入；异常不影响破坏）
    try {
      await ensureTool({
        bot,
        container: botContainer(bot),
        handSlot: bot.selectedSlotIndex,
        blockTypeId: targetBlock!.typeId,
      });
    } catch {
      /* 回调失败按不切换处理 */
    }

    // ⚠️ 挖掘对准（默认：身体朝向与视线都看向目标方块——身体不面向时引擎
    // 的挖掘判定会打到无效方块；faceTowards 微动作下一 tick 执行）。
    // skipLook=true：**绝不动姿态/视角**——定点挖掘（无意识挂机）语义：
    // 视角是用户预先摆好的任务输入，任务只沿视线挖不调整。
    if (!skipLook) {
      await faceTowards(bot, targetBlock!.center());
    }

    // 持续挖掘循环（**先敲后等**：每 1 tick 起手，消除接手新目标首击前的空挡）
    let sinceCheck = 0;
    while (true) {
      // 每 tick 起手（不传 direction——引擎可选参数默认方向）
      try {
        bot.breakBlock(targetLoc);
      } catch {
        /* 敲击失败下 tick 重试 */
      }

      // 可取消等待：token cancel() 时 signal 立即唤醒（不等本 tick 定时器到期——
      // 主动取消核心；无 token 时等价 waitTicks(1)）
      await waitTicksSignal(1, token);
      sinceCheck++;

      // ⚠️ token 取消即时检测（每 tick，非 pollTicks——主动取消要快）
      if (token?.cancelled) return "aborted";

      // ⚠️ 目标消失检测**每 tick**（单块 getBlock 开销小）——方块一被摧毁立即
      // 交接下一个目标；按 pollTicks 检测会留下最多 5 tick 的挖掘空挡
      //（连续挖掘关键）。读取失败按未消失处理（下 tick 再查）。
      // ⚠️ 类型守卫同 tick 复核（一次读块）：坐标上的方块被换成其他类型 →
      //   立即停手返回 changed，绝不挖后续出现的无关方块。
      const tickBlock = readBlock(dimension, targetLoc);
      if (blockGone(tickBlock)) return "broken"; // 成功信号：已摧毁
      if (expectedTypeId && tickBlock && tickBlock.typeId !== expectedTypeId) return "changed";

      // 实时检测（距离/实体有效性/外部中止/视线复核有开销，按 pollTicks 轮询；
      // shouldStop 回调保持 pollTicks 粒度避免高频闭包调用）
      if (sinceCheck < pollTicks) continue;
      sinceCheck = 0;

      if (shouldStop?.()) return "aborted"; // 外部中止（调用方生命周期控制）
      if (!bot.isValid) return "aborted"; // 实体失效（重连/移除）
      if (distance3d(bot.location, targetLoc) > maxDistance) return "far";

      // ⚠️ 视线复核（仅自动挖掘等"视线挖方块"调用方开启）：目标不再是当前
      //   视线方块 = 中途被插入方块遮挡（如玩家放基岩挡路）→ 中止返回 blocked，
      //   由调用方重新探测视线（先挖阻挡块）——杜绝锁定坐标持续敲的隔山打牛。
      //   视线读取失败（undefined）不误判，继续原目标。
      if (requireLineOfSight) {
        const sight = viewBlock(bot, maxDistance);
        if (
          sight &&
          (sight.location.x !== targetLoc.x || sight.location.y !== targetLoc.y || sight.location.z !== targetLoc.z)
        ) {
          return "blocked";
        }
      }
    }
  } finally {
    // 释放并发锁 + 清理挖掘状态（所有退出路径；传送后引擎可能不自动打断）
    activeBreaks.delete(bot.name);
    try {
      bot.stopBreakingBlock();
    } catch {
      /* 清理失败忽略 */
    }
  }
}

// ─── 持续破坏（直到指定方块被摧毁，复用单块破坏） ───────

/**
 * 定点持续破坏指定坐标方块（异步协程，直到该方块被摧毁）。
 * ⚠️ 定点破坏铁律：**只挖目标坐标上、类型与预期一致的方块**——全程以目标
 * 坐标为唯一破坏点，不用视线射线替代（旧版"看哪破哪"是挖泥巴/挖坑 BUG
 * 的根因：瞄准稍有偏差射线命中地面 → 挖掉泥土 → 视线跟随刚挖的方块继续
 * 朝下 → 无限挖坑，目标原木永远轮不到）。
 * 每轮：中止检查（shouldStop/token）→ 死亡检查（记录标记）→ 刷新实体 →
 * 目标状态检查（消失 → broken / 类型变化 → changed）→ 距离自检（far）→
 * 原子破坏**目标坐标**（breakBlockOnce 透传 expectedTypeId 全程类型守卫）。
 * 前置：可用性 → 距离自检 → 目标可读 + 类型守卫 → 看向目标方块中心
 * （引擎 Block.center() 权威值）→ 等待 0.25 秒扭头到位。**无超时**（破到
 * 目标消失为止；不可破方块由调用方通过 shouldStop 放弃）。
 *
 * @param botName 假人名
 * @param target 目标方块坐标（自动 floor）
 * @param options 选项（工具策略回调 / 距离 / 检测间隔 / 外部中止 /
 *   expectedTypeId 预期类型——缺省取破坏开始时目标坐标的实际类型）
 * @returns 破坏结果（broken 表示目标已摧毁；changed 表示目标已被换成其他方块）
 */
export async function breakBlockAt(botName: string, target: Vector3, options: BreakBlockOptions = {}): Promise<BreakResult> {
  const {
    ensureTool = () => undefined,
    maxDistance = DEFAULT_MAX_DISTANCE,
    pollTicks = DEFAULT_POLL_TICKS,
    token,
    shouldStop,
    skipLook = false,
  } = options;

  let bot = resolveBotPlayer(botName);
  if (!bot) return "offline";
  // ⚠️ 前置：token 已取消 → 立即返回 aborted（不发起扭头/破坏）
  if (isCancelled(token, shouldStop)) return "aborted";
  const dimension = bot.dimension;
  const targetLoc: Vector3 = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };

  // 距离自检（3D——引擎不限制距离，须显式判定；超距直接放弃不发起敲击）
  if (distance3d(bot.location, target) > maxDistance) return "far";

  // 目标可读检查 + 目标中心（引擎权威值；已破坏/液体 → 快路径 broken）
  const targetBlock = readBlock(dimension, targetLoc);
  if (blockGone(targetBlock)) return "broken";
  // 预期类型：调用方显式指定优先（砍树流程传木头类型），否则锁定破坏开始时
  // 的实际类型——后续全程只认这个类型，类型变化即停手
  const expectedTypeId = options.expectedTypeId ?? targetBlock!.typeId;
  if (targetBlock!.typeId !== expectedTypeId) return "changed";
  const targetCenter = targetBlock!.center();

  // 扭头看向目标方块中心（引擎权威值），等待 0.25 秒扭头到位；
  // **循环内不再 lookAt**——视线全程稳定指向目标，射线不因转头偏移。
  // skipLook（连续同向破坏）：视线已对准 → 跳过扭头（每块省 5 tick 停顿）
  if (!skipLook) {
    // 面向目标（身体朝向 + 视线，用户规格：挖掘判定需身体与视线都对准）
    await faceTowards(bot, targetCenter);
    // 扭头等待亦可被 token 取消（取消了就不必等扭头到位）
    if (token) {
      const settled = await Promise.race([
        waitTicks(LOOK_SETTLE_TICKS),
        token.signal.then(() => "cancelled" as const),
      ]);
      if (token.cancelled) return "aborted";
      void settled;
    } else {
      await waitTicks(LOOK_SETTLE_TICKS);
    }
  }

  try {
    let busyWaits = 0; // busy 自旋计数（并发锁被其它破坏长期占用时放弃——防无限等待）
    while (true) {
      // 主动取消（token：每轮即时检测——能力卸载立即中止）+ 外部中止回调
      if (isCancelled(token, shouldStop)) return "aborted";

      // 假人死亡（实体可能仍在世界（尸体）→ 显式查记录标记）
      if (botRegistry.get(botName)?.death) return "offline";

      // 每轮刷新实体（每破一块一次——getEntity 有开销，不每 tick 解析）
      bot = resolveBotPlayer(botName);
      if (!bot) return botRegistryAlive(botName) ? "aborted" : "offline";

      // 目标状态（每轮读块；空气/液体 = 已消失 → broken；类型变化 → changed）
      const current = readBlock(dimension, targetLoc);
      if (blockGone(current)) return "broken";
      if (expectedTypeId && current && current.typeId !== expectedTypeId) return "changed";

      // 距离超限（目标掉落/被推走/假人被传送）→ 放弃
      if (distance3d(bot.location, target) > maxDistance) return "far";

      // 原子破坏**目标坐标**（工具策略/取消令牌/类型守卫透传；内部实时检测/
      // 并发防护/成功信号/中止）——绝不挖坐标以外的方块
      const result = await breakBlockOnce(bot, targetLoc, { expectedTypeId, ensureTool, maxDistance, pollTicks, token, shouldStop });
      if (result === "broken") continue; // 该块已摧毁 → 下一轮（目标可能还没消失）
      if (result === "busy") {
        // 并发保护（另一破坏进行中，如手动 /mp:breakblock）→ 等待后重试；
        // 上限内放弃（自旋上限 ≈ 10 轮 × pollTicks ≈ 2 秒——不无限等）
        if (++busyWaits > BUSY_WAIT_LIMIT) return "aborted";
        await waitTicksSignal(pollTicks, token); // busy 等待亦支持取消唤醒
        continue;
      }
      return result; // far / aborted / offline / changed 直接结束
    }
  } finally {
    // 所有退出路径清理（取最新实体——破坏中假人重连/重生后初始实体可能失效）
    try {
      resolveBotPlayer(botName)?.stopBreakingBlock();
    } catch {
      /* 清理失败忽略 */
    }
  }
}
