// ─── 钓鱼钩生成追踪（mc 层） ────────────────────────────
// 自动钓鱼的第一步感知：监测鱼钩实体（minecraft:fishing_hook）生成事件，
// 读取鱼钩的主人名字（投掷者：玩家或假人），并打上主人 tag（mp:fisher:<名字>）
// 方便后期按主人查询鱼钩（tag 编码/解析规则在 core/tasks/FishingRules）。
//
// 基岩版 API 说明：
//   - @minecraft/server 2.8.0 无 projectileSpawn afterEvent，投射物生成
//     统一走 world.afterEvents.entitySpawn（tridentTracker 同款模式）
//   - 鱼钩主人经 minecraft:projectile 组件 .owner（Entity）读取：
//     owner.name = 玩家名 / 假人名
//
// 后续扩展点（按用户规格逐步接入）：浮漂状态监测（稳定后下沉 = 收竿信号）/
// 鱼钩消失监测（回收重抛）。

import { world, Player } from "@minecraft/server";
import type { Entity } from "@minecraft/server";

import { isFishingHook, makeFisherTag } from "../../rules/FishingRules";

/** 初始化幂等守卫（main.ts worldLoad 调用一次；防重复订阅） */
let fishingHookTrackerReady = false;

/**
 * 读取鱼钩主人名字：minecraft:projectile 组件的 owner（投掷者实体）。
 * 玩家/假人实体 .name 即名字（2.8.0 中 name 仅在 Player 类上，Entity 基类
 * 只有 nameTag）；读不到组件/owner 时返回 undefined。
 */
function readHookOwnerName(hook: Entity): string | undefined {
  try {
    const proj = hook.getComponent("minecraft:projectile");
    const owner = (proj as { owner?: Entity } | undefined)?.owner;
    if (!owner) return undefined;
    // name 为空时以实体 id 兜底（tridentTracker 同款：投掷者实体无 name 属性时）
    return (owner instanceof Player ? owner.name : owner.nameTag) || owner.id;
  } catch {
    return undefined;
  }
}

/** 鱼钩生成回调：识别鱼钩 + 打主人 tag + 输出日志（调试日志，英文） */
function onHookSpawn(hook: Entity): void {
  const ownerName = readHookOwnerName(hook);
  if (!ownerName) {
    console.warn(`[MockPlayer] fishing hook ${hook.id} spawned, owner unavailable`);
    return;
  }
  try {
    hook.addTag(makeFisherTag(ownerName));
  } catch (e) {
    console.warn(`[MockPlayer] tag fishing hook ${hook.id} failed: ${e}`);
  }
  console.warn(`[MockPlayer] fishing hook ${hook.id} spawned, owner=${ownerName}`);
}

/**
 * 初始化钓鱼钩追踪（幂等；main.ts worldLoad 后调用）。
 * 订阅 entitySpawn：鱼钩生成即回调（事件内 try-catch 隔离，防单事件崩溃）。
 */
export function initFishingHookTracker(): void {
  if (fishingHookTrackerReady) return;
  fishingHookTrackerReady = true;
  world.afterEvents.entitySpawn.subscribe((event) => {
    try {
      if (!isFishingHook(event.entity.typeId)) return;
      onHookSpawn(event.entity);
    } catch (e) {
      console.warn(`[MockPlayer] entitySpawn callback error: ${e}`);
    }
  });
}
