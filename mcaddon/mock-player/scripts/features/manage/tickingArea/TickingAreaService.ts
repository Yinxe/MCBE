// ─── 常加载统一服务（配套追踪 + 混合回退） ─────
// 封装两种提供方的配套创建/销毁，保证 create 的提供方与 remove 一致
// 对外提供：
//   - createCircleWithFallback(center,dim,name): 先 CommandCircle，容量不足回退 ManagerSingleChunk，记录实际提供方
//   - createSingleChunk(center,dim,name): 直接 Manager
//   - remove(name,dim?): 按记录的提供方配套销毁；未知则双试兜底（兼容旧残留）
//   - has(name): 任一提供方存在即视为存在
//   - sync(): 同步两者镜像

import type { Dimension, Vector3 } from "@minecraft/server";
import { CommandCircleProvider } from "./CommandCircleProvider";
import { ManagerSingleChunkProvider } from "./ManagerSingleChunkProvider";
import type { TickingAreaProvider } from "./TickingAreaProvider";

const circleProvider = new CommandCircleProvider();
const singleProvider = new ManagerSingleChunkProvider();

// name -> kind 配套追踪（创建后记录，销毁时按此配套）
const createdBy = new Map<string, TickingAreaProvider["kind"]>();

function getProvider(kind: TickingAreaProvider["kind"]): TickingAreaProvider {
  return kind === "command:circle" ? circleProvider : singleProvider;
}

export async function createCircleWithFallback(center: Vector3, dimension: Dimension, name: string, radius: number = 4): Promise<{ ok: true; fallback: boolean; kind: TickingAreaProvider["kind"] } | { ok: false; reason: string }> {
  // 幂等：先按记录配套清理旧残留，避免同名冲突
  await removeTickingArea(name, dimension).catch(()=>{});

  const r1 = await circleProvider.create(center, dimension, name, radius);
  if (r1.ok) {
    createdBy.set(name, circleProvider.kind);
    return { ok: true, fallback: false, kind: circleProvider.kind };
  }
  const reason1 = (r1 as any).reason ?? "";
  // 仅容量不足回退，其他错误直接返回（避免把语法错误也回退）
  if (!String(reason1).includes("容量不足")) {
    return { ok: false, reason: reason1 };
  }
  console.warn(`[TickingService] ${name} CommandCircle 容量不足，回退 ManagerSingleChunk: ${reason1}`);
  const r2 = await singleProvider.create(center, dimension, name);
  if (r2.ok) {
    createdBy.set(name, singleProvider.kind);
    return { ok: true, fallback: true, kind: singleProvider.kind };
  }
  return { ok: false, reason: `Circle:${reason1}; Single:${(r2 as any).reason ?? "未知"}` };
}

export async function createSingleChunk(center: Vector3, dimension: Dimension, name: string): Promise<{ ok: true; kind: TickingAreaProvider["kind"] } | { ok: false; reason: string }> {
  await removeTickingArea(name, dimension).catch(()=>{});
  const r = await singleProvider.create(center, dimension, name);
  if (r.ok) {
    createdBy.set(name, singleProvider.kind);
    return { ok: true, kind: singleProvider.kind };
  }
  return { ok: false, reason: (r as any).reason ?? "创建失败" };
}

export async function removeTickingArea(name: string, dimension?: Dimension): Promise<{ ok: true } | { ok: false; reason: string }> {
  const kind = createdBy.get(name);
  if (kind) {
    const p = getProvider(kind);
    const res = await p.remove(name, dimension as any);
    createdBy.delete(name);
    // 配套销毁后，再兜底清另一域残留（防旧版本跨域残留）
    try {
      const otherKind = kind === "command:circle" ? singleProvider.kind : circleProvider.kind;
      const other = getProvider(otherKind);
      if (other.has(name)) await other.remove(name, dimension as any).catch(()=>{});
    } catch {}
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "销毁失败" };
  }
  // 未知来源（重启后 Map 丢失或旧残留）：双试兜底，按 Manager→Command 顺序
  let lastReason = "";
  try {
    const r1 = await singleProvider.remove(name, dimension as any);
    if ((r1 as any).ok) return { ok: true };
    lastReason = (r1 as any).reason ?? "";
  } catch (e: any){ lastReason = e?.message ?? String(e); }
  try {
    const r2 = await circleProvider.remove(name, dimension as any);
    if ((r2 as any).ok) return { ok: true };
    lastReason = lastReason ? `${lastReason}; ${(r2 as any).reason ?? ""}` : (r2 as any).reason ?? "";
  } catch (e: any){ lastReason = lastReason ? `${lastReason}; ${e?.message ?? String(e)}` : e?.message ?? String(e); }
  // 幂等：未找到也视为成功（已清理）
  if (String(lastReason).includes("未找到") || String(lastReason).includes("不存在")) return { ok: true };
  return { ok: false, reason: lastReason || "未知" };
}

export function hasTickingArea(name: string): boolean {
  return circleProvider.has(name) || singleProvider.has(name);
}

export function syncTickingAreas(): void {
  try { circleProvider.sync?.(); } catch {}
  try { singleProvider.sync?.(); } catch {}
  // 清理 Map 中已不存在的记录（避免泄漏）
  for (const name of [...createdBy.keys()]) {
    if (!hasTickingArea(name)) createdBy.delete(name);
  }
}

export function estimateFor(name: string): number | undefined {
  const kind = createdBy.get(name);
  if (!kind) return undefined;
  return getProvider(kind).estimate?.();
}

// 暴露内部以供诊断
export const __internal = { createdBy, circleProvider, singleProvider };
