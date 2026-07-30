// ─── 三叉戟选择 UI ────────────────────────────────────
// 模态表单展示假人背包中所有三叉戟，玩家勾选后提交投掷

import { Player, system } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit/ui";

import { botRegistry } from "../features/core/persistence";
import { scanTridents, isMainhandTrident, throwTridents } from "../features/trident";

/**
 * 展示三叉戟选择表单。
 * 若背包中没有三叉戟 → 直接提示，不显示 UI。
 * 若主手已是三叉戟且背包无其他三叉戟 → 直接投掷。
 */
export function showTridentSelector(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`§c假人 §e${botName}§c 已不存在`); return; }
  if (!record.online || record.death) { player.sendMessage("§c假人不在线或已死亡"); return; }

  const tridents = scanTridents(botName);
  if (!tridents) { player.sendMessage("§c无法获取假人实体"); return; }
  if (tridents.length === 0) {
    player.sendMessage("§c假人背包中没有三叉戟");
    return;
  }

  // ── 快速路径：仅主手有三叉戟 → 直接投掷 ──
  if (tridents.length === 1 && tridents[0].isMainhand) {
    player.sendMessage(`§a主手已装备三叉戟，直接投掷`);
    system.run(() => {
      throwTridents(botName, player.id, [tridents[0].slotIndex], () => {
        player.sendMessage(`§a§e${botName}§a 已投掷三叉戟`);
      });
    });
    return;
  }

  // ── 模态表单 ──
  const builder = new ModalFormBuilder();
  builder.title("§l选择要投掷的三叉戟");

  // 每个三叉戟一个开关
  for (const t of tridents) {
    builder.toggle(`slot_${t.slotIndex}`, t.label, { defaultValue: t.isMainhand });
  }

  builder.show(player).then((vals) => {
    if (!vals) return; // 取消

    const selected: number[] = [];
    for (const t of tridents) {
      const key = `slot_${t.slotIndex}`;
      const val = (vals as Record<string, any>)[key];
      if (val === true) {
        selected.push(t.slotIndex);
      }
    }

    if (selected.length === 0) {
      player.sendMessage("§e未选择任何三叉戟");
      return;
    }

    player.sendMessage(`§a准备投掷 §e${selected.length}§a 把三叉戟...`);
    system.run(() => {
      throwTridents(botName, player.id, selected, () => {
        player.sendMessage(`§a§e${botName}§a 投掷完成`);
      });
    });
  });
}
