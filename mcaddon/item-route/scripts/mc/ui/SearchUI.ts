// ─── 搜索：单仓库查物品（name-maps → ItemIndex）+ 粒子标记 ──
import { world, system, type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { searchItems, getChineseName } from "../../core/data/ItemNameMap";
import { containerShortName } from "../../core/model/ContainerId";
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

/** 容器 ID → 可读短名（如 c@(1,2,3)@overworld → (1,2,3)@overworld） */
function shortId(cid: string): string {
  return containerShortName(cid);
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
      `${uiColor.chat.info}${line.name}${uiColor.chat.muted} ×${line.count} [${line.containerIds.map(shortId).join(", ")}]`
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
  // ⚠️ 性能：宽查询（如"石"/"a"）会命中数百 typeId，若对每个都全仓逐槽 getItem 会 O(N³) 卡顿。
  //    限制对**前 MAX_TYPE_IDS 个**匹配类型扫描（按字母序），超出折叠提示，避免宽查询拖垮。
  const MAX_TYPE_IDS = 40;
  const typeIds = searchItems(query).slice(0, MAX_TYPE_IDS);
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

/** 在容器坐标持续播放标记粒子（v1 状态机：正常 15 秒 / 超时手持续时 / 松手 3 秒宽限） */
export function startMarkerParticles(
  player: Player,
  dimensionId: string,
  locations: Location[],
  isToken: (itemTypeId: string) => boolean
): void {
  // 每玩家独立会话：同一玩家重复搜索（含换仓）→ 清旧会话再重启（结果刷新、不重叠）
  const oldHandle = activeMarkerHandles.get(player.name);
  if (oldHandle !== undefined) system.clearRun(oldHandle);

  // 状态机（v1 修正口径，需求第 11 条）：
  //   active —— 正常 15 秒窗口：**手持信物不暂停倒计时**（耗尽正常时间），
  //             15 秒到：手持 → held（续时）；否则 → 结束（15 秒后自动消失）。
  //   held   —— 信物续时：手持持续显示；松手 → grace。
  //   grace  —— 3 秒宽限期：切回手持 → held（续时）；3 秒到 → 结束。
  let elapsed = 0; // active 阶段经过 tick（15 秒正常窗口）
  let graceElapsed = 0; // grace 阶段经过 tick
  let phase: "active" | "held" | "grace" | "done" = "active";
  let graceNotified = false;
  player.sendMessage(`${uiColor.chat.info}紫标记已标记容器位置（默认 15 秒，之后手持信物可持续显示）`);

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
      // 正常 15 秒窗口：手持信物**不**重置计时，正常耗尽；15 秒到按是否手持分流
      elapsed += PARTICLE_INTERVAL;
      if (elapsed >= DEFAULT_DURATION) {
        if (holdingToken) phase = "held";
        else cleanup(); // 未手持 → 15 秒后自动消失（不再叠 3 秒宽限）
      }
      return;
    }
    if (phase === "held") {
      // 信物续时：手持持续显示；松手进入 3 秒宽限
      if (!holdingToken) {
        phase = "grace";
        graceElapsed = 0;
        graceNotified = false;
      }
      return;
    }
    if (phase === "grace") {
      if (holdingToken) {
        // 宽限期内拾起信物 → 续时恢复（回到 held，不重开 15 秒）
        phase = "held";
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

/** 清理全部标记会话（服务器停止等） */
export function stopMarkerParticles(): void {
  for (const [, handle] of activeMarkerHandles) {
    system.clearRun(handle);
  }
  activeMarkerHandles.clear();
}

/** 清理指定玩家的标记会话（玩家离开时调用，防下线残留渲染） */
export function stopMarkerParticlesFor(playerName: string): void {
  const handle = activeMarkerHandles.get(playerName);
  if (handle !== undefined) {
    system.clearRun(handle);
    activeMarkerHandles.delete(playerName);
  }
}
