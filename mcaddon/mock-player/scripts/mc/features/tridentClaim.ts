// ─── 三叉戟认主（mc 层） ───────────────────────────────
// 扫描假人 100 半径内"自家"三叉戟（主人丢的或主人名下假人丢的），
// 按聚集概率降序；批量勾选后认主为第二任（覆盖复写旧第二任）。
// 聚集概率计算在 core/coords/Cluster（纯数学，可单测）。

import { world, EntityProjectileComponent } from "@minecraft/server";
import type { Entity } from "@minecraft/server";

import { botRegistry } from "../bootstrap/context";
import { resolveBotPlayer } from "../adapters/PlayerGateway";
import { formatEnchantments, formatDurability } from "../format";
import { BotEvents } from "../../core/events/DomainEvents";
import {
  makeSecondOwnerTag, parseClaimTags, parseItemTag, isOwnedByFamily, OWNER2_TAG_PREFIX,
} from "../../core/items/TridentClaimRules";
import { sortByClusterProbability } from "../../core/coords/Cluster";
import { enchantDisplayName } from "../../core/format/EnchantZh";
import { levelToRoman } from "../../core/format/Format";
import type { Vec3 } from "../../core/model/Types";

const THROWN_TRIDENT = "minecraft:thrown_trident";
/** 认主扫描半径（方块） */
export const CLAIM_SCAN_RADIUS = 100;
/** 聚集概率的邻居判定半径（方块） */
const CLUSTER_RADIUS = 15;

/** 可认主的三叉戟条目（UI 展示用） */
export interface ClaimableTrident {
  entityId: string;
  pos: Vec3;
  /** 附魔/耐久文本（无附魔时显示"无附魔"） */
  itemLabel: string;
  /** 聚集概率 0-1 */
  probability: number;
}

/**
 * 扫描假人 100 半径内自家三叉戟（当前维度）。
 * - 自家 = 第一/第二任 ∈ 家族集合（主人名 + 主人名下全部假人名）
 * - 读不到物品组件（附魔/耐久）的三叉戟直接跳过
 * @returns undefined = 假人不可用；[] = 无自家三叉戟
 */
export function scanOwnTridents(botName: string): ClaimableTrident[] | undefined {
  const bot = resolveBotPlayer(botName);
  const record = botRegistry.get(botName);
  if (!bot || !record) return undefined;

  // 无主假人没有"自家"体系
  const ownerName = record.ownerName;
  if (!ownerName) return [];

  // 家族集合 = {主人名} ∪ {主人名下全部假人名}
  const family = new Set<string>([ownerName]);
  for (const r of botRegistry.all()) {
    if (r.ownerName === ownerName) family.add(r.name);
  }

  // 球形扫描（bot 为中心，半径 100，仅当前维度）
  let tridents: Entity[] = [];
  try {
    tridents = bot.dimension.getEntities({
      type: THROWN_TRIDENT,
      location: bot.location,
      maxDistance: CLAIM_SCAN_RADIUS,
    });
  } catch {
    return [];
  }

  // 过滤自家（物品组件缺失不跳过：附魔展示降级，认主功能必须可用）
  const entries: { entity: Entity; pos: Vec3 }[] = [];
  for (const t of tridents) {
    try {
      const { firstOwner, secondOwner } = parseClaimTags(t.getTags());
      if (!firstOwner && !secondOwner) continue;
      if (!isOwnedByFamily(firstOwner, secondOwner, family)) continue;
      entries.push({ entity: t, pos: t.location });
    } catch {
      // 单条读取失败跳过
    }
  }
  if (entries.length === 0) return [];

  // 聚集概率（扎堆 → 概率大）→ 降序
  const sorted = sortByClusterProbability(entries.map((e) => e.pos), CLUSTER_RADIUS);
  return sorted.map((s) => {
    const entry = entries[s.index]!;
    return {
      entityId: entry.entity.id,
      pos: s.pos,
      itemLabel: readItemLabel(entry.entity),
      probability: s.probability,
    };
  });
}

/**
 * 读取三叉戟的附魔/耐久展示文本。
 * 数据源优先级：投掷时编码的 mp:item: tag（可靠）→ minecraft:item 组件（仅掉落物实体有）→ 空（省略）。
 */
function readItemLabel(entity: Entity): string {
  // 1) mp:item: tag（投掷流程编码，thrown_trident 可靠数据源）
  for (const tag of entity.getTags()) {
    const info = parseItemTag(tag);
    if (info) {
      const parts: string[] = [];
      if (info.enchantments.length > 0) {
        parts.push(info.enchantments.map((e) => `${enchantDisplayName(e.id)}${levelToRoman(e.level)}`).join(" "));
      }
      if (info.durability) {
        parts.push(`(${info.durability.current}/${info.durability.max})`);
      }
      return parts.join(" ");
    }
  }

  // 2) minecraft:item 组件（兜底：仅当实体带物品组件时可用）
  try {
    const itemComp = entity.getComponent("minecraft:item") as { itemStack?: { typeId: string } } | undefined;
    if (itemComp?.itemStack) {
      return [
        formatEnchantments(itemComp.itemStack as never),
        formatDurability(itemComp.itemStack as never),
      ].filter(Boolean).join(" ");
    }
  } catch {
    // 组件读取失败 → 省略附魔段
  }
  return "";
}

/**
 * 批量认主：将假人写为第二任主人（覆盖复写已有第二任）+ 重设 owner。
 * @returns 成功认主数量
 */
export function claimTridents(botName: string, entityIds: string[]): number {
  const bot = resolveBotPlayer(botName);
  if (!bot) return 0;

  let claimed = 0;
  for (const id of entityIds) {
    try {
      const t = world.getEntity(id);
      if (!t || t.typeId !== THROWN_TRIDENT) continue;

      // 更替事件负载：记录更替前的第二任与第一任
      const { firstOwner, secondOwner: previousSecond } = parseClaimTags(t.getTags());

      // 覆盖复写：先移除已有第二任 tag（mp:owner2:*），再打当前假人
      for (const tag of t.getTags()) {
        if (tag.startsWith(OWNER2_TAG_PREFIX)) t.removeTag(tag);
      }
      t.addTag(makeSecondOwnerTag(botName));

      const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
      if (proj) proj.owner = bot;
      claimed++;
      console.info(`[MockPlayer] 认主 ${botName} → 三叉戟 ${t.id}`);

      // 认主事件 + 主人更替事件（第二任覆盖复写：1任→2任 或 2任→新2任）
      BotEvents.tridentClaimed.trigger({ tridentId: id, claimedBy: botName, via: "ui", firstOwner, secondOwner: botName });
      BotEvents.tridentOwnerChanged.trigger({
        tridentId: id,
        firstOwner,
        previousSecondOwner: previousSecond,
        newSecondOwner: botName,
      });
    } catch {
      // 单条失败不影响批量
    }
  }
  return claimed;
}