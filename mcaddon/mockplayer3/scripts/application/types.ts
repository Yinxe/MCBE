// ─── application 层共享小类型 ───────────────────────────────────────
// 管线意图的统一回执形状，interface 层据此渲染用户提示；失败必带中文原因。

import type { ReclaimCounts } from "../engine/EntityOps";

export type ActionResult = { ok: true; botId?: number; name?: string } | { ok: false; reason: string };

/** 回收意图回执：成功带计数，失败带原因 */
export type ReclaimOutcome = ({ ok: true } & ReclaimCounts) | { ok: false; reason: string };
