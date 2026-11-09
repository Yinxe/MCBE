// ─── 传送点界面:快速选择 / 管理列表 / 单点操作 / 新建 ──────────
//
// 所有会改动存档的动作都走 ../warpService,与命令入口共用同一套校验与计次规则。

import type { Player } from "@minecraft/server";
import {
  ActionFormBuilder,
  ModalFormBuilder,
  notifySuccess,
} from "@mc-toolchain/mod-common";
import { sortWaypoints, updateWaypointLocation } from "../../core/waypoints";
import { formatLocation } from "../../core/naming";
import {
  WAYPOINT_CATEGORIES,
  type WaypointCategory,
  type WaypointRecord,
} from "../../core/types";
import { detectBiomeName } from "../detection";
import { loadConfig, loadPlayerData, savePlayerData } from "../store";
import {
  applyWaypointEdits,
  applyWaypointPin,
  createWarpAtPlayer,
  warpToWaypoint,
} from "../warpService";
import { showMainMenu } from "./menu";
import { waypointSummary } from "./shared";

/** 快速选择:下拉列出全部传送点,选中后立即传送。 */
export async function showWarpSelector(player: Player): Promise<void> {
  const waypoints = sortWaypoints(loadPlayerData(player.id).waypoints);

  if (waypoints.length === 0) {
    player.sendMessage(
      "§6还未设置传送点,使用 §f/tpa:setwarp <名称> §6创建或到主菜单新建",
    );
    await showMainMenu(player);
    return;
  }

  const values = await new ModalFormBuilder()
    .title("§l选择传送点")
    .dropdown(
      "warp",
      "点击选择要传送的传送点",
      waypoints.map(waypointSummary),
      { defaultValueIndex: 0 },
    )
    .show(player);

  if (!values) return;

  const waypoint = waypoints[values.warp as number];
  if (!waypoint) return;

  warpToWaypoint(player, waypoint.id);
}

/** 管理列表:每个传送点一个按钮,底部是新建与返回。 */
export async function showWarpManagement(player: Player): Promise<void> {
  const waypoints = sortWaypoints(loadPlayerData(player.id).waypoints);

  if (waypoints.length === 0) {
    player.sendMessage("§6还未设置传送点");
    await showMainMenu(player);
    return;
  }

  const form = new ActionFormBuilder().title(
    `§l传送点管理 (${waypoints.length})`,
  );
  for (const waypoint of waypoints) {
    form.button(waypointSummary(waypoint), () =>
      showWaypointActions(player, waypoint.id),
    );
  }
  form.button("§a✚ 新建传送点", () => showCreateWarpForm(player));
  form.button("§c← 返回主菜单", () => showMainMenu(player));

  await form.show(player);
}

/** 单个传送点的操作表单。更新坐标 / 传送 / 删除三项互斥。 */
async function showWaypointActions(
  player: Player,
  waypointId: string,
): Promise<void> {
  // 每次重新读存档,避免用界面打开时的旧快照
  const current = loadPlayerData(player.id).waypoints.filter(
    (item) => item.id === waypointId,
  )[0];
  if (!current) {
    player.sendMessage("§c该传送点已不存在");
    await showWarpManagement(player);
    return;
  }

  const values = await new ModalFormBuilder()
    .title(`§l${current.isPinned ? "★ " : ""}${current.name}`)
    .label("info", describeWaypoint(current))
    .divider()
    .textField("name", "名称", { defaultValue: current.name })
    .dropdown("category", "分类", WAYPOINT_CATEGORIES as unknown as string[], {
      defaultValueIndex: Math.max(
        0,
        (WAYPOINT_CATEGORIES as readonly string[]).indexOf(current.category),
      ),
    })
    .textField("note", "备注", { defaultValue: current.note })
    .toggle("pinned", "§b置顶", { defaultValue: current.isPinned })
    .toggle("isPublic", "§a设为公共传送点", { defaultValue: current.isPublic })
    .toggle("updateLocation", "§e更新坐标到当前位置", {
      defaultValue: false,
      tooltip: "将传送点坐标更新到你当前所在位置",
    })
    .toggle("doTeleport", "§a传送到此传送点", {
      defaultValue: false,
      tooltip: "保存后立即传送到此传送点",
    })
    .toggle("deleteWarp", "§c删除此传送点", {
      defaultValue: false,
      tooltip: "永久删除此传送点",
    })
    .submitButton("§a保存")
    .show(player);

  if (!values) return;

  const wantUpdateLocation = values.updateLocation === true;
  const wantTeleport = values.doTeleport === true;
  const wantDelete = values.deleteWarp === true;

  // 互斥校验:三项只能选一项
  if (
    [wantUpdateLocation, wantTeleport, wantDelete].filter(Boolean).length > 1
  ) {
    player.sendMessage("§c更新坐标、传送和删除不能同时使用");
    await showWarpManagement(player);
    return;
  }

  const newName = String(values.name ?? "").trim() || current.name;

  if (wantDelete) {
    const data = loadPlayerData(player.id);
    data.waypoints = data.waypoints.filter((item) => item.id !== waypointId);
    savePlayerData(player.id, data);
    player.sendMessage(`§c已删除传送点 §e${newName}`);
    await showWarpManagement(player);
    return;
  }

  // 名称 / 分类 / 备注
  applyWaypointEdits(player, waypointId, {
    name: newName,
    category: WAYPOINT_CATEGORIES[
      values.category as number
    ] as WaypointCategory,
    note: String(values.note ?? "").trim(),
  });

  // 置顶
  applyWaypointPin(player, waypointId, values.pinned === true);

  // 公共状态
  if ((values.isPublic === true) !== current.isPublic) {
    togglePublicFromUi(player, waypointId);
  }

  // 更新坐标
  if (wantUpdateLocation) {
    const data = loadPlayerData(player.id);
    updateWaypointLocation(
      data,
      waypointId,
      player.location,
      player.dimension.id,
    );
    savePlayerData(player.id, data);
    player.sendMessage(`§a已更新 §e${newName} §a的坐标到当前位置`);
  }

  if (wantTeleport) {
    warpToWaypoint(player, waypointId);
    return;
  }

  notifySuccess(player, `已保存 §e${newName} §a的修改`);
  await showWarpManagement(player);
}

/** 传送点详情文本。 */
function describeWaypoint(waypoint: WaypointRecord): string {
  return (
    `§7${waypoint.category}   §7${waypoint.biomeInfo ?? "未知"}\n` +
    `§b坐标 §f${formatLocation(waypoint.location, waypoint.dimensionId)}\n` +
    `§b传送 §f${waypoint.teleportCount}次   §b公共 ${waypoint.isPublic ? "§a是" : "§c否"}`
  );
}

/** 从界面翻转公共状态。功能被关闭时给出提示。 */
function togglePublicFromUi(player: Player, waypointId: string): void {
  const config = loadConfig();
  if (!config.publicWaypointEnabled) {
    player.sendMessage("§c公共传送点功能已关闭");
    return;
  }

  const data = loadPlayerData(player.id);
  const waypoint = data.waypoints.filter((item) => item.id === waypointId)[0];
  if (!waypoint) return;

  waypoint.isPublic = !waypoint.isPublic;
  savePlayerData(player.id, data);
}

/** 新建传送点:自动检测群系并推荐分类。 */
export async function showCreateWarpForm(player: Player): Promise<void> {
  const detectedBiome = detectBiomeName(player.dimension, player.location);

  // 检测到群系时把分类默认指向「群系」
  let defaultCategoryIndex = 0;
  if (detectedBiome) {
    const index = (WAYPOINT_CATEGORIES as readonly string[]).indexOf("群系");
    if (index >= 0) defaultCategoryIndex = index;
  }

  const values = await new ModalFormBuilder()
    .title("§l新建传送点")
    .label(
      "info",
      detectedBiome ? `§b检测到 §f${detectedBiome}` : "§c(无法检测群系)",
    )
    .divider()
    .textField("name", "传送点名称", {
      defaultValue: "",
      tooltip: "输入传送点名称",
    })
    .dropdown("category", "分类", WAYPOINT_CATEGORIES as unknown as string[], {
      defaultValueIndex: defaultCategoryIndex,
      tooltip: detectedBiome ? "根据群系已自动推荐" : "",
    })
    .textField("note", "备注(可选)", {
      defaultValue: detectedBiome ? `位于 ${detectedBiome}` : "",
      tooltip: "自定义备注信息",
    })
    .show(player);

  if (!values) return;

  const name = String(values.name ?? "").trim();
  if (!name) {
    player.sendMessage("§c传送点名称不能为空");
    return;
  }

  const outcome = createWarpAtPlayer(player, name, {
    category: WAYPOINT_CATEGORIES[
      values.category as number
    ] as WaypointCategory,
    note: String(values.note ?? "").trim(),
  });

  if (!outcome.ok) {
    player.sendMessage(outcome.error);
    return;
  }

  notifySuccess(player, `已创建传送点 §e${name}`);
  await showWarpManagement(player);
}
