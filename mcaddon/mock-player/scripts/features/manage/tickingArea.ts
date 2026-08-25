// ─── TickingArea barrel（单职拆分后兼容层） ──────────
// 模拟4（命令域 9×9）与单区块（Manager）已拆至子模块，保留本文件作重导出以兼容旧 import 路径
// 新代码请直接 `from "./tickingArea/sim4"` / `from "./tickingArea/singleChunk"`

export interface TickingAreaResult {
  ok: boolean;
  reason?: string;
}

/** @deprecated 固定名已废弃（per-bot mockplayer:aux:<name> 替代），仅保留供旧存档残留清理 */
export const SAFE_ONLINE_TICKING_AREA_NAME = "mockplayer:safe_online";
/** @deprecated 固定名已废弃，仅保留供旧存档残留清理 */
export const SAFE_OFFLINE_TICKING_AREA_NAME = "mockplayer:safe_offline";

export { SIM4_RADIUS, createSim4Area, hasTickingArea, removeSim4Area } from "./tickingArea/sim4";
export { createSingleChunkArea, removeSingleChunkArea } from "./tickingArea/singleChunk";
