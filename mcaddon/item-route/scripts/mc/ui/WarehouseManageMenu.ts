// ─── 仓库列表：管理员全部 / 普通玩家成员身份 ────────────────
// 可见性：OP（canManage）或拥有任一仓库 → 全部；否则仅显示有成员身份的仓库。
// 按钮附 维度 + 面积（x×y×z=体积格）+ 管理员显示 owner（v1 WarehouseManageMenu 同款），
// 选择仓库后进入 showWarehouseSettingsMenu（其内 ensureContainersLoaded 按需加载容器）。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, canManage } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";
import { areaSize } from "../../core/services/WarehouseService";
import { dimensionShort } from "../../core/model/ContainerId";
import { isMenuInfoOn } from "../../core/data/MenuInfo";
import * as uiColor from "./uiColor";

/**
 * 展示仓库列表（主菜单"仓库列表"入口）：按管理员/成员身份筛选可见仓库，按名排序。
 * 空列表给出提示；按钮附 维度/面积/owner 信息（按 OPInfoConfigUI 开关，可关掉不显示）；
 * 选择后跳转仓库设置。
 *
 * @param player - 打开列表的玩家
 * @param deps   - 命令共享依赖门面
 */
export async function showWarehouseManageMenu(player: Player, deps: CommandDeps): Promise<void> {
  const all = deps.loadedWarehouses();
  const ownsAny = all.some((w) => w.ownerName === player.name);
  const isAdmin = canManage(player);
  const visible = isAdmin || ownsAny ? all : all.filter((w) => deps.members.getRole(w, player.name) !== undefined);

  if (visible.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}没有可管理的仓库`);
    return;
  }

  // 仓库名按钮在浅灰背景上 → 深色前景；附 owner/ID/维度/规格（OPInfoConfigUI 开关控制）
  const info = deps.config.menuInfo;
  const form = new ActionFormBuilder().title(`${uiColor.form.title}仓库列表`).body(`${uiColor.form.body}选择仓库：`);
  for (const w of [...visible].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    const parts: string[] = [`${uiColor.btn.nav}${w.displayName}`];
    if (isAdmin && w.ownerName !== player.name && isMenuInfoOn(info, "warehouseOwner")) {
      parts.push(`${uiColor.btn.info}(${w.ownerName})`);
    }
    if (isMenuInfoOn(info, "warehouseId")) parts.push(`${uiColor.form.muted}${w.id}`);
    if (isMenuInfoOn(info, "warehouseDimension") || isMenuInfoOn(info, "warehouseSpec")) {
      const size = areaSize(w.area);
      parts.push(
        `${uiColor.btn.info} ` +
          (isMenuInfoOn(info, "warehouseDimension") ? `${dimensionShort(w.area.dimension)} ` : "") +
          (isMenuInfoOn(info, "warehouseSpec") ? `${size.x}×${size.y}×${size.z}=${size.volume}格` : "")
      );
    }
    form.button(parts.join(" "), () => void showWarehouseSettingsMenu(player, deps, w));
  }
  await form.show(player);
}
