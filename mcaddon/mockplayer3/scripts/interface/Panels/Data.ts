// ─── 数据面板 ───
// Modal 优先 + 聊天兜底：行数组先构建（两呈现共用），每节 pushSafe 容错，
// 单项失败只显"无法统计"，表单必定弹出。

import { EquipmentSlot } from "@minecraft/server";
import type { ItemStack, Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord, EquipSlotName } from "../../domain/Record";
import { BOT_MARKER_TAG } from "../../domain/Record";
import { totalXpForLevel } from "../../domain/XpMath";
import { modeSpec } from "../../domain/Catalog";
import type { ItemSummary } from "../../engine/PanelOps";
import { entityGateway } from "../../engine/EntityGateway";
import { botStatus, formatDimension, formatDurability, formatEnchantments, formatPos, uiViewer } from "../Kit";
import { services } from "../../Composition";

const EQUIP_LABELS: Record<EquipSlotName, string> = {
  head: "头盔",
  chest: "胸甲",
  legs: "护腿",
  feet: "靴子",
  offhand: "副手",
};

function stripType(typeId: string): string {
  return typeId.replace("minecraft:", "");
}

function describeItem(item: ItemStack | undefined): string {
  if (!item) return "空";
  const summary = services.panelOps.itemSummary(item);
  const name = item.nameTag || stripType(item.typeId);
  const amount = item.amount > 1 ? ` amount x${item.amount}` : "";
  const ench = summary ? formatEnchantments(summary).replace(/§[0-9a-f]/gi, "") : "";
  const dur = summary ? formatDurability(summary).replace(/§[0-9a-f]/gi, "") : "";
  return [`${name}${amount}`, ench, dur].filter(Boolean).join(" ");
}

function slotName(i: number): string {
  return i < 9 ? `快捷${i}` : `背包${i - 9}`;
}

export function sendData(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  const { ops, panelOps, runtime } = services;
  const lines: string[] = [];
  const pushSafe = (fn: () => void, fallback?: string): void => {
    try {
      fn();
    } catch (e) {
      lines.push(fallback ?? `${color.muted}该节数据无法统计: ${color.muted}${(e as Error)?.message ?? String(e)}`);
    }
  };
  const st = botStatus(record);
  const live = st.online && !st.death;
  const pose = live ? ops.readPose(record.botId) : null;
  const dimId = pose?.dimensionId ?? record.dimensionId;
  const curPos = pose?.position ?? record.home.position;

  pushSafe(() => lines.push(`${color.gold}===== ${color.playerName}${record.name} ${color.gold}数据总览 =====`));
  pushSafe(() => {
    const points: { label: string; dim: string; pos: { x: number; y: number; z: number } }[] = [
      { label: "当前", dim: dimId, pos: curPos },
    ];
    if (record.respawnPoint)
      points.push({ label: "重生", dim: record.respawnPoint.dimensionId, pos: record.respawnPoint.position });
    for (const cp of points) {
      const loaded = panelOps.chunkLoadedAt(cp.dim, cp.pos);
      lines.push(
        `${color.muted}${cp.label}区块(${formatDimension(cp.dim)} ${formatPos(cp.pos)}): ${loaded ? `${color.success}已加载` : `${color.error}未加载`}`
      );
    }
  });
  pushSafe(() => {
    const statusStr = st.death
      ? `${color.error}死亡`
      : live
        ? `${color.success}${modeSpec(record.workMode).label}`
        : `${color.muted}离线`;
    const session = runtime.session(record.botId);
    lines.push(
      `${color.muted}状态: ${statusStr}  ${color.muted}主人: ${record.ownerKey ?? color.muted + "无"}  ${color.muted}实体ID: ${session?.entityId ?? "无"}`
    );
  });
  pushSafe(() => {
    lines.push(`${color.muted}所在维度: ${color.accent}${formatDimension(record.dimensionId)}`);
  });
  pushSafe(() => {
    lines.push(
      `${color.muted}潜行: ${record.switches.sneaking ? color.success + "是" : color.muted + "否"}  ${color.muted}在线: ${live ? color.success + "是" : color.muted + "否"}  ${color.muted}死亡: ${st.death ? color.error + "是" : color.muted + "否"}`
    );
  });
  pushSafe(() => {
    const tags = record.tags.filter((t) => t !== BOT_MARKER_TAG);
    let line = `${color.muted}标签: ${color.accent}${tags.join(" ") || color.muted + "无"}`;
    if (record.workMode !== "none") {
      line += `${color.muted} 工作模式: ${color.success}${modeSpec(record.workMode).label}`;
    }
    lines.push(line);
  });
  pushSafe(() => {
    lines.push(`${color.muted}━━ 位置详情 ━━`);
    const homeLine = `${color.info}当前: ${Math.floor(record.home.position.x)} ${Math.floor(record.home.position.y)} ${Math.floor(record.home.position.z)} ${color.darkGray}${formatDimension(record.dimensionId)} ${color.muted}偏航${Math.floor(record.home.yaw)}° 俯仰${Math.floor(record.home.pitch)}°`;
    if (live && pose) {
      lines.push(
        `${color.success}实体: ${Math.floor(pose.position.x)} ${Math.floor(pose.position.y)} ${Math.floor(pose.position.z)} ${color.darkGray}${formatDimension(pose.dimensionId)} ${color.muted}偏航${Math.floor(pose.yaw)}° 俯仰${Math.floor(pose.pitch)}°`
      );
    }
    lines.push(homeLine);
    if (record.respawnPoint) {
      const rp = record.respawnPoint;
      lines.push(
        `${color.accent}重生: ${Math.floor(rp.position.x)} ${Math.floor(rp.position.y)} ${Math.floor(rp.position.z)} ${color.darkGray}${formatDimension(rp.dimensionId)} ${color.muted}偏航${Math.floor(rp.yaw)}° 俯仰${Math.floor(rp.pitch)}°`
      );
    } else {
      lines.push(`${color.muted}  (未设重生点，使用家点)`);
    }
  });
  pushSafe(() => {
    const exp = record.experience;
    const nextNeed = totalXpForLevel(exp.level + 1) - totalXpForLevel(exp.level);
    lines.push(
      `${color.muted}经验: ${color.accent}Lv.${exp.level} ${color.muted}进度 ${color.info}${exp.progress}${color.muted}/${color.info}${nextNeed} ${color.muted}总经验 ${color.info}${exp.totalXp}`
    );
  });
  pushSafe(() => {
    const effects = live ? ops.captureEffects(record.botId) : record.effects;
    if (effects.length > 0) {
      lines.push(`${color.muted}━━ 效果 (${effects.length}) ━━`);
      for (const e of effects)
        lines.push(
          ` ${color.info}${stripType(e.id)} ${color.accent}${e.amplifier + 1}级 ${color.muted}${e.durationTicks}tick`
        );
    } else {
      lines.push(`${color.muted}效果: 无`);
    }
  });
  pushSafe(() => {
    if (live) {
      const bot = entityGateway.resolveBot(record.botId) ?? undefined;
      const inv = bot?.getComponent("minecraft:inventory");
      const equippable = bot?.getComponent("minecraft:equippable");
      const container = inv?.container;
      if (pose) lines.push(`${color.muted}身位俯仰/偏航: ${Math.floor(pose.pitch)}° / ${Math.floor(pose.yaw)}°`);
      const hit = panelOps.viewTarget(record.botId);
      const block = hit ? (bot?.dimension.getBlock(hit.center) ?? undefined) : undefined;
      lines.push(
        hit && block
          ? `${color.muted}视角方块: ${color.info}${block.typeId} ${color.muted}@ ${formatPos(hit.center)} ${color.muted}(${formatDimension(record.dimensionId)})`
          : hit
            ? `${color.muted}视角方块: 获取失败`
            : `${color.muted}视角方块: 无 (空视野)`
      );
      lines.push(`${color.muted}━━ 装备 ━━`);
      const selected = bot && container ? bot.selectedSlotIndex : -1;
      const equipRow = (label: string, item: ItemStack | undefined, marker: string): string =>
        `${marker}${label}: ${item ? `${color.info}${describeItem(item)}` : color.muted + "空"}`;
      lines.push(equipRow("头盔", equippable?.getEquipment(EquipmentSlot.Head), " "));
      lines.push(equipRow("胸甲", equippable?.getEquipment(EquipmentSlot.Chest), " "));
      lines.push(equipRow("护腿", equippable?.getEquipment(EquipmentSlot.Legs), " "));
      lines.push(equipRow("靴子", equippable?.getEquipment(EquipmentSlot.Feet), " "));
      lines.push(equipRow("主手", selected >= 0 ? container?.getItem(selected) : undefined, `${color.gold}▶ `));
      lines.push(equipRow("副手", equippable?.getEquipment(EquipmentSlot.Offhand), " "));
      if (container) {
        const items: (ItemStack | undefined)[] = [];
        for (let i = 0; i < container.size; i++) items.push(container.getItem(i));
        const filled = items.filter((x): x is ItemStack => Boolean(x));
        const totalAmt = filled.reduce((n, x) => n + x.amount, 0);
        lines.push(`${color.muted}━━ 背包(0-8快捷栏 9-35背包) [${filled.length}/36格 ${totalAmt}件] ━━`);
        if (filled.length === 0) {
          lines.push(`${color.muted}空背包`);
        } else {
          lines.push(`${color.muted}─ 热栏 ─`);
          for (let i = 0; i < 9; i++)
            if (items[i]) lines.push(` ${slotName(i)}: ${color.info}${describeItem(items[i])}`);
          lines.push(`${color.muted}─ 背包 ─`);
          for (let i = 9; i < 36; i++)
            if (items[i]) lines.push(` ${slotName(i)}: ${color.info}${describeItem(items[i])}`);
        }
      }
    } else {
      lines.push(`${color.muted}━━ 装备/背包(离线缓存) ━━`);
      const vault = panelOps.vaultSlots(record.botId);
      const equip = vault.equip ?? {};
      const equipFilled = (Object.keys(EQUIP_LABELS) as EquipSlotName[]).filter((n) => equip[n]);
      if (equipFilled.length === 0) {
        lines.push(`${color.muted}装备: 无缓存`);
      } else {
        for (const n of equipFilled)
          lines.push(` ${EQUIP_LABELS[n]}: ${color.info}${describeSummary(equip[n] as ItemSummary)}`);
      }
      const inv = vault.inv ?? [];
      const filled = inv.filter((s): s is ItemSummary => s !== null);
      if (filled.length === 0) {
        lines.push(`${color.muted}背包: 无缓存`);
      } else {
        const totalAmt = filled.reduce((n, s) => n + s.amount, 0);
        lines.push(`${color.muted}背包: ${filled.length}/36 格 ${totalAmt}件 (缓存)`);
        filled
          .slice(0, 10)
          .forEach((s, i) => lines.push(` ${slotName(inv.indexOf(s))}: ${color.info}${describeSummary(s)}`));
        if (filled.length > 10)
          lines.push(`${color.muted}… 还有 ${filled.length - 10} 格未展示，用 /mp:storage 查看详情`);
      }
      lines.push(`${color.muted}主手: 离线（选中槽未知，查看背包）`);
    }
  }, `${color.muted}持有信息: ${color.muted}无法统计`);
  pushSafe(() => lines.push(`${color.gold}========================`), `${color.muted}数据尾异常`);

  // ── 呈现：Modal 分段，失败逐行聊天兜底 ──
  const statusTag = st.death ? "§c[死亡]" : live ? "§a[在线]" : "§e[离线]";
  const chatFallback = (why?: unknown): void => {
    for (const line of lines) say(line);
    if (why !== undefined) console.warn(`[mockplayer3] data ModalForm 失败回退聊天: ${why}`);
  };
  try {
    const builder = new ModalFormBuilder()
      .title(`${color.bold}${record.name} ${statusTag}`)
      .label("overview", lines[0]!);
    let seg: string[] = [];
    let n = 0;
    for (const line of lines.slice(1, -1)) {
      if (line.includes("━━") && seg.length > 0) {
        builder.label(`sec_${n++}`, seg.join("\n")).divider();
        seg = [];
      }
      seg.push(line);
    }
    if (seg.length > 0) builder.label(`sec_${n}`, seg.join("\n"));
    builder.label(
      "hint",
      `${color.muted}提示：关闭后可再次点击「查看数据」刷新${color.muted}（单项"无法统计"不影响其余显示）`
    );
    // 内容全为 label（零交互），弹出即完成呈现；builder 内部异常与取消不可分辨，不做聊天兜底
    void builder.show(player);
  } catch (e) {
    chatFallback(e);
  }
}

function describeSummary(s: ItemSummary): string {
  const name = s.nameTag || stripType(s.typeId);
  const amount = s.amount > 1 ? ` amount x${s.amount}` : "";
  const ench = formatEnchantments(s).replace(/§[0-9a-f]/gi, "");
  const dur = formatDurability(s).replace(/§[0-9a-f]/gi, "");
  return [`${name}${amount}`, ench, dur].filter(Boolean).join(" ");
}
