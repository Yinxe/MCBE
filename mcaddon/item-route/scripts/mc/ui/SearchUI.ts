// ─── 搜索：单仓库查物品（name-maps → ItemIndex）+ 粒子标记 ──
import { world, system, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Location } from "../../core/model/types";
import { searchMarkerMolang } from "../effects/SortEffects";
import * as uiColor from "./uiColor";

const PARTICLE_INTERVAL = 20; // 粒子刷新的 tick 间隔
const DEFAULT_DURATION = 15 * 20; // 松手后标记持续 15 秒
const GRACE_DURATION = 3 * 20; // 超时宽限期 3 秒（宽限期内拾信物可续时）
const MARKER_OFFSET_H = 0.455; // 粒子贴方块面偏移（v1 同款）
/** 每玩家活跃标记会话（playerName → interval handle） */
const activeMarkerHandles = new Map<string, number>();

export interface SearchResultLine {
  typeId: string;
  name: string;
  count: number;
  containerIds: string[];
}

/** 玩家到仓库中心 XZ 直线距离 */
function warehouseDistance(warehouse: Warehouse, player: Player): number {
  const cx =
    (Math.min(warehouse.area.corner1.x, warehouse.area.corner2.x) +
      Math.max(warehouse.area.corner1.x, warehouse.area.corner2.x)) /
    2;
  const cz =
    (Math.min(warehouse.area.corner1.z, warehouse.area.corner2.z) +
      Math.max(warehouse.area.corner1.z, warehouse.area.corner2.z)) /
    2;
  return Math.hypot(player.location.x - cx, player.location.z - cz);
}

/**
 * 搜索入口（主菜单"容器搜索"）：列出当前维度内有权限（member+）的仓库（按距离排序），
 * 选仓 + 输入关键词 → runSearchAndDisplay。默认选中最近的仓库。
 *
 * @param player - 打开搜索的玩家
 * @param deps   - 命令共享依赖门面
 */
export async function showSearchUI(player: Player, deps: CommandDeps): Promise<void> {
  // 有权（member+）且同维度的仓库，按距玩家距离排序（v1 同款：可选择仓库，但须自己有权限）
  const accessible = deps
    .loadedWarehouses()
    .filter((w) => w.area.dimension === player.dimension.id && deps.members.can(w, player.name, "member"))
    .map((w) => ({ warehouse: w, dist: warehouseDistance(w, player) }))
    .sort((a, b) => a.dist - b.dist);
  if (accessible.length === 0) {
    player.sendMessage(`${uiColor.chat.error}当前维度没有你有权限（成员）的仓库`);
    return;
  }
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}容器搜索`)
    .dropdown(
      "warehouse",
      "选择仓库",
      accessible.map((a) => `${a.warehouse.displayName} ${uiColor.form.muted}(${Math.round(a.dist)} 格)`),
      { defaultValueIndex: 0 } // 默认最近的
    )
    .textField("query", "搜索关键词", { defaultValue: "" });
  const values = await form.show(player);
  if (!values) return;
  const query = (values.query as string).trim();
  if (!query) return;
  const selected = accessible[values.warehouse as number]?.warehouse;
  if (selected === undefined) return;
  runSearchAndDisplay(player, deps, selected, query);
}

/** 搜索指定仓库并展示结果 + 标记粒子（命令与 UI 共用） */
export function runSearchAndDisplay(player: Player, deps: CommandDeps, warehouse: Warehouse, query: string): void {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载（搜索扫容器内容）
  const lines = runSearch(warehouse, query);
  if (lines.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}未找到匹配物品`);
    return;
  }
  player.sendMessage(`${uiColor.chat.highlight}━━ ${warehouse.displayName} 搜索结果：${lines.length} 种 ━━`);
  const locs: Location[] = [];
  for (const line of lines) {
    player.sendMessage(
      `${uiColor.chat.info}${line.name}${uiColor.chat.muted} ×${line.count} [${line.containerIds.join(", ")}]`
    );
    for (const id of line.containerIds) {
      const c = warehouse.containers.get(id);
      if (c) locs.push(...c.occupiedLocations);
    }
  }
  if (locs.length > 0) startMarkerParticles(player, player.dimension.id, locs, (t) => deps.config.isToken(t));
}

/** 纯逻辑搜索：在指定仓库内 query → typeIds → 逐容器按 typeId 精确计数（可单测） */
export function runSearch(warehouse: Warehouse, query: string): SearchResultLine[] {
  const typeIds = searchItems(query);
  // 只搜存储容器（single/multi/misc），排除在途输入仓（input 不落库、且索引不含 misc，
  // 直接扫全量非 input 保证"索引加载与否"两种状态结果一致，对齐 v1 SearchService 逐容器扫描）
  const containers = [...warehouse.containers.values()].filter((c) => c.role !== "input");
  const out: SearchResultLine[] = [];
  for (const typeId of typeIds) {
    let count = 0;
    const containerIds: string[] = [];
    for (const container of containers) {
      let found = false;
      for (let i = 0; i < container.capacity; i++) {
        const item = container.getItem(i);
        if (item?.itemId !== typeId) continue;
        count += item.amount; // 仅统计该类型（multi 混放不虚高）
        found = true;
      }
      if (found) containerIds.push(container.id);
    }
    if (count > 0) out.push({ typeId, name: getChineseName(typeId), count, containerIds });
  }
  return out;
}

/** 在容器坐标持续播放标记粒子（v1 状态机：持信物续时 / 松手倒计时 / 宽限期重拾恢复） */
export function startMarkerParticles(
  player: Player,
  dimensionId: string,
  locations: Location[],
  isToken: (itemTypeId: string) => boolean
): void {
  // 每玩家独立会话：同一玩家重复搜索 → 清旧会话并重新计时（结果刷新）
  const oldHandle = activeMarkerHandles.get(player.name);
  if (oldHandle !== undefined) system.clearRun(oldHandle);

  let elapsed = 0; // 松手后经过 tick
  let graceElapsed = 0; // 宽限期内经过 tick
  let phase: "active" | "grace" | "done" = "active";
  let graceNotified = false;
  player.sendMessage(`${uiColor.chat.info}紫标记已标记容器位置（持续 15 秒，手持信物可持续续时）`);

  const dim = world.getDimension(dimensionId);
  const handle = system.runInterval(() => {
    if (phase === "done") return;

    // 持信物判定（玩家可能离线 → 视为未持信物，按倒计时自然结束）
    let holdingToken = false;
    try {
      const inv = player.getComponent("inventory")?.container;
      const held = inv?.getItem(player.selectedSlotIndex);
      holdingToken = isToken(held?.typeId ?? "");
    } catch {
      /* 玩家离线：holdingToken 保持 false */
    }

    // 刷粒子：跳过未加载区块（getBlock 抛错 → 跳过该坐标）；紫色标记（v1 playSearchEffect 同款）
    try {
      if (dim !== undefined) {
        const molang = searchMarkerMolang();
        for (const loc of locations) {
          try {
            dim.getBlock({ x: loc.x, y: loc.y, z: loc.z });
          } catch {
            continue;
          }
          dim.spawnParticle("itemroute:sort", { x: loc.x + 0.5, y: loc.y + MARKER_OFFSET_H, z: loc.z + 0.5 }, molang);
        }
      }
    } catch {
      cleanup();
      return;
    }

    if (phase === "active") {
      if (holdingToken)
        elapsed = 0; // 持信物 → 一直续时
      else elapsed += PARTICLE_INTERVAL;
      if (elapsed >= DEFAULT_DURATION) {
        phase = "grace";
        graceElapsed = 0;
        graceNotified = false;
      }
    }

    if (phase === "grace") {
      if (holdingToken) {
        // 宽限期内拾起信物 → 续时恢复
        phase = "active";
        elapsed = 0;
        graceElapsed = 0;
        return;
      }
      if (!graceNotified) {
        graceNotified = true;
        try {
          player.sendMessage(`${uiColor.chat.warn}标记即将在 3 秒后消失，手持信物可继续标记`);
        } catch {
          /* 忽略 */
        }
      }
      graceElapsed += PARTICLE_INTERVAL;
      if (graceElapsed >= GRACE_DURATION) cleanup();
    }
  }, PARTICLE_INTERVAL);

  activeMarkerHandles.set(player.name, handle);

  function cleanup(): void {
    phase = "done";
    system.clearRun(handle);
    activeMarkerHandles.delete(player.name);
    try {
      player.sendMessage(`${uiColor.chat.muted}容器标记已结束`);
    } catch {
      /* 忽略 */
    }
  }
}

/** 清理全部标记会话（玩家离开等） */
export function stopMarkerParticles(): void {
  for (const [, handle] of activeMarkerHandles) {
    system.clearRun(handle);
  }
  activeMarkerHandles.clear();
}
