// ─── /mp:data <name> — 查看模拟玩家完整数据 ────────────

import { Player, world, system, EntityInventoryComponent, EntityEquippableComponent, EquipmentSlot, CustomCommandParamType, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";

import { BotRecord } from "../features/types";
import { getTagDef } from "../features/tags";
import { formatPos, formatDimensionId, serializeItemStack, getTotalXpForLevels } from "../features/utils";
import { botRegistry, loadBotInventory } from "../features/persistence";

export function sendData(player: Player, record: BotRecord): void {
  const lines: string[] = [];
  lines.push(`§6===== §e${record.name} §6数据总览 =====`);

  // ── 基础信息 ──
  const status = record.death ? "§c死亡" : record.online ? "§a在线" : "§7离线";
  lines.push(`§7状态: ${status}  §7实体ID: §f${record.entityId ?? "无"}`);
  lines.push(`§7潜行: ${record.isSneaking ? "§a是" : "§7否"}  §7控制器: ${record.controllerId ?? "§7无"}`);

  // ── 标签 ──
  const tagLabels = record.tags
    .map((t) => {
      const def = getTagDef(t);
      return def ? def.label : t;
    })
    .join(" §7| ");
  lines.push(`§7标签: §b${tagLabels}`);

  // ── 位置 ──
  if (record.lastPoint) {
    lines.push(`§7最后位置: ${formatPos(record.lastPoint.location)} §8${formatDimensionId(record.lastPoint.dimension)}`);
  }
  lines.push(`§7重生点: ${formatPos(record.respawnPoint.location)} §8${formatDimensionId(record.respawnPoint.dimension)}`);
  if (record.deathPoint) {
    lines.push(`§7死亡点: ${formatPos(record.deathPoint.location)} §8${formatDimensionId(record.deathPoint.dimension)}`);
  }

  // ── 经验 ──
  const exp = record.experience;
  lines.push(`§7经验: §bLv.${exp.level} §7进度 §f${exp.xpProgress} §7/ §f${getTotalXpForLevels(exp.level + 1) - getTotalXpForLevels(exp.level)} §7总经验 §f${exp.totalXp}`);

  // ── 背包和装备（在线时读取实时数据） ──
  if (record.online && record.entityId) {
    const bot = world.getEntity(record.entityId) as Player | undefined;
    if (bot) {
      // 装备
      const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
      if (equip) {
        lines.push(`§7━━ 装备 ━━`);
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
              ? ` §7[${serialized.enchantments.map((e) => `${e.id} ${e.level}`).join(" ")}]`
              : "";
            lines.push(` §7${label}: §f${item.typeId} §7x${item.amount}${ench}`);
          }
        }
      }

      // 背包详情（逐格显示）
      const inv = bot.getComponent("minecraft:inventory") as EntityInventoryComponent;
      if (inv?.container) {
        lines.push(`§7━━ 背包(0-8快捷栏 9-35背包) ━━`);
        let itemCount = 0;
        for (let i = 0; i < inv.container.size; i++) {
          const item = inv.container.getItem(i);
          if (!item) continue;
          itemCount += item.amount;
          const serialized = serializeItemStack(item);
          const ench = serialized.enchantments && serialized.enchantments.length > 0
            ? ` §7[${serialized.enchantments.map((e) => `${e.id} ${e.level}`).join(" ")}]`
            : "";
          const slotLabel = i < 9 ? `快捷${i}` : `背包${i - 9}`;
          lines.push(` §7${slotLabel}: §f${item.typeId} §7x${item.amount}${ench}`);
        }
        lines.push(`§7共 §f${itemCount} §7个物品`);
      }
    }
  } else {
    lines.push(`§7━━ 背包(离线数据) ━━`);
    const saved = loadBotInventory(record.name);
    if (saved) {
      let itemCount = 0;
      for (let i = 0; i < saved.length; i++) {
        const item = saved[i];
        if (!item) continue;
        itemCount += item.amount;
        const slotLabel = i < 9 ? `快捷${i}` : `背包${i - 9}`;
        lines.push(` §7${slotLabel}: §f${item.typeId} §7x${item.amount}`);
      }
      lines.push(`§7共 §f${itemCount} §7个物品`);
    }
  }

  lines.push(`§6========================`);

  for (const line of lines) {
    player.sendMessage(line);
  }
}

export function registerDataCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:data",
      description: "查看模拟玩家的完整数据",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;

      const nameInput = args[0] as string | undefined;
      if (!nameInput) {
        player.sendMessage("§c用法: /mp:data <假人名>");
        return { status: CustomCommandStatus.Failure, message: "缺少参数" };
      }

      const record = botRegistry.get(nameInput);
      if (!record) {
        player.sendMessage(`§c未找到模拟玩家 §e${nameInput}§c`);
        return { status: CustomCommandStatus.Failure, message: "未找到" };
      }

      // ⚠️ 命令回调运行在 restricted-execution mode
      // serializeItemStack 中的 getCanDestroy/getCanPlaceOn 受限
      // 用 system.run 切换到主 tick 执行
      system.run(() => {
        sendData(player, record);
      });
      return { status: CustomCommandStatus.Success, message: "ok" };
    },
  );
}
