// ─── 核心操作（共享业务逻辑） ──────────────────────────
// 所有操作同步执行，需在 system.run() 内调用
// 操作不发送任何消息，由调用层（commands/ui）处理反馈
//
// ⚠️ 注意区分职责：
//   创建/上线 → 只生成实体，背包/装备/经验恢复由 playerJoin 事件完成
//   下线/死亡 → 调用 saveBotFullState 保存背包/装备/经验，再由事件兜底

import {
  Player,
  Vector3,
  Vector2,
  world,
  GameMode,
  Dimension,
  EntityInventoryComponent,
  EntityEquippableComponent,
  EquipmentSlot,
  ItemStack,
} from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord, PositionState, BOT_TAG, SerializedItemStack } from "./types";
import { TAG_CONTROL, TAG_IDLE, EXCLUSIVE_SET, syncEntityTags } from "./tags";
import {
  getPlayerLookTarget,
  serializeContainer,
  serializeEquipment,
  captureExperience,
  getEquipmentSlot,
} from "./utils";
import {
  botRegistry,
  saveBotRecord,
  removeBotRecord,
  saveBotInventory,
  saveBotEquipment,
  removeBotInventory,
  isBotRestored,
  removeBotRestored,
} from "./persistence";

// ─── 创建 ──────────────────────────────────────────────

export interface CreateBotOptions {
  name: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
}

/**
 * 生成假人后统一设置标签/位置/朝向/注册
 * createBot 和 onlineBot 的公共尾部逻辑
 * 背包/装备/经验不在此恢复——它们由 playerJoin 事件负责
 */
function finalizeBotSpawn(
  bot: SimulatedPlayer,
  record: BotRecord,
  location: Vector3,
  rotation: Vector2,
  lookTarget: Vector3,
  isSneaking: boolean,
): void {
  syncEntityTags(bot, record.tags);
  bot.teleport(location, { rotation });
  bot.isSneaking = isSneaking;
  bot.lookAtLocation(lookTarget, LookDuration.Continuous);

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

/**
 * 创建新假人
 * - 生成 SimulatedPlayer
 * - 构建 BotRecord（初始标签、位置、重生点）
 * - 背包/装备/经验由 playerJoin 事件从持久化恢复（新假人无保存数据，自动跳过）
 */
export function createBot(options: CreateBotOptions): BotRecord {
  const { name, location, dimension, initialTags, rotation, lookTarget, isSneaking } = options;

  const bot = spawnSimulatedPlayer(
    { x: location.x, y: location.y, z: location.z, dimension },
    name,
    GameMode.Survival,
  );
  console.warn(`[MockPlayer] 创建假人 ${name}（目标 ${dimension.id} ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}）`);

  const currentState: PositionState = {
    location,
    dimension: dimension.id,
    rotation: { x: rotation.x, y: rotation.y },
    lookTarget,
  };

  const record: BotRecord = {
    name,
    online: true,
    death: false,
    entityId: bot.id,
    tags: [...initialTags],
    isSneaking,
    lastPoint: currentState,
    respawnPoint: currentState,
    deathPoint: null,
    experience: { level: 0, xpProgress: 0, totalXp: 0 },
  };

  finalizeBotSpawn(bot, record, location, { x: rotation.x, y: rotation.y }, lookTarget, isSneaking);
  return record;
}

// ─── 上线 ──────────────────────────────────────────────

/**
 * 恢复离线假人上线
 * - 从记录中取最后位置/重生点生成 SimulatedPlayer
 * - 背包/装备/经验由后续的 playerJoin 事件恢复
 * - ⚠️ 注意：spawnSimulatedPlayer 无视坐标（永远在西边角生成）
 *   所以必须跟随 teleport 修正位置
 */
export function onlineBot(record: BotRecord): SimulatedPlayer {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = spawnSimulatedPlayer(
    { x: state.location.x, y: state.location.y, z: state.location.z, dimension: dim },
    record.name,
    GameMode.Survival,
  );
  console.warn(`[MockPlayer] 上线假人 ${record.name}（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`);

  // 背包/装备/经验在 playerJoin 事件中恢复

  record.online = true;
  record.death = false;
  record.entityId = bot.id;
  finalizeBotSpawn(bot, record, state.location, state.rotation, state.lookTarget, record.isSneaking);

  return bot;
}

// ─── 保存假人完整状态（背包 + 装备 + 经验）───────────────

/**
 * 保存假人的全部运行时状态到持久化
 * - 背包 36 格 → saveBotInventory（每格独立 key）
 * - 装备 5 槽 → saveBotEquipment（每槽独立 key）
 * - 经验值 → record.experience + saveBotRecord
 *
 * ⚠️ 注意：改了 record.experience 后必须 saveBotRecord，否则不持久化
 * 此函数在以下场景被调用：
 *   - offlineBot（主动下线）
 *   - entityDie（死亡，无论是否自动重生）
 *   - playerLeave（尽力保存，实体可能已不可访问）
 *   - behavior 100tick 周期（仅装备+经验）
 */
// ─── 物品交互（装备/互换） ──────────────────────────────

/** 可互换的装备槽列表（不含主手） */
const SWAP_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];

/**
 * 将玩家手中的装备穿到假人身上（自动交换）
 * 在 system.run() 内调用
 */
export function equipBotArmor(bot: Player, player: Player, armorItem: ItemStack): boolean {
  const slot = getEquipmentSlot(armorItem.typeId);
  if (!slot) return false;

  const bEquip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  if (!bEquip) return false;

  const currentItem = bEquip.getEquipment(slot);
  bEquip.setEquipment(slot, armorItem);

  // 处理玩家手中的物品变化
  const inv = player.getComponent("minecraft:inventory") as EntityInventoryComponent;
  if (inv?.container) {
    const handSlot = player.selectedSlotIndex;
    if (currentItem) {
      // 假人原有装备 → 换到玩家手中
      inv.container.setItem(handSlot, currentItem);
    } else {
      // 假人该槽为空 → 消耗玩家手中的物品
      const handStack = inv.container.getItem(handSlot);
      if (handStack && handStack.amount > 1) {
        handStack.amount--;
        inv.container.setItem(handSlot, handStack);
      } else {
        inv.container.setItem(handSlot, undefined);
      }
    }
  }
  return true;
}

/** 交换单个装备槽（调用方保证 pEquip/bEquip 非空） */
function swapSlot(pEquip: EntityEquippableComponent, bEquip: EntityEquippableComponent, slot: EquipmentSlot): void {
  const pItem = pEquip.getEquipment(slot);
  const bItem = bEquip.getEquipment(slot);
  pEquip.setEquipment(slot, bItem);
  bEquip.setEquipment(slot, pItem);
}

/** 获取双方 EquippableComponent，任一为空返回 false */
function getBothEquip(player: Player, bot: Player): [EntityEquippableComponent, EntityEquippableComponent] | undefined {
  const p = player.getComponent("minecraft:equippable") as EntityEquippableComponent;
  const b = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  return p && b ? [p, b] : undefined;
}

/** 与假人互换主手物品 */
export function swapMainhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Mainhand);
  console.warn(`[MockPlayer] 交换主手 ${bot.name} ←→ ${player.name}`);
  return true;
}

/** 与假人互换副手物品 */
export function swapOffhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Offhand);
  console.warn(`[MockPlayer] 交换副手 ${bot.name} ←→ ${player.name}`);
  return true;
}

/** 与假人互换全部装备（头盔/胸甲/护腿/靴子/副手） */
export function swapEquipmentWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  for (const slot of SWAP_SLOTS) swapSlot(both[0], both[1], slot);
  console.warn(`[MockPlayer] 交换装备 ${bot.name} ←→ ${player.name}`);
  return true;
}

/**
 * 仅保存假人装备栏 + 经验（不含背包）
 * 替换 saveBotFullState 用于互换/脱下装备等场景，避免全量扫描 36 格背包
 */
export function saveBotEquipState(bot: Player, record: BotRecord): void {
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  if (equip) {
    saveBotEquipment(record.name, serializeEquipment(equip));
  }
  record.experience = captureExperience(bot);
  saveBotRecord(record);
  console.warn(`[MockPlayer] 装备状态保存完成 ${record.name}`);
}

/** 一键卸甲：卸下假人主手 + 副手 + 全部装备，回收至玩家背包 */
export function unequipBotAll(player: Player, bot: Player): boolean {
  const bEquip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  const pInv = player.getComponent("minecraft:inventory") as EntityInventoryComponent;
  if (!bEquip || !pInv?.container) return false;

  // 所有要回收的槽：主手 + 5 装备槽
  const allSlots = [EquipmentSlot.Mainhand, ...SWAP_SLOTS];
  let count = 0;
  for (const slot of allSlots) {
    const item = bEquip.getEquipment(slot);
    if (!item) continue;
    bEquip.setEquipment(slot, undefined);
    count++;
    // 尝试放入玩家背包，放不下的掉落在地
    const remainder = pInv.container.addItem(item);
    if (remainder) {
      player.dimension.spawnItem(remainder, player.location);
    }
  }
  console.warn(`[MockPlayer] 一键卸甲 ${bot.name}——${count} 件 → ${player.name}`);
  return true;
}

export function saveBotFullState(bot: Player, record: BotRecord): void {
  // ⚠️ 高危防护：假人刚生成时背包为空，恢复完成前禁止保存
  // 否则空背包会覆盖持久化的真实数据
  if (!isBotRestored(record.name)) {
    console.warn(`[MockPlayer] ⛔ 全量保存被拦截 ${record.name}——尚未恢复完成`);
    return;
  }

  const inv = bot.getComponent("minecraft:inventory") as EntityInventoryComponent;
  if (inv?.container) {
    saveBotInventory(record.name, serializeContainer(inv.container));
  }
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  if (equip) {
    saveBotEquipment(record.name, serializeEquipment(equip));
  }
  record.experience = captureExperience(bot);
  saveBotRecord(record);
  console.warn(`[MockPlayer] 全量状态保存完成 ${record.name}`);
}

// ─── 下线 ──────────────────────────────────────────────

/**
 * 主动下线假人
 * - 保存当前状态（最后位置 + 背包 + 装备 + 经验）
 * - disconnect 移除实体
 * - ⚠️ disconnect 后 playerLeave 事件会触发，但此时实体已不可访问
 *   所以保存必须在 disconnect 前完成
 */
export function offlineBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  const online = entity as SimulatedPlayer | undefined;

  if (online && online.hasTag(BOT_TAG)) {
    record.lastPoint = {
      location: online.location,
      dimension: online.dimension.id,
      rotation: online.getRotation(),
      lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
    };
    record.isSneaking = online.isSneaking;

    console.warn(`[MockPlayer] 下线保存 ${record.name}（${record.lastPoint.dimension} ${Math.floor(record.lastPoint.location.x)} ${Math.floor(record.lastPoint.location.y)} ${Math.floor(record.lastPoint.location.z)}）`);
    saveBotFullState(online, record);

    online.disconnect();
  }

  record.online = false;
  record.entityId = undefined;
  botRegistry.set(record.name, record);
  saveBotRecord(record);

}

// ─── 删除 ──────────────────────────────────────────────

export function deleteBot(record: BotRecord): void {
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as SimulatedPlayer).disconnect();
    }
  }
  botRegistry.delete(record.name);
  removeBotRecord(record.name);
  removeBotInventory(record.name);
  // 离线删除：disconnect() 不会触发 playerLeave，必须手动清除恢复标记
  // 否则同名新假人会被 isBotRestored 误判为已恢复，空背包覆盖持久化数据
  removeBotRestored(record.name);
}

// ─── 杀死 ──────────────────────────────────────────────

export function killBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  (entity as SimulatedPlayer).kill();
}

// ─── 传送 ──────────────────────────────────────────────

export function tpPlayerToBot(player: Player, record: BotRecord): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  player.teleport(entity.location);
}

export function tpBotToPlayer(record: BotRecord, player: Player): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;
  const playerRot = player.getRotation();
  const lookTarget = getPlayerLookTarget(player);

  bot.teleport(player.location, { rotation: playerRot });
  bot.lookAtLocation(lookTarget, LookDuration.Continuous);
  bot.isSneaking = player.isSneaking;

  record.isSneaking = player.isSneaking;
  if (record.lastPoint) {
    record.lastPoint.location = player.location;
    record.lastPoint.dimension = player.dimension.id;
    record.lastPoint.rotation = playerRot;
    record.lastPoint.lookTarget = lookTarget;
  }
  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 移动 ──────────────────────────────────────────────

export function moveBot(record: BotRecord, target: Vector3): boolean {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;
  bot.stopMoving();
  const result = bot.navigateToLocation(target, 1);
  return result.isFullPath;
}

// ─── 控制模式 ──────────────────────────────────────────

export function toggleControl(record: BotRecord, player: Player): void {
  const hasControl = record.tags.includes(TAG_CONTROL.value);

  if (hasControl) {
    // 关闭控制
    record.tags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    record.controllerId = undefined;

    const hasExclusive = record.tags.some((t) => EXCLUSIVE_SET.has(t));
    if (!hasExclusive) {
      record.tags.push(TAG_IDLE.value);
    }
  } else {
    // 开启控制
    record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
    if (!record.tags.includes(TAG_CONTROL.value)) {
      record.tags.push(TAG_CONTROL.value);
    }
    record.controllerId = player.id;

    // 立即同步一次体态
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
      const lookTarget = getPlayerLookTarget(player);
      (entity as SimulatedPlayer).teleport(player.location, { rotation: player.getRotation() });
      (entity as SimulatedPlayer).lookAtLocation(lookTarget, LookDuration.Continuous);
    }
  }

  // 同步标签到实体
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 潜行 ──────────────────────────────────────────────

export function setSneaking(record: BotRecord, sneaking: boolean): void {
  record.isSneaking = sneaking;

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as Player).isSneaking = sneaking;
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 标签更新 ──────────────────────────────────────────

export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: Player): void {
  const hadControl = record.tags.includes(TAG_CONTROL.value);
  const hasControlNow = newTags.includes(TAG_CONTROL.value);

  record.tags = newTags;

  if (!hasControlNow) {
    record.controllerId = undefined;
  } else if (!hadControl && controllerPlayer) {
    record.controllerId = controllerPlayer.id;
  }

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
