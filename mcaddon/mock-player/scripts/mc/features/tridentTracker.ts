// ─── 投掷物双任认主追踪（mc 层） ──────────────────────
//
// 双认主机制（两个方向互补）：
//   1. 投掷即标记：投掷物生成（entitySpawn）时，以投射物 owner（实际投掷者）
//      为第一任主人打 tag（玩家或假人皆可）。
//   2. fallback 认主：投掷物实体加载（entityLoad）时，在主人列表中按优先级认主
//      ——第二任（仅假人）在线则认第二任，否则第一任在线认第一任；都离线不动。
//   3. 假人上线夺回：假人上线后 rebindBotTridents 扫描第一/第二任含自己的投掷物
//      （三叉戟/箭），重设 owner 到当前实体（玩家下线期间被认走的击杀经验回归）。
//
// tag 设计（core/items/TridentClaimRules）：
//   mp:owner:<name>  第一任主人（玩家或假人）
//   mp:owner2:<name> 第二任主人（仅假人，可被后续假人覆盖复写）
//   mp:item:<...>    附魔/耐久编码（投掷时打上，认主 UI 解码展示）
//
// ⚠️ thrown_trident / arrow 投射物实体没有可读物品的组件（minecraft:item 仅掉落物实体），
//    附魔信息只能在投掷流程获取：优先投掷流程注册的 pending 队列，其次投掷者主手。

import { world, system, EntityProjectileComponent } from "@minecraft/server";
import type { Dimension, Entity, ItemStack } from "@minecraft/server";
import { botRegistry } from "../bootstrap/context";
import { BotEvents } from "../../events/DomainEvents";
import { isTrackedProjectile, makeItemTag, makeOwnerTag, makeSecondOwnerTag, parseClaimTags, resolveClaimOwner, TRACKED_PROJECTILE_IDS } from "../../items/TridentClaimRules";
import { queueClaimReport } from "./claimReporter";

// ─── pending 附魔信息队列 ──────────────────────────────
// 投掷流程（features/trident.ts doThrowLoop）在 useItemInSlot 前注册物品信息，
// entitySpawn 回调消费（FIFO，投掷为逐把串行）。玩家手动投掷走主手读取兜底。

const pendingItemTags = new Map<string, { tag: string }[]>();

// ─── 反查表（entityId → botName） ──────────────────────
// 实体 ID → 假人名映射：实体重建/改名后仍可追踪假人归属；
// entitySpawn 认主时优先反查（投掷者实体无 name 属性时兜底），并输出认主日志。

const entityOwnerMap = new Map<string, string>();

/** 初始化幂等守卫（main.ts worldLoad 调用一次；防重复订阅） */
let tridentTrackerReady = false;

/** 投掷流程注册：投掷前把三叉戟物品信息编码入队（ownerName → 队列） */
export function registerPendingTridentItem(botName: string, item: ItemStack): void {
  const tag = encodeItemTag(item);
  if (!tag) return;
  const list = pendingItemTags.get(botName) ?? [];
  list.push({ tag });
  pendingItemTags.set(botName, list);
}

/**
 * 投掷失败/中止时丢弃刚注册的物品信息（投掷未发生，防止旧附魔错配到下一把投掷物）。
 * 投掷为逐把串行（isThrowing 互斥），刚注册的是队尾条目，pop 即可。
 */
export function discardPendingTridentItem(botName: string): void {
  const list = pendingItemTags.get(botName);
  if (!list || list.length === 0) return;
  list.pop();
  if (list.length === 0) pendingItemTags.delete(botName);
}

function consumePendingItem(ownerName: string): { tag: string } | undefined {
  const list = pendingItemTags.get(ownerName);
  if (!list || list.length === 0) return undefined;
  const item = list.shift()!;
  if (list.length === 0) pendingItemTags.delete(ownerName);
  return item;
}

/** ItemStack → mp:item: tag（附魔/耐久编码；非三叉戟或无附魔也编码耐久） */
function encodeItemTag(item: ItemStack): string | undefined {
  try {
    const enchantments: { id: string; level: number }[] = [];
    if (item.hasComponent("minecraft:enchantable")) {
      const ench = item.getComponent("minecraft:enchantable") as { getEnchantments: () => { type: { id: string }; level: number }[] } | undefined;
      for (const e of ench?.getEnchantments() ?? []) {
        enchantments.push({ id: e.type.id, level: e.level });
      }
    }
    let durability: { current: number; max: number } | undefined;
    const dur = item.getComponent("minecraft:durability") as { damage?: number; maxDurability?: number } | undefined;
    if (dur && dur.maxDurability) {
      durability = { current: Math.max(0, dur.maxDurability - (dur.damage ?? 0)), max: dur.maxDurability };
    }
    return makeItemTag(enchantments, durability);
  } catch {
    return undefined;
  }
}

/** 兜底：从投掷者主手读取三叉戟物品（引擎可能尚未消耗主手物品） */
function readMainhandItem(owner: Entity): { tag: string } | undefined {
  try {
    const inv = owner.getComponent("minecraft:inventory") as { container?: { getItem: (slot: number) => ItemStack | undefined } } | undefined;
    const handSlot = (owner as { selectedSlotIndex?: number }).selectedSlotIndex ?? 0;
    const item = inv?.container?.getItem(handSlot);
    if (!item || item.typeId !== "minecraft:trident") return undefined;
    const tag = encodeItemTag(item);
    return tag ? { tag } : undefined;
  } catch {
    return undefined;
  }
}

// ─── 初始化 ─────────────────────────────────────────────

/**
 * 订阅 entitySpawn + entityLoad + 假人生命周期事件。
 * - entitySpawn：打第一任 tag / 附魔信息
 * - entityLoad：fallback 认主（第二任在线优先）
 * - botOnline / botRespawn：假人上线/复活 → rebindBotTridents 夺回
 * - botOffline：假人下线 → releaseBotTridents 回退第一任
 * 在 worldLoad 后调用一次。
 */
export function initTridentTracker(): void {
  // ⚠️ 幂等守卫：重复调用会叠加订阅（entitySpawn/entityLoad 双跑、事件双触发）
  if (tridentTrackerReady) {
    console.warn(`[MockPlayer] initTridentTracker 重复调用，跳过`);
    return;
  }
  tridentTrackerReady = true;

  // ── 生命周期事件订阅（事件驱动认主，业务模块不再硬编码互相调用） ──
  BotEvents.botOnline.subscribe((e) => system.run(() => rebindBotTridents(e.botName)));
  BotEvents.botRespawn.subscribe((e) => system.run(() => rebindBotTridents(e.botName)));
  BotEvents.botOffline.subscribe((e) => system.run(() => releaseBotTridents(e.botName)));

  // ── 投掷即标记：第一任主人 = 实际投掷者（玩家或假人）+ 附魔信息 ──
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (!isTrackedProjectile(entity.typeId)) return;
    try {
      // 已有第一任 tag → 跳过（重复 spawn / 已标记）
      if (parseClaimTags(entity.getTags()).firstOwner) return;

      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent | undefined;
      const owner = proj?.owner;
      if (!owner) return;

      // 认主来源：反查表优先（假人实体 ID → 假人名，实体无 name 时兜底），
      // 其次投掷者实体的 name（玩家/假人皆可）
      const mappedName = entityOwnerMap.get(owner.id);
      const ownerName = mappedName ?? (owner as { name?: string }).name;
      if (!ownerName) return;

      entity.addTag(makeOwnerTag(ownerName));
      console.info(
        `[MockPlayer] 投掷物 ${entity.typeId} ${entity.id} 认主日志：第一任=${ownerName}` +
        (mappedName ? `（反查表 ${owner.id}）` : "")
      );
      BotEvents.tridentClaimed.trigger({ tridentId: entity.id, claimedBy: ownerName, via: "spawn", firstOwner: ownerName });

      // 附魔/耐久编码：优先投掷流程 pending 队列，其次投掷者主手
      const itemInfo = consumePendingItem(ownerName) ?? readMainhandItem(owner);
      if (itemInfo) {
        entity.addTag(itemInfo.tag);
        console.info(`[MockPlayer] 投掷物 ${entity.id} 附魔信息已标记`);
      }
    } catch (e) {
      console.info(`[MockPlayer] entitySpawn 认主异常: ${e}`);
    }
  });

  // ── fallback 认主：实体加载时在主人列表中按优先级认主 ──
  // 覆盖场景：未加载区块中的投掷物、游戏重启后区块重载
  world.afterEvents.entityLoad.subscribe((event) => {
    const entity = event.entity;
    if (!isTrackedProjectile(entity.typeId)) return;
    try {
      const { firstOwner, secondOwner } = parseClaimTags(entity.getTags());
      if (!firstOwner && !secondOwner) return;

      // 第二任在线优先，其次第一任在线；都离线不动（等上线夺回）
      const target = resolveClaimOwner(firstOwner, secondOwner, isOwnerOnline);
      if (!target) return;

      const targetEntity = resolveOwnerEntity(target);
      if (!targetEntity) return;

      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent;
      if (proj) {
        proj.owner = targetEntity;
        // 认主日志：注明优先级（第二任在线 > 第一任离线回退）
        const via = secondOwner && secondOwner === target ? "第二任" : "第一任";
        console.info(
          `[MockPlayer] entityLoad 认主 ${entity.typeId} ${entity.id} → ${target}（${via}${secondOwner && secondOwner !== target ? "离线回退" : ""}）` +
          `｜主人列表：第一任=${firstOwner ?? "无"} 第二任=${secondOwner ?? "无"}`
        );
        BotEvents.tridentClaimed.trigger({ tridentId: entity.id, claimedBy: target, via: "load", firstOwner, secondOwner });

        // 认主汇报（集中聚合）：目标假人 → 其主人"认领"；目标玩家且原第二任是离线假人 → "回退给你"
        const targetRecord = botRegistry.get(target);
        if (targetRecord) {
          queueClaimReport({ to: targetRecord.ownerName ?? "", bot: target, kind: "claimed", typeId: entity.typeId });
        } else if (secondOwner) {
          queueClaimReport({ to: target, bot: secondOwner, kind: "returned", typeId: entity.typeId, target });
        }
      }
    } catch (e) {
      console.info(`[MockPlayer] entityLoad 认主异常: ${e}`);
    }
  });
}

// ─── 在线/实体解析 ─────────────────────────────────────

/** 名字 → 是否在线（假人=registry 有 entityId；玩家=世界中存在） */
function isOwnerOnline(name: string): boolean {
  const record = botRegistry.get(name);
  if (record) return !!record.entityId; // 假人
  try {
    return world.getPlayers({ name }).length > 0; // 玩家
  } catch {
    return false;
  }
}

/** 名字 → 当前实体（假人按 entityId 查；玩家按名字查） */
function resolveOwnerEntity(name: string): Entity | undefined {
  const record = botRegistry.get(name);
  if (record?.entityId) {
    try {
      const e = world.getEntity(record.entityId);
      return e?.isValid ? e : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    return world.getPlayers({ name })[0];
  } catch {
    return undefined;
  }
}

// ─── 上线/下线跟踪（维护反查表） ───────────────────────
// 反查表（entityId → botName）供 entitySpawn 认主时解析假人投掷者；
// 由 onlineBot/playerJoin/playerSpawn（在线）与 offlineBot/entityDie/deleteBot（离线）维护。

/** 该假人当前被追踪的认主三叉戟数（工作流 isRunning 查询用） */
export function countOwnedTridents(botName: string): number {
  let count = 0;
  for (const owner of entityOwnerMap.values()) {
    if (owner === botName) count++;
  }
  return count;
}

export function trackBotOnline(entityId: string, botName: string): void {
  entityOwnerMap.set(entityId, botName);
  console.info(`[MockPlayer] 反查表 += ${botName}（${entityId}）共 ${entityOwnerMap.size} 条`);
}

export function trackBotOffline(entityId: string): void {
  entityOwnerMap.delete(entityId);
  console.info(`[MockPlayer] 反查表 -= ${entityId} 剩余 ${entityOwnerMap.size} 条`);
}

// ─── 投掷物查询 ────────────────────────────────────────

/** 按认主 tag 查某维度内全部受跟踪投掷物（三叉戟 + 箭，分类型查询合并） */
function findProjectilesByTag(dim: Dimension, tag: string): Entity[] {
  const result: Entity[] = [];
  for (const typeId of TRACKED_PROJECTILE_IDS) {
    try {
      result.push(...dim.getEntities({ tags: [tag], type: typeId }));
    } catch {
      // 单类型查询失败跳过
    }
  }
  return result;
}

// ─── 上线夺回 ─────────────────────────────────────────

/**
 * 假人上线后扫描第一/第二任包含自己的投掷物（三叉戟/箭），重设 owner 到当前实体。
 * 覆盖场景：模式切换（chunkload↔normal）、手动重连、游戏重启。
 * 由 playerJoin / playerSpawn 调用。
 */
export function rebindBotTridents(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record?.entityId) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 跳过：无 entityId`);
    return;
  }

  const newOwner = world.getEntity(record.entityId);
  if (!newOwner) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 跳过：实体 ${record.entityId} 不存在`);
    return;
  }

  let total = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      const firstOwner = findProjectilesByTag(dim, makeOwnerTag(botName));
      const secondOwner = findProjectilesByTag(dim, makeSecondOwnerTag(botName));
      for (const t of [...firstOwner, ...secondOwner]) {
        // ⚠️ 优先级校验：按主人列表计算当前最优 owner（第二任在线 > 第一任在线）。
        //   只有最优是自己才夺回——避免把"第二任是其他在线假人"的投掷物抢过来。
        const { firstOwner: f, secondOwner: s } = parseClaimTags(t.getTags());
        const target = resolveClaimOwner(f, s, isOwnerOnline);
        if (target !== botName) continue;

        total++;
        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) {
            proj.owner = newOwner;
            BotEvents.tridentClaimed.trigger({ tridentId: t.id, claimedBy: botName, via: "rebind", firstOwner: f, secondOwner: s });
            // 认主汇报（集中聚合）：假人主人"认领"；第一任是玩家且不是假人主人 → 玩家"被认走"
            // ⚠️ firstOwner === ownerName（主人自己投掷的）时只发主人一路，避免同一玩家重复计数
            queueClaimReport({ to: record.ownerName ?? "", bot: botName, kind: "claimed", typeId: t.typeId });
            if (f && !botRegistry.get(f) && f !== record.ownerName) {
              queueClaimReport({ to: f, bot: botName, kind: "covered", typeId: t.typeId });
            }
          }
        } catch (e) {
          console.info(`[MockPlayer] 重绑定 ${t.id} 失败: ${e}`);
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
  if (total > 0) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 完成，重绑定 ${total} 把投掷物`);
  }
}

// ─── 下线回退认主第一任 ────────────────────────────────

/**
 * 假人下线时调用：名下投掷物（第二任 = 自己）尝试回退认主**第一任**。
 * - 第一任在线（玩家在世界 / 假人 registry 有 entityId）→ 重设 owner 到第一任，
 *   避免投掷物 owner 悬空导致击杀经验丢失
 * - 第一任离线 → 保持现状，等第一任上线由 rebind 认主
 * - tag 保留（第二任仍是自己）：假人上线后 rebind 会重新夺回（第二任 > 第一任）
 * 由 offlineBot / entityDie（死亡下线）/ playerLeave 调用。
 */
export function releaseBotTridents(botName: string): void {
  let total = 0;
  const ownerName = botRegistry.get(botName)?.ownerName ?? "";
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      const asFirst = findProjectilesByTag(dim, makeOwnerTag(botName));
      const asSecond = findProjectilesByTag(dim, makeSecondOwnerTag(botName));
      for (const t of [...asFirst, ...asSecond]) {
        const { firstOwner, secondOwner } = parseClaimTags(t.getTags());

        // 只有第二任是自己才需要回退（第一任是自己则下线无需切换——第一任不可变）
        if (secondOwner !== botName) continue;
        // 没有第一任（异常数据）→ 无从回退
        if (!firstOwner) continue;
        // 第一任在线 → 认主第一任；离线 → 等其上线 rebind
        const targetEntity = resolveOwnerEntity(firstOwner);
        if (!targetEntity) continue;

        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) {
            proj.owner = targetEntity;
            total++;
            console.info(`[MockPlayer] 下线回退 ${botName} → 投掷物 ${t.id} 认主第一任=${firstOwner}`);
            BotEvents.tridentClaimed.trigger({ tridentId: t.id, claimedBy: firstOwner, via: "offline-fallback", firstOwner, secondOwner });
            // 认主汇报（集中聚合）：假人主人"降级回退"；第一任是玩家且不是假人主人 → "重新获得（→ 你）"
            // ⚠️ firstOwner === ownerName 时只发主人一路，避免同一玩家重复计数（回退通知翻倍）
            queueClaimReport({ to: ownerName, bot: botName, kind: "returned", typeId: t.typeId, target: firstOwner });
            if (!botRegistry.get(firstOwner) && firstOwner !== ownerName) {
              queueClaimReport({ to: firstOwner, bot: botName, kind: "returned", typeId: t.typeId, target: firstOwner });
            }
          }
        } catch (e) {
          console.info(`[MockPlayer] 下线回退 ${t.id} 失败: ${e}`);
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
  if (total > 0) {
    console.info(`[MockPlayer] releaseBotTridents(${botName}) 完成，回退 ${total} 把投掷物到第一任`);
  }
}