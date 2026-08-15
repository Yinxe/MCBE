// ─── /mp:data <name> — 查看模拟玩家完整数据 ────────────
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    viewData 动作 → sendData（命令与 UI 共用）。

import { Player, world, EntityInventoryComponent, EntityEquippableComponent, EquipmentSlot, CustomCommandParamType, CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../rules/Types";
import { getTagDef } from "../rules/tags/BotTags";
import { BotUiEvent } from "../events/UiEvents";
import { formatPos } from "../ui/format";
import { formatDimensionId } from "../rules/format/Format";
import { serializeItemStack } from "../features/basic/McItemCodec";
import { getTotalXpForLevels } from "../rules/xp/XpMath";
import { botRegistry, botStore } from "../bootstrap/context";
import { isChunkLoaded } from "../bot/PlayerGateway";

// ─── UI 事件订阅（BOT 主菜单 → 感知查看数据动作） ──────

/** 订阅 BOT 主菜单动作事件：查看数据 → sendData */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "viewData") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const record = botRegistry.get(e.botName);
    if (!record) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已被删除`); return; }
    sendData(player, record);
  });
}

export function sendData(player: Player, record: BotRecord): void {
  const lines: string[] = [];
  lines.push(`${color.gold}===== ${color.playerName}${record.name} ${color.gold}数据总览 =====`);

  // 根据记录的最后位置检测区块加载状态（未上线的假人取重生点）
  const checkPos = record.lastPoint ?? record.respawnPoint;
  if (checkPos) {
    try {
      const dim = world.getDimension(checkPos.dimension);
      const loaded = isChunkLoaded(dim, checkPos.location);
      lines.push(`${color.muted}区块(${formatDimensionId(checkPos.dimension)} ${formatPos(checkPos.location)}): ${loaded ? `${color.success}已加载` : `${color.error}未加载`}`);
    } catch {
      lines.push(`${color.muted}区块: ${color.error}检测失败`);
    }
  }

  // ── 基础信息 ──
  const status = record.death ? `${color.error}死亡` : record.online ? `${color.success}在线` : `${color.muted}离线`;
  lines.push(`${color.muted}状态: ${status}  ${color.muted}实体ID: ${color.info}${record.entityId ?? "无"}`);
  lines.push(`${color.muted}生成模式: ${record.spawnMode === "chunkload" ? `${color.accent}强加载` : `${color.success}普通`}`);
  lines.push(`${color.muted}潜行: ${record.isSneaking ? `${color.success}是` : `${color.muted}否`}  ${color.muted}控制器: ${record.controllerId ?? `${color.muted}无`}`);

  // ── 标签 ──
  const tagLabels = record.tags
    .map((t) => {
      const def = getTagDef(t);
      return def ? def.label : t;
    })
    .join(` ${color.muted}| `);
  lines.push(`${color.muted}标签: ${color.accent}${tagLabels}`);

  // ── 位置 ──
  if (record.lastPoint) {
    lines.push(`${color.muted}最后位置: ${formatPos(record.lastPoint.location)} ${color.darkGray}${formatDimensionId(record.lastPoint.dimension)}`);
  }
  lines.push(`${color.muted}重生点: ${formatPos(record.respawnPoint.location)} ${color.darkGray}${formatDimensionId(record.respawnPoint.dimension)}`);
  if (record.deathPoint) {
    lines.push(`${color.muted}死亡点: ${formatPos(record.deathPoint.location)} ${color.darkGray}${formatDimensionId(record.deathPoint.dimension)}`);
  }

  // ── 经验 ──
  const exp = record.experience;
  lines.push(`${color.muted}经验: ${color.accent}Lv.${exp.level} ${color.muted}进度 ${color.info}${exp.xpProgress} ${color.muted}/ ${color.info}${getTotalXpForLevels(exp.level + 1) - getTotalXpForLevels(exp.level)} ${color.muted}总经验 ${color.info}${exp.totalXp}`);

  // ── 背包和装备（在线时读取实时数据） ──
  if (record.online && record.entityId) {
    const bot = world.getEntity(record.entityId) as Player | undefined;
    if (bot) {
      // ── 身位/视角 ──
      const rot = bot.getRotation();
      lines.push(`${color.muted}身位俯仰/偏航: ${color.info}${Math.floor(rot.x)}° ${color.muted}/ ${color.info}${Math.floor(rot.y)}°`);
      try {
        const hit = (bot as any).getBlockFromViewDirection?.({ maxDistance: 64 });
        if (hit) {
          const b = hit.block;
          lines.push(`${color.muted}视角方块: ${color.info}${b.typeId} ${color.muted}@ ${formatPos(b.location)}`);
        } else {
          lines.push(`${color.muted}视角方块: ${color.muted}无`);
        }
      } catch { lines.push(`${color.muted}视角方块: ${color.error}获取失败`); }
      // 装备
      const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
      if (equip) {
        lines.push(`${color.muted}━━ 装备 ━━`);
        const slots: [string, EquipmentSlot][] = [
          ["头盔", EquipmentSlot.Head],
          ["胸甲", EquipmentSlot.Chest],
          ["护腿", EquipmentSlot.Legs],
          ["靴子", EquipmentSlot.Feet],
          ["主手", EquipmentSlot.Mainhand],
          ["副手", EquipmentSlot.Offhand],
        ];
        for (const [label, slot] of slots) {
          const item = equip.getEquipment(slot);
          if (item) {
            const serialized = serializeItemStack(item);
            const ench = serialized.enchantments && serialized.enchantments.length > 0
              ? ` ${color.muted}[${serialized.enchantments.map((e) => `${e.id} ${e.level}`).join(" ")}]`
              : "";
            lines.push(` ${color.muted}${label}: ${color.info}${item.typeId} ${color.muted}x${item.amount}${ench}`);
          }
        }
      }

      // 背包详情（逐格显示）
      const inv = bot.getComponent("minecraft:inventory") as EntityInventoryComponent;
      if (inv?.container) {
        lines.push(`${color.muted}━━ 背包(0-8快捷栏 9-35背包) ━━`);
        let itemCount = 0;
        for (let i = 0; i < inv.container.size; i++) {
          const item = inv.container.getItem(i);
          if (!item) continue;
          itemCount += item.amount;
          const serialized = serializeItemStack(item);
          const ench = serialized.enchantments && serialized.enchantments.length > 0
            ? ` ${color.muted}[${serialized.enchantments.map((e) => `${e.id} ${e.level}`).join(" ")}]`
            : "";
          const slotLabel = i < 9 ? `快捷${i}` : `背包${i - 9}`;
          lines.push(` ${color.muted}${slotLabel}: ${color.info}${item.typeId} ${color.muted}x${item.amount}${ench}`);
        }
        lines.push(`${color.muted}共 ${color.info}${itemCount} ${color.muted}个物品`);
      }
    }
  } else {
    lines.push(`${color.muted}━━ 背包(离线数据) ━━`);
    const saved = botStore.loadInventory(record.name);
    if (saved) {
      let itemCount = 0;
      for (let i = 0; i < saved.length; i++) {
        const item = saved[i];
        if (!item) continue;
        itemCount += item.amount;
        const slotLabel = i < 9 ? `快捷${i}` : `背包${i - 9}`;
        lines.push(` ${color.muted}${slotLabel}: ${color.info}${item.typeId} ${color.muted}x${item.amount}`);
      }
      lines.push(`${color.muted}共 ${color.info}${itemCount} ${color.muted}个物品`);
    }
  }

  lines.push(`${color.gold}========================`);

  for (const line of lines) {
    player.sendMessage(line);
  }
}

export function registerDataCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:data",
    description: "查看模拟玩家的完整数据",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const nameInput = params.name as string | undefined;
    if (!nameInput) {
      player.sendMessage(`${color.error}用法: /mp:data <假人名>`);
      return;
    }
    const record = botRegistry.get(nameInput);
    if (!record) {
      player.sendMessage(`${color.error}未找到模拟玩家 ${color.playerName}${nameInput}${color.error}`);
      return;
    }
    sendData(player, record);
  });
}
