// ─── 面板复合原子（面板多格读取/复合操作的 engine 侧唯一出口） ────
// 句柄不出 engine——物品观测一律升为 ItemSummary 纯数据上达；复合操作
// （互换/丢弃序列）在此原子化，interface 只做意图翻译与渲染。
// 互换口径：背包先含主手格、主手绝不吞物（选择置换走 Wielder 本体）。

import type { EquipmentSlot, ItemStack } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../domain/Record";
import type { EquipSlotName } from "../domain/Record";
import { botOf, botValid, inventoryContainer, itemEnchantments, rayHit, readBlock, sleepTicks } from "./Atomic";
import type { RayHit } from "./Atomic";
import { consumer } from "./Consumer";
import type { ConsumeTier } from "./Consumer";
import { dropper } from "./Dropper";
import { entityGateway } from "./EntityGateway";
import { EQUIP_SLOT_MAP } from "./EquipSlots";
import { equipChanged } from "./Hooks";
import type { ItemVault } from "./ItemVault";

/** 物品观测摘要（面板渲染唯一物料；附魔/耐久在 engine 侧读全） */
export interface ItemSummary {
  typeId: string;
  amount: number;
  nameTag?: string;
  enchants: { id: string; level: number }[];
  /** 耐久损耗（无耐久组件 undefined） */
  damage?: number;
  maxDurability?: number;
}

/** 实体/仓的槽位全览（equip 按 EQUIP_SLOT_NAMES 键） */
export interface SlotsView {
  selected: number;
  inv: (ItemSummary | null)[];
  equip: Partial<Record<EquipSlotName, ItemSummary | null>>;
}

export type UseItemOnceResult = "used" | "fully-fed" | "unusable" | "offline";

export interface DiscardReport {
  dropped: number;
  failed: number;
}

/** 互换勾选（四区域开关；背包含主手格） */
export interface SwapFlags {
  mainhand: boolean;
  offhand: boolean;
  armor: boolean;
  inventory: boolean;
}

/** 主手选择菜单物料（"固定:无"显隐规则在 interface 判定） */
export interface MainhandMenu {
  selected: number;
  options: { slot: number; item: ItemSummary }[];
  hasEmpty: boolean;
  mainhandEmpty: boolean;
}

/** 丢弃槽间节流（Dropper 同源引擎节奏：4t） */
const DROP_GAP_TICKS = 4;

function summarize(item: ItemStack | null | undefined): ItemSummary | null {
  if (!item) return null;
  const s: ItemSummary = { typeId: item.typeId, amount: item.amount, enchants: itemEnchantments(item) };
  try {
    const tag = item.nameTag;
    if (tag) s.nameTag = tag;
  } catch {
    /* nameTag 瞬态不可读按无 */
  }
  try {
    const dur = item.getComponent("minecraft:durability") as { damage: number; maxDurability: number } | undefined;
    if (dur) {
      s.damage = dur.damage;
      s.maxDurability = dur.maxDurability;
    }
  } catch {
    /* 组件不可读按无耐久 */
  }
  return s;
}

type EquippableView = {
  getEquipment(slot: EquipmentSlot): ItemStack | undefined;
  setEquipment(slot: EquipmentSlot, item?: ItemStack): unknown;
};

function readEquip(equipComp: EquippableView | undefined, name: EquipSlotName): ItemSummary | null {
  if (!equipComp) return null;
  try {
    return summarize(equipComp.getEquipment(EQUIP_SLOT_MAP[name]));
  } catch {
    return null;
  }
}

export class PanelOps {
  constructor(private readonly vault: ItemVault) {}

  /** 单项物品观测（三叉戟勾选等已持 ItemStack 的原子回读升数据用） */
  itemSummary(item: ItemStack): ItemSummary | null {
    return summarize(item);
  }

  /** 实体当下槽位全览（在线渲染源；离线/失效 undefined——调用方回退仓视图） */
  liveSlots(botId: number): SlotsView | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    const container = inventoryContainer(bot);
    if (!container) return undefined;
    const inv: (ItemSummary | null)[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      let item: ItemStack | undefined;
      try {
        item = container.getItem(i);
      } catch {
        item = undefined;
      }
      inv.push(summarize(item));
    }
    let equipComp;
    try {
      equipComp = bot.getComponent("minecraft:equippable");
    } catch {
      equipComp = undefined;
    }
    const equip: Partial<Record<EquipSlotName, ItemSummary | null>> = {};
    for (const name of EQUIP_SLOT_NAMES) equip[name] = readEquip(equipComp, name);
    let selected = 0;
    try {
      selected = bot.selectedSlotIndex;
    } catch {
      /* 选中槽不可读按 0（与回收主手假设一致） */
    }
    return { selected, inv, equip };
  }

  /** 仓快照槽位视图（离线回收预览/数据面板缓存分支；无仓数据 inv undefined） */
  vaultSlots(botId: number): {
    inv?: (ItemSummary | null)[];
    equip?: Partial<Record<EquipSlotName, ItemSummary | null>>;
  } {
    const out: { inv?: (ItemSummary | null)[]; equip?: Partial<Record<EquipSlotName, ItemSummary | null>> } = {};
    const savedInv = this.vault.readInventory(botId);
    if (savedInv) out.inv = savedInv.map((it) => summarize(it));
    const savedEquip = this.vault.readEquipment(botId);
    if (savedEquip) {
      const equip: Partial<Record<EquipSlotName, ItemSummary | null>> = {};
      for (const name of EQUIP_SLOT_NAMES) equip[name] = summarize(savedEquip[name] ?? null);
      out.equip = equip;
    }
    return out;
  }

  /**
   * 使用一次：选中槽→热栏第一个有物（Consumer findUsableSlot 同源语义，
   * 在此先行判定食物档），饱食拒食、不可用物品各自归因；fire-and-forget
   * 由调用方处理，本方法永不 reject。
   */
  async useItemOnce(botId: number): Promise<UseItemOnceResult> {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const container = inventoryContainer(bot);
    if (!container) return "unusable";
    let slot = -1;
    try {
      const selected = bot.selectedSlotIndex;
      if (selected >= 0 && selected < INVENTORY_SIZE && container.getItem(selected)) slot = selected;
      else {
        for (let i = 0; i < 9; i++) {
          if (container.getItem(i)) {
            slot = i;
            break;
          }
        }
      }
    } catch {
      return "offline";
    }
    if (slot < 0) return "unusable";
    const tier: ConsumeTier = consumer.isFood(botId, slot) ? "food" : "generic";
    const r = await consumer.consume(botId, tier);
    if (r === "full") return "fully-fed";
    if (r === "offline") return "offline";
    if (r === "consumed" || r === "aborted") return "used";
    return "unusable";
  }

  /**
   * 按勾选丢弃：装备先摘入空槽随背包序列丢（选中→丢→还原由 Dropper 承担），
   * 无空位则 spawnItem 兜底；槽间 ≥4t（引擎节奏）。必须在 system.run/异步链内调用。
   */
  async discardSlots(botId: number, invSlots: number[], equipSlots: EquipSlotName[]): Promise<DiscardReport> {
    const report: DiscardReport = { dropped: 0, failed: 0 };
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) {
      report.failed = invSlots.length + equipSlots.length;
      return report;
    }
    const container = inventoryContainer(bot);
    let equipComp;
    try {
      equipComp = bot.getComponent("minecraft:equippable");
    } catch {
      equipComp = undefined;
    }
    const pending: number[] = [];
    for (const i of invSlots) {
      if (i < 0 || i >= INVENTORY_SIZE || !container) continue;
      try {
        if (container.getItem(i)) pending.push(i);
      } catch {
        /* 不可读格跳过（比误判丢弃安全） */
      }
    }
    for (const name of equipSlots) {
      let item: ItemStack | undefined;
      try {
        item = equipComp?.getEquipment(EQUIP_SLOT_MAP[name]);
      } catch {
        item = undefined;
      }
      if (!item) continue;
      try {
        equipComp?.setEquipment(EQUIP_SLOT_MAP[name], undefined);
        equipChanged(botId, name);
      } catch {
        report.failed++;
        continue;
      }
      // 摘下的装备安置进空槽走统一丢弃序列；无空位直接落地（spawnItem）
      let stash = -1;
      if (container) {
        try {
          const handSlot = bot.selectedSlotIndex;
          for (let i = 0; i < INVENTORY_SIZE; i++) {
            if (i === handSlot && container.getItem(i)) continue;
            if (!container.getItem(i)) {
              stash = i;
              break;
            }
          }
        } catch {
          stash = -1;
        }
      }
      if (stash >= 0) {
        try {
          container?.setItem(stash, item);
          pending.push(stash);
        } catch {
          stash = -1;
        }
      }
      if (stash < 0) {
        try {
          bot.dimension.spawnItem(item, bot.location);
          report.dropped++;
        } catch {
          report.failed++;
        }
      }
    }
    pending.sort((a, b) => a - b);
    for (let k = 0; k < pending.length; k++) {
      if (k > 0) await sleepTicks(DROP_GAP_TICKS);
      const r = dropper.dropSlot(botId, pending[k]);
      if (r === "dropped") report.dropped++;
      else if (r === "offline") {
        report.failed += pending.length - k;
        break;
      } else if (r === "failed") report.failed++;
    }
    return report;
  }

  /**
   * 与真人互换：背包[含主手格]→主手（背包未勾选才单独换）→副手/装备逐槽。
   * 同步执行体——调用方必须在同一 system.run 内；每装备槽变更报
   * equipChanged。绝不 reject/抛穿。
   */
  swapWithPlayer(playerName: string, botId: number, flags: SwapFlags): { done: string[]; error?: string } {
    const done: string[] = [];
    try {
      const player = entityGateway.findRealPlayer(playerName);
      if (!player) return { done, error: "找不到操作者" };
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) return { done, error: "假人不在线" };
      const pc = player.getComponent("minecraft:inventory")?.container;
      const bc = inventoryContainer(bot);
      if (!pc || !bc) return { done, error: "容器不可用" };
      if (flags.inventory) {
        const n = Math.min(pc.size, bc.size, INVENTORY_SIZE);
        for (let i = 0; i < n; i++) {
          const a = pc.getItem(i);
          const b = bc.getItem(i);
          pc.setItem(i, b ?? undefined);
          bc.setItem(i, a ?? undefined);
        }
        done.push("背包");
      } else if (flags.mainhand) {
        let hp = 0;
        let hb = 0;
        try {
          hp = player.selectedSlotIndex ?? 0;
          hb = bot.selectedSlotIndex;
        } catch {
          /* 选中槽不可读按 0 */
        }
        const a = pc.getItem(hp);
        const b = bc.getItem(hb);
        pc.setItem(hp, b ?? undefined);
        bc.setItem(hb, a ?? undefined);
        done.push("主手");
      }
      const peq = player.getComponent("minecraft:equippable") as EquippableView | undefined;
      const beq = bot.getComponent("minecraft:equippable") as EquippableView | undefined;
      const swapOne = (name: EquipSlotName): boolean => {
        if (!peq || !beq) return false;
        try {
          const slot = EQUIP_SLOT_MAP[name];
          const a = peq.getEquipment(slot);
          const b = beq.getEquipment(slot);
          peq.setEquipment(slot, b ?? undefined);
          beq.setEquipment(slot, a ?? undefined);
          equipChanged(botId, name);
          return true;
        } catch {
          return false;
        }
      };
      if (flags.offhand && swapOne("offhand")) done.push("副手");
      if (flags.armor) {
        let swapped = 0;
        for (const name of ["head", "chest", "legs", "feet"] as EquipSlotName[]) {
          if (swapOne(name)) swapped++;
        }
        if (swapped > 0) done.push("装备");
      }
      return { done };
    } catch (e: any) {
      return { done, error: e?.message ?? String(e) };
    }
  }

  /** 主手选择菜单物料（选项=非选中槽有物格；离线 undefined） */
  mainhandMenu(botId: number): MainhandMenu | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    const container = inventoryContainer(bot);
    if (!container) return undefined;
    let selected = 0;
    try {
      selected = bot.selectedSlotIndex;
    } catch {
      return undefined;
    }
    const options: { slot: number; item: ItemSummary }[] = [];
    let hasEmpty = false;
    let mainhandEmpty = false;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      let item: ItemStack | undefined;
      try {
        item = container.getItem(i);
      } catch {
        item = undefined;
      }
      if (i === selected) {
        if (!item) mainhandEmpty = true;
        continue;
      }
      if (!item) {
        hasEmpty = true;
        continue;
      }
      const s = summarize(item);
      if (s) options.push({ slot: i, item: s });
    }
    return { selected, options, hasEmpty, mainhandEmpty };
  }

  /** 视角射线目标（数据面板"视角方块"；未命中/失效 undefined） */
  viewTarget(botId: number): RayHit | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    return rayHit(bot, 64);
  }

  /** 区块加载探测（getBlock 读得到=已加载；数据面板三点检查） */
  chunkLoadedAt(dimId: string, p: Vec3): boolean {
    return (
      readBlock(dimId, { x: Math.floor(p.x), y: Math.max(Math.floor(p.y), -64), z: Math.floor(p.z) }) !== undefined
    );
  }
}
