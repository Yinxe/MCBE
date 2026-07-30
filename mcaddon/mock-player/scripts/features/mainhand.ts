// ─── 主手物品选择 ──────────────────────────────────────
// 扫描背包所有物品，将选中的物品置换到 slot 0 并选中

import { system, world, ItemEnchantableComponent } from "@minecraft/server";

import { resolveBotPlayer } from "./core/persistence";

const MAINHAND_SLOT = 0;

// ─── 公开类型 ──────────────────────────────────────────

export interface MainhandOption {
  /** 选项值: -1 = 清空, >=0 = 物品所在槽位 */
  value: number;
  /** 展示文字，如 "§7固定:无"、"§f[热栏3] 钻石剑 §7x32" */
  label: string;
}

// ─── 扫描背包 ──────────────────────────────────────────

/**
 * 扫描假人全部背包，生成主手选择列表。
 * 第一项固定为"固定:无"（value = -1）。
 * @returns undefined 表示假人不可用，空数组表示背包无物品
 */
export function getMainhandOptions(botName: string): MainhandOption[] | undefined {
  const bot = resolveBotPlayer(botName);
  if (!bot) return undefined;

  const options: MainhandOption[] = [
    { value: -1, label: "§7固定:无" },
  ];

  const inv = bot.getComponent("minecraft:inventory") as any;
  if (!inv?.container) return options;

  const container = inv.container;
  for (let i = 0; i < container.size; i++) {
    if (i === MAINHAND_SLOT) continue; // slot 0 是当前主手，不展示在列表中
    const item = container.getItem(i);
    if (!item) continue;

    const slotName = i < 9 ? `热栏${i + 1}` : `背包${i + 1}`;
    let label: string;
    try {
      // ── 显示名 ──
      const displayName = item.nameTag || item.typeId.replace("minecraft:", "");
      // ── 附魔 ──
      const enchLines: string[] = [];
      if (item.hasComponent("minecraft:enchantable")) {
        const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent;
        if (ench) {
          for (const e of ench.getEnchantments()) {
            enchLines.push(`§b${e.type.id} ${levelToRoman(e.level)}`);
          }
        }
      }
      // ── 耐久 ──
      let durStr = "";
      const dur = item.getComponent("minecraft:durability") as any;
      if (dur) {
        const maxD = dur.maxDurability ?? 1;
        const dmg = dur.damage ?? 0;
        const cur = maxD - dmg;
        const pct = Math.floor((cur / maxD) * 100);
        const color = pct > 50 ? "§a" : pct > 20 ? "§e" : "§c";
        durStr = `${color}(${cur}/${maxD})`;
      }
      const amount = item.amount > 1 ? ` §7x${item.amount}` : "";
      label = `§f[${slotName}] §f${displayName}${amount}${durStr}${enchLines.length > 0 ? "\n" + enchLines.join("\n") : ""}`;
    } catch {
      label = `§f[${slotName}] §7<解析失败>`;
    }
    options.push({ value: i, label });
  }

  return options;
}

// ─── 设置主手 ──────────────────────────────────────────

/**
 * 将指定槽位的物品置换到 slot 0 并选中。
 * @param value -1 表示清空主手，>=0 表示物品所在槽位
 */
export function setMainhandSlot(botName: string, slotValue: number): void {
  const bot = resolveBotPlayer(botName);
  if (!bot) return;

  const inv = bot.getComponent("minecraft:inventory") as any;
  if (!inv?.container) return;
  const container = inv.container;

  system.run(() => {
    try {
      if (slotValue === -1) {
        // 清空主手
        container.setItem(MAINHAND_SLOT, undefined);
      } else if (slotValue >= 0 && slotValue < container.size && slotValue !== MAINHAND_SLOT) {
        // 交换 slot 0 和目标槽
        const currentMainhand = container.getItem(MAINHAND_SLOT);
        const targetItem = container.getItem(slotValue);
        container.setItem(slotValue, currentMainhand ?? undefined);
        container.setItem(MAINHAND_SLOT, targetItem);
      }
      bot.selectedSlotIndex = MAINHAND_SLOT;
    } catch {
      // 操作失败时忽略
    }
  });
}

// ─── 辅助 ──────────────────────────────────────────────

function levelToRoman(level: number): string {
  const map: Record<number, string> = {
    1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
    6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
  };
  return map[level] || `[${level}]`;
}
