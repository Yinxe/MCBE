// ─── 搜索：跨仓库查物品（name-maps → ItemIndex）+ 粒子标记 ──
import { world, system, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import { locationKey, type Location } from "../../core/model/types";
import * as uiColor from "./uiColor";

const PARTICLE_INTERVAL = 20;       // 粒子刷新的 tick 间隔
const DEFAULT_DURATION = 15 * 20;   // 标记持续 15 秒
const GRACE_DURATION = 3 * 20;      // 宽限期
const activeMarkerHandles: number[] = [];

export interface SearchResultLine {
  typeId: string;
  name: string;
  count: number;
  containerIds: string[];
}

export async function showSearchUI(player: Player, deps: CommandDeps): Promise<void> {
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}容器搜索`)
    .textField("query", "搜索关键词", { defaultValue: "" });
  const values = await form.show(player);
  if (!values) return;
  const query = (values.query as string).trim();
  if (!query) return;

  const lines = runSearch(deps, query);
  if (lines.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}未找到匹配物品`);
    return;
  }
  player.sendMessage(`${uiColor.chat.highlight}━━ 搜索结果：${lines.length} 种 ━━`);
  for (const line of lines) {
    player.sendMessage(`${uiColor.chat.info}${line.name}${uiColor.chat.muted} ×${line.count} [${line.containerIds.join(", ")}]`);
  }
}

/** 纯逻辑搜索：query → typeIds → 各仓库索引 lookup 聚合（可单测） */
export function runSearch(deps: CommandDeps, query: string): SearchResultLine[] {
  const typeIds = searchItems(query);
  const out: SearchResultLine[] = [];
  for (const typeId of typeIds) {
    let count = 0;
    const containerIds: string[] = [];
    for (const w of deps.loadedWarehouses()) {
      const index = deps.resolveIndex(w.id); // 该仓库自己的索引（隔离）
      if (index === undefined) continue;
      const hits = index.lookup(typeId);
      for (const id of [...hits.single, ...hits.multi]) {
        if (containerIds.includes(id)) continue;
        containerIds.push(id);
        const container = w.containers.get(id);
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

/** 在容器坐标持续播放紫色标记粒子（10s 倒计时 + 3s 宽限） */
export function startMarkerParticles(
  player: Player,
  dimensionId: string,
  locations: Location[]
): void {
  stopMarkerParticles();
  const dim = world.getDimension(dimensionId);
  if (dim === undefined) return;
  let ticksLeft = DEFAULT_DURATION;
  const interval = system.runInterval(() => {
    ticksLeft -= PARTICLE_INTERVAL;
    if (ticksLeft + GRACE_DURATION <= 0) {
      stopMarkerParticles();
      return;
    }
    for (const loc of locations) {
      dim.spawnParticle("itemroute:sort", { x: loc.x + 0.5, y: loc.y + 1.2, z: loc.z + 0.5 });
    }
    void player; // 持续中
  }, PARTICLE_INTERVAL);
  activeMarkerHandles.push(interval);
}

export function stopMarkerParticles(): void {
  while (activeMarkerHandles.length > 0) {
    const id = activeMarkerHandles.pop();
    if (id !== undefined) system.clearRun(id);
  }
}

export function markerKey(loc: Location): string {
  return locationKey(loc);
}