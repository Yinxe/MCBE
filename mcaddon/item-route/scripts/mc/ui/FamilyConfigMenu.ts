// ─── 同族配置菜单（仓库级）：一族一开关 + 族内全部物品列出 ──
// 分页列出全部物品族（core/data item-families，51 族，一族一个启用开关）。
// 每族一行：启用状态 + 物品数；点击进入该族详情（ModalForm：启用 toggle + 族内全部物品中文名列表），
// 提交即写 warehouse.settings.enabledFamilies（经 WarehouseService.updateSettings，meta 持久化）。
// 默认全开（enabledFamilies 空哨兵 = 全部启用，见 Warehouse.isFamilyEnabled）；逐族关闭 → 写显式算法。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { isFamilyEnabled, type Warehouse } from "../../core/model/Warehouse";
import { ITEM_FAMILIES, type ItemFamily } from "../../core/data/item-families";
import { getChineseName } from "../../core/data/ItemNameMap";
import * as uiColor from "./uiColor";

const PAGE = 9; // 每页族数（51 族 → 6 页）

/** 全族 id（默认全开哨兵转显式用） */
const ALL_FAMILY_IDS: string[] = ITEM_FAMILIES.map((f) => f.id);

/** 打开同族配置（owner+）：分页族列表 → 逐族开关 */
export async function showFamilyConfigMenu(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse
): Promise<void> {
  if (!requireRole(deps.members, warehouse, player.name, "owner")) {
    player.sendMessage(`${uiColor.chat.error}需要管理员权限`);
    return;
  }
  let page = 0;
  const totalPages = Math.ceil(ITEM_FAMILIES.length / PAGE);

  const render = (): void => {
    const enabledCount = ITEM_FAMILIES.filter((f) => isFamilyEnabled(warehouse.settings, f.id)).length;
    const form = new ActionFormBuilder()
      .title(`${uiColor.form.title}同族配置 · ${warehouse.displayName}`)
      .body(
        `${uiColor.form.muted}启用 ${uiColor.form.body}${enabledCount}${uiColor.form.muted}/${ITEM_FAMILIES.length} 个族\t` +
          `${uiColor.form.muted}一物一族 · 族内同收\n` +
          `${uiColor.form.muted}点击某族查看/开关其收纳`
      );
    const slice = ITEM_FAMILIES.slice(page * PAGE, page * PAGE + PAGE);
    for (const f of slice) {
      const on = isFamilyEnabled(warehouse.settings, f.id);
      const state = on ? `${uiColor.form.success}✓启用` : `${uiColor.form.error}禁用`;
      form.button(
        `${state} ${uiColor.form.title}${f.displayName} ${uiColor.form.muted}· ${f.items.length} 物品`,
        () => void openDetail(player, deps, warehouse, f, render)
      );
    }
    if (page > 0) form.button(`${uiColor.btn.info}◀上一页`, () => { page--; render(); });
    if (page < totalPages - 1) form.button(`${uiColor.btn.info}下一页▶`, () => { page++; render(); });
    form.button(`${uiColor.btn.nav}返回`, () => undefined);
    void form.show(player);
  };
  render();
}

/** 族详情：启用开关 + 族内全部物品中文名列表；保存即落 enabledFamilies */
function openDetail(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse,
  family: ItemFamily,
  onDone: () => void
): void {
  const itemNames = family.items.map((id) => getChineseName(id)).join("、");
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}同族 · ${family.displayName}`)
    .toggle("enable", `${uiColor.form.accent}启用该族收纳`, {
      defaultValue: isFamilyEnabled(warehouse.settings, family.id),
      tooltip: "关闭后族内物品不再经同族层级路由进",
    })
    .label("items", `${uiColor.form.muted}族内物品（${family.items.length}）\n${uiColor.form.body}${itemNames}`);
  void form.show(player).then((values) => {
    if (!values) return;
    const want = values.enable as boolean;
    const enabledFamilies = toggleFamily(warehouse.settings.enabledFamilies, family.id, want);
    deps.warehouses.updateSettings(warehouse, { enabledFamilies });
    player.sendMessage(
      `${uiColor.chat.success}${family.displayName}族${want ? "已启用" : "已禁用"}（共 ${family.items.length} 物，启用 ${ITEM_FAMILIES.filter((f) => isFamilyEnabled(warehouse.settings, f.id)).length} 族）`
    );
    onDone();
  });
}

/** 计算下一份 enabledFamilies（空哨兵=全开；逐族开关转显式列表）。由 updateSettings 落盘 */
function toggleFamily(cur: string[], familyId: string, want: boolean): string[] {
  const allOn = cur.length === 0;
  if (want) {
    // 启用：空哨兵已是全开（无操作）；显式则补入
    if (allOn) return cur;
    return cur.includes(familyId) ? cur : [...cur, familyId];
  }
  // 禁用：空哨兵 → 物化成全部减一；显式则移除
  const base = allOn ? ALL_FAMILY_IDS : cur;
  return base.filter((id) => id !== familyId);
}