// ─── 三叉戟选择 UI ────────────────────────────────────
// 模态表单展示假人背包中所有三叉戟，玩家勾选后提交投掷
// 标签格式化在此层完成，trident.ts 只返回原始槽位数据
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    throwTrident 动作 → 弹表单。

import { Player, system, world, ItemStack } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../core/events/UiEvents";
import { botRegistry } from "../bootstrap/context";
import { scanTridents, isMainhandTrident, throwTridents, type TridentSlot } from "../features/trident";
import { formatEnchantments, formatDurability } from "../format";

const SLOT_HOTBAR = 9;

// ─── UI 事件订阅（BOT 主菜单 → 感知投三叉戟动作） ──────

/** 订阅 BOT 主菜单动作事件：投三叉戟 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "throwTrident") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showTridentSelector(player, e.botName);
  });
}

/**
 * 根据原始槽位数据构造模态表单用的彩色标签。
 */
function makeTridentLabel(item: ItemStack, slotIndex: number, isMainhand: boolean): string {
  const slotLabel = isMainhand
    ? `${color.info}[主手]`
    : slotIndex < SLOT_HOTBAR
      ? `${color.info}[热栏${slotIndex + 1}]`
      : `${color.info}[背包${slotIndex + 1}]`;

  const displayName = item.nameTag
    ? `${color.playerName}${item.nameTag}`
    : `${color.success}三叉戟`;

  const enchStr = formatEnchantments(item);
  let durStr = formatDurability(item);
  if (!durStr) durStr = `${color.muted}(∞)`;

  return `${slotLabel} ${displayName} ${enchStr} ${durStr}`;
}

/**
 * 展示三叉戟选择表单。
 * 若背包中没有三叉戟 → 直接提示，不显示 UI。
 * 若主手已是三叉戟且背包无其他三叉戟 → 直接投掷。
 */
export function showTridentSelector(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 已不存在`); return; }
  if (!record.online || record.death) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }

  const tridents = scanTridents(botName);
  if (!tridents) { player.sendMessage(`${color.error}无法获取假人实体`); return; }
  if (tridents.length === 0) {
    player.sendMessage(`${color.error}假人背包中没有三叉戟`);
    return;
  }

  // 预构建标签（每个 TridentsSlot 只需计算一次）
  const labels: string[] = tridents.map((t) => makeTridentLabel(t.item, t.slotIndex, t.isMainhand));

  // ── 快速路径：仅主手有三叉戟 → 直接投掷 ──
  if (tridents.length === 1 && tridents[0].isMainhand) {
    player.sendMessage(`${color.success}主手已装备三叉戟，直接投掷`);
    system.run(() => {
      throwTridents(botName, player.id, [tridents[0].slotIndex], () => {
        player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已投掷三叉戟`);
      });
    });
    return;
  }

  // ── 模态表单 ──
  const builder = new ModalFormBuilder();
  builder.title(`${color.bold}选择要投掷的三叉戟`);

  for (let i = 0; i < tridents.length; i++) {
    builder.toggle(`slot_${tridents[i].slotIndex}`, labels[i], { defaultValue: tridents[i].isMainhand });
  }

  builder.show(player).then((vals) => {
    if (!vals) return;

    const selected: number[] = [];
    for (const t of tridents) {
      const key = `slot_${t.slotIndex}`;
      const val = (vals as Record<string, any>)[key];
      if (val === true) {
        selected.push(t.slotIndex);
      }
    }

    if (selected.length === 0) {
      player.sendMessage(`${color.warn}未选择任何三叉戟`);
      return;
    }

    player.sendMessage(`${color.success}准备投掷 ${color.warn}${selected.length}${color.success} 把三叉戟...`);
    system.run(() => {
      throwTridents(botName, player.id, selected, () => {
        player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 投掷完成`);
      });
    });
  });
}
