// ─── 投掷物认主（mc 层） ───────────────────────────────
// 扫描假人 100 半径内"自家"投掷物（主人丢的或主人名下假人丢的三叉戟/箭），
// 按聚集概率降序；批量勾选后认主为第二任（覆盖复写旧第二任）。
// 聚集概率计算在 core/coords/Cluster（纯数学，可单测）。

import { world, EntityProjectileComponent } from "@minecraft/server";
import type { Entity } from "@minecraft/server";

import { botRegistry } from "../../bootstrap/context";
import { resolveBotPlayer } from "../../adapters/PlayerGateway";
import { formatEnchantments, formatDurability } from "../../format";
import { BotEvents } from "../../../events/DomainEvents";
import { queueClaimReport } from "../manage/claimReporter";
import {
  makeSecondOwnerTag, parseClaimTags, parseItemTag, isOwnedByFamily,
  OWNER2_TAG_PREFIX, TRACKED_PROJECTILE_IDS, isTrackedProjectile, projectileTypeLabel,
} from "../../../items/TridentClaimRules";
import { computeClusterProbabilities, groupPointsByProximity } from "../../../coords/Cluster";
import { enchantDisplayName } from "../../../format/EnchantZh";
import { levelToRoman } from "../../../format/Format";
import type { Vec3 } from "../../../model/Types";

/** 认主扫描半径（方块） */
export const CLAIM_SCAN_RADIUS = 100;
/** 聚集分组半径（方块）：距离 ≤ 3 格（链式连通）的投掷物聚为一组 */
const CLUSTER_RADIUS = 3;

/** 聚集分组前缀：A 类 = 三叉戟，B 类 = 箭 */
const GROUP_PREFIX: Record<string, string> = {
  "minecraft:thrown_trident": "A",
  "minecraft:arrow": "B",
};

/** 可认主的投掷物条目（UI 展示用） */
export interface ClaimableTrident {
  entityId: string;
  typeId: string;
  pos: Vec3;
  /** 展示名：自定义 nameTag/name 优先，否则"三叉戟"/"箭" */
  label: string;
  /** 附魔/耐久文本（无附魔时显示"无附魔"） */
  itemLabel: string;
  /** 组内聚集概率 0-1（组内邻居密度归一化） */
  probability: number;
  /** 当前第二任主人（认主时会覆盖；等于目标假人 = 已认主） */
  currentSecondOwner?: string;
}

/** 聚集分组（认主 UI 展示用）：同类型投掷物按半径 3 链式聚集为一组 */
export interface ClaimGroup {
  /** 组名：A01/A02...（A=三叉戟）B01/B02...（B=箭），按组内数量降序编号 */
  id: string;
  /** 投掷物类型 id */
  typeId: string;
  /** 组内条目（按组内聚集概率降序） */
  entries: ClaimableTrident[];
}

/**
 * 扫描假人 100 半径内自家投掷物（三叉戟/箭，当前维度）并按聚集分组。
 * - 自家 = 第一/第二任 ∈ 家族集合（主人名 + 主人名下全部假人名）
 * - 聚集分组：同类型投掷物按半径 3 格链式连通聚类；组按组内数量降序编号
 *   （A01/A02...=三叉戟组、B01/B02...=箭组）；组内条目按聚集概率降序
 * - 读不到物品组件（附魔/耐久）的投掷物直接跳过
 * @returns undefined = 假人不可用；[] = 无自家投掷物
 */
export function scanOwnTridents(botName: string): ClaimGroup[] | undefined {
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

  // 球形扫描（bot 为中心，半径 100，仅当前维度；三叉戟 + 箭分两次查询合并）
  let projectiles: Entity[] = [];
  try {
    for (const typeId of TRACKED_PROJECTILE_IDS) {
      projectiles.push(...bot.dimension.getEntities({
        type: typeId,
        location: bot.location,
        maxDistance: CLAIM_SCAN_RADIUS,
      }));
    }
  } catch {
    return [];
  }

  // 过滤自家（物品组件缺失不跳过：附魔展示降级，认主功能必须可用）
  const entries: { entity: Entity; pos: Vec3; secondOwner?: string }[] = [];
  for (const t of projectiles) {
    try {
      const { firstOwner, secondOwner } = parseClaimTags(t.getTags());
      if (!firstOwner && !secondOwner) continue;
      if (!isOwnedByFamily(firstOwner, secondOwner, family)) continue;
      entries.push({ entity: t, pos: t.location, secondOwner });
    } catch {
      // 单条读取失败跳过
    }
  }
  if (entries.length === 0) return [];

  // 按类型分组 → 各自按半径 3 链式聚集 → 组按数量降序编号（A 类三叉戟 / B 类箭）
  const groups: ClaimGroup[] = [];
  for (const typeId of TRACKED_PROJECTILE_IDS) {
    const ofType = entries.filter((e) => e.entity.typeId === typeId);
    if (ofType.length === 0) continue;
    const rawGroups = groupPointsByProximity(ofType, CLUSTER_RADIUS)
      .sort((a, b) => b.length - a.length); // 组内数量降序（稳定排序）
    rawGroups.forEach((g, idx) => {
      groups.push({
        id: `${GROUP_PREFIX[typeId] ?? "C"}${String(idx + 1).padStart(2, "0")}`,
        typeId,
        entries: buildGroupEntries(g),
      });
    });
  }
  return groups;
}

/** 组装组内条目：组内聚集概率（邻居密度归一化）→ 降序 */
function buildGroupEntries(group: { entity: Entity; pos: Vec3; secondOwner?: string }[]): ClaimableTrident[] {
  const probs = computeClusterProbabilities(group.map((e) => e.pos), CLUSTER_RADIUS);
  return group
    .map((entry, i) => ({
      entry,
      probability: probs[i] ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability)
    .map(({ entry, probability }) => ({
      entityId: entry.entity.id,
      typeId: entry.entity.typeId,
      pos: entry.pos,
      label: readProjectileLabel(entry.entity),
      itemLabel: readItemLabel(entry.entity),
      probability,
      currentSecondOwner: entry.secondOwner,
    }));
}

/**
 * 读取投掷物展示名：自定义 nameTag 优先 → name → 类型中文名兜底。
 * 玩家可用命令给投掷物命名（/summon 带 nameTag），认主时展示便于区分。
 */
function readProjectileLabel(entity: Entity): string {
  const nameTag = (entity as { nameTag?: string }).nameTag?.trim();
  if (nameTag) return nameTag;
  const name = (entity as { name?: string }).name?.trim();
  if (name && name !== entity.typeId) return name;
  return projectileTypeLabel(entity.typeId);
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
 * @param operatorName 操作者玩家名（UI 已直接反馈操作者，汇报排除防重复）
 * @returns 成功认主数量
 */
export function claimTridents(botName: string, entityIds: string[], operatorName?: string): number {
  const bot = resolveBotPlayer(botName);
  if (!bot) return 0;

  // 汇报对象预取：认主假人的主人（第三方管理员操作时也告知主人）
  const botOwner = botRegistry.get(botName)?.ownerName ?? "";

  let claimed = 0;
  for (const id of entityIds) {
    try {
      const t = world.getEntity(id);
      if (!t || !isTrackedProjectile(t.typeId)) continue;

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
      console.info(`[MockPlayer] 认主 ${botName} → 投掷物 ${t.id}`);

      // 认主事件 + 主人更替事件（第二任覆盖复写：1任→2任 或 2任→新2任）
      BotEvents.tridentClaimed.trigger({ tridentId: id, claimedBy: botName, via: "ui", firstOwner, secondOwner: botName });
      BotEvents.tridentOwnerChanged.trigger({
        tridentId: id,
        firstOwner,
        previousSecondOwner: previousSecond,
        newSecondOwner: botName,
      });

      // 认主汇报（集中聚合；操作者已有 UI 直接消息，排除防重复）：
      // - 认主假人的主人：认领明细
      // - 旧第二任假人的主人：名下假人被顶替（victim）
      // - 第一任是玩家且不是认主假人的主人（被假人认走）：玩家视角"被认领"
      // ⚠️ firstOwner === botOwner（主人自己投掷的）时只发主人一路，避免重复计数
      if (botOwner && botOwner !== operatorName) {
        queueClaimReport({ to: botOwner, bot: botName, kind: "claimed", typeId: t.typeId });
      }
      const prevRecord = previousSecond ? botRegistry.get(previousSecond) : undefined;
      if (prevRecord?.ownerName && prevRecord.ownerName !== operatorName) {
        queueClaimReport({ to: prevRecord.ownerName, bot: botName, kind: "covered", typeId: t.typeId, victim: previousSecond });
      }
      if (firstOwner && !botRegistry.get(firstOwner) && firstOwner !== operatorName && firstOwner !== botOwner) {
        queueClaimReport({ to: firstOwner, bot: botName, kind: "covered", typeId: t.typeId });
      }
    } catch {
      // 单条失败不影响批量
    }
  }
  return claimed;
}