// ─── 物品序列化编解码（mc 层） ──────────────────────────
// ItemStack ↔ SerializedItemStack 双向转换 + 容器/装备收集 + 状态/经验捕获。
// 全部强绑定 ItemStack/Container 组件，core 层不涉及（仅使用 core 的类型与经验公式）。
//
// ⚠️ 存储链路已迁移到 NBT 木桶阵列（McBotStore）：保存/恢复直接搬运**真实
// ItemStack**（完整 NBT，潜影盒等嵌套容器内容随物品原样保留），不再经 JSON
// 序列化。本文件的 serialize* 仅保留给 UI/回收**预览**用途；
// collectContainerItems / collectEquipment 供全量保存直取真实物品。

import {
  Player,
  Vector3,
  Vector2,
  Container,
  ItemStack,
  ItemEnchantableComponent,
  EntityEquippableComponent,
} from "@minecraft/server";
import type { PositionState, ExperienceRecord, SerializedEffect, SerializedItemStack, ItemPreview } from "../../../rules/Types";
import { buildExperienceRecord } from "../../../rules/xp/XpMath";
import { EQUIP_SLOT_MAP } from "./EquipmentSlots";

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

// ─── 经验捕获 ──────────────────────────────────────────

/** 从 Player 捕获当前经验值到 ExperienceRecord */
export function captureExperience(player: Player): ExperienceRecord {
  return buildExperienceRecord(player.level, player.xpEarnedAtCurrentLevel);
}

// ─── 效果捕获（buff 持久化） ──────────────────────────

/** 流程性效果（由劫掠等业务自行管理，不持久化——避免恢复时干扰检测链） */
const EXCLUDED_EFFECTS = new Set(["minecraft:village_hero", "minecraft:bad_omen", "minecraft:raid_omen"]);

/**
 * 捕获玩家当前效果（排除流程性效果）。
 * 返回 undefined = 无可持久化效果（调用方保持 record.effects 原值或置空）。
 */
export function captureEffects(player: Player): SerializedEffect[] | undefined {
  try {
    const comp = player.getComponent("minecraft:effects") as any;
    const list: { typeId?: string; duration?: number; amplifier?: number }[] = comp?.getEffects?.() ?? [];
    const result: SerializedEffect[] = [];
    for (const e of list) {
      const id = e.typeId ?? "";
      if (!id || EXCLUDED_EFFECTS.has(id)) continue;
      result.push({ id, duration: e.duration ?? 0, amplifier: e.amplifier ?? 0 });
    }
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

// ─── 真实物品收集（NBT 存储全量保存用） ────────────────

/** 容器 → 真实 ItemStack 数组（索引 = 槽位；空位 null） */
export function collectContainerItems(container: Container): (ItemStack | null)[] {
  const result: (ItemStack | null)[] = [];
  for (let i = 0; i < container.size; i++) {
    result.push(container.getItem(i) ?? null);
  }
  return result;
}

/** 装备组件 → 真实 ItemStack 记录（{ head?, chest?, legs?, feet?, offhand? }；空槽 null） */
export function collectEquipment(equip: EntityEquippableComponent): Record<string, ItemStack | null> {
  const result: Record<string, ItemStack | null> = {};
  for (const [name, slot] of Object.entries(EQUIP_SLOT_MAP)) {
    result[name] = equip.getEquipment(slot) ?? null;
  }
  return result;
}

// ─── 物品序列化（仅预览用途） ──────────────────────────

/**
 * 序列化单个 ItemStack → SerializedItemStack（预览/展示用）。
 * ⚠️ 嵌套容器（潜影盒/收纳袋）内容无法经此保留（原版物品的
 * `minecraft:inventory` 组件运行时不可访问）——存储链路请走 NBT 后端。
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

  return data;
}

// ─── 物品预览 ──────────────────────────────────────────

/**
 * 从 ItemStack 提取 ItemPreview（在线假人分支用）
 */
export function itemStackToPreview(item: ItemStack): ItemPreview {
  const ench: { id: string; level: number }[] = [];
  if (item.hasComponent("minecraft:enchantable")) {
    try {
      const ec = item.getComponent("minecraft:enchantable") as any;
      for (const e of ec.getEnchantments()) {
        ench.push({ id: e.type.id, level: e.level });
      }
    } catch { /* ignore */ }
  }
  let damage: number | undefined;
  let maxDurability: number | undefined;
  const dur = item.getComponent("minecraft:durability") as any;
  if (dur) {
    damage = dur.damage ?? 0;
    maxDurability = dur.maxDurability ?? 0;
  }
  return {
    typeId: item.typeId,
    amount: item.amount,
    nameTag: item.nameTag || undefined,
    damage,
    maxDurability,
    enchantments: ench,
  };
}
