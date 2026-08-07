// ─── 同族配置菜单（仓库级）：**单个模态**、一族一开关 ──
// 全部物品族（core/data item-families，45 族）在一个 ModalForm 里逐族开关：
//   · 每族一个 toggle，label = 族名（物品数），tooltip = 该族全部成员中文名（次要展示）。
//   · 提交一次落 warehouse.settings.enabledFamilies（经 WarehouseService.updateSettings，meta 持久化）。
// 默认全开（enabledFamilies 空哨兵 = 全部启用，见 Warehouse.isFamilyEnabled）；
// 全部勾选 → 写空哨兵；有禁用 → 写显式启用列表。
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { isFamilyEnabled, type Warehouse } from "../../core/model/Warehouse";
import { ITEM_FAMILIES } from "../../core/data/item-families";
import { getChineseName } from "../../core/data/ItemNameMap";
import * as uiColor from "./uiColor";

/** 打开同族配置（owner+）：单个模态，一族一个开关（成员中文名在 tooltip） */
export async function showFamilyConfigMenu(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse
): Promise<void> {
  if (!requireRole(deps.members, warehouse, player.name, "owner")) {
    player.sendMessage(`${uiColor.chat.error}需要管理员权限`);
    return;
  }
  const enabledCount = ITEM_FAMILIES.filter((f) => isFamilyEnabled(warehouse.settings, f.id)).length;
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}同族配置 · ${warehouse.displayName}`)
    .label(
      "info",
      `${uiColor.form.muted}已启用 ${uiColor.form.body}${enabledCount}${uiColor.form.muted}/${ITEM_FAMILIES.length} 族\t` +
        `${uiColor.form.muted}一物一族 · 族内同收\n` +
        `${uiColor.form.muted}每个族一个开关，族员鼠标悬停可见`
    );
  for (const f of ITEM_FAMILIES) {
    const memberNames = f.items.map((id) => getChineseName(id)).join("、");
    form.toggle(`fam_${f.id}`, `${f.displayName}（${f.items.length} 物）`, {
      defaultValue: isFamilyEnabled(warehouse.settings, f.id),
      tooltip: `族员：${memberNames}`,
    });
  }
  const values = await form.show(player);
  if (!values) return;
  // 逐族读取开关 → 启用列表（默认全关：空 = 不启用任何族；玩家勾选即启用）
  const enabled: string[] = [];
  for (const f of ITEM_FAMILIES) {
    if (values[`fam_${f.id}`] === true) enabled.push(f.id);
  }
  deps.warehouses.updateSettings(warehouse, { enabledFamilies: enabled });
  player.sendMessage(
    `${uiColor.chat.success}同族配置已保存（启用 ${enabled.length}/${ITEM_FAMILIES.length} 族）`
  );
}