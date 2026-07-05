/**
 * ============================================================================
 * SearchUI —— 仓库容器搜索界面
 * ============================================================================
 *
 * 职责：
 * 1. 通过 ModalForm 提供搜索交互（介绍文字 + 搜索框 + 仓库选择下拉）
 * 2. 执行搜索后将结果通过聊天栏发送给玩家
 * 3. 自动播放紫色粒子标记匹配的容器位置
 * 4. 粒子标记默认持续 10 秒，手持信物可持续续时
 * 5. 同一玩家同一时刻只有一个活跃标记会话（新搜索取代旧标记）
 * ============================================================================
 */

import { world, system, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { BlockLocation, WarehouseData } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { SearchService, formatSearchResult } from "../warehouse/SearchService";
import { playSearchEffect } from "../sorting/SortEffects";
import { Logger } from "../util/Logger";

const log = new Logger("SearchUI");

/** 粒子刷新间隔（tick） */
const PARTICLE_INTERVAL = 20;
/** 默认标记持续时间（tick）：10 秒 */
const DEFAULT_DURATION = 10 * 20;
/** 超时后宽限期（tick）：3 秒后彻底消失 */
const GRACE_DURATION = 3 * 20;

/**
 * 每个玩家当前的活跃标记会话句柄。
 * key = player.id，value = handle（system.runInterval 返回值）。
 * 同一玩家再次搜索时，旧的会话会被清理。
 */
const activeMarkerHandles = new Map<string, number>();

/**
 * 显示容器搜索界面。
 *
 * @param player      - 搜索玩家
 * @param repository  - 仓库持久化仓储
 * @param configStore - 模组配置仓储
 */
export async function showSearchUI(
  player: Player,
  repository: WarehouseRepository,
  configStore: ModConfigStore
): Promise<void> {
  // ── 1. 加载仓库数据，找出最近仓库 ──
  const warehouses = repository.loadAll().filter((w) => w.dimensionId === player.dimension.id);

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
  const form = new ModalFormBuilder()
    .title("容器搜索")
    .label("info", "§7输入物品名称搜索仓库中的容器\n支持输入物品 ID（minecraft:xxx）、英文名或中文名模糊搜索")
    .textField("query", "§a搜索关键字", "输入物品名称…", { defaultValue: "" })
    .dropdown(
      "warehouse",
      "§a选择仓库",
      sortedWarehouses.map((sw) => `${sw.warehouse.displayName} §7(距离 ${Math.round(sw.distance)} 格)`),
      { defaultValueIndex: 0 }
    );

  const vals = await form.show(player);
  if (!vals) return;
  const query = vals.query as string;
  const warehouseIndex = vals.warehouse as number;

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
  await performSearch(player, selected, query.trim(), configStore);
}

/**
 * 执行搜索并展示结果。
 */
async function performSearch(
  player: Player,
  warehouse: WarehouseData,
  query: string,
  configStore: ModConfigStore
): Promise<void> {
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
  player.sendMessage("§7紫色粒子已标记容器位置 (持续 10 秒，手持信物可持续续时)");

  const blLocations: BlockLocation[] = locations.map((l) => ({
    x: Math.floor(l.x),
    y: Math.floor(l.y),
    z: Math.floor(l.z),
  }));

  startMarkerParticles(player, warehouse.dimensionId, blLocations, configStore);
}

/**
 * 启动容器位置标记粒子。
 *
 * 状态机：
 *   持锄 → timer 保持 0           （标记持续）
 *   松锄 → timer 递增              （10 秒倒计时）
 *   超时 → 进入宽限期              （3 秒后消失）
 *   宽限期内拾锄 → 回到持锄       （续时）
 *   宽限期结束 → 清理标记
 *
 * 每 20 tick 刷新一次粒子。
 * 同一玩家再次调用会先清理旧会话。
 *
 * @param player      - 搜索玩家
 * @param dimensionId - 容器维度 ID
 * @param locations   - 要标记的方块坐标列表
 * @param configStore - 模组配置仓储（用于获取当前信物 ID）
 */
function startMarkerParticles(
  player: Player,
  dimensionId: string,
  locations: BlockLocation[],
  configStore: ModConfigStore
): void {
  // 清理同一玩家的旧标记会话
  const oldHandle = activeMarkerHandles.get(player.id);
  if (oldHandle !== undefined) {
    system.clearRun(oldHandle);
  }

  let elapsed = 0; // 松锄后经过的 tick
  let graceElapsed = 0; // 宽限期内经过的 tick
  let phase: "active" | "grace" | "done" = "active";
  let graceNotified = false;

  const handle = system.runInterval(() => {
    if (phase === "done") return;

    // ── 检查玩家手持状态 ──
    let holdingHoe = false;
    try {
      const inv = player.getComponent("inventory")?.container;
      const held = inv?.getItem(player.selectedSlotIndex);
      holdingHoe = configStore.isToken(held?.typeId);
    } catch {
      // 玩家可能已离线
    }

    // ── 刷粒子 ──
    try {
      const dimension = world.getDimension(dimensionId);
      playSearchEffect(dimension, locations);
    } catch {
      // 维度不可达时静默停止
      cleanup();
      return;
    }

    if (phase === "active") {
      if (holdingHoe) {
        elapsed = 0; // 持锄 → 一直续时
      } else {
        elapsed += PARTICLE_INTERVAL;
      }

      if (elapsed >= DEFAULT_DURATION) {
        // 超时，进入宽限期
        phase = "grace";
        graceElapsed = 0;
        graceNotified = false;
      }
    }

    if (phase === "grace") {
      if (holdingHoe) {
        // 宽限期内拾锄 → 续时成功
        phase = "active";
        elapsed = 0;
        graceElapsed = 0;
        return;
      }

      if (!graceNotified) {
        graceNotified = true;
        try {
          player.sendMessage("§e标记即将在 3 秒后消失，手持信物可继续标记");
        } catch {
          /* 忽略 */
        }
      }

      graceElapsed += PARTICLE_INTERVAL;

      if (graceElapsed >= GRACE_DURATION) {
        cleanup();
      }
    }
  }, PARTICLE_INTERVAL);

  activeMarkerHandles.set(player.id, handle);

  function cleanup(): void {
    phase = "done";
    system.clearRun(handle);
    activeMarkerHandles.delete(player.id);
    try {
      player.sendMessage("§7容器标记已结束");
    } catch {
      /* 忽略 */
    }
  }
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
