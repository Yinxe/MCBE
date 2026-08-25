// ─── 模拟4 常加载（命令域 9×9 圆形） ─────────────────
// 仅走游戏命令 `tickingarea add circle <xyz> 4 <name>`，不使用 Manager
// 供上线后刷新 per-bot `mockplayer:aux:<name>` 常驻辅助

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { SIM4_TICKING_RADIUS_CHUNKS } from "../../../rules/Types";

export const SIM4_RADIUS = SIM4_TICKING_RADIUS_CHUNKS;

const commandAreas = new Set<string>();

export function hasTickingArea(name: string): boolean {
  return commandAreas.has(name);
}

export async function createSim4Area(center: Vector3, dimension: Dimension, name: string) {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" } as const;
  try {
    removeSim4Area(name, dimension);
  } catch {}
  const r = createViaCommand(center, dimension, name, SIM4_RADIUS);
  if (r.ok) commandAreas.add(name);
  return r;
}

export function removeSim4Area(name: string, dimension?: Dimension) {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" } as const;
  const r = removeViaCommand(name, dimension);
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
