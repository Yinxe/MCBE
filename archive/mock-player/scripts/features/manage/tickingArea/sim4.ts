// ─── 模拟4 常加载（命令域 圆形 r=4，49 区块） ───────────
// 仅走游戏命令 `tickingarea add circle <xyz> 4 <name>`，不使用 Manager API 直接创建
// 供上线后刷新 per-bot `mockplayer:aux:<name>` 常驻辅助
// 区块数：wiki 定义 `tickingarea add circle` 以中心区块向外各延伸 4 区块，构成圆形
//   半径 r=4 时为 49 区块（4+1+4 直径上 9 区块，但四角剔除：1+5+7+7+9+7+7+5+1=49），
//   非 81（81 为外接正方形上界，仅作容量估算的悲观值，实际按 49 计费）。
// ⚠️ 合规说明：命令与 Manager 共享同一世界 tickingArea 注册表（非双域隔离），
//    故本模块的内存 Set 需与世界 Manager 保持同步（见 syncCommandAreasFromWorld），
//    且 Sim4 亦需做容量预检（按 49 块计费）。

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { SIM4_TICKING_RADIUS_CHUNKS } from "../../../rules/Types";

export const SIM4_RADIUS = SIM4_TICKING_RADIUS_CHUNKS;

/** 内存镜像：已创建的 Sim4 名称（幂等/查询加速），需与世界 Manager 同步 */
const commandAreas = new Set<string>();

/** Sim4 圆形 r=4 的精确 chunk 数（wiki：4+1+4 圆形，49 区块） */
export function estimateSim4ChunkCount(radius: number = SIM4_RADIUS): number {
  if (radius === 4) return 49; // 1+5+7+7+9+7+7+5+1 = 49（r=4 圆形精确值）
  // 通用：按圆形 dx²+dz²≤r² 计数（以中心区块为原点）
  let c = 0;
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) if (dx * dx + dz * dz <= radius * radius) c++;
  return c;
}

/** 统一查询：内存 Set 命中 或 世界 Manager 已存在（双重保障，防重启后 Set 丢失） */
export function hasTickingArea(name: string): boolean {
  if (commandAreas.has(name)) return true;
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) return true;
  } catch {}
  return false;
}

/** 同步内存 Set ← 世界 Manager（worldLoad 时调用，修复重启后 Set 丢失导致的 name 冲突） */
export function syncCommandAreasFromWorld(): void {
  try {
    const all = world.tickingAreaManager.getAllTickingAreas?.() as any[] | undefined;
    if (!all) return;
    for (const a of all) {
      const id = (a as any).identifier ?? (a as any).name;
      if (typeof id === "string" && id.startsWith("mockplayer:aux:")) {
        commandAreas.add(id);
      }
    }
  } catch {}
}

export async function createSim4Area(center: Vector3, dimension: Dimension, name: string) {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" } as const;
  // 幂等：先清理同名残留（同时清内存 Set + 世界 Manager/命令，防止跨域残留导致创建失败）
  try {
    removeSim4Area(name, dimension);
  } catch {}
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) {
      world.tickingAreaManager.removeTickingArea(name);
    }
  } catch {}

  // 容量预检：按 wiki 圆形 49 块计费（非 81），直接对比 Manager 的 chunkCount / maxChunkCount
  // 不使用 hasCapacity 的外接正方形 boundingBox（会悲观为 81，导致误拒）
  const est = estimateSim4ChunkCount();
  try {
    const mgr = world.tickingAreaManager as any;
    const chunkCount = mgr.chunkCount;
    const maxChunkCount = mgr.maxChunkCount;
    if (typeof chunkCount === "number" && typeof maxChunkCount === "number") {
      if (chunkCount + est > maxChunkCount) {
        return {
          ok: false,
          reason: `模拟4容量不足（需 ${est} 块列，当前 ${chunkCount}/${maxChunkCount}，圆形 r=4=49 块），将回退单区块`,
        } as const;
      }
    } else {
      // 降级：Manager 未暴露计数时，仍尝试 hasCapacity（外接正方形，仅作兜底）
      const r = SIM4_RADIUS;
      const from = {
        x: Math.floor(center.x / 16) * 16 - r * 16,
        y: 0,
        z: Math.floor(center.z / 16) * 16 - r * 16,
      };
      const to = {
        x: Math.floor(center.x / 16) * 16 + r * 16 + 15,
        y: 0,
        z: Math.floor(center.z / 16) * 16 + r * 16 + 15,
      };
      const opts = { dimension, from, to } as any;
      if (!mgr.hasCapacity(opts)) {
        return {
          ok: false,
          reason: `模拟4容量不足（预估 ${est} 块列，外接 81 上界（已修正为 49 精确，保留 81 仅作 hasCapacity 兜底分支说明），当前 ${mgr.chunkCount ?? "?"}/${mgr.maxChunkCount ?? "?"}），将回退单区块`,
        } as const;
      }
    }
  } catch (e: any) {
    // 预检异常不阻断创建（降级为直接尝试命令，失败再回退）
    console.warn(`[MockPlayer] Sim4 容量预检异常 ${name}: ${e?.message ?? e}`);
  }

  const r = createViaCommand(center, dimension, name, SIM4_RADIUS);
  if (r.ok) {
    commandAreas.add(name);
    // 创建后二次校验：Manager 是否可见（防 successCount 误报）
    try {
      if (!world.tickingAreaManager.hasTickingArea(name)) {
        console.warn(`[MockPlayer] Sim4 创建后校验未见 ${name}（命令 successCount>0 但 Manager 无记录）`);
      }
    } catch {}
  }
  return r;
}

export function removeSim4Area(name: string, dimension?: Dimension) {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" } as const;
  const r = removeViaCommand(name, dimension);
  // 同时尝试 Manager 移除（双域兜底，命令与 Manager 共享注册表）
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) {
      world.tickingAreaManager.removeTickingArea(name);
    }
  } catch {}
  // 无论命令是否匹配到（可能已被外部清理），本模块集合一律移除（幂等）
  commandAreas.delete(name);
  return r;
}

function normalizeExecuteDimension(id: string): string {
  if (id === "minecraft:overworld" || id === "overworld") return "overworld";
  if (id === "minecraft:nether" || id === "nether") return "nether";
  if (id === "minecraft:the_end" || id === "the_end" || id === "minecraft:theEnd" || id === "theEnd") return "the_end";
  return id;
}

function runTickingCommand(cmd: string, targetDim: Dimension): { success: boolean; error?: string } {
  const execDim = normalizeExecuteDimension(targetDim.id);
  const execCmd = `execute in ${execDim} run ${cmd}`;
  const executors: Dimension[] = [];
  try {
    const overworld = world.getDimension("minecraft:overworld");
    if (overworld.id !== targetDim.id) executors.push(overworld);
  } catch {}
  executors.push(targetDim);
  for (const cand of ["minecraft:nether", "minecraft:the_end"] as const) {
    if (cand === targetDim.id) continue;
    try {
      const d = world.getDimension(cand);
      if (!executors.some((e) => e.id === d.id)) executors.push(d);
    } catch {}
  }
  let lastError: string | undefined;
  for (const exec of executors) {
    try {
      const res = exec.runCommand(execCmd);
      if (res.successCount > 0) return { success: true };
      lastError = `execute 返回 successCount=0: ${execCmd}`;
    } catch (e: any) {
      lastError = e?.message ?? String(e);
    }
    try {
      const res2 = exec.runCommand(cmd);
      if (res2.successCount > 0) return { success: true };
      if (!lastError) lastError = `裸命令 successCount=0: ${cmd}`;
    } catch (e: any) {
      if (!lastError) lastError = e?.message ?? String(e);
    }
  }
  try {
    const res = targetDim.runCommand(cmd);
    if (res.successCount > 0) return { success: true };
    return { success: false, error: lastError ?? `裸命令 successCount=0: ${cmd}` };
  } catch (e: any) {
    return { success: false, error: lastError ?? e?.message ?? String(e) };
  }
}

function createViaCommand(center: Vector3, dimension: Dimension, name: string, radius: number) {
  const x = Math.floor(center.x),
    y = Math.floor(center.y),
    z = Math.floor(center.z);
  const cmd = `tickingarea add circle ${x} ${y} ${z} ${radius} ${name}`;
  const r = runTickingCommand(cmd, dimension);
  return r.success ? ({ ok: true } as const) : ({ ok: false, reason: r.error ?? `命令执行失败: ${cmd}` } as const);
}

function removeViaCommand(name: string, hintDimension?: Dimension) {
  const cmd = `tickingarea remove ${name}`;
  if (hintDimension) {
    const r = runTickingCommand(cmd, hintDimension);
    if (r.success) return { ok: true } as const;
  }
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"] as const) {
    if (hintDimension && normalizeExecuteDimension(hintDimension.id) === normalizeExecuteDimension(dimId)) continue;
    try {
      const dim = world.getDimension(dimId);
      const r = runTickingCommand(cmd, dim);
      if (r.success) return { ok: true } as const;
    } catch {}
  }
  if (hintDimension) {
    for (const alt of [hintDimension.id, normalizeExecuteDimension(hintDimension.id)]) {
      if (alt === hintDimension.id) continue;
      try {
        const dim = world.getDimension(alt);
        const r = runTickingCommand(cmd, dim);
        if (r.success) return { ok: true } as const;
      } catch {}
    }
  }
  return { ok: false, reason: `未找到常加载区域 ${name}（跨维度 execute 均无匹配）` } as const;
}
