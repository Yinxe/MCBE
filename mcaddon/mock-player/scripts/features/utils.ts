// ─── 工具函数 ──────────────────────────────────────────

import {
  Player,
  Vector3,
  Vector2,
  Container,
  ItemStack,
  ItemEnchantableComponent,
  Potions,
  EnchantmentType,
  EquipmentSlot,
  EntityEquippableComponent,
} from "@minecraft/server";
import { PositionState, SerializedItemStack, SerializedEnchantment, ExperienceRecord } from "./types";

// ─── 坐标方向 ──────────────────────────────────────────

export function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

export function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const hit = player.getBlockFromViewDirection({ maxDistance });
  if (hit) {
    const b = hit.block;
    return { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  }
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: head.x + dir.x * maxDistance,
    y: head.y + dir.y * maxDistance,
    z: head.z + dir.z * maxDistance,
  };
}

// ─── 格式化 ────────────────────────────────────────────

const DIM_MAP: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界",
  "minecraft:the_end": "末地",
};

export function formatDimensionId(dimId: string): string {
  return DIM_MAP[dimId] ?? dimId;
}

export function formatPos(v: Vector3): string {
  return `§7[§f${Math.floor(v.x)} §f${Math.floor(v.y)} §f${Math.floor(v.z)}§7]`;
}

export function formatState(state: PositionState): string {
  return `${formatPos(state.location)} §8${formatDimensionId(state.dimension)} §7旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

// ─── 状态捕获 ──────────────────────────────────────────

export function capturePlayerState(player: Player, lookTarget: Vector3): PositionState {
  return {
    location: player.location,
    dimension: player.dimension.id,
    rotation: player.getRotation(),
    lookTarget,
  };
}

export function capturePlayerStateFromRotation(
  location: Vector3,
  dimension: string,
  rotation: Vector2,
  lookTarget: Vector3
): PositionState {
  return { location, dimension, rotation, lookTarget };
}

// ─── 坐标解析 ──────────────────────────────────────────

/** 解析 "x y z" 格式的坐标文本 */
export function parseCoordinateInput(input: string): Vector3 | undefined {
  if (!input || input.trim() === "") return undefined;
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return undefined;
  return { x, y, z };
}

// ─── 背包序列化 ──────────────────────────────────────────

/**
 * 序列化单个 ItemStack → SerializedItemStack
 * 递归处理嵌套容器（潜影盒、收纳袋）
 */
export function serializeItemStack(item: ItemStack): SerializedItemStack {
  const data: SerializedItemStack = {
    typeId: item.typeId,
    amount: item.amount,
  };

  if (item.nameTag) data.nameTag = item.nameTag;
  if (item.keepOnDeath) data.keepOnDeath = true;
  if (item.lockMode !== "none") data.lockMode = item.lockMode;

  const lore = item.getLore();
  if (lore.length > 0) data.lore = lore;

  // ⚠️ getCanDestroy / getCanPlaceOn 在受限模式下调用会抛异常
  // 加 try-catch 兜底，不影响核心数据保存
  try { const d = item.getCanDestroy(); if (d.length > 0) data.canDestroy = d; } catch {}
  try { const p = item.getCanPlaceOn(); if (p.length > 0) data.canPlaceOn = p; } catch {}

  // 耐久
  const durability = item.getComponent("minecraft:durability");
  if (durability) {
    const d = durability as any;
    if (d.damage > 0) data.damage = d.damage;
    if (d.unbreakable) data.unbreakable = true;
  }

  // 附魔
  if (item.hasComponent("minecraft:enchantable")) {
    const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent;
    const list = ench.getEnchantments();
    if (list.length > 0) {
      data.enchantments = list.map((e) => ({ id: e.type.id, level: e.level }));
    }
  }

  // 药水
  if (item.hasComponent("minecraft:potion")) {
    const p = item.getComponent("minecraft:potion") as any;
    data.potionEffectType = p.potionEffectType?.id;
    data.potionDeliveryType = p.potionDeliveryType?.id;
  }

  // 染色
  if (item.hasComponent("minecraft:dyeable")) {
    const d = item.getComponent("minecraft:dyeable") as any;
    if (d.color) {
      data.color = { red: d.color.red, green: d.color.green, blue: d.color.blue };
    }
  }

  // 成书
  if (item.hasComponent("minecraft:book")) {
    const b = item.getComponent("minecraft:book") as any;
    data.bookAuthor = b.author;
    data.bookContents = b.contents;
    data.bookIsSigned = b.isSigned;
  }

  // 嵌套容器（潜影盒、收纳袋等）
  // ⚠️ ItemInventoryComponent.container 可能抛出 InvalidContainerError
  //    加 try-catch 兜底，不影响外层物品序列化
  try {
    const invComp = item.getComponent("minecraft:inventory") as any;
    if (invComp?.container) {
      data.container = serializeContainer(invComp.container);
      console.warn(`[MockPlayer] [DIAG] 序列化容器 ${item.typeId} 容器大小=${invComp.container.size} 嵌套物品=${data.container?.filter(x=>!!x).length || 0}`);
    } else {
      console.warn(`[MockPlayer] [DIAG] 序列化容器 ${item.typeId} hasComp=${item.hasComponent("minecraft:inventory")} invComp=${typeof invComp} container=${typeof invComp?.container}`);
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] [DIAG] 序列化容器异常 ${item.typeId}: ${e.message}`);
  }

  return data;
}

/** 序列化整个 Container（36 格背包 / 嵌套容器的所有格子） */
export function serializeContainer(container: Container): (SerializedItemStack | null)[] {
  const result: (SerializedItemStack | null)[] = [];
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    result.push(item ? serializeItemStack(item) : null);
  }
  return result;
}

/**
 * 反序列化 SerializedItemStack → ItemStack
 * 返回 undefined 表示空位
 */
export function deserializeItemStack(data: SerializedItemStack | null | undefined): ItemStack | undefined {
  if (!data) return undefined;

  // 药水物品用 Potions.resolve 创建，确保效果正确
  let item: ItemStack;
  if (data.potionEffectType && data.potionDeliveryType) {
    try {
      item = Potions.resolve(data.potionEffectType, data.potionDeliveryType);
      item.amount = data.amount;
    } catch {
      item = new ItemStack(data.typeId, data.amount);
    }
  } else {
    item = new ItemStack(data.typeId, data.amount);
  }

  // 基础属性
  if (data.nameTag) item.nameTag = data.nameTag;
  if (data.keepOnDeath) item.keepOnDeath = true;
  if (data.lockMode && data.lockMode !== "none") (item as any).lockMode = data.lockMode;
  if (data.lore && data.lore.length > 0) item.setLore(data.lore);
  if (data.canDestroy && data.canDestroy.length > 0) item.setCanDestroy(data.canDestroy);
  if (data.canPlaceOn && data.canPlaceOn.length > 0) item.setCanPlaceOn(data.canPlaceOn);

  // 耐久 / 不可破坏
  if (data.damage !== undefined || data.unbreakable) {
    const d = item.getComponent("minecraft:durability") as any;
    if (d) {
      if (data.damage !== undefined) d.damage = data.damage;
      if (data.unbreakable) d.unbreakable = true;
    }
  }

  // 附魔
  if (data.enchantments && data.enchantments.length > 0 && item.hasComponent("minecraft:enchantable")) {
    const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent;
    for (const e of data.enchantments) {
      try {
        ench.addEnchantment({ type: new EnchantmentType(e.id), level: e.level });
      } catch {
        // 单个附魔添加失败不影响其他
      }
    }
  }

  // 染色
  if (data.color && item.hasComponent("minecraft:dyeable")) {
    const d = item.getComponent("minecraft:dyeable") as any;
    d.color = { red: data.color.red, green: data.color.green, blue: data.color.blue };
  }

  // 成书（仅签名书可以设置，未签名书的内容通过 writable book 组件设置）
  if (data.bookIsSigned && item.hasComponent("minecraft:book")) {
    const b = item.getComponent("minecraft:book") as any;
    // book 组件属性在 ItemStack 上是只读的，无法设置
    // 签名书的 author/contents 只能通过 setItem 到容器时保留
    // 此处仅记录，实际需要通过 ItemBookComponent 的 createWritableBook / createSignedBook 方法
  }

  // 嵌套容器由 deserializeContainer / fillNestedContainer 处理
  // 此处只创建「外壳物品」，内部容器在已放入目标容器后递归填充

  return item;
}

/**
 * 反序列化整组物品到容器（含嵌套容器）
 *
 * 流程：先 setItem 放入目标容器 → 取回 → 填充嵌套容器 → 写回
 * 这样 ItemInventoryComponent 在目标容器上下文中初始化，
 * 避免 setItem 拷贝时内部容器数据丢失。
 *
 * @param container 目标容器
 * @param items 序列化物品数组（index = slot）
 */
export function deserializeContainer(container: Container, items: (SerializedItemStack | null | undefined)[]): void {
  for (let i = 0; i < Math.min(container.size, items.length); i++) {
    const data = items[i];
    if (!data) {
      container.setItem(i, undefined);
      continue;
    }
    const hasContainer = !!data.container && data.container.length > 0;
    if (hasContainer) {
      console.warn(`[MockPlayer] [DIAG] 反序列化 slot=${i} ${data.typeId} 有嵌套容器=${data.container?.filter(x=>!!x).length || 0}/${data.container?.length || 0}`);
    }
    // 先放入「外壳物品」（不含嵌套容器填充）
    container.setItem(i, deserializeItemStack(data));
    // 再取回填充内部容器（在目标容器上下文中操作）
    fillNestedContainer(container, i, data.container);
  }
}

/**
 * 递归填充容器物品的嵌套容器
 * 确保 ItemInventoryComponent 在已放入容器的物品上初始化，
 * 避免 setItem 拷贝丢失内部容器数据
 */
function fillNestedContainer(
  parentContainer: Container,
  parentSlot: number,
  nestedData: (SerializedItemStack | null)[] | undefined,
): void {
  if (!nestedData) return;
  try {
    const parentItem = parentContainer.getItem(parentSlot);
    if (!parentItem) return;
    const invComp = parentItem.getComponent("minecraft:inventory") as any;
    if (!invComp?.container) {
      console.warn(`[MockPlayer] [DIAG] 填充容器失败: slot=${parentSlot} 无可访问容器组件`);
      return;
    }

    const inner = invComp.container;
    const len = Math.min(inner.size, nestedData.length);
    const nonNull = nestedData.filter(x => !!x).length;
    console.warn(`[MockPlayer] [DIAG] 填充容器 slot=${parentSlot} ${parentItem.typeId} 内部容器大小=${inner.size} 待填充=${nonNull}/${len}`);

    // 第一遍：填充外层物品（不含其内部容器）
    for (let i = 0; i < len; i++) {
      const nd = nestedData[i];
      inner.setItem(i, nd ? deserializeItemStack(nd) : undefined);
    }
    // 第二遍：递归填充物品自身的嵌套容器
    for (let i = 0; i < len; i++) {
      const nd = nestedData[i];
      if (nd?.container) {
        fillNestedContainer(inner, i, nd.container);
      }
    }
    // 写回（getItem 可能返回拷贝）
    parentContainer.setItem(parentSlot, parentItem);

    // 验证：立即读回来检查
    const verify = parentContainer.getItem(parentSlot);
    if (verify) {
      const verifyComp = verify.getComponent("minecraft:inventory") as any;
      if (verifyComp?.container) {
        let stillHas = 0;
        for (let i = 0; i < Math.min(verifyComp.container.size, len); i++) {
          if (verifyComp.container.getItem(i)) stillHas++;
        }
        console.warn(`[MockPlayer] [DIAG] ✅ 写回验证 slot=${parentSlot} 容器物品=${stillHas}/${nonNull}`);
      } else {
        console.warn(`[MockPlayer] [DIAG] ❌ 写回验证 slot=${parentSlot} 容器组件丢失`);
      }
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] [DIAG] 填充容器异常 slot=${parentSlot}: ${e.message}`);
  }
}

// ─── 经验值计算 ──────────────────────────────────────────

/**
 * 计算从 0 级升到 targetLevel 累计所需的总经验值（不含当前等级进度）
 * MC 升级公式：
 *   0–15 级：2n + 7
 *   16–30 级：5n - 38
 *   31+ 级：  9n - 158
 */
export function getTotalXpForLevels(targetLevel: number): number {
  let total = 0;
  for (let i = 0; i < targetLevel; i++) {
    if (i >= 30) total += 9 * i - 158;
    else if (i >= 15) total += 5 * i - 38;
    else total += 2 * i + 7;
  }
  return total;
}

/** 从 Player 捕获当前经验值到 ExperienceRecord */
export function captureExperience(player: Player): ExperienceRecord {
  const level = player.level;
  const xpProgress = player.xpEarnedAtCurrentLevel;
  return {
    level,
    xpProgress,
    totalXp: getTotalXpForLevels(level) + xpProgress,
  };
}

// ─── 装备序列化 ──────────────────────────────────────────

/** 装备槽名字 → EquipmentSlot 映射 */
const EQUIP_SLOT_MAP: Record<string, EquipmentSlot> = {
  head: EquipmentSlot.Head,
  chest: EquipmentSlot.Chest,
  legs: EquipmentSlot.Legs,
  feet: EquipmentSlot.Feet,
  offhand: EquipmentSlot.Offhand,
};

/** 序列化装备栏（head/chest/legs/feet/offhand）*/
export function serializeEquipment(
  equip: EntityEquippableComponent
): Record<string, SerializedItemStack | null> {
  const result: Record<string, SerializedItemStack | null> = {};
  for (const [name, slot] of Object.entries(EQUIP_SLOT_MAP)) {
    const item = equip.getEquipment(slot);
    result[name] = item ? serializeItemStack(item) : null;
  }
  return result;
}

/** 反序列化恢复装备栏（含嵌套容器两阶段填充） */
export function deserializeEquipment(
  equip: EntityEquippableComponent,
  data: Record<string, SerializedItemStack>
): void {
  for (const [name, slot] of Object.entries(EQUIP_SLOT_MAP)) {
    const serialized = data[name];
    // 阶段一：放入外壳物品
    equip.setEquipment(slot, serialized ? deserializeItemStack(serialized) : undefined);
    // 阶段二：填充嵌套容器（如有）
    if (serialized?.container) {
      try {
        const placed = equip.getEquipment(slot);
        if (!placed) continue;
        const invComp = placed.getComponent("minecraft:inventory") as any;
        if (!invComp?.container) continue;
        const inner = invComp.container;
        const len = Math.min(inner.size, serialized.container.length);
        for (let i = 0; i < len; i++) {
          const nd = serialized.container[i];
          inner.setItem(i, nd ? deserializeItemStack(nd) : undefined);
        }
        for (let i = 0; i < len; i++) {
          const nd = serialized.container[i];
          if (nd?.container) fillNestedContainer(inner, i, nd.container);
        }
        equip.setEquipment(slot, placed);
      } catch {}
    }
  }
}

// ─── 物品类型判断 ──────────────────────────────────────────

/** 根据 typeId 判断物品属于哪个装备槽，非装备返回 undefined */
export function getEquipmentSlot(typeId: string): EquipmentSlot | undefined {
  if (typeId === "minecraft:elytra") return EquipmentSlot.Chest;
  if (typeId === "minecraft:carved_pumpkin") return EquipmentSlot.Head;
  if (typeId.includes("skull") || typeId.includes("_head")) return EquipmentSlot.Head;
  if (typeId.endsWith("_helmet")) return EquipmentSlot.Head;
  if (typeId.endsWith("_chestplate")) return EquipmentSlot.Chest;
  if (typeId.endsWith("_leggings")) return EquipmentSlot.Legs;
  if (typeId.endsWith("_boots")) return EquipmentSlot.Feet;
  return undefined;
}

/** 判断是否为可穿戴装备（盔甲/鞘翅/南瓜/头颅等） */
export function isWearableItem(typeId: string): boolean {
  return getEquipmentSlot(typeId) !== undefined;
}
