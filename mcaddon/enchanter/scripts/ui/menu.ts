import { Player, ItemStack } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder, notifySuccess } from "@yinxe/toolkit/ui";
import {
  analyzeHeldItem,
  getExistingEnchantTypes,
  getAllEnchantTypes,
  inscribeEnchant,
  overlimitEnchant,
} from "../enchanter/enchantManager";
import { ItemAnalysis } from "../enchanter/types";

/**
 * 打开高级附魔主菜单。
 */
export function showMainMenu(player: Player): void {
  const analysis = analyzeHeldItem(player);

  if (!analysis) {
    player.sendMessage("§c请手持一件可附魔的物品");
    return;
  }

  if (!analysis.isValid) {
    player.sendMessage("§c手持物品无法附魔");
    return;
  }

  // 构建物品分析摘要
  const enchSummary = analysis.enchantments.length === 0
    ? "§6无附魔"
    : analysis.enchantments.map((e) =>
        `${e.displayName} ${toRoman(e.currentLevel)}` +
        (e.isOverlimited ? " §c⚠" : "")
      ).join("  ");

  new ActionFormBuilder()
    .title("§l高级附魔")
    .body(
      `§b当前物品: §f${analysis.itemName}\n` +
      `§b附魔: ${enchSummary}\n` +
      `§b功能:`,
    )
    .button("§6✦ 附魔铭刻\n§8为物品增加新的附魔词条", () =>
      showInscribeForm(player, analysis),
    )
    .button("§b⬆ 附魔超限\n§8突破原版上限提升附魔等级", () =>
      showOverlimitForm(player, analysis),
    )
    .show(player);
}

// ─── 附魔铭刻 ──────────────────────────────────────────────────────

function showInscribeForm(player: Player, analysis: ItemAnalysis): void {
  const existingTypes = getExistingEnchantTypes(
    player.getComponent("inventory")?.container?.getSlot(player.selectedSlotIndex)?.getItem()!,
  );
  const existingSet = new Set(existingTypes);

  const all = getAllEnchantTypes().filter((e) => !existingSet.has(e.id));

  if (all.length === 0) {
    player.sendMessage("§c该物品已拥有所有可铭刻的附魔");
    return;
  }

  new ModalFormBuilder()
    .title("§l附魔铭刻")
    .label("hint", "§7选择一个新附魔铭刻到物品上")
    .dropdown("enchant", "选择附魔", all.map((e) => `${e.name}（上限 ${toRoman(e.maxLevel)}）`), { defaultValueIndex: 0 })
    .slider("level", "等级", 1, 10, { defaultValue: 1, valueStep: 1 })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const idx = vals.enchant as number;
      const chosenId = all[idx].id;
      const level = vals.level as number;

      const container = player.getComponent("inventory")?.container;
      const slot = container?.getSlot(player.selectedSlotIndex);
      const item = slot?.getItem();
      if (!item) { player.sendMessage("§c物品已不存在"); return; }

      const result = inscribeEnchant(item, chosenId, level);
      slot?.setItem(item);
      notifySuccess(player, result);
    });
}

// ─── 附魔超限 ──────────────────────────────────────────────────────

function showOverlimitForm(player: Player, analysis: ItemAnalysis): void {
  if (analysis.enchantments.length === 0) {
    player.sendMessage("§c该物品暂无可超限的附魔，请先铭刻附魔");
    return;
  }

  const options = analysis.enchantments.map((e) => {
    const roman = toRoman(e.currentLevel);
    return `${e.displayName} ${roman} → ${toRoman(Math.min(e.currentLevel + 1, 10))}`;
  });

  new ModalFormBuilder()
    .title("§l附魔超限")
    .label("hint", "§7选择一个附魔突破其等级上限")
    .dropdown("enchant", "选择附魔", options, { defaultValueIndex: 0 })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const idx = vals.enchant as number;
      const chosenId = analysis.enchantments[idx].typeId;

      const container = player.getComponent("inventory")?.container;
      const slot = container?.getSlot(player.selectedSlotIndex);
      const item = slot?.getItem();
      if (!item) { player.sendMessage("§c物品已不存在"); return; }

      const result = overlimitEnchant(item, chosenId);
      slot?.setItem(item);
      notifySuccess(player, result);
    });
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  for (const [value, symbol] of map) {
    while (n >= value) { result += symbol; n -= value; }
  }
  return result;
}
