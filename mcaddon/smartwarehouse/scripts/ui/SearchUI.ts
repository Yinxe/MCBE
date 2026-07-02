/**
 * ============================================================================
 * SearchUI —— 仓库容器搜索界面
 * ============================================================================
 *
 * 职责：
 * 1. 通过 ModalForm 提供搜索交互（介绍文字 + 搜索框 + 仓库选择下拉）
 * 2. 执行搜索后将结果通过聊天栏发送给玩家
 * 3. 自动播放紫色粒子标记匹配的容器位置
 * 4. 粒子标记持续 30 秒，玩家手持木锄时持续标记
 * ============================================================================
 */

import { world, system, type Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import type { BlockLocation, WarehouseData } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { SearchService, formatSearchResult } from "../warehouse/SearchService";
import { playSearchEffect } from "../sorting/SortEffects";
import { Logger } from "../util/Logger";

const log = new Logger("SearchUI");

/** 木锄物品 ID */
const HOE_ID = "minecraft:wooden_hoe";
/** 粒子刷新间隔（tick） */
const PARTICLE_INTERVAL = 20;
/** 默认标记持续时间（tick）：30 秒 */
const DEFAULT_DURATION = 30 * 20;

/**
 * 显示容器搜索界面。
 *
 * @param player     - 搜索玩家
 * @param repository - 仓库持久化仓储
 */
export async function showSearchUI(player: Player, repository: WarehouseRepository): Promise<void> {
  // ── 1. 加载仓库数据，找出最近仓库 ──
  const warehouses = repository
    .loadAll()
    .filter((w) => w.dimensionId === player.dimension.id);

  if (warehouses.length === 0) {
    player.sendMessage("§c当前维度下没有可搜索的仓库");
    return;
  }

  // 按距离排序找最近的
  const sortedWarehouses = warehouses
    .map((w) => ({
      warehouse: w,
      distance: calcDistance(player, w),
    }))
    .sort((a, b) => a.distance - b.distance);

  // ── 2. 构建 ModalForm ──
  const form = new ModalFormData()
    .title("容器搜索")
    .label("§7输入物品名称搜索仓库中的容器\n支持输入物品 ID（minecraft:xxx）、英文名或中文名模糊搜索")
    .textField("§a搜索关键字", "输入物品名称…", { defaultValue: "" })
    .dropdown(
      "§a选择仓库",
      sortedWarehouses.map((sw) => `${sw.warehouse.displayName} §7(距离 ${Math.round(sw.distance)} 格)`),
      { defaultValueIndex: 0 }
    );

  const response = await form.show(player);
  if (response.canceled) return;

  // label() 在旧版 API 中不占用 formValues 索引（数组长度为 2），
  // 在新版 API 中会占用（长度 3，label 值恒为 undefined）。
  // 兼容两种行为：检测数组长度自动偏移。
  const rawValues = response.formValues as (string | number)[];
  const offset = rawValues.length >= 3 ? 1 : 0;
  const query = rawValues[offset] as string;
  const warehouseIndex = rawValues[offset + 1] as number;

  if (!query || query.trim().length === 0) {
    player.sendMessage("§c请输入搜索关键字");
    return;
  }

  const selected = sortedWarehouses[warehouseIndex]?.warehouse;
  if (!selected) {
    player.sendMessage("§c未找到选中的仓库");
    return;
  }

  // ── 3. 执行搜索 ──
  await performSearch(player, selected, query.trim());
}

/**
 * 执行搜索并展示结果。
 */
async function performSearch(player: Player, warehouse: WarehouseData, query: string): Promise<void> {
  const service = new SearchService();
  const dimension = world.getDimension(warehouse.dimensionId);

  let result: import("../warehouse/SearchService").WarehouseSearchResult;
  try {
    result = service.search(warehouse, query, dimension);
  } catch (error) {
    log.error(`搜索失败: ${error}`);
    player.sendMessage(`§c搜索出错: ${error}`);
    return;
  }

  // ── 4. 发送聊天结果 ──
  const lines = formatSearchResult(result);
  for (const line of lines) {
    player.sendMessage(line);
  }

  // ── 5. 无匹配则跳过粒子标记 ──
  if (result.containerCount === 0) return;

  const locations = service.getMarkerLocations(result);
  if (locations.length === 0) return;

  // ── 6. 播放粒子标记 ──
  player.sendMessage(`§7紫色粒子已标记 ${locations.length} 个容器位置 (持续 30 秒，手持木锄可维持标记)`);

  const blLocations: BlockLocation[] = locations.map((l) => ({
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    z: Math.floor(l.z),
  }));

  startMarkerParticles(player, warehouse.dimensionId, blLocations);
}

/**
 * 启动容器位置标记粒子。
 * 每 20 tick 刷新一次粒子，持续 30 秒。
 * 玩家手持木锄时重置计时器，持续标记。
 */
function startMarkerParticles(player: Player, dimensionId: string, locations: BlockLocation[]): void {
  let elapsed = 0;
  let active = true;

  const handle = system.runInterval(() => {
    if (!active) return;

    try {
      const dimension = world.getDimension(dimensionId);
      playSearchEffect(dimension, locations);
    } catch {
      // 维度不可达时静默停止
      active = false;
      return;
    }

    // 检查玩家手持物品
    try {
      const inv = player.getComponent("inventory")?.container;
      const held = inv?.getItem(player.selectedSlotIndex);
      if (held && held.typeId === HOE_ID) {
        elapsed = 0; // 手持木锄时重置计时
        return;
      }
    } catch {
      // 玩家可能已离线
    }

    elapsed += PARTICLE_INTERVAL;
    if (elapsed >= DEFAULT_DURATION) {
      active = false;
      system.clearRun(handle);
      try {
        player.sendMessage("§7容器标记已结束");
      } catch { /* 忽略 */ }
    }
  }, PARTICLE_INTERVAL);
}

/**
 * 计算玩家到仓库中心的 XZ 平面距离。
 */
function calcDistance(player: Player, warehouse: WarehouseData): number {
  const cx = (warehouse.area.min.x + warehouse.area.max.x) / 2;
  const cz = (warehouse.area.min.z + warehouse.area.max.z) / 2;
  const dx = player.location.x - cx;
  const dz = player.location.z - cz;
  return Math.sqrt(dx * dx + dz * dz);
}
