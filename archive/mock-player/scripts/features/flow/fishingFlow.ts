// ─── 闭包钓鱼流程（mc 层） ─────────────────────────────
// fishOnce：一次调用完成一次完整钓鱼（发杆 → 稳定 → 监听上钩 → 收竿），
// 返回明确结果（caught / timeout / failed + 失败原因）。
//
// 流程（用户规格）：
//   1. 发杆（无鱼钩才发杆）——**鱼钩抛竿即生成**（无需轮询等生成）
//   2. await + timeout 等待 STABILIZE_TICKS（1.25 秒）：鱼钩下落至稳定目标
//      位置（入水先下沉再上浮，稳定后记录坐标才可信——稳定期内下沉会被
//      咬钩判定误判）
//   3. 落点检查：鱼钩不在水中 = 本次钓鱼直接失败（勾中实体生物 → snagged /
//      勾中固体方块 → landed），**提前收竿**后返回失败原因
//   4. 监听上钩（最长 BITE_TIMEOUT_TICKS = 45 秒）：窗口累计净下降超阈值
//      连续 2 窗口 = 明显下沉（咬钩）→ 触发收杆信号（通知主人 + 自动收竿）
//   5. 超时 → 收竿无获（timeout）；鱼钩中途消失 → hook-lost 失败
//
// 通知（用户规格 2.1.14）：鱼上钩后只通知**附近 7 格玩家** [模拟玩家][钓鱼]
// 提醒（上钩 / 战利品 / 超时 / 失败原因）；无鱼竿等缺因提示由 AI 端口负责
// （McFishingPorts idle，主人通知 + 节流）

import { system, world } from "@minecraft/server";
import type { Container, Entity, EntityInventoryComponent, ItemStack } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { diffLoot, initialBiteTracker, isWaterBlock, judgeHookPlacement, makeLootFingerprint, updateBiteTracker, type BackpackInfo, type BiteTracker, type FishingFailureReason, type FishingOutcome, type HookPlacement, type LootItem } from "../../rules/FishingRules";
import { enchantDisplayName } from "../../rules/format/EnchantZh";
import { BOT_TAG, TAG_FISH_MODE } from "../../rules/tags/BotTags";
import { castFishingRod, findOwnHooks, reelFishingRod } from "../basic/fishing";
import { enchantableOf } from "../basic/items/ItemComponentRead";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { botRegistry } from "../../bootstrap/context";
import { distance3d, waitTicks } from "../utils";
import { lookAt } from "../basic/PoseGateway";
import type { Vec3 } from "../../rules/Types";

// ── 领域类型 re-export（类型已归位 core/tasks/FishingRules，此处保持导入方兼容） ──
export type { FishingOutcome, FishingFailureReason, BackpackInfo, LootItem } from "../../rules/FishingRules";

// ─── 常量 ────────────────────────────────────────────────

/** 浮漂稳定等待（tick，=1.25 秒：鱼钩抛竿即生成，下落至稳定目标位置的时间） */
const STABILIZE_TICKS = 25;
/** 下沉检测窗口（tick，=2 tick：咬钩下沉持续时间仅约 10 tick（收竿窗口），
 *  检测必须足够密——2 tick 采样让最高点参照的下沉量尽快达到 0.25 阈值） */
const BITE_CHECK_TICKS = 2;
/** 上钩监听上限（tick，=45 秒，用户规格） */
const BITE_TIMEOUT_TICKS = 900;
/** 挂实体检测半径（格，=0.25 极小值：鱼钩**直接勾住**实体才算挂住——物理贴合；
 *  getEntities 按实体中心点计算距离，半径放大即误判水中正常游动的鱼） */
const PLACEMENT_ENTITY_RADIUS = 0.25;
/** 背包快满阈值（剩余空格数 ≤ 该值 → 警告"背包快满"） */
const NEAR_FULL_GAP = 2;

// ─── 结果类型（区分度：成功 / 无获超时 / 失败+原因） ────
// ⚠️ FishingOutcome / FishingFailureReason / BackpackInfo 类型定义已归位
//    core/tasks/FishingRules（AI 任务端口契约共用），此处仅 re-export。

// ─── 防重入 ──────────────────────────────────────────────

/** 进行中的钓鱼流程（按假人键控，防并发双收竿） */
const runningFishing = new Set<string>();

// ─── 战利品事件感知（用户规格） ─────────────────────────
// ⚠️ 收竿后战利品入包有引擎延迟——收竿后立即快照 diff 会漏（"无战利品"根因）。
//    改为**订阅假人背包物品变化事件**：只感知**钓鱼的假人**（旧 TAG_FISH_MODE
//    或新版 workMode="fishing"，二选一 → 生物 AI 新版兼容）+ **非主手槽**变化
//    （主手变化 = 抛竿/收竿操作，不是战利品）+ 钓鱼进行中。
//    收竿后等待战利品入包（3 tick）再读取收集结果；事件未触发时回退快照 diff。

/** 钓鱼中收集到的战利品（botName → 指纹 → 数量；每次钓鱼后清空） */
const pendingLoot = new Map<string, Record<string, number>>();

/** 初始化幂等守卫（main.ts worldLoad 调用一次；防重复订阅） */
let lootTrackerReady = false;

/**
 * 订阅假人背包物品变化（战利品感知；main.ts worldLoad 后调用）。
 * 过滤：假人（BOT_TAG）+ 钓鱼（旧 TAG_FISH_MODE 或 workMode="fishing"）
 *   + 钓鱼进行中（runningFishing）+ 非主手槽（selectedSlotIndex）。
 */
export function initLootTracker(): void {
  if (lootTrackerReady) return;
  lootTrackerReady = true;
  world.afterEvents.playerInventoryItemChange.subscribe((event) => {
    try {
      const bot = event.player;
      if (!bot.hasTag(BOT_TAG)) return; // 只感知假人
      // 钓鱼：旧标签路径或新版工作模式（工作模式值域互斥，二选一）
      const workMode = botRegistry.get(bot.name)?.workMode;
      if (!bot.hasTag(TAG_FISH_MODE.value) && workMode !== "fishing") return;
      if (!runningFishing.has(bot.name)) return; // 钓鱼进行中
      const selected = (bot as { selectedSlotIndex?: number }).selectedSlotIndex ?? 0;
      if (event.slot === selected) return; // 排除主手（抛竿/收竿）
      const item = event.itemStack;
      if (!item) return; // 槽位被清空不算战利品
      const fp = makeLootFingerprint(item.typeId, itemEnchantments(item));
      const map = pendingLoot.get(bot.name) ?? {};
      map[fp] = (map[fp] ?? 0) + item.amount;
      pendingLoot.set(bot.name, map);
    } catch {
      /* 单事件异常隔离 */
    }
  });
}

/** 取出并清空钓鱼中收集的战利品（指纹 → 数量） */
function takePendingLoot(botName: string): Record<string, number> {
  const loot = pendingLoot.get(botName) ?? {};
  pendingLoot.delete(botName);
  return loot;
}
// ─── 战利品回收 + 自动存入容器（用户规格 2.3.3 / 2.3.4） ──
/** 战利品拾取半径（格，=3：战利品生成在鱼钩位置附近的水面） */
const LOOT_PICK_RADIUS = 3;
/** 拾取扫描次数（战利品生成有引擎延迟，两次扫描兜底） */
const LOOT_PICK_TRIES = 2;
/** 两次拾取扫描的间隔（tick） */
const LOOT_PICK_GAP_TICKS = 6;
/** 自动存入容器的最大触达距离（格，=5：模拟玩家伸手可及范围） */
const STORE_REACH = 5;

/**
 * 把落在鱼钩附近的掉落物收进假人背包。
 * 返回本次实际收取的物品栈（供自动存入容器按指纹搬运）。
 */
function pickLootAt(botName: string, pos: Vec3): ItemStack[] {
  const bot = resolveBotPlayer(botName);
  const picked: ItemStack[] = [];
  if (!bot) return picked;
  try {
    const container = (bot.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined)?.container;
    if (!container) return picked;
    const drops = bot.dimension.getEntities({
      type: "minecraft:item",
      location: { x: pos.x, y: pos.y, z: pos.z },
      maxDistance: LOOT_PICK_RADIUS,
    });
    for (const drop of drops) {
      try {
        const stack = drop.getComponent("minecraft:item")?.itemStack;
        if (!stack) continue;
        if (container.addItem(stack)) continue;
        drop.remove();
        picked.push(stack.clone());
      } catch {
        /* 单个掉落物失败不影响其它 */
      }
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] pickLootAt ${botName} error: ${e}`);
  }
  if (picked.length > 0) console.warn(`[MockPlayer] pickLootAt ${botName} picked ${picked.length} drop(s) near hook`);
  return picked;
}

/** 收竿后把鱼钩附近的战利品收进背包（两次扫描：战利品生成有延迟） */
async function collectLootNearHook(botName: string, pos: Vec3): Promise<ItemStack[]> {
  for (let i = 0; i < LOOT_PICK_TRIES; i++) {
    await waitTicks(LOOT_PICK_GAP_TICKS);
    const got = pickLootAt(botName, pos);
    if (got.length > 0) return got;
  }
  return [];
}

/**
 * 把本竿战利品存入记录里配置的容器（钓鱼模式「自动存入容器」）。
 * 超出触达距离 / 目标不是容器 / 容器已满 → 战利品留在背包并提示附近玩家。
 */
async function storeLootToChest(botName: string, loot: LootItem[], stacks: ItemStack[]): Promise<string> {
  const record = botRegistry.get(botName);
  if (!record || record.autoStore !== true || !record.autoStorePoint) return "off";
  const bot = resolveBotPlayer(botName);
  if (!bot) return "offline";
  const p = record.autoStorePoint;
  const center = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
  if (distance3d(bot.location, center) > STORE_REACH) {
    notifyOwner(botName, `${color.warn}目标容器超出触达距离（>${STORE_REACH} 格），战利品留在背包`);
    return "too-far";
  }
  let container: Container | undefined;
  try {
    const block = bot.dimension.getBlock({ x: p.x, y: p.y, z: p.z });
    container = block?.getComponent("minecraft:inventory")?.container;
  } catch {
    container = undefined;
  }
  if (!container) {
    notifyOwner(botName, `${color.warn}目标不是容器方块，战利品留在背包`);
    return "not-container";
  }
  // 转头看向容器（同时更新记录朝向，避免姿态系统立刻拉回）
  try {
    lookAt(bot, center);
    if (record.lastPoint) record.lastPoint.lookTarget = center;
  } catch {
    /* 朝向失败不影响搬运 */
  }
  let opened = false;
  try {
    opened = bot.interactWithBlock({ x: p.x, y: p.y, z: p.z });
  } catch {
    opened = false;
  }
  await waitTicks(2);
  let stored = 0;
  try {
    const inv = (bot.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined)?.container;
    if (inv) {
      // 目标指纹 → 需要搬运的数量（本竿战利品；无统计时回退用实际收取的物品栈）
      const wanted = new Map<string, number>();
      for (const l of loot) {
        const fp = makeLootFingerprint(l.typeId, l.enchantments);
        wanted.set(fp, (wanted.get(fp) ?? 0) + l.count);
      }
      if (wanted.size === 0) {
        for (const stack of stacks) {
          const fp = makeLootFingerprint(stack.typeId, itemEnchantments(stack));
          wanted.set(fp, (wanted.get(fp) ?? 0) + stack.amount);
        }
      }
      for (const [fp, count] of wanted) {
        let need = count;
        for (let i = 0; i < inv.size && need > 0; i++) {
          const item = inv.getItem(i);
          if (!item) continue;
          if (makeLootFingerprint(item.typeId, itemEnchantments(item)) !== fp) continue;
          const move = Math.min(need, item.amount);
          const toStore = item.clone();
          toStore.amount = move;
          const rest = container.addItem(toStore);
          const moved = move - (rest?.amount ?? 0);
          if (moved <= 0) break;
          if (item.amount === moved) inv.setItem(i, undefined);
          else {
            const left = item.clone();
            left.amount = item.amount - moved;
            inv.setItem(i, left);
          }
          need -= moved;
          stored += moved;
        }
      }
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] storeLootToChest ${botName} transfer error: ${e}`);
  }
  // 收尾交互状态：模拟玩家没有客户端界面，interactWithBlock 通常不会真正打开容器；
  // 若引擎进入了交互状态，用 SimulatedPlayer.stopInteracting() 关闭（存在才调用）。
  try {
    if (typeof bot.stopInteracting === "function") bot.stopInteracting();
  } catch {
    /* 关闭失败不影响结果 */
  }
  console.warn(`[MockPlayer] storeLootToChest ${botName} stored=${stored} opened=${opened} target=(${p.x},${p.y},${p.z})`);
  if (stored > 0) notifyOwner(botName, `${color.success}已存入容器 ${stored} 件战利品（${p.x}, ${p.y}, ${p.z}）`);
  else notifyOwner(botName, `${color.warn}战利品未能存入容器（背包里没找到对应物品或容器已满）`);
  return stored > 0 ? "ok" : "full";
}

// ─── 工具 ────────────────────────────────────────────────

/** 钓鱼消息通知半径（格，用户规格：鱼上钩后只通知附近 7 格玩家） */
const NOTIFY_RADIUS = 7;

/**
 * 通知附近玩家钓鱼消息（[模拟玩家][钓鱼] 前缀 + 详细；用户规格：**只通知
 * 附近 NOTIFY_RADIUS 格内的玩家**，主人不在附近不直发；排除假人自己）。
 */
function notifyOwner(botName: string, detail: string): void {
  try {
    const bot = resolveBotPlayer(botName);
    if (!bot) return;
    const msg = `${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${color.muted}${detail}`;
    for (const p of world.getPlayers()) {
      if (p.name === botName) continue; // 排除假人自己
      const dx = p.location.x - bot.location.x;
      const dz = p.location.z - bot.location.z;
      if (Math.hypot(dx, dz) <= NOTIFY_RADIUS) {
        p.sendMessage(msg);
      }
    }
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 失败原因 → 中文描述（通知用） */
export function failureLabel(reason: FishingFailureReason): string {
  switch (reason) {
    case "offline":
      return "假人不在线";
    case "no-rod":
      return "没有鱼竿";
    case "landed":
      return "鱼钩勾中固体方块（落陆地），本次钓鱼失败";
    case "snagged":
      return "鱼钩勾中实体生物，本次钓鱼失败";
    case "hook-lost":
      return "鱼钩中途消失，本次钓鱼失败";
    case "busy":
      return "已有钓鱼流程进行中";
    default:
      return "执行失败";
  }
}

// ─── 背包快照 / 状态（成功钓鱼报告用） ───────────────────

/** 背包物品附魔列表（读 enchantable 组件；无组件返回空） */
function itemEnchantments(item: ItemStack): { id: string; level: number }[] {
  const ench = enchantableOf(item);
  if (!ench) return [];
  try {
    return ench.getEnchantments().map((e) => ({ id: e.type.id, level: e.level }));
  } catch {
    return [];
  }
}

/** 背包指纹快照（指纹 → 数量；指纹含附魔，可区分同物品不同附魔） */
function snapshotInventory(botName: string): Record<string, number> {
  const snapshot: Record<string, number> = {};
  const bot = resolveBotPlayer(botName);
  if (!bot) return snapshot;
  try {
    const container = (bot.getComponent("minecraft:inventory") as
      | { container?: { size: number; getItem: (i: number) => ItemStack | undefined } }
      | undefined)?.container;
    if (!container) return snapshot;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item) continue;
      const fp = makeLootFingerprint(item.typeId, itemEnchantments(item));
      snapshot[fp] = (snapshot[fp] ?? 0) + item.amount;
    }
  } catch {
    /* 背包不可读按空快照处理 */
  }
  return snapshot;
}

/** 背包状态（已用格数/总格数） */
function backpackInfo(botName: string): BackpackInfo {
  const bot = resolveBotPlayer(botName);
  if (!bot) return { usedSlots: 0, totalSlots: 0 };
  try {
    const container = (bot.getComponent("minecraft:inventory") as
      | { container?: { size: number; getItem: (i: number) => ItemStack | undefined } }
      | undefined)?.container;
    if (!container) return { usedSlots: 0, totalSlots: 0 };
    let used = 0;
    for (let i = 0; i < container.size; i++) {
      if (container.getItem(i)) used++;
    }
    return { usedSlots: used, totalSlots: container.size };
  } catch {
    return { usedSlots: 0, totalSlots: 0 };
  }
}

/** 战利品 → 中文展示（物品 typeId + 附魔中文；附魔用 ENCH_ZH） */
function lootLabel(loot: LootItem[]): string {
  if (loot.length === 0) return "（无战利品）";
  return loot
    .map((l) => {
      const ench = l.enchantments.length > 0 ? `（${l.enchantments.map((e) => enchantDisplayName(e.id)).join("、")}）` : "";
      return `${l.typeId}×${l.count}${ench}`;
    })
    .join("、");
}

/** 背包状态 + 容量预警（快满/已满）→ 中文展示 */
function backpackLabel(backpack: BackpackInfo): string {
  const { usedSlots, totalSlots } = backpack;
  let warning = "";
  if (usedSlots >= totalSlots) {
    warning = `${color.error}；⚠️ 背包已满（${usedSlots}/${totalSlots}），建议清理`;
  } else if (usedSlots >= totalSlots - NEAR_FULL_GAP) {
    warning = `${color.warn}；⚠️ 背包快满（${usedSlots}/${totalSlots}）`;
  }
  return `${color.muted}背包 ${usedSlots}/${totalSlots}${warning}`;
}

// ─── 流程阶段 ────────────────────────────────────────────

/**
 * 稳定后落点检查：鱼钩所在方块是否水 + 附近是否勾中实体生物。
 * @returns 落点状态；鱼钩实体丢失（收回/消失）返回 undefined（调用方按 hook-lost 处理）
 */
async function checkPlacement(botName: string, hookId: string): Promise<HookPlacement | undefined> {
  const hook = world.getEntity(hookId) as Entity | undefined;
  if (!hook) return undefined;
  const pos = hook.location;
  const block = hook.dimension.getBlock({
    x: Math.floor(pos.x),
    y: Math.floor(pos.y),
    z: Math.floor(pos.z),
  });
  const inWater = block ? isWaterBlock(block.typeId) : false;
  // 附近实体检测（用户规格：**任何实体**都算勾中——玩家/鱼/水生生物/其他
  // 生物都不行；仅鱼钩本身除外）
  let hasEntityNearby = false;
  try {
    hasEntityNearby = hook.dimension
      .getEntities({ location: pos, maxDistance: PLACEMENT_ENTITY_RADIUS })
      .some((e) => e.id !== hookId && e.typeId !== "minecraft:fishing_hook");
  } catch {
    /* 维度不可访问按无实体处理 */
  }
  return judgeHookPlacement(inWater, hasEntityNearby);
}

/**
 * 监听上钩（最长 45 秒）：**相对稳定基准的累计下降**超阈值连续 2 窗口 =
 * 咬钩 → 收竿（慢速渐进下沉也能捕获——相邻窗口对比会漏检）。判定逻辑
 * 在 core（updateBiteTracker，可单测），本处只做感知与副作用。
 * 鱼钩中途消失 → hook-lost；超时 → 收竿（无获）返回 timeout。
 */
async function watchForBite(botName: string, hookId: string): Promise<FishingOutcome> {
  // 稳定后基准高度（用户规格：记录鱼钩坐标）
  let baseY: number | undefined;
  let tracker: BiteTracker | undefined;

  for (let waited = 0; waited < BITE_TIMEOUT_TICKS; waited += BITE_CHECK_TICKS) {
    await waitTicks(BITE_CHECK_TICKS);
    const hook = world.getEntity(hookId) as Entity | undefined;
    if (!hook) return { kind: "failed", reason: "hook-lost" };
    const y = hook.location.y;
    if (baseY === undefined) {
      baseY = y;
      console.warn(`[MockPlayer] fishOnce ${botName} hook stabilized at y=${y}`);
    }
    tracker = tracker ?? initialBiteTracker(y);

    const { tracker: next, bite } = updateBiteTracker(tracker, y);
    tracker = next;
    if (bite) {
      // ── 咬钩：触发收杆信号（通知主人 + 自动收竿） ──
      const hookPos = { x: hook.location.x, y: hook.location.y, z: hook.location.z };
      console.warn(`[MockPlayer] fishOnce ${botName} bite detected (drop ${(tracker.maxY - y).toFixed(2)} from max ${tracker.maxY.toFixed(2)})`);
      notifyOwner(botName, `${color.success}鱼上钩了，正在收竿！`);
      const before = snapshotInventory(botName); // 收竿前背包快照（战利品 diff 基准）
      const reel = await reelFishingRod(botName);
      if (reel === "reeled") {
        // ── 成功：等待战利品入包（事件驱动收集优先，diff 回退） + 背包状态报告 ──
        // 先把落在鱼钩附近的战利品收进背包（引擎自动拾取在假人身上不可靠，用户规格 2.3.3）
        const lootStacks = await collectLootNearHook(botName, hookPos);
        const collected = takePendingLoot(botName);
        const loot =
          Object.keys(collected).length > 0
            ? diffLoot({}, collected) // 事件收集（指纹 → LootItem）
            : diffLoot(before, snapshotInventory(botName)); // 回退：延迟后快照 diff
        // 自动存入容器（用户规格 2.3.4）：本竿有战利品才搬运
        if (loot.length > 0 || lootStacks.length > 0) await storeLootToChest(botName, loot, lootStacks);
        const backpack = backpackInfo(botName);
        console.warn(`[MockPlayer] fishOnce ${botName} caught: ${loot.map((l) => `${l.typeId}x${l.count}`).join(",") || "none"} backpack=${backpack.usedSlots}/${backpack.totalSlots}`);
        notifyOwner(botName, `${color.success}钓到 ${lootLabel(loot)}；${backpackLabel(backpack)}`);
        return { kind: "caught", loot, backpack };
      }
      // 收竿异常：no-hook=钩已消失 / offline=假人下线 / no-rod=鱼竿没了 / error=执行失败
      const reason: FishingFailureReason =
        reel === "no-hook" ? "hook-lost" : reel === "offline" ? "offline" : reel === "no-rod" ? "no-rod" : "error";
      return { kind: "failed", reason };
    }
  }

  // ── 超时（45 秒无鱼）：收竿无获 ──
  console.warn(`[MockPlayer] fishOnce ${botName} bite timeout (${BITE_TIMEOUT_TICKS} ticks), reeling`);
  notifyOwner(botName, `${color.warn}等待 ${BITE_TIMEOUT_TICKS / 20} 秒无鱼上钩，收竿结束`);
  const reel = await reelFishingRod(botName);
  if (reel !== "reeled") {
    // 收杆失败（假人下线 offline / 钩已消失 no-hook / 执行失败）——日志可见，钩残留由下次流程 already-cast 接管
    console.warn(`[MockPlayer] fishOnce ${botName} timeout reel=${reel}`);
  }
  return { kind: "timeout" };
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 完成一次完整钓鱼（闭包流程）：发杆 → 稳定等待 → 落点检查 → 监听上钩
 * （45 秒）→ 下沉触发收杆。异常（勾中实体/固体方块）**提前收竿**后判定
 * 失败并返回原因；鱼钩消失 → hook-lost 失败。
 *
 * @param botName - 假人名
 * @returns 结果：caught=上钩收竿 / timeout=超时收竿 / failed=失败+原因
 */
export async function fishOnce(botName: string): Promise<FishingOutcome> {
  if (runningFishing.has(botName)) return { kind: "failed", reason: "busy" };
  runningFishing.add(botName);
  try {
    // ── 1. 发杆（无钩才发；already-cast=已有钩 → 直接进入流程） ──
    const cast = await castFishingRod(botName);
    if (cast === "offline") return { kind: "failed", reason: "offline" };
    if (cast === "no-rod") return { kind: "failed", reason: "no-rod" };
    if (cast === "error") return { kind: "failed", reason: "error" };
    console.warn(`[MockPlayer] fishOnce ${botName} cast=${cast}`);

    // ── 2. 稳定等待（await + timeout 1.25 秒：鱼钩抛竿即生成，下落至稳定位置） ──
    await waitTicks(STABILIZE_TICKS);

    // ── 3. 读取鱼钩状态 + 落点检查（勾中实体/固体方块/钩丢失 = 直接失败） ──
    const hookId = findOwnHooks(botName)[0]?.id;
    if (!hookId) return { kind: "failed", reason: "hook-lost" }; // 发杆成功但钩不在 = 异常丢失
    const placement = await checkPlacement(botName, hookId);
    if (placement !== "water") {
      const reason: FishingFailureReason = placement === undefined ? "hook-lost" : placement;
      console.warn(`[MockPlayer] fishOnce ${botName} placement=${placement ?? "missing"}`);
      // ⚠️ 修复（用户调参）：抛钩无效（勾中非水方块 landed / 勾中实体生物
      //   snagged）→ **提前收钩**再结束——否则鱼钩残留在陆地/实体上，
      //   getFishingStatus 按鱼钩存在性持续误报 fishing，流程卡死重抛；
      //   鱼钩已丢失（hook-lost）则无需收
      if (placement !== undefined) {
        const reel = await reelFishingRod(botName);
        console.warn(`[MockPlayer] fishOnce ${botName} invalid placement (${placement}), early reel=${reel}`);
      }
      notifyOwner(
        botName,
        `${color.error}${failureLabel(reason)}${placement !== undefined ? "（已提前收竿）" : ""}`,
      );
      return { kind: "failed", reason };
    }

    // ── 4. 记录坐标 + 监听上钩（45 秒） ──
    // ⚠️ 清零战利品暂存：抛竿阶段（含鱼竿置入主手 slot 0 的槽位互换）产生的
    // 槽位变化**不属于战利品**（loot tracker 会误收）——正式监听前清空，
    // 仅保留收竿后入包的真实战利品（收竿发生在 watchForBite 内部，其后才收集）
    pendingLoot.delete(botName);
    return await watchForBite(botName, hookId);
  } finally {
    runningFishing.delete(botName);
  }
}
