// ─── /mp:storage <name> — 打印假人 NBT 存储绑定与实存物品（调试） ──
//
// 输出：
//   1. 存储区域 ID + 绑定表（背包每格/装备每槽 → slotId）
//   2. 实际存储物品（从槽读出：typeId ×数量 / 耐久 / 名称）
//      —— 绑定但槽内为占位（structure_void）显示 [占位/空]
//   3. 区域总览（totalStats：区域数/容量/已用）
//
// 用途：排查绑定漂移、占位异常、槽位被外部模组占用等存储问题。

import { Player, CustomCommandParamType, CommandPermissionLevel } from "@minecraft/server";
import { defineCommand, color } from "@yinxe/toolkit";
import { ItemStorage } from "@yinxe/nbt-data-storage";

import { BotRecord } from "../../model/Types";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../../model/Types";
import { botRegistry, botStore } from "../bootstrap/context";
import { guardBotCommand } from "./auth";

/** 槽位 → 槽位标签（快捷栏/背包） */
function slotLabel(i: number): string {
  return i < 9 ? `快捷${i}` : `背包${i - 9}`;
}

/** 物品简要描述（typeId ×数量 + 耐久 + 名称） */
function itemDesc(item: { typeId: string; amount: number; nameTag?: string; damage?: number }): string {
  const short = item.typeId.replace("minecraft:", "");
  const parts = [item.amount > 1 ? `${short}×${item.amount}` : short];
  if (item.damage) parts.push(`耐久${item.damage}`);
  if (item.nameTag) parts.push(`"${item.nameTag}"`);
  return parts.join(" ");
}

export function sendStorage(player: Player, record: BotRecord): void {
  const lines: string[] = [];
  lines.push(`${color.gold}===== ${color.playerName}${record.name} ${color.gold}Storage 绑定调试 =====`);

  const binding = botStore.getBinding(record.name);
  if (!binding) {
    lines.push(`${color.muted}未绑定任何存储槽位（绑定表不存在）——从未保存过物品`);
  } else {
    lines.push(`${color.muted}存储区域: ${color.info}${binding.regionId}`);

    // 实际存储（loadInventory/loadEquipment 跳过占位，占位格显示为"绑定但空"）
    const storedInv = botStore.loadInventory(record.name) ?? [];
    const storedEquip = botStore.loadEquipment(record.name) ?? {};

    // ── 背包绑定表 ──
    lines.push(`${color.muted}━━ 背包绑定（36 格） ━━`);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const sid = binding.inv[String(i)];
      const label = slotLabel(i);
      if (sid === undefined) {
        lines.push(` ${color.muted}${label}: ${color.darkGray}[未绑定]`);
        continue;
      }
      const actual = storedInv[i];
      const desc = actual ? `${color.info}${itemDesc(actual)}` : `${color.darkGray}[占位/空]`;
      lines.push(` ${color.muted}${label}: ${color.accent}slot#${sid} ${color.muted}→ ${desc}`);
    }

    // ── 装备绑定表 ──
    lines.push(`${color.muted}━━ 装备绑定 ━━`);
    for (const name of EQUIP_SLOT_NAMES) {
      const sid = binding.equip[name];
      if (sid === undefined) {
        lines.push(` ${color.muted}${name}: ${color.darkGray}[未绑定]`);
        continue;
      }
      const actual = storedEquip[name];
      const desc = actual ? `${color.info}${itemDesc(actual)}` : `${color.darkGray}[占位/空]`;
      lines.push(` ${color.muted}${name}: ${color.accent}slot#${sid} ${color.muted}→ ${desc}`);
    }
  }

  // ── 区域总览（世界全部存储区域） ──
  try {
    const stats = ItemStorage.totalStats();
    lines.push(`${color.muted}━━ 存储区域总览 ━━`);
    lines.push(
      ` ${color.muted}区域数: ${color.info}${stats.regionCount} ${color.muted}容量: ${color.info}${stats.totalCapacity} ${color.muted}已用: ${color.info}${stats.totalUsed}`,
    );
  } catch (e: any) {
    lines.push(`${color.muted}存储区域统计失败: ${color.error}${e?.message ?? e}`);
  }

  lines.push(`${color.gold}============================`);
  for (const line of lines) {
    player.sendMessage(line);
  }
}

export function registerStorageCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:storage",
    description: "查看假人 NBT 存储绑定与实存物品（调试）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const nameInput = params.name as string | undefined;
    if (!nameInput) {
      player.sendMessage(`${color.error}用法: /mp:storage <假人名>`);
      return;
    }
    const denied = guardBotCommand(player, nameInput);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(nameInput);
    if (!record) {
      player.sendMessage(`${color.error}未找到模拟玩家 ${color.playerName}${nameInput}`);
      return;
    }
    sendStorage(player, record);
  });
}
