// ─── 模拟4 常加载能力（TickingArea） ─────────────────────
//
// 通过 `tickingarea add circle <xyz> 4 <name>` 申请以目标点为中心、半径 4 区块的常加载区域（模拟距离 4），
// 移除：`tickingarea remove <name>`。
// ⚠️ 跨维度：裸命令无法跨维度创建/移除，需配合 `execute in <dimension> run ...` 使用
//    本模块的命令通道已封装 `execute in <dimension> run tickingarea ...`，
//    调用方只需传入目标 Dimension 即可跨维度生效。
// 本模块是对上述能力的程序化封装，提供基于命令与 TickingAreaManager 的双通道实现，
// 并统一暴露 Promise 化的创建（等待区块加载完成）与同步移除。
//
// - 创建：优先使用 `world.tickingAreaManager`（Promise 在全部区块加载后 resolve，保障后续生成可靠；
//   且为模组独立额度，不占全局命令预算）；失败回退到命令 `execute in <dimension> run tickingarea add circle`。
// - 移除：同时尝试 TickingAreaManager 与命令双通道（命令侧走 `execute in <dimension> run tickingarea remove`），
//   确保无论以何种方式创建的区域都能被清理。
// - 名称隔离：Manager 的区域仅本包可见（无法操作其他包/命令创建的区域），命令创建的区域为全局可见；
//   双通道移除保证兼容。
//
// 模拟4仅为辅助加载：申请 → 上线假人 → 卸载（假人继承已加载区块）。

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { SIM4_TICKING_RADIUS_CHUNKS } from "../../rules/Types";

/** 模拟距离 4（区块半径） */
export const SIM4_RADIUS = SIM4_TICKING_RADIUS_CHUNKS;

/** 安全上线专用的固定常加载区域名（全局排队共享，不可并发） */
export const SAFE_ONLINE_TICKING_AREA_NAME = "mockplayer:safe_online";
/** 安全下线专用的固定常加载区域名（与上线不同名，减少冲突，可并发） */
export const SAFE_OFFLINE_TICKING_AREA_NAME = "mockplayer:safe_offline";

/** 常加载操作结果 */
export interface TickingAreaResult {
  ok: boolean;
  reason?: string;
}

/**
 * 检查本包是否已存在指定名称的常加载区域（仅查询 TickingAreaManager 隔离域）。
 */
export function hasTickingArea(name: string): boolean {
  try {
    return world.tickingAreaManager.hasTickingArea(name);
  } catch {
    return false;
  }
}

/**
 * 以目标点为中心创建模拟4常加载区域（圆形半径 4）。
 * 等价命令：`tickingarea add circle <xyz> 4 <name>`
 * @param center 中心坐标（方块坐标，取整后使用）
 * @param dimension 目标维度（区域所在维度，必须与假人生成点维度一致）
 * @param name 常加载区域名（模组独有，建议带前缀 mockplayer:）
 * @returns 是否创建成功（Manager 方式的 Promise 在全部区块加载后 resolve）
 */
export async function createSim4Area(
  center: Vector3,
  dimension: Dimension,
  name: string,
): Promise<TickingAreaResult> {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" };
  // 先清理同名残留（防重名冲突导致创建失败）
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) {
      world.tickingAreaManager.removeTickingArea(name);
    }
  } catch {
    // 忽略
  }
  // 优先：Manager 方式（Promise 等待区块加载完成，可靠）
  const managerResult = await createViaManager(center, dimension, name);
  if (managerResult.ok) return managerResult;
  // 回退：命令方式（圆形）
  const cmdResult = createViaCommand(center, dimension, name, SIM4_RADIUS);
  if (cmdResult.ok) return cmdResult;
  // 双通道均失败，回显 Manager 的原因（更详细）+ 命令原因
  return {
    ok: false,
    reason: managerResult.reason ? `${managerResult.reason}；命令回退失败: ${cmdResult.reason ?? "unknown"}` : cmdResult.reason,
  };
}

/**
 * 移除常加载区域。
 * 等价命令：`tickingarea remove <name>`
 * 同时尝试 Manager 与命令双通道，确保兼容。
 * @param name 要移除的区域名
 * @param dimension 可选：执行移除命令的维度上下文（默认尝试 overworld / nether / the_end / 传入维度）
 */
export function removeSim4Area(name: string, dimension?: Dimension): TickingAreaResult {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" };
  let managerRemoved = false;
  let managerError: string | undefined;
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) {
      world.tickingAreaManager.removeTickingArea(name);
      managerRemoved = true;
    }
  } catch (e: any) {
    managerError = e?.message ?? String(e);
  }

  // 命令通道：尝试在多个维度执行移除（tickingarea remove 为全局名，但需在某维度上下文执行）
  const cmdResult = removeViaCommand(name, dimension);
  if (cmdResult.ok || managerRemoved) {
    return { ok: true };
  }
  // 两者均未成功移除
  if (managerError) return { ok: false, reason: `${managerError}；${cmdResult.reason ?? "unknown"}` };
  return cmdResult;
}

// ─── 私有：Manager 通道 ──────────────────────────────────

async function createViaManager(center: Vector3, dimension: Dimension, name: string): Promise<TickingAreaResult> {
  const manager = world.tickingAreaManager;
  // 构造 4 区块半径的包围盒（方块坐标）：以中心所在区块为基准 ±4 区块
  // 覆盖圆形半径 4 的外接正方形（9×9 区块列，区块柱常加载，y 取中心 y）
  const chunkX = Math.floor(center.x / 16);
  const chunkZ = Math.floor(center.z / 16);
  const y = Math.floor(center.y);
  // from/to 均取区块对齐边界（from 为区块起点，to 为区块终点含 15 偏移），确保覆盖完整区块列
  const from = { x: (chunkX - SIM4_RADIUS) * 16, y, z: (chunkZ - SIM4_RADIUS) * 16 };
  const to = { x: (chunkX + SIM4_RADIUS) * 16 + 15, y, z: (chunkZ + SIM4_RADIUS) * 16 + 15 };
  const options = { dimension, from, to };
  try {
    if (!manager.hasCapacity(options)) {
      return { ok: false, reason: `常加载容量不足（${manager.chunkCount}/${manager.maxChunkCount}）` };
    }
  } catch (e: any) {
    return { ok: false, reason: `hasCapacity 检查失败: ${e?.message ?? e}` };
  }
  try {
    await manager.createTickingArea(name, options);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

// ─── 私有：跨维度 execute 规范化 ───────────────────────

/** 将 Dimension.id 规范化为 `execute in <dim>` 接受的形式（香草维度用短名，自定义保持全称） */
function normalizeExecuteDimension(id: string): string {
  // 香草三维度：Bedrock 的 execute in 接受 overworld / nether / the_end
  if (id === "minecraft:overworld" || id === "overworld") return "overworld";
  if (id === "minecraft:nether" || id === "nether") return "nether";
  if (id === "minecraft:the_end" || id === "the_end" || id === "minecraft:theEnd" || id === "theEnd") return "the_end";
  // 自定义维度：保持原 id（如 mockplayer:test），execute in 应支持全称
  return id;
}

/** 尝试通过 `execute in <dim> run <cmd>` 执行，若失败回退裸命令 */
function runTickingCommand(cmd: string, targetDim: Dimension): { success: boolean; error?: string } {
  const execDim = normalizeExecuteDimension(targetDim.id);
  const execCmd = `execute in ${execDim} run ${cmd}`;
  // 优先用 overworld 作为执行者去 execute 到目标维度（跨维度最可靠）
  // 裸 dimension.runCommand 在跨维度时可能仍在原维度执行，execute 才能强制切换
  const executors: Dimension[] = [];
  try {
    const overworld = world.getDimension("minecraft:overworld");
    if (overworld.id !== targetDim.id) executors.push(overworld);
  } catch {}
  executors.push(targetDim);
  // 再尝试其他常见维度作为执行者
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
    // 回退：裸命令（同维度执行时等价）
    try {
      const res2 = exec.runCommand(cmd);
      if (res2.successCount > 0) return { success: true };
      if (!lastError) lastError = `裸命令 successCount=0: ${cmd}`;
    } catch (e: any) {
      if (!lastError) lastError = e?.message ?? String(e);
    }
  }
  // 最后兜底：直接在目标维度裸执行一次（兼容旧逻辑）
  try {
    const res = targetDim.runCommand(cmd);
    if (res.successCount > 0) return { success: true };
    return { success: false, error: lastError ?? `裸命令 successCount=0: ${cmd}` };
  } catch (e: any) {
    return { success: false, error: lastError ?? e?.message ?? String(e) };
  }
}

// ─── 私有：命令通道（已跨维度封装） ─────────────────────

function createViaCommand(center: Vector3, dimension: Dimension, name: string, radius: number): TickingAreaResult {
  const x = Math.floor(center.x);
  const y = Math.floor(center.y);
  const z = Math.floor(center.z);
  const cmd = `tickingarea add circle ${x} ${y} ${z} ${radius} ${name}`;
  const r = runTickingCommand(cmd, dimension);
  if (r.success) return { ok: true };
  return { ok: false, reason: r.error ?? `命令执行失败: ${cmd}` };
}

function removeViaCommand(name: string, hintDimension?: Dimension): TickingAreaResult {
  const cmd = `tickingarea remove ${name}`;
  // 若有提示维度，直接走跨维度 execute
  if (hintDimension) {
    const r = runTickingCommand(cmd, hintDimension);
    if (r.success) return { ok: true };
    // 提示维度未找到，继续尝试其他维度（区域可能被创建在其他维度，或残留）
  }
  // 尝试常见维度（overworld / nether / the_end）逐一 execute
  const tryDimIds = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
  for (const dimId of tryDimIds) {
    if (hintDimension && normalizeExecuteDimension(hintDimension.id) === normalizeExecuteDimension(dimId)) continue;
    try {
      const dim = world.getDimension(dimId);
      const r = runTickingCommand(cmd, dim);
      if (r.success) return { ok: true };
    } catch {
      // 维度不存在或命令失败，继续
    }
  }
  // 也尝试 hintDimension 的短名/全名互换（兼容不同服版本对 dimension id 的写法差异）
  if (hintDimension) {
    for (const alt of [hintDimension.id, normalizeExecuteDimension(hintDimension.id)]) {
      if (alt === hintDimension.id) continue;
      try {
        const altDim = world.getDimension(alt);
        const r = runTickingCommand(cmd, altDim);
        if (r.success) return { ok: true };
      } catch {}
    }
  }
  return { ok: false, reason: `未找到常加载区域 ${name}（跨维度 execute 均无匹配）` };
}
