// ─── /mp:data <name> — 查看模拟玩家完整数据 ────────────
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    viewData 动作 → sendData（命令与 UI 共用）。

import {
  Player,
  world,
  EntityInventoryComponent,
  EntityEquippableComponent,
  EquipmentSlot,
  CustomCommandParamType,
  CommandPermissionLevel,
} from "@minecraft/server";
import { ModalFormBuilder, defineCommand, color, style } from "@yinxe/toolkit";

import { BotRecord } from "../../../rules/Types";
import { getTagDef } from "../../../rules/tags/BotTags";
import { BotUiEvent } from "../../../events/UiEvents";
import { formatPos } from "../../ui/format";
import { formatDimensionId } from "../../../rules/format/Format";
import { serializeItemStack } from "../../../features/basic/items";
import { getTotalXpForLevels } from "../../../rules/xp/XpMath";
import { botRegistry, botStore } from "../../../bootstrap/context";
import { isChunkLoaded } from "../../../bot/PlayerGateway";
import { guardBotCommand } from "../auth";

// ─── UI 事件订阅（BOT 主菜单 → 感知查看数据动作） ──────

/** 订阅 BOT 主菜单动作事件：查看数据 → sendData */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "viewData") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const denied = guardBotCommand(player, e.botName);
    if (denied) {
      player.sendMessage(`${color.error}${denied}`);
      return;
    }
    const record = botRegistry.get(e.botName);
    if (!record) {
      player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已被删除`);
      return;
    }
    sendData(player, record);
  });
}

export function sendData(player: Player, record: BotRecord): void {
  const lines: string[] = [];
  // 顶层容错：任何单节统计失败仅显示“无法统计”，不影响整体表单弹出
  const pushSafe = (fn: () => void, fallback?: string) => {
    try { fn(); } catch (e) {
      try { lines.push(fallback ?? `${color.muted}该节数据无法统计: ${color.muted}${(e as Error)?.message ?? String(e)}`); } catch {}
    }
  };
  pushSafe(() => lines.push(`${color.gold}===== ${color.playerName}${record.name} ${color.gold}数据总览 =====`));

  // ── 区块加载（当前/重生） ──
  const checkPoints: Array<{ label: string; pos: import("../../../rules/Types").PositionState | null }> = [
    { label: "当前", pos: record.lastPoint ?? (record.death && record.deathPoint ? record.deathPoint : null) },
    { label: "重生", pos: record.respawnPoint },
  ];
  if (record.deathPoint) checkPoints.push({ label: "死亡", pos: record.deathPoint });
  for (const cp of checkPoints) {
    if (!cp.pos) continue;
    try {
      const dim = world.getDimension(cp.pos.dimension);
      const loaded = isChunkLoaded(dim, cp.pos.location);
      lines.push(
        `${color.muted}${cp.label}区块(${formatDimensionId(cp.pos.dimension)} ${formatPos(cp.pos.location)}): ${loaded ? `${color.success}已加载` : `${color.error}未加载`}`
      );
    } catch {
      lines.push(`${color.muted}${cp.label}区块: ${color.error}检测失败`);
    }
  }

  // ── 基础信息 ──
  const workModeLabels: Record<string, string> = {
    none: "空闲",
    wander: "闲逛",
    mine: "挖掘",
    place: "放置",
    attack: "攻击",
    raid: "劫掠",
    fishing: "钓鱼",
    follow: "跟随",
  };
  const status = record.death
    ? `${color.error}死亡`
    : record.online
      ? `${color.success}${workModeLabels[record.workMode] ?? record.workMode}`
      : `${color.muted}离线`;
  const owner = record.ownerName ? `${color.playerName}${record.ownerName}` : `${color.muted}无主`;
  lines.push(`${color.muted}状态: ${status}  ${color.muted}主人: ${owner}  ${color.muted}实体ID: ${color.info}${record.entityId ?? "无"}`);
  lines.push(`${color.muted}生成模式: ${color.accent}${record.spawnMode ?? "normal"}${record.spawnMode === "chunkload" ? ` ${color.gold}(强加载)` : ""}  ${color.muted}木材模式: ${color.info}${record.woodcutMode ?? "logs"}`);
  lines.push(
    `${color.muted}潜行: ${record.isSneaking ? `${color.success}是` : `${color.muted}否`}  ${color.muted}控制器: ${record.controllerId ?? `${color.muted}无`}  ${color.muted}在线: ${record.online ? color.success + "是" : color.warn + "否"}  ${color.muted}死亡: ${record.death ? color.error + "是" : color.success + "否"}`
  );

  // ── 标签 ──
  const tagLabels = record.tags
    .map((t) => {
      const def = getTagDef(t);
      return def ? def.label : t.replace("mockplayer:tag:", "");
    })
    .join(` ${color.muted}| `);
  lines.push(`${color.muted}标签: ${color.accent}${tagLabels || color.muted + "无"}`);
  if (record.workMode !== "none") {
    lines.push(`${color.muted}工作模式: ${color.success}${workModeLabels[record.workMode] ?? record.workMode}${record.woodcutMode ? ` ${color.muted}(${record.woodcutMode})` : ""}`);
  }

  // ── 位置详情（重生/当前/死亡 均含朝向与视点） ──
  const formatStateLine = (label: string, state: import("../../../rules/Types").PositionState | null, colorLabel: string = color.muted) => {
    if (!state) return;
    lines.push(
      `${colorLabel}${label}: ${formatPos(state.location)} ${color.darkGray}${formatDimensionId(state.dimension)} ${color.muted}偏航${Math.floor(state.rotation.y)}° 俯仰${Math.floor(state.rotation.x)}°`
    );
    if (state.lookTarget) {
      lines.push(`${color.muted}  ${label}视点: ${formatPos(state.lookTarget as any)}`);
    }
  };
  lines.push(`${color.muted}━━ 位置详情 ━━`);
  formatStateLine("当前", record.lastPoint, color.accent);
  formatStateLine("重生", record.respawnPoint, color.gold);
  if (record.deathPoint) formatStateLine(record.death ? "死亡" : "上次死亡", record.deathPoint, record.death ? color.error : color.muted);
  if (!record.lastPoint && !record.deathPoint) {
    lines.push(`${color.muted}  (当前无 lastPoint，使用重生点)`);
  }

  // ── 经验 ──
  const exp = record.experience;
  const nextNeed = getTotalXpForLevels(exp.level + 1) - getTotalXpForLevels(exp.level);
  lines.push(
    `${color.muted}经验: ${color.accent}Lv.${exp.level} ${color.muted}进度 ${color.info}${exp.xpProgress}${color.muted}/${color.info}${nextNeed} ${color.muted}总经验 ${color.info}${exp.totalXp}`
  );

  // ── 效果 ──
  if (record.effects && record.effects.length > 0) {
    lines.push(`${color.muted}━━ 效果 (${record.effects.length}) ━━`);
    for (const e of record.effects) {
      lines.push(` ${color.info}${e.id.replace("minecraft:", "")} ${color.muted}${e.amplifier + 1}级 ${color.muted}${e.duration}tick`);
    }
  } else {
    lines.push(`${color.muted}效果: ${color.muted}无`);
  }

    pushSafe(() => {
  // ── 手持与装备（在线实时 / 离线缓存） ──
  const formatSerializedPreview = (s: any): string => {
    if (!s) return `${color.muted}空`;
    const ench = s.enchantments && s.enchantments.length > 0 ? ` ${color.muted}[${s.enchantments.map((e: any) => `${e.id.replace("minecraft:", "")} ${e.level}`).join(" ")}]` : "";
    let dur = "";
    if (s.damage !== undefined && s.maxDurability) {
      const cur = s.maxDurability - (s.damage ?? 0);
      dur = ` ${color.muted}(${cur}/${s.maxDurability})`;
    } else if (s.damage !== undefined) {
      dur = ` ${color.muted}(损伤${s.damage})`;
    }
    const name = s.nameTag ? `${color.playerName}${s.nameTag}§r` : `${color.info}${s.typeId.replace("minecraft:", "")}`;
    const amt = s.amount > 1 ? ` ${color.muted}x${s.amount}` : "";
    return `${name}${amt}${ench}${dur}`;
  };

  if (record.online && record.entityId) {
    const bot = world.getEntity(record.entityId) as Player | undefined;
    if (bot) {
      // 身位/视角
      const rot = bot.getRotation();
      lines.push(
        `${color.muted}身位俯仰/偏航: ${color.info}${Math.floor(rot.x)}° ${color.muted}/ ${color.info}${Math.floor(rot.y)}°`
      );
      try {
        const hit = (bot as any).getBlockFromViewDirection?.({ maxDistance: 64 });
        if (hit) {
          const b = hit.block;
          lines.push(`${color.muted}视角方块: ${color.info}${b.typeId} ${color.muted}@ ${formatPos(b.location)} ${color.muted}(${b.dimension.id})`);
        } else {
          lines.push(`${color.muted}视角方块: ${color.muted}无 (空视野)`);
        }
      } catch {
        lines.push(`${color.muted}视角方块: ${color.error}获取失败`);
      }
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
            const ench =
              serialized.enchantments && serialized.enchantments.length > 0
                ? ` ${color.muted}[${serialized.enchantments.map((e) => `${e.id.replace("minecraft:", "")} ${e.level}`).join(" ")}]`
                : "";
            let dur = "";
            if (serialized.damage !== undefined && (serialized as any).maxDurability) {
              const cur = (serialized as any).maxDurability - (serialized.damage ?? 0);
              dur = ` ${color.muted}(${cur}/${(serialized as any).maxDurability})`;
            }
            const name = serialized.nameTag ? `${color.playerName}${serialized.nameTag}§r` : `${color.info}${item.typeId.replace("minecraft:", "")}`;
            const amt = item.amount > 1 ? ` ${color.muted}x${item.amount}` : "";
            // 高亮主手
            const prefix = label === "主手" ? `${color.gold}▶ ` : " ";
            lines.push(`${prefix}${color.muted}${label}: ${name}${amt}${ench}${dur}`);
          } else {
            const prefix = label === "主手" ? `${color.gold}▶ ` : " ";
            lines.push(`${prefix}${color.muted}${label}: ${color.muted}空`);
          }
        }
      }

      // 背包详情（逐格显示，分区）
      const inv = bot.getComponent("minecraft:inventory") as EntityInventoryComponent;
      if (inv?.container) {
        let filled = 0;
        let totalAmt = 0;
        for (let i = 0; i < inv.container.size; i++) if (inv.container.getItem(i)) { filled++; totalAmt += inv.container.getItem(i)!.amount; }
        lines.push(`${color.muted}━━ 背包(0-8快捷栏 9-35背包) ${color.muted}[${color.info}${filled}/36${color.muted}格 ${color.info}${totalAmt}${color.muted}件] ━━`);
        const hotbarItems: string[] = [];
        const backpackItems: string[] = [];
        for (let i = 0; i < inv.container.size; i++) {
          const item = inv.container.getItem(i);
          if (!item) continue;
          const serialized = serializeItemStack(item);
          const ench =
            serialized.enchantments && serialized.enchantments.length > 0
              ? ` ${color.muted}[${serialized.enchantments.map((e) => `${e.id.replace("minecraft:", "")} ${e.level}`).join(" ")}]`
              : "";
          let dur = "";
          if (serialized.damage !== undefined && (serialized as any).maxDurability) {
            const cur = (serialized as any).maxDurability - (serialized.damage ?? 0);
            dur = ` ${color.muted}(${cur}/${(serialized as any).maxDurability})`;
          }
          const name = serialized.nameTag ? `${color.playerName}${serialized.nameTag}§r` : `${color.info}${item.typeId.replace("minecraft:", "")}`;
          const amt = item.amount > 1 ? ` ${color.muted}x${item.amount}` : "";
          const line = `${color.muted}${i < 9 ? `快捷${i}` : `背包${i - 9}`}: ${name}${amt}${ench}${dur}`;
          if (i < 9) hotbarItems.push(line);
          else backpackItems.push(line);
        }
        if (hotbarItems.length) {
          lines.push(`${color.muted}─ 热栏 ─`);
          for (const l of hotbarItems) lines.push(` ${l}`);
        }
        if (backpackItems.length) {
          lines.push(`${color.muted}─ 背包 ─`);
          for (const l of backpackItems) lines.push(` ${l}`);
        }
        if (filled === 0) lines.push(` ${color.muted}空背包`);
      }
    }
  } else {
    lines.push(`${color.muted}━━ 装备/背包(离线缓存) ━━`);
    const savedEquip = botStore.loadEquipment(record.name) as Record<string, any> | undefined;
    if (savedEquip && Object.keys(savedEquip).length > 0) {
      for (const [slot, data] of Object.entries(savedEquip)) {
        const labelMap: Record<string, string> = { head: "头盔", chest: "胸甲", legs: "护腿", feet: "靴子", offhand: "副手" };
        const label = labelMap[slot] ?? slot;
        lines.push(` ${color.muted}${label}: ${formatSerializedPreview(data)}`);
      }
    } else {
      lines.push(` ${color.muted}装备: 无缓存`);
    }
    // 主手离线提示（主手在背包容器中，需通过 loadInventory 查找）
    const saved = botStore.loadInventory(record.name);
    if (saved) {
      let filled = 0;
      let totalAmt = 0;
      for (const it of saved) if (it) { filled++; totalAmt += (it as any).amount ?? 1; }
      lines.push(`${color.muted}背包: ${color.info}${filled}/36 ${color.muted}格 ${color.info}${totalAmt}${color.muted}件 ${color.muted}(缓存)`);
      // 展示前 9 格热栏 + 背包示例（最多展示 10 项防止刷屏）
      let shown = 0;
      for (let i = 0; i < saved.length && shown < 10; i++) {
        const item = saved[i] as any;
        if (!item) continue;
        const preview = formatSerializedPreview({ typeId: item.typeId, amount: item.amount, nameTag: item.nameTag, enchantments: [], damage: undefined } as any);
        // 尝试从真实存储读取序列化（botStore 内部已是 ItemStack，此处简化）
        const slotLabel = i < 9 ? `快捷${i}` : `背包${i - 9}`;
        // 若有真实序列化则用真实，否则用简化
        let line = ` ${color.muted}${slotLabel}: `;
        try {
          // 尝试完整序列化（若 item 是 ItemStack）
          const ser = item.typeId ? { typeId: item.typeId, amount: item.amount, nameTag: item.nameTag } : null;
          line += ser ? `${color.info}${ser.typeId.replace("minecraft:", "")} ${color.muted}x${ser.amount}` : preview;
        } catch { line += preview; }
        lines.push(line);
        shown++;
      }
      if (filled > 10) lines.push(` ${color.muted}… 还有 ${filled - 10} 格未展示，用 /mp:storage 查看详情`);
    } else {
      lines.push(` ${color.muted}背包: 无缓存`);
    }
    // 离线手持提示
    lines.push(`${color.muted}主手: ${color.muted}离线（选中槽未知，查看背包）`);
  }

      }, `${color.muted}持有信息: ${color.muted}无法统计`);

pushSafe(() => lines.push(`${color.gold}========================`), `${color.muted}数据尾异常`);

  // 模态展示：用 ModalForm 呈现（ModelForm），避免聊天刷屏，优化排版与滚动查看
  // 任何单项统计已在 pushSafe 中兜底为“无法统计”，此处保证表单必定弹出
  try {
    const title = `${color.bold}${String((record as any).name ?? "未知")} ${(record as any).death ? style("[死亡]", color.error) : (record as any).online ? style("[在线]", color.success) : style("[离线]", color.warn)}`;
    const builder = new ModalFormBuilder().title(title);
    builder.label("header", `${color.gold}===== ${color.playerName}${String((record as any).name ?? "未知")} ${color.gold}数据总览 =====`);
    let current: string[] = [];
    let secIdx = 0;
    const flush = () => {
      if (current.length === 0) return;
      try {
        const text = current.join("\n");
        builder.label(`sec_${secIdx++}`, text);
        builder.divider();
      } catch {}
      current = [];
    };
    try {
      for (const line of lines.slice(1, -1)) {
        if (typeof line === "string" && line.includes("━━")) {
          flush();
          current.push(line);
        } else {
          current.push(String(line ?? ""));
        }
      }
      flush();
    } catch {
      try { builder.label("fallback", lines.join("\n")); } catch {}
    }
    builder.label("hint", `${color.muted}提示：关闭后可再次点击「查看数据」刷新${color.muted}（单项“无法统计”不影响其余显示）`);
    builder.show(player).catch(() => {
      for (const l of lines) try { player.sendMessage(l); } catch {}
    });
  } catch (e) {
    for (const l of lines) try { player.sendMessage(l); } catch {}
    try { console.warn(`[data] ModalForm 失败回退聊天: ${(e as Error)?.message ?? String(e)}`); } catch {}
  }
}

export function registerDataCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:data",
      description: "查看模拟玩家的完整数据",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const nameInput = params.name as string | undefined;
      if (!nameInput) {
        player.sendMessage(`${color.error}用法: /mp:data <假人名>`);
        return;
      }
      const denied = guardBotCommand(player, nameInput);
      if (denied) {
        player.sendMessage(`${color.error}${denied}`);
        return;
      }
      const record = botRegistry.get(nameInput);
      if (!record) {
        player.sendMessage(`${color.error}未找到模拟玩家 ${color.playerName}${nameInput}${color.error}`);
        return;
      }
      sendData(player, record);
    }
  );
}
