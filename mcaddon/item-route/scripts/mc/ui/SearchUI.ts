// ─── 搜索：单仓库查物品（name-maps → ItemIndex）+ 粒子标记 ──
import { world, system, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import { nearestWarehouseByPermission } from "../../core/model/Area";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Location } from "../../core/model/types";
import * as uiColor from "./uiColor";

const PARTICLE_INTERVAL = 20;       // 粒子刷新的 tick 间隔
const DEFAULT_DURATION = 15 * 20;   // 松手后标记持续 15 秒
const GRACE_DURATION = 3 * 20;      // 超时宽限期 3 秒（宽限期内拾信物可续时）
const MARKER_OFFSET_H = 0.455;      // 粒子贴方块面偏移（v1 同款）
/** 每玩家活跃标记会话（playerId → interval handle） */
const activeMarkerHandles = new Map<string, number>();

export interface SearchResultLine {
  typeId: string;
  name: string;
  count: number;
  containerIds: string[];
}

export async function showSearchUI(player: Player, deps: CommandDeps): Promise<void> {
  const warehouse = nearestWarehouseByPermission(
    deps.loadedWarehouses(),
    player.dimension.id,
    { x: player.location.x, z: player.location.z },
    (w) => deps.members.can(w, player.id, "member")
  );
  if (warehouse === undefined) {
    player.sendMessage(`${uiColor.chat.error}附近没有你有权限（成员）的仓库`);
    return;
  }
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}容器搜索 · ${uiColor.form.accent}${warehouse.displayName}`)
    .textField("query", "搜索关键词", { defaultValue: "" });
  const values = await form.show(player);
  if (!values) return;
  const query = (values.query as string).trim();
  if (!query) return;

  const lines = runSearch(deps, warehouse, query);
  if (lines.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}未找到匹配物品`);
    return;
  }
  player.sendMessage(`${uiColor.chat.highlight}━━ 搜索结果：${lines.length} 种 ━━`);
  for (const line of lines) {
    player.sendMessage(`${uiColor.chat.info}${line.name}${uiColor.chat.muted} ×${line.count} [${line.containerIds.join(", ")}]`);
  }
}

/** 纯逻辑搜索：在指定仓库内 query → typeIds → 该仓索引 lookup 聚合（可单测） */
export function runSearch(deps: CommandDeps, warehouse: Warehouse, query: string): SearchResultLine[] {
  const typeIds = searchItems(query);
  const index = deps.resolveIndex(warehouse.id); // 该仓库自己的索引（隔离）
  const out: SearchResultLine[] = [];
  for (const typeId of typeIds) {
    let count = 0;
    const containerIds: string[] = [];
    if (index !== undefined) {
      const hits = index.lookup(typeId);
      for (const id of [...hits.single, ...hits.multi]) {
        if (containerIds.includes(id)) continue;
        containerIds.push(id);
        const container = warehouse.containers.get(id);
        if (container === undefined) continue;
        for (let i = 0; i < container.capacity; i++) {
          count += container.getItem(i)?.amount ?? 0;
        }
      }
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
  const oldHandle = activeMarkerHandles.get(player.id);
  if (oldHandle !== undefined) system.clearRun(oldHandle);

  let elapsed = 0;        // 松手后经过 tick
  let graceElapsed = 0;   // 宽限期内经过 tick
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

    // 刷粒子：跳过未加载区块（getBlock 抛错 → 跳过该坐标）
    try {
      if (dim !== undefined) {
        for (const loc of locations) {
          try {
            dim.getBlock({ x: loc.x, y: loc.y, z: loc.z });
          } catch {
            continue;
          }
          dim.spawnParticle("itemroute:sort", { x: loc.x + 0.5, y: loc.y + MARKER_OFFSET_H, z: loc.z + 0.5 });
        }
      }
    } catch {
      cleanup();
      return;
    }

    if (phase === "active") {
      if (holdingToken) elapsed = 0; // 持信物 → 一直续时
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

  activeMarkerHandles.set(player.id, handle);

  function cleanup(): void {
    phase = "done";
    system.clearRun(handle);
    activeMarkerHandles.delete(player.id);
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