import {
  Player,
} from "@minecraft/server";
import {
  ActionFormBuilder,
  ModalFormBuilder,
  notifySuccess,
} from "@yinxe/toolkit";
import {
  getSortedWaypoints,
  createWaypoint,
  deleteWaypoint,
  togglePin,
  togglePublic,
  incrementTeleportCount,
  editWaypoint,
  updateWaypointLocation,
} from "../teleporter/waypointManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { getBiomeName } from "../teleporter/detection";
import { WAYPOINT_CATEGORIES, WaypointCategory, WaypointRecord } from "../teleporter/types";
import { showMainMenu } from "./menu";

// ─── 传送点选择器（ModalForm 下拉选择，不分页） ──────────────────────

/**
 * 快速选择传送点（ModalForm 下拉选择框）。
 * 选中后立即传送。
 */
export function showWarpSelector(player: Player): void {
  const waypoints = getSortedWaypoints(player.id);

  if (waypoints.length === 0) {
    player.sendMessage("§6还未设置传送点，使用 §f/tpa:setwarp <名称> §6创建或到主菜单新建");
    showMainMenu(player);
    return;
  }

  const options = waypoints.map((wp) => {
    const pin = wp.isPinned ? "★ " : "";
    const biome = wp.biomeInfo ? ` ${wp.biomeInfo}` : "";
    const dim = shortDimension(wp.dimensionId);
    const loc = `${Math.floor(wp.location.x)} ${Math.floor(wp.location.y)} ${Math.floor(wp.location.z)}`;
    return `${pin}${wp.name}§r${biome} §f${dim} ${loc} §6${wp.teleportCount}次`;
  });

  new ModalFormBuilder()
    .title("§l选择传送点")
    .dropdown("warp", "点击选择要传送的传送点", options, { defaultValueIndex: 0 })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const idx = vals.warp as number;
      const wp = waypoints[idx];
      if (!wp) return;
      incrementTeleportCount(player.id, wp.id);
      const ok = teleportPlayerTo(player, wp.location, wp.dimensionId);
      if (ok) {
        notifySuccess(player, `§a已传送到 §e${wp.name} §6（${formatLocation(wp.location, wp.dimensionId)}§6）`);
      } else {
        player.sendMessage(`§c传送到 §e${wp.name}§c 失败`);
      }
    });
}

// ─── 传送点管理列表（ActionForm，无分页） ────────────────────────────

/**
 * 管理传送点列表（ActionForm，不分页）。
 * 点击进入单个传送点的操作菜单。
 */
export function showWarpManagement(player: Player): void {
  const waypoints = getSortedWaypoints(player.id);

  if (waypoints.length === 0) {
    player.sendMessage("§6还未设置传送点");
    showMainMenu(player);
    return;
  }

  const form = new ActionFormBuilder()
    .title(`§l传送点管理 (${waypoints.length})`);

  for (const wp of waypoints) {
    const pinIcon = wp.isPinned ? "★ " : "";
    const pubIcon = wp.isPublic ? " 🌐" : "";
    const dim = shortDimension(wp.dimensionId);
    const loc = `${Math.floor(wp.location.x)} ${Math.floor(wp.location.y)} ${Math.floor(wp.location.z)}`;
    const biome = wp.biomeInfo ? ` ${wp.biomeInfo}` : "";
    const label =
      `${pinIcon}§e${wp.name}§r${biome}${pubIcon}\n§f${dim} ${loc} §6${wp.teleportCount}次`;

    form.button(label, () => showWaypointActions(player, wp));
  }

  form.button("§a✚ 新建传送点", () => showCreateWarpForm(player));
  form.button("§c← 返回主菜单", () => showMainMenu(player));

  form.show(player);
}

// ─── 单个传送点的管理表单（ModalForm） ──────────────────────────────

function showWaypointActions(
  player: Player,
  wp: WaypointRecord,
): void {
  const catIndex = WAYPOINT_CATEGORIES.indexOf(wp.category as WaypointCategory);

  new ModalFormBuilder()
    .title(`§l${wp.isPinned ? "★ " : ""}${wp.name}`)
    .label("info",
      `§7${wp.category}   §7${wp.biomeInfo || "未知"}\n` +
      `§b坐标 §f${Math.floor(wp.location.x)} ${Math.floor(wp.location.y)} ${Math.floor(wp.location.z)}\n` +
      `§b维度 §f${fullDimension(wp.dimensionId)}\n` +
      `§b传送 §f${wp.teleportCount}次   §b公共 ${wp.isPublic ? "§a是" : "§c否"}`,
    )
    .divider()
    .textField("name", "名称", { defaultValue: wp.name })
    .dropdown("category", "分类", WAYPOINT_CATEGORIES as unknown as string[], {
      defaultValueIndex: Math.max(0, catIndex),
    })
    .textField("note", "备注", { defaultValue: wp.note })
    .toggle("pinned", "§b置顶", { defaultValue: wp.isPinned })
    .toggle("isPublic", "§a设为公共传送点", { defaultValue: wp.isPublic })
    .toggle("updateLocation", "§e更新坐标到当前位置", { defaultValue: false,
      tooltip: "将传送点坐标更新到你当前所在位置" })
    .toggle("doTeleport", "§a传送到此传送点", { defaultValue: false,
      tooltip: "保存后立即传送到此传送点" })
    .toggle("deleteWarp", "§c删除此传送点", { defaultValue: false,
      tooltip: "永久删除此传送点" })
    .submitButton("§a保存")
    .show(player)
    .then((vals) => {
      if (!vals) return;

      // 收集修改
      const newName = (vals.name as string).trim() || wp.name;
      const newCat = WAYPOINT_CATEGORIES[vals.category as number] as WaypointCategory;
      const newNote = (vals.note as string).trim();
      const newPinned = vals.pinned as boolean;
      const newPublic = vals.isPublic as boolean;
      const shouldUpdateLocation = vals.updateLocation as boolean;
      const shouldTeleport = vals.doTeleport as boolean;
      const shouldDelete = vals.deleteWarp as boolean;

      // 互斥检验：三个操作不能同时选择
      const selectedOps = [shouldUpdateLocation, shouldTeleport, shouldDelete].filter(Boolean);
      if (selectedOps.length > 1) {
        player.sendMessage("§c更新坐标、传送和删除不能同时使用");
        showWarpManagement(player);
        return;
      }

      // 删除操作（优先处理，跳过保存编辑）
      if (shouldDelete) {
        deleteWaypoint(player.id, wp.id);
        player.sendMessage(`§c已删除传送点 §e${newName}`);
        showWarpManagement(player);
        return;
      }

      // 保存编辑
      editWaypoint(player.id, wp.id, {
        name: newName !== wp.name ? newName : undefined,
        category: newCat !== wp.category ? newCat : undefined,
        note: newNote !== wp.note ? newNote : undefined,
      });

      // 更新置顶
      if (newPinned !== wp.isPinned) {
        togglePin(player.id, wp.id);
      }

      // 更新公共
      if (newPublic !== wp.isPublic) {
        const result = togglePublic(player.id, wp.id);
        if (result === "denied") {
          player.sendMessage("§c公共传送点功能已关闭");
        }
      }

      // 更新坐标到当前位置
      if (shouldUpdateLocation) {
        updateWaypointLocation(
          player.id, wp.id,
          player.location,
          player.dimension.id,
        );
        player.sendMessage(`§a已更新 §e${newName} §a的坐标到当前位置`);
      }

      // 传送到传送点
      if (shouldTeleport) {
        incrementTeleportCount(player.id, wp.id);
        const ok = teleportPlayerTo(player, wp.location, wp.dimensionId);
        if (ok) {
          notifySuccess(player, `§a已传送到 §e${newName} §6（${formatLocation(wp.location, wp.dimensionId)}§6）`);
        } else {
          player.sendMessage(`§c传送到 §e${newName}§c 失败`);
        }
      }

      player.sendMessage(`§a已保存 §e${newName} §a的修改`);
      showWarpManagement(player);
    });
}

// ─── 新建传送点（自动检测群系） ──────────────────────────────────────

export function showCreateWarpForm(player: Player): void {
  const loc = player.location;
  const dim = player.dimension.id;

  // 自动检测群系
  let detectedBiome: string | null = null;
  try {
    detectedBiome = getBiomeName(player.dimension, loc);
  } catch {
    // 忽略检测失败
  }

  // 根据检测结果自动建议分类
  let defaultCategoryIndex = 0;
  if (detectedBiome) {
    defaultCategoryIndex = (WAYPOINT_CATEGORIES as readonly string[]).indexOf("群系");
    if (defaultCategoryIndex < 0) defaultCategoryIndex = 0;
  }

  new ModalFormBuilder()
    .title("§l新建传送点")
    .label("info", detectedBiome ? `§b检测到 §f${detectedBiome}` : "§c（无法检测）")
    .divider()
    .textField("name", "传送点名称", {
      defaultValue: "",
      tooltip: "输入传送点名称",
    })
    .dropdown("category", "分类", WAYPOINT_CATEGORIES as unknown as string[], {
      defaultValueIndex: defaultCategoryIndex,
      tooltip: detectedBiome ? "根据群系已自动推荐" : "",
    })
    .textField("note", "备注（可选）", {
      defaultValue: detectedBiome ? `位于 ${detectedBiome}` : "",
      tooltip: "自定义备注信息",
    })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const name = (vals.name as string).trim();
      if (!name) {
        player.sendMessage("§c传送点名称不能为空");
        return;
      }

      const cat = WAYPOINT_CATEGORIES[vals.category as number] as WaypointCategory;
      const note = (vals.note as string).trim();

      const err = createWaypoint(
        player, name, cat, note, loc, dim,
        detectedBiome ?? undefined,
      );
      if (err) {
        player.sendMessage(err);
        return;
      }
      notifySuccess(player, `§a已创建传送点 §e${name}`);
      showWarpManagement(player);
    });
}

// ─── 维度格式化 ─────────────────────────────────────────────────────

function shortDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld": return "主世界";
    case "minecraft:nether": return "下界";
    case "minecraft:the_end": return "末地";
    default: return dimId.split(":")[1] || dimId;
  }
}

function fullDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld": return "主世界";
    case "minecraft:nether": return "下界 (Nether)";
    case "minecraft:the_end": return "末地 (The End)";
    default: return dimId;
  }
}
