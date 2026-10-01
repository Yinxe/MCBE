// ─── 实体生命周期原子（生命期操作；运动/交互原子另册） ──────────────
// 应用层经本文件触碰实体：全部方法以 botId 寻址，句柄由 EntityGateway
// 独享解析，跨层不传 @minecraft 对象；写后回读校验内建。
// 物品导出/导入：仓↔实体逐格真实 ItemStack + 指纹回读对账。

import { ItemStack, world } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import { horizontalDistance } from "../domain/Coords";
import { LEGACY_TAG_PREFIX } from "../domain/Migrate";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE, BOT_MARKER_TAG } from "../domain/Record";
import type { EquipSlotName, ExperienceRecord, SerializedEffect } from "../domain/Record";
import type { SlotDigest } from "../domain/Fingerprint";
import type { InventorySlotProbe } from "../domain/WorkChest";
import type { NotifyLevel, NotifySetting } from "../domain/NotifyRules";
import { lootFingerprint, mismatchedSlots } from "../domain/Fingerprint";
import { permitVaultRead, permitVaultTrust } from "../domain/SavePolicy";
import { totalXpForLevel } from "../domain/XpMath";
import { asSimulated } from "./Compat";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { entityGateway } from "./EntityGateway";
import { itemEnchantments } from "./Atomic";
import { ItemVault } from "./ItemVault";
import { getNotifySetting, sendNotify, setNotifySetting as persistNotifySetting } from "./NotifyStore";
import type { NotifyDelivery } from "./NotifyStore";
import { EQUIP_SLOT_MAP } from "./EquipSlots";

/** 流程性效果不持久化：恢复时干扰劫掠检测链 */
const EXCLUDED_EFFECTS: ReadonlySet<string> = new Set([
  "minecraft:village_hero",
  "minecraft:bad_omen",
  "minecraft:raid_omen",
]);

/** 装备槽指纹 typeId|amount|damage|nameTag——耐久损耗必须触发写仓 */
function equipFingerprint(item: ItemStack | null): string {
  if (!item) return "-";
  let damage = 0;
  try {
    const dur = item.getComponent("minecraft:damageable") as { damage?: number } | undefined;
    damage = dur?.damage ?? 0;
  } catch {
    /* 组件不可读按无耐久 */
  }
  let nameTag = "";
  try {
    nameTag = item.nameTag ?? "";
  } catch {
    /* nameTag 瞬态不可读按无 */
  }
  return `${item.typeId}|${item.amount}|${damage}|${nameTag}`;
}

/** 实体当下姿态/状态快照（应用层落记录用——纯数据） */
export interface PoseSnapshot {
  position: Vector3;
  dimensionId: string;
  yaw: number;
  pitch: number;
  sneaking: boolean;
}

export type OpResult = { ok: true } | { ok: false; reason: string };

/** 物品导入结果（指纹不符→重试一轮→仍不符则中止上线） */
export type ImportResult = { ok: true } | { ok: false; reason: string };

/** 滞留导出快照（仓区块未就绪时的内存保物袋） */
interface PendingExport {
  inv: (ItemStack | null)[];
  equip: (ItemStack | null)[];
  items: number;
}

/** 回收计数（命令播报消费，纯数据上达） */
export interface ReclaimCounts {
  items: number;
  overflow: number;
  xp: number;
  xpLevel: number;
}

/**
 * 回收子集选择（九开关互不重叠：经验/热栏(0-8 除主手格)/背包(9-35)/主手(选中格)
 * + 副手与四甲位）。主手=在线选中格、离线 slot0 约定（与预览同口径）。
 */
export interface ReclaimSelection {
  xp: boolean;
  hotbar: boolean;
  inventory: boolean;
  mainhand: boolean;
  offhand: boolean;
  head: boolean;
  chest: boolean;
  legs: boolean;
  feet: boolean;
}

/** 全量回收（/mp:reclaim 命令与删除路径缺省） */
export const FULL_RECLAIM: ReclaimSelection = {
  xp: true,
  hotbar: true,
  inventory: true,
  mainhand: true,
  offhand: true,
  head: true,
  chest: true,
  legs: true,
  feet: true,
};

/** 热栏格数（0-8；主手选中格从热栏开关中摘出） */
const HOTBAR_SIZE = 9;

/** 36 格归属判定：选中格=主手，其余 0-8=热栏，9-35=背包（三开关互不重叠） */
function slotWanted(sel: ReclaimSelection, slot: number, handSlot: number): boolean {
  if (slot === handSlot) return sel.mainhand;
  if (slot < HOTBAR_SIZE) return sel.hotbar;
  return sel.inventory;
}

function digestOf(item: ItemStack | null | undefined): SlotDigest | null {
  return item ? { typeId: item.typeId, amount: item.amount } : null;
}

/** 真实物品件数（占位/空位不计——滞留导出只在确有物品时才建立） */
function countItems(items: (ItemStack | null)[]): number {
  let n = 0;
  for (const it of items) if (it) n++;
  return n;
}

export class EntityOps {
  /** 装备槽指纹基线（实时保存时据此去重，会话结束即清） */
  private readonly equipBaselines = new Map<string, string>();
  /** 仓不可写时的滞留导出（内存保物，仓可读后由 Scheduler 补写） */
  private readonly pendingExports = new Map<number, PendingExport>();

  constructor(private readonly vault: ItemVault) {}

  // ─── 解析与存在性 ──

  /** botId 实体当下是否可达（会话对账用） */
  isPresent(botId: number, knownEntityId?: string): boolean {
    return this.entity(botId, knownEntityId) !== null;
  }

  /** 死亡窗口内的实体回取（F-04：回调后短期仍可读；句柄仍归网关） */
  private entity(botId: number, knownEntityId?: string): SimulatedPlayer | null {
    return entityGateway.resolveBot(botId, knownEntityId);
  }

  // ─── 姿态/外观原子 ──

  /** 传送 + 身体朝向（F-01：朝向经 teleport rotation 设置，绝不用持续注视）；写后回读校验 */
  teleportTo(
    botId: number,
    position: Vector3,
    dimensionId: string,
    yaw: number,
    pitch: number,
    knownEntityId?: string
  ): OpResult {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return { ok: false, reason: "实体不可达" };
    let dim;
    try {
      dim = world.getDimension(dimensionId);
    } catch {
      return { ok: false, reason: `维度无效 ${dimensionId}` };
    }
    try {
      bot.teleport(position, { dimension: dim, rotation: { x: pitch, y: yaw } });
    } catch (e: any) {
      return { ok: false, reason: `传送失败: ${e?.message ?? e}` };
    }
    // 跨维度传送当 tick 可能未就位：回读不符按失败处理，管线自决重试
    const loc = this.readPose(botId, knownEntityId);
    if (!loc) return { ok: false, reason: "传送后实体失效" };
    if (
      loc.dimensionId !== dimensionId ||
      Math.abs(loc.position.x - position.x) > 1 ||
      Math.abs(loc.position.y - position.y) > 1 ||
      Math.abs(loc.position.z - position.z) > 1
    ) {
      return { ok: false, reason: "传送回读不符" };
    }
    return { ok: true };
  }

  /** 读实体当下姿态（记录 home 冲刷用） */
  readPose(botId: number, knownEntityId?: string): PoseSnapshot | null {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return null;
    try {
      const rot = bot.getRotation();
      return {
        position: { x: bot.location.x, y: bot.location.y, z: bot.location.z },
        dimensionId: bot.dimension.id,
        yaw: rot.y,
        pitch: rot.x,
        sneaking: bot.isSneaking,
      };
    } catch {
      return null;
    }
  }

  /**
   * 重放标签（F-07：记录是标签真源，实体只是副本）。
   * 先清 `mockplayer:tag:` 旧前缀残留（同名实体 NBT 携带旧标签）与当前前缀
   * 中不在目标集的陈旧项，再全量补加——只增不删清不掉脏副本。
   */
  applyTags(botId: number, tags: string[]): void {
    const bot = this.entity(botId);
    if (!bot) return;
    try {
      const want = new Set([BOT_MARKER_TAG, ...tags]);
      for (const t of bot.getTags()) {
        if (t.startsWith(LEGACY_TAG_PREFIX) || (t.startsWith("mockplayer3:") && !want.has(t))) {
          try {
            bot.removeTag(t);
          } catch {
            /* 单标签失败不中断 */
          }
        }
      }
      const have = new Set(bot.getTags());
      for (const t of [BOT_MARKER_TAG, ...tags]) {
        if (!have.has(t)) {
          try {
            bot.addTag(t);
          } catch {
            /* 单标签失败不中断 */
          }
        }
      }
    } catch {
      /* 实体瞬态失效 */
    }
  }

  /** 潜行开关应用 */
  setSneaking(botId: number, value: boolean): void {
    const bot = this.entity(botId);
    if (!bot) return;
    try {
      bot.isSneaking = value;
    } catch {
      /* 瞬态失效 */
    }
  }

  /** 重生点双写（F-08：记录 + 实体 setSpawnPoint，死亡原地复活语义） */
  setSpawnPoint(botId: number, position: Vector3, dimensionId: string): void {
    const bot = this.entity(botId);
    if (!bot) return;
    try {
      bot.setSpawnPoint({ x: position.x, y: position.y, z: position.z, dimension: world.getDimension(dimensionId) });
    } catch {
      // API 缺失/维度未加载：记录侧仍有真源，吞异常
    }
  }

  // ─── 经验/效果原子 ──

  /** 捕获经验快照（level+当下等级内进度 → totalXp 由 domain XpMath 推得） */
  captureExperience(botId: number, knownEntityId?: string): ExperienceRecord | null {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return null;
    try {
      const level = bot.level;
      const progress = bot.xpEarnedAtCurrentLevel;
      return { level, progress, totalXp: totalXpForLevel(level) + progress };
    } catch {
      return null;
    }
  }

  /** 恢复经验：按存档 totalXp 补差额，只增不减（防异常数据倒扣） */
  restoreExperience(botId: number, exp: ExperienceRecord): void {
    const bot = this.entity(botId);
    if (!bot || exp.totalXp <= 0) return;
    try {
      const current = totalXpForLevel(bot.level) + bot.xpEarnedAtCurrentLevel;
      const delta = exp.totalXp - current;
      if (delta > 0) bot.addExperience(delta);
    } catch {
      /* 经验恢复失败不阻塞上线 */
    }
  }

  /** 捕获效果快照（排除流程性效果） */
  captureEffects(botId: number, knownEntityId?: string): SerializedEffect[] {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return [];
    const out: SerializedEffect[] = [];
    try {
      for (const e of bot.getEffects()) {
        if (!e.typeId || EXCLUDED_EFFECTS.has(e.typeId)) continue;
        out.push({ id: e.typeId, durationTicks: e.duration, amplifier: e.amplifier });
      }
    } catch {
      /* 瞬态失效：按无效果处理 */
    }
    return out;
  }

  /** 恢复效果（离线期间效果暂停，按最后保存时长重施；单条失败跳过） */
  applyEffects(botId: number, effects: SerializedEffect[]): void {
    const bot = this.entity(botId);
    if (!bot) return;
    for (const e of effects) {
      try {
        bot.addEffect(e.id, e.durationTicks, { amplifier: e.amplifier });
      } catch {
        /* 坏数据跳过 */
      }
    }
  }

  // ─── 物品仓 ↔ 实体 ──

  /**
   * 导出（实体→仓）：背包 36 + 装备 5 全量对账写，只序列化实体当下持有物。
   * 仓区块未加载时不丢物：实体态快照滞留内存，由 Scheduler 补写。
   */
  exportItems(botId: number, knownEntityId?: string): OpResult {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return { ok: false, reason: "实体不可达，无法导出物品" };
    const inv: (ItemStack | null)[] = [];
    const container = bot.getComponent("minecraft:inventory")?.container;
    if (container) {
      for (let i = 0; i < INVENTORY_SIZE; i++) inv.push(container.getItem(i) ?? null);
    }
    const equip: (ItemStack | null)[] = [];
    const equipComp = bot.getComponent("minecraft:equippable");
    if (equipComp) {
      for (const name of EQUIP_SLOT_NAMES) equip.push(equipComp.getEquipment(EQUIP_SLOT_MAP[name]) ?? null);
      EQUIP_SLOT_NAMES.forEach((name, i) =>
        this.equipBaselines.set(`${botId}:${name}`, equipFingerprint(equip[i] ?? null))
      );
    }
    const items = countItems(inv) + countItems(equip);
    if (!this.vault.regionReady(this.vault.getBinding(botId)?.regionId)) {
      if (items > 0) this.pendingExports.set(botId, { inv, equip, items });
      else this.pendingExports.delete(botId);
      console.warn(`[mockplayer3] 导出暂存 bot=${botId}：物品仓区块未加载（${items} 件待补写）`);
      return { ok: false, reason: `物品仓区块未加载，${items} 件已暂存内存待补写` };
    }
    if (container) this.vault.saveInventory(botId, inv);
    if (equipComp) this.vault.saveEquipment(botId, equip);
    this.pendingExports.delete(botId);
    return { ok: true };
  }

  /**
   * 补写滞留导出（Scheduler 周期调用；F-18：调用方单拍限制处理条数）。
   * @returns 本轮成功落仓的条数
   */
  drainPendingExports(): number {
    if (this.pendingExports.size === 0) return 0;
    let done = 0;
    for (const [botId, snap] of [...this.pendingExports]) {
      if (!this.vault.regionReady(this.vault.getBinding(botId)?.regionId)) continue;
      this.vault.saveInventory(botId, snap.inv);
      this.vault.saveEquipment(botId, snap.equip);
      this.pendingExports.delete(botId);
      done++;
      console.warn(`[mockplayer3] 滞留物品已补写仓 bot=${botId}（${snap.items} 件）`);
    }
    return done;
  }

  /** 滞留导出条数（巡检/面板诊断） */
  pendingExportCount(): number {
    return this.pendingExports.size;
  }

  /**
   * 冲写某假人的滞留导出（上线/回收/删除前置）。
   * @returns ok=无滞留或已落仓；false=区块仍不可读（调用方须改期，绝不带旧仓态继续）
   */
  flushPendingExport(botId: number): OpResult {
    const snap = this.pendingExports.get(botId);
    if (!snap) return { ok: true };
    if (!this.vault.regionReady(this.vault.getBinding(botId)?.regionId))
      return { ok: false, reason: `物品仓区块未加载，${snap.items} 件暂存物品尚未落仓` };
    this.vault.saveInventory(botId, snap.inv);
    this.vault.saveEquipment(botId, snap.equip);
    this.pendingExports.delete(botId);
    console.warn(`[mockplayer3] 滞留物品已补写仓 bot=${botId}（${snap.items} 件）`);
    return { ok: true };
  }

  /**
   * 导入（仓→实体）+ 回读对账：写实体 → 指纹比对 → 不符重写一轮 → 仍不符返回失败。
   * 读不到≠没有：绑定表有槽位却整批读空＝阵列区块未加载，此时硬失败（上线中止可重试），
   * 绝不让假人空背包上线再反向覆盖仓。
   */
  importItems(botId: number): ImportResult {
    const flush = this.flushPendingExport(botId);
    if (!flush.ok) return { ok: false, reason: flush.reason };
    const verdict = permitVaultRead(
      this.vault.hasStoredSlots(botId),
      this.vault.regionReady(this.vault.getBinding(botId)?.regionId)
    );
    if (!verdict.allow) return { ok: false, reason: "物品仓区块未加载（世界尚未就绪），请稍后再上线" };
    const savedInv = this.vault.readInventory(botId);
    const savedEquip = this.vault.readEquipment(botId);
    if (!savedInv && !savedEquip) return { ok: true }; // 无仓数据（新假人）
    const bot = this.entity(botId);
    if (!bot) return { ok: false, reason: "实体不可达，无法导入物品" };
    const container = bot.getComponent("minecraft:inventory")?.container;
    const equipComp = bot.getComponent("minecraft:equippable");
    if (savedInv && !container) return { ok: false, reason: "背包组件不可用" };
    if (savedEquip && !equipComp) return { ok: false, reason: "装备组件不可用" };

    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      problems = [];
      if (savedInv && container) {
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          try {
            container.setItem(i, savedInv[i] ?? undefined);
          } catch {
            problems.push(`inv#${i}`);
          }
        }
        const expected = savedInv.map(digestOf);
        const actual: (SlotDigest | null)[] = [];
        for (let i = 0; i < INVENTORY_SIZE; i++) actual.push(digestOf(container.getItem(i)));
        for (const n of mismatchedSlots(expected, actual)) problems.push(`inv#${n}`);
      }
      if (savedEquip && equipComp) {
        for (const name of EQUIP_SLOT_NAMES) {
          const item = savedEquip[name];
          if (!item) continue;
          try {
            equipComp.setEquipment(EQUIP_SLOT_MAP[name], item);
          } catch {
            problems.push(`equip:${name}`);
            continue;
          }
          const back = equipComp.getEquipment(EQUIP_SLOT_MAP[name]);
          if (!back || back.typeId !== item.typeId || back.amount !== item.amount) problems.push(`equip:${name}`);
        }
      }
      if (problems.length === 0) {
        // 导入完成=实体与仓一致：装备指纹以仓态播种（防首轮复查把存量当变化重播）
        for (const name of EQUIP_SLOT_NAMES)
          this.equipBaselines.set(`${botId}:${name}`, equipFingerprint(savedEquip?.[name] ?? null));
        return { ok: true };
      }
    }
    return {
      ok: false,
      reason: `物品仓校验失败（${problems.slice(0, 4).join(",")}${problems.length > 4 ? "…" : ""}）`,
    };
  }

  /**
   * 单格直写仓（世界库存事件驱动；崩溃/强退不丢上次 checkpoint 后的物品变更）。
   * 恢复期守卫在装配根。
   */
  saveInventorySlotNow(botId: number, slot: number): void {
    if (slot < 0 || slot >= INVENTORY_SIZE) return;
    // 仓区块未就绪：单格直写必然静默失败——转全量导出滞留内存由 Scheduler 补写
    if (!this.vault.regionReady(this.vault.getBinding(botId)?.regionId)) {
      this.exportItems(botId);
      return;
    }
    const container = this.entity(botId)?.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    let item: ItemStack | null = null;
    try {
      item = container.getItem(slot) ?? null;
    } catch {
      return; // 槽位瞬态不可读：本次放弃（下一事件或 checkpoint 兜底）
    }
    this.vault.saveSlots(botId, [{ slot, item }]);
  }

  /**
   * 装备复查保存（逐槽指纹比对、无变化零写入）。
   * entityHurt 触发：掉血未判死也算——护甲吸收同样耗耐久。
   */
  syncEquipmentDedup(botId: number): void {
    const equipComp = this.entity(botId)?.getComponent("minecraft:equippable");
    if (!equipComp) return;
    // 同 saveInventorySlotNow：区块未就绪时逐槽写必失败，转全量导出滞留补写
    if (!this.vault.regionReady(this.vault.getBinding(botId)?.regionId)) {
      this.exportItems(botId);
      return;
    }
    const writes: { slot: EquipSlotName; item: ItemStack | null }[] = [];
    for (const name of EQUIP_SLOT_NAMES) {
      let item: ItemStack | null = null;
      try {
        item = equipComp.getEquipment(EQUIP_SLOT_MAP[name]) ?? null;
      } catch {
        continue; // 槽不可读按无变化（checkpoint 全量兜底）
      }
      const fp = equipFingerprint(item);
      const key = `${botId}:${name}`;
      if (this.equipBaselines.get(key) === fp) continue;
      this.equipBaselines.set(key, fp);
      writes.push({ slot: name, item });
    }
    if (writes.length > 0) this.vault.saveEquipSlots(botId, writes);
  }

  /** 会话销毁时清除装备指纹基线（重生后不残留旧基线） */
  forgetEquipBaselines(botId: number): void {
    for (const key of [...this.equipBaselines.keys()]) {
      if (key.startsWith(`${botId}:`)) this.equipBaselines.delete(key);
    }
  }

  // ─── 生命周期动作 ──

  /** 击杀（/mp:kill 与真死亡共用死亡管线，仅触发方不同） */
  kill(botId: number): OpResult {
    const bot = this.entity(botId);
    if (!bot) return { ok: false, reason: "无法在世界中找到该模拟玩家" };
    try {
      bot.kill();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `击杀失败: ${e?.message ?? e}` };
    }
  }

  /** 重生（F-04：仅 entityDie before 回调窗口内可调，窗口判定归调用方） */
  respawn(botId: number, knownEntityId: string): OpResult {
    const bot = this.entity(botId, knownEntityId) ?? entityGateway.byId(knownEntityId);
    if (!bot) return { ok: false, reason: "死亡窗口内实体不可读" };
    try {
      const done = bot.respawn();
      return done ? { ok: true } : { ok: false, reason: "引擎拒绝重生请求" };
    } catch (e: any) {
      return { ok: false, reason: `重生异常: ${e?.message ?? e}` };
    }
  }

  /** 断连（异步释放名字——F-03：名字票据置"释放中"，由应用层维护） */
  disconnect(botId: number, knownEntityId?: string): void {
    const bot = this.entity(botId, knownEntityId);
    if (!bot) return;
    try {
      bot.disconnect();
    } catch {
      /* 句柄已废（重复断连） */
    }
    entityGateway.invalidate(botId);
  }

  // ─── 回收交付（删除假人：仓内物品+经验交付操作者） ──

  /**
   * 把物品与经验交付真实玩家：容器可纳则入包，溢出在玩家脚边落地；经验只增不减。
   * @returns items 按堆计；overflow 只计有剩余的堆——落地用 addItem 原生 remainder（保 NBT）
   */
  giveToPlayer(playerName: string, items: ItemStack[], totalXp: number): { items: number; overflow: number } {
    const out = { items: 0, overflow: 0 };
    const player = entityGateway.findRealPlayer(playerName);
    if (!player) return out;
    const container = player.getComponent("minecraft:inventory")?.container;
    for (const item of items) {
      let remainder: ItemStack | null | undefined;
      if (container) {
        try {
          remainder = container.addItem(item);
        } catch {
          remainder = item;
        }
      } else {
        remainder = item;
      }
      if (remainder) {
        try {
          player.dimension.spawnItem(remainder, player.location);
          out.overflow++;
        } catch {
          /* 交付失败：物品留在原地比抛穿好 */
        }
      }
      out.items++;
    }
    if (totalXp > 0) {
      try {
        player.addExperience(totalXp);
      } catch {
        /* 忽略 */
      }
    }
    return out;
  }

  /** 真人在线判定（leave 事件只给名字，按名字判主人） */
  isOnlinePlayer(playerName: string): boolean {
    return entityGateway.findRealPlayer(playerName) !== undefined;
  }

  /** 真人传送（位置为纯数据交付，句柄不出 engine） */
  tpPlayerTo(playerName: string, position: Vector3, dimensionId: string): OpResult {
    const player = entityGateway.findRealPlayer(playerName);
    if (!player) return { ok: false, reason: "玩家不在世界中" };
    let dim;
    try {
      dim = world.getDimension(dimensionId);
    } catch {
      return { ok: false, reason: `维度无效 ${dimensionId}` };
    }
    try {
      player.teleport(position, { dimension: dim });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `传送失败: ${e?.message ?? e}` };
    }
  }

  // ─── 回收（仓/实体物品+经验交付，mp:reclaim 管线） ──

  /**
   * 清空实体经验。引擎事实：addExperience(-n) 对 SimulatedPlayer 不生效；
   * resetLevel() 仅 2.6.0+ 可用；xp 指令清空最保险、全版本可用。
   */
  clearExperience(botId: number): void {
    const bot = this.entity(botId);
    if (!bot) return;
    try {
      // eslint-disable-next-line minecraft-linting/avoid-unnecessary-command -- 上注实测：addExperience(-n) 对假人不生效，本条规则建议在本场景不成立
      bot.runCommand("xp -2147483647L");
    } catch {
      const anyBot = bot as unknown as {
        resetLevel?: () => void;
        addLevels?: (n: number) => void;
        addExperience?: (n: number) => void;
        level: number;
        xpEarnedAtCurrentLevel: number;
      };
      if (typeof anyBot.resetLevel === "function") {
        try {
          anyBot.resetLevel();
        } catch {
          /* 低版本无此 API */
        }
      } else {
        try {
          anyBot.addLevels?.(-anyBot.level);
        } catch {
          /* 兜底互不牵连 */
        }
        try {
          anyBot.addExperience?.(-anyBot.xpEarnedAtCurrentLevel);
        } catch {
          /* 兜底互不牵连 */
        }
      }
    }
  }

  /**
   * 在线回收（实体→玩家）：逐格先摘除后交付（摘除失败该格跳过——绝不留复制路径）；
   * 经验取实体真值（防记录与实体不同步导致反复回收）；交付后清实体经验并把现态
   * 回写仓（否则下次上线 importItems 还原旧物=刷物）。
   * sel 为回收子集；主手=当前选中格，热栏取其外 0-8、背包 9-35（三开关互斥）。缺省全量。
   * @returns null=实体不可达（调用方报错，绝不静默走仓）
   */
  reclaimFromEntity(playerName: string, botId: number, sel: ReclaimSelection = FULL_RECLAIM): ReclaimCounts | null {
    const bot = this.entity(botId);
    if (!bot) return null;
    let handSlot = 0;
    try {
      handSlot = bot.selectedSlotIndex;
    } catch {
      /* 选中槽不可读按 slot0（与预览假设一致） */
    }
    const items: ItemStack[] = [];
    const container = bot.getComponent("minecraft:inventory")?.container;
    if (container) {
      for (let i = 0; i < INVENTORY_SIZE; i++) {
        if (!slotWanted(sel, i, handSlot)) continue;
        const item = container.getItem(i);
        if (!item) continue;
        try {
          container.setItem(i, undefined);
        } catch {
          continue; // 摘除失败：物品留在实体，比复制安全
        }
        items.push(item);
      }
    }
    const equipComp = bot.getComponent("minecraft:equippable");
    if (equipComp) {
      for (const name of EQUIP_SLOT_NAMES) {
        if (!sel[name]) continue;
        const item = equipComp.getEquipment(EQUIP_SLOT_MAP[name]);
        if (!item) continue;
        try {
          equipComp.setEquipment(EQUIP_SLOT_MAP[name], undefined);
        } catch {
          continue;
        }
        items.push(item);
      }
    }
    let xp = 0;
    let xpLevel = 0;
    if (sel.xp) {
      try {
        xpLevel = bot.level;
        xp = totalXpForLevel(xpLevel) + bot.xpEarnedAtCurrentLevel;
      } catch {
        /* 经验不可读按 0（物品照常交付） */
      }
    }
    const given = this.giveToPlayer(playerName, items, xp);
    if (xp > 0) this.clearExperience(botId);
    this.exportItems(botId); // 现态回写仓（对账写：摘除后实体态→仓）
    return { items: given.items, overflow: given.overflow, xp, xpLevel };
  }

  /**
   * 离线回收（仓→玩家）：读仓交付后仅回写未回收格（绑定保留——takeAll 是删除专用）。
   * 经验取记录快照（离线无实体真值可读）。仓无选中槽概念，
   * 主手按 slot0 约定、热栏=1-8、背包=9-35（与回收面板同口径）。
   */
  reclaimFromVault(
    playerName: string,
    botId: number,
    recordXp: ExperienceRecord,
    sel: ReclaimSelection = FULL_RECLAIM
  ): ReclaimCounts {
    const items: ItemStack[] = [];
    const savedInv = this.vault.readInventory(botId);
    const savedEquip = this.vault.readEquipment(botId);
    const taken = new Array<boolean>(INVENTORY_SIZE).fill(false);
    if (savedInv) {
      for (let i = 0; i < INVENTORY_SIZE; i++) {
        const it = savedInv[i];
        if (slotWanted(sel, i, 0) && it) {
          items.push(it);
          taken[i] = true;
        }
      }
    }
    const equipTaken: Record<string, boolean> = {};
    if (savedEquip) {
      for (const name of EQUIP_SLOT_NAMES) {
        if (!sel[name]) continue;
        const it = savedEquip[name];
        if (it) {
          items.push(it);
          equipTaken[name] = true;
        }
      }
    }
    const xp = sel.xp ? recordXp.totalXp : 0;
    const given = this.giveToPlayer(playerName, items, xp);
    if (savedInv)
      this.vault.saveInventory(
        botId,
        savedInv.map((it, i) => (taken[i] ? null : it))
      );
    if (savedEquip)
      this.vault.saveEquipment(
        botId,
        EQUIP_SLOT_NAMES.map((n) => (equipTaken[n] ? null : (savedEquip[n] ?? null)))
      );
    return { items: given.items, overflow: given.overflow, xp, xpLevel: sel.xp ? recordXp.level : 0 };
  }

  /** 仓是否有可恢复数据（mp:recover 的"无可恢复数据"回执判定） */
  vaultHasData(botId: number): boolean {
    return this.vault.readInventory(botId) !== undefined || this.vault.readEquipment(botId) !== undefined;
  }

  /**
   * 仓此刻可信吗（把"没存过"与"读不到"分开）。
   * 有滞留快照时仓态落后于实体，同样不可信——调用方须先补写或改期。
   */
  vaultReadable(botId: number): boolean {
    return permitVaultTrust(
      this.pendingExports.has(botId),
      this.vault.hasStoredSlots(botId),
      this.vault.regionReady(this.vault.getBinding(botId)?.regionId)
    ).allow;
  }

  /** 滞留导出诊断（巡检/管理面板：哪些假人的物品还压在内存里） */
  pendingExportList(): { botId: number; items: number }[] {
    return [...this.pendingExports].map(([botId, snap]) => ({ botId, items: snap.items }));
  }

  /**
   * 真人位置快照（跟随能力跨层判距用——句柄不出 engine，纯数据上达）。
   * @returns 在线返回 id/位置/维度；离线或瞬态失效 undefined
   */
  playerProbe(playerName: string): { id: string; location: Vec3; dimensionId: string } | undefined {
    const player = entityGateway.findRealPlayer(playerName);
    if (!player) return undefined;
    try {
      const l = player.location;
      return { id: player.id, location: { x: l.x, y: l.y, z: l.z }, dimensionId: player.dimension.id };
    } catch {
      return undefined;
    }
  }

  // ─── 钓鱼播报/战利品观测 ──

  /** 区域播报：半径内真实玩家收报；假人不收报，无人附近静默丢弃 */
  notifyNearby(dimId: string, center: Vec3, radius: number, text: string): void {
    for (const p of entityGateway.realPlayersNear(dimId, center, radius)) {
      try {
        p.sendMessage(text);
      } catch {
        /* 瞬态失效 */
      }
    }
  }

  /**
   * 最近真人播报：同维度全体真人取水平距离最近者，不设半径上限；
   * 假人不收报，无人在线静默丢弃。
   */
  notifyNearestRealPlayer(dimId: string, center: Vec3, text: string): void {
    let nearest: { p: { sendMessage(m: string): void }; dist: number } | undefined;
    for (const p of entityGateway.realPlayersNear(dimId, center, Number.POSITIVE_INFINITY)) {
      try {
        const dist = horizontalDistance(center, p.location);
        if (!nearest || dist < nearest.dist) nearest = { p, dist };
      } catch {
        /* 单实体瞬态失效——跳过 */
      }
    }
    if (!nearest) return;
    try {
      nearest.p.sendMessage(text);
    } catch {
      /* 瞬态失效 */
    }
  }

  /**
   * 背包战利品指纹快照（含附魔，指纹→总件数）。引擎实测：收竿后立即快照会漏收，须等 3t 沉淀。
   */
  /**
   * 工作箱搬运的背包格观测（非空格 slot/typeId/amount；不可读=空表）。
   * 只观测不决策——入选与否由 domain/WorkChest.planWorkTransfer 判定。
   */
  inventoryProbes(botId: number): InventorySlotProbe[] {
    const out: InventorySlotProbe[] = [];
    const bot = this.entity(botId);
    if (!bot) return out;
    try {
      const container = bot.getComponent("minecraft:inventory")?.container;
      if (!container) return out;
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (!item) continue;
        out.push({ slot: i, typeId: item.typeId, amount: item.amount });
      }
    } catch {
      return [];
    }
    return out;
  }

  /**
   * 永不搬运的物品类型集：主手（快捷栏 0 格）+ 副手 + 五件穿戴的当前 typeId。
   * 同 type 的背包副本一并保护（在用的工具不会只有一份还正好想留背包）；
   * 信物保护由调用方从配置补入。
   */
  protectedItemTypeIds(botId: number): Set<string> {
    const out = new Set<string>();
    const bot = this.entity(botId);
    if (!bot) return out;
    try {
      const main = bot.getComponent("minecraft:inventory")?.container?.getItem(0);
      if (main) out.add(main.typeId);
    } catch {
      /* 背包不可读：主手保护缺席，planWorkTransfer 仍强制跳过 0 格 */
    }
    try {
      const equipComp = bot.getComponent("minecraft:equippable");
      if (equipComp) {
        for (const name of EQUIP_SLOT_NAMES) {
          const item = equipComp.getEquipment(EQUIP_SLOT_MAP[name]);
          if (item) out.add(item.typeId);
        }
      }
    } catch {
      /* 装备不可读：按无穿戴保护 */
    }
    return out;
  }

  lootSnapshot(botId: number): Record<string, number> {
    const out: Record<string, number> = {};
    const bot = this.entity(botId);
    if (!bot) return out;
    try {
      const container = bot.getComponent("minecraft:inventory")?.container;
      if (!container) return out;
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (!item) continue;
        const fp = lootFingerprint(item.typeId, itemEnchantments(item));
        out[fp] = (out[fp] ?? 0) + item.amount;
      }
    } catch {
      /* 背包不可读按空快照（diff 端自然无增项） */
    }
    return out;
  }

  /** 背包占用（已用格/总格——钓获播报的容量预警数据源） */
  backpackUsage(botId: number): { used: number; total: number } {
    const bot = this.entity(botId);
    if (!bot) return { used: 0, total: 0 };
    try {
      const container = bot.getComponent("minecraft:inventory")?.container;
      if (!container) return { used: 0, total: 0 };
      let used = 0;
      for (let i = 0; i < container.size; i++) {
        if (container.getItem(i)) used++;
      }
      return { used, total: container.size };
    } catch {
      return { used: 0, total: 0 };
    }
  }

  /**
   * 取回仓内全部物品并交付真实玩家（删除管线"先取物后删仓"复合原语，应用层不经手 ItemStack）。
   * @returns items 按堆计/overflow 落地堆数/xp 交付经验。
   */
  deliverVaultToPlayer(
    playerName: string,
    botId: number,
    totalXp: number
  ): { items: number; overflow: number; xp: number } {
    const items = this.vault.takeAll(botId).filter((i): i is ItemStack => i !== null);
    // 滞留导出随删除一并交付（takeAll 已销绑定表，在途快照不能再写回仓）。
    // 快照是实体最后一次全量态，取代仓内旧副本交付（否则同物双发）。
    const held = this.pendingExports.get(botId);
    this.pendingExports.delete(botId);
    const deliver = held ? held.inv.concat(held.equip).filter((i): i is ItemStack => i !== null) : items;
    const given = this.giveToPlayer(playerName, deliver, totalXp);
    return { ...given, xp: totalXp };
  }

  /**
   * 定向私信唯一入口（管线结果只告知发起者）：总开关/档位按玩家个人设置过滤。
   * @param playerName - 目标真人玩家名
   * @param text - 正文（可自带 § 色码）
   * @param level - 通知档位（缺省 info）
   * @returns 投递回执（sent/suppressed/unreachable）——关键告警方据此决定重试
   */
  notifyPlayer(playerName: string, text: string, level: NotifyLevel = "info"): NotifyDelivery {
    return sendNotify(playerName, text, level);
  }

  /** 个人通知设置读取（面板/命令用） */
  notifySetting(playerName: string): NotifySetting {
    return getNotifySetting(playerName);
  }

  /** 个人通知设置写入（世界事件回调用外须 system.run） */
  setNotifySetting(playerName: string, setting: NotifySetting): void {
    persistNotifySetting(playerName, setting);
  }

  /** 名字占用判读（无副作用）：ghosts=未认领的假人标签实体；real=同名真人 */
  inspectNameUsage(name: string, protectEntityIds: ReadonlySet<string>): { ghosts: number; real: number } {
    let ghosts = 0;
    let real = 0;
    for (const p of entityGateway.nameBlockers(name)) {
      if (protectEntityIds.has(p.id)) continue;
      try {
        if (p.hasTag(BOT_MARKER_TAG)) ghosts++;
        else real++;
      } catch {
        /* 实体瞬态失效跳过 */
      }
    }
    return { ghosts, real };
  }

  /**
   * 释放无主幽灵实体（disconnect 异步释放——调用后仍需轮询确认）。
   * 真人同名绝不动手：disconnect 会踢真人下线。
   */
  releaseGhosts(name: string, protectEntityIds: ReadonlySet<string>): number {
    let n = 0;
    for (const p of entityGateway.nameBlockers(name)) {
      if (protectEntityIds.has(p.id)) continue;
      let bot = false;
      try {
        bot = p.hasTag(BOT_MARKER_TAG);
      } catch {
        continue;
      }
      if (!bot) continue;
      try {
        asSimulated(p)?.disconnect();
        n++;
      } catch {
        /* 实体可能刚消失 */
      }
    }
    return n;
  }
}
