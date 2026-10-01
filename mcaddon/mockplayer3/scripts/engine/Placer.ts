// ─── 放置原子（"主手方块放于面前"的发起与回读） ──────────────────────
// 双通道，按支撑面是否可交互分流：
// 常规通道 startBuild/stopBuild——引擎按放置规则落块并自动扣 1，目标被占/主手不足一律放不下，
//   不会顶掉既有方块，也不会凭空产方块（这是引擎放置的天然保证，优先走它）。
// 特殊通道 setBlockType——支撑面是 GUI/开关类方块（箱/熔炉/门/按钮/拉杆…）时，startBuild 会被
//   方块自身交互吃掉（开界面/开关门）而不贴块；SimulatedPlayer 的界面开启又不受
//   playerInteractWithBlock.cancel 与 isSneaking 约束，故这类支撑改向"相邻空格"直写主手方块。
//   直写只落 isAir 的目标格，目标非空即判无变化——绝不覆盖既有方块；成功后手动扣 1 主手。
// 回读：常规通道用射线差分（命中格由支撑格变他格＝放置成立）；特殊通道以目标格 typeId 相符为准。
// 主手非方块/命中面非法一律不发起（判无变化或无目标），避免逐拍空放。

import type { Vec3 } from "../domain/Coords";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";
import type { BlockRaycastHit, ItemStack } from "@minecraft/server";
import { Direction, EquipmentSlot } from "@minecraft/server";
import { isClickGuardBlockedBlock } from "../domain/ClickGuard";
import { blockFloor, botOf, botValid, inventoryContainer, rayHit } from "./Atomic";

/** 放置结果（switch 完备可查） */
export type PlaceResult = "placed" | "unchanged" | "no-target" | "offline";

/** 主手持物类型判定（能力启动前置；offline=实体/主手组件暂不可读的瞬态，按重试处理） */
export type MainhandKind = "block" | "not-block" | "empty" | "offline";

/** 回读射线距离（与破坏默认一致——准星 6 格内才谈"面前"） */
const DEFAULT_MAX_DISTANCE = 6;

/** 主手是否为可放置方块：item typeId 与方块 id 同名即视为方块候选 */
const BLOCK_TYPE_IDS: ReadonlySet<string> = new Set<string>(Object.values(MinecraftBlockTypes) as string[]);

/**
 * 同名但拒启的特殊件：门的物品 id 与方块 id 同名，落 BLOCK_TYPE_IDS 会被误判为方块，
 * 故在同名集之外单列拒启清单——door/trapdoor/button 按后缀覆盖全系材质，bed 与 lever 为同名特例。
 */
const NON_PLACEABLE_SUFFIXES: readonly string[] = ["_door", "_trapdoor", "_button"];
const NON_PLACEABLE_EXACT: ReadonlySet<string> = new Set<string>(["minecraft:bed", "minecraft:lever"]);

/**
 * 命中面 → 相邻格偏移（North=-z/South=+z/East=+x/West=-x/Up=+y/Down=-y，Bedrock 方位口径）；
 * 特殊通道据此定位支撑面外侧的目标格。
 */
const FACE_NORMALS: Partial<Record<Direction, Vec3>> = {
  [Direction.Up]: { x: 0, y: 1, z: 0 },
  [Direction.Down]: { x: 0, y: -1, z: 0 },
  [Direction.North]: { x: 0, y: 0, z: -1 },
  [Direction.South]: { x: 0, y: 0, z: 1 },
  [Direction.East]: { x: 1, y: 0, z: 0 },
  [Direction.West]: { x: -1, y: 0, z: 0 },
};

/**
 * 右键会被方块自身吃掉（开界面/开关门/按按钮/拨拉杆）而非贴块放置的支撑——特殊通道的适用面：
 * GUI/容器类沿用误点拦截名单判定，门/活板门/按钮按后缀覆盖全系材质，拉杆为特例。
 */
const INTERACTIVE_SUFFIXES: readonly string[] = ["_door", "_trapdoor", "_button"];
const INTERACTIVE_EXACT: ReadonlySet<string> = new Set<string>(["minecraft:lever"]);

function isInteractableSupport(typeId: string): boolean {
  return (
    isClickGuardBlockedBlock(typeId) ||
    INTERACTIVE_EXACT.has(typeId) ||
    INTERACTIVE_SUFFIXES.some((s) => typeId.endsWith(s))
  );
}

function isNonPlaceableSpecial(typeId: string): boolean {
  return NON_PLACEABLE_EXACT.has(typeId) || NON_PLACEABLE_SUFFIXES.some((s) => typeId.endsWith(s));
}

export class Placer {
  /** 主手手持物的放置学分类（能力启动前置读；组件暂不可读按 offline 瞬态重试） */
  mainhandKind(botId: number): MainhandKind {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const held = mainhandItem(bot);
    if (held === undefined) return "offline";
    if (!held) return "empty";
    if (isNonPlaceableSpecial(held.typeId)) return "not-block";
    return BLOCK_TYPE_IDS.has(held.typeId) ? "block" : "not-block";
  }

  /** 面前放置一次；瞄准归调用方，发起前视线应已指向支撑面 */
  placeInFront(botId: number, maxDistance: number = DEFAULT_MAX_DISTANCE): PlaceResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    let hit: BlockRaycastHit | undefined;
    try {
      hit = bot.getBlockFromViewDirection({ maxDistance });
    } catch {
      return "no-target";
    }
    if (!hit) return "no-target";
    const held = mainhandItem(bot);
    if (!held || isNonPlaceableSpecial(held.typeId) || !BLOCK_TYPE_IDS.has(held.typeId)) return "unchanged";
    try {
      bot.stopBreakingBlock();
    } catch {
      /* 无挖掘态时打断可能抛，忽略继续放置 */
    }
    // 可交互支撑走特殊通道：向相邻空格直写，绕开"使用方块=开界面/开关"
    if (isInteractableSupport(hit.block.typeId)) {
      const normal = FACE_NORMALS[hit.face];
      if (!normal) return "no-target"; // 命中面非法（引擎异常方位）——无法定位相邻格
      const support = hit.block.location;
      const target: Vec3 = {
        x: Math.floor(support.x) + normal.x,
        y: Math.floor(support.y) + normal.y,
        z: Math.floor(support.z) + normal.z,
      };
      return placeAgainstInteractable(bot, target, held);
    }
    // 常规支撑交引擎按规则放置（自动扣料、放不下即无变化），射线差分回读判定
    return placeByBuild(bot, hit, maxDistance);
  }
}

/** 常规通道：startBuild 起手即停一拍落一块，射线差分回读；引擎负责放置校验与扣料 */
function placeByBuild(
  bot: NonNullable<ReturnType<typeof botOf>>,
  hit: BlockRaycastHit,
  maxDistance: number
): PlaceResult {
  const before = blockFloor(hit.block.location);
  try {
    bot.startBuild(bot.selectedSlotIndex);
    bot.stopBuild();
  } catch {
    return "unchanged"; // 发起未落地，按无变化处理
  }
  const after = rayHit(bot, maxDistance);
  if (!after) return "unchanged"; // 支撑面确在（hit 已判），回读瞬态按无变化处理
  return sameCell(after.location, before) ? "unchanged" : "placed";
}

/** 特殊通道：仅向 isAir 的目标格直写主手方块并手动扣 1，目标非空即绝不覆盖既有方块 */
function placeAgainstInteractable(
  bot: NonNullable<ReturnType<typeof botOf>>,
  target: Vec3,
  held: ItemStack
): PlaceResult {
  try {
    const dim = bot.dimension;
    const cur = dim.getBlock(target);
    if (!cur || !cur.isAir) return "unchanged"; // 目标非空格不覆盖
    dim.setBlockType(target, held.typeId);
    const placed = dim.getBlock(target);
    if (!placed || placed.typeId !== held.typeId) return "unchanged";
  } catch {
    return "offline"; // 维度/区块瞬态不可读写
  }
  consumeMainhand(bot, held);
  return "placed";
}

/** 主手物品读句柄；equippable 组件暂不可读返回 undefined（瞬态），空手返回 null */
function mainhandItem(bot: ReturnType<typeof botOf>): ItemStack | null | undefined {
  if (!bot) return undefined;
  try {
    const eq = bot.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    return eq ?? null;
  } catch {
    return undefined;
  }
}

/** 放置成功后扣 1 主手；不足额/组件瞬态静默跳过（宁可不扣，不凭空吞方块） */
function consumeMainhand(bot: NonNullable<ReturnType<typeof botOf>>, held: ItemStack): void {
  const inv = inventoryContainer(bot);
  if (!inv) return;
  try {
    const idx = bot.selectedSlotIndex;
    const cur = inv.getItem(idx);
    if (!cur || cur.typeId !== held.typeId) return;
    if (cur.amount <= 1) inv.setItem(idx, undefined);
    else {
      cur.amount -= 1;
      inv.setItem(idx, cur);
    }
  } catch {
    /* 背包瞬态：本次不扣，下拍照放 */
  }
}

function sameCell(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** 进程级单例 */
export const placer = new Placer();
