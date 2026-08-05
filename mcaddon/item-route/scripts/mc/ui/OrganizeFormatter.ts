// ─── 整理结果格式化（v1 smartwarehouse OrganizeFormatter 风格） ──
// 把 OrganizeResult 转成玩家可读的消息行：
//   · 失败 → 一行错误
//   · 无动作 → "已经很整齐了"
//   · 成功 → 混乱度 before→after、堆叠 before→after（合并 N 组）、种类/容量、perType top-8
import type { OrganizeResult } from "../../core/services/OrganizeService";
import { getChineseName } from "../../core/data/ItemNameMap";
import { chat } from "./uiColor";

/** 整理结果 → 玩家可读消息行列表（每条 sendMessage 一行） */
export function formatOrganizeResult(result: OrganizeResult, warehouseName: string): string[] {
  const lines: string[] = [];

  if (!result.ok) {
    lines.push(`${chat.error}${warehouseName} 整理失败`);
    return lines;
  }
  if (result.moves === 0 && result.actionsPlanned === 0) {
    lines.push(`${chat.info}${warehouseName} 已经很整齐了，无需整理`);
    return lines;
  }

  lines.push(`${chat.success}${warehouseName} 整理完成`);
  lines.push(`${chat.muted}混乱度: ${chat.info}${pct(result.chaosBefore)} → ${pct(result.chaosAfter)}`);
  const skipInfo = result.skipped > 0 ? `${chat.muted}（跳过 ${chat.info}${result.skipped}${chat.muted} 堆，目标满/不可堆叠）` : "";
  lines.push(
    `${chat.muted}堆叠: ${chat.info}${result.beforeStacks} → ${result.afterStacks}${chat.muted}（合并 ${chat.info}${result.moves}${chat.muted} 组${skipInfo}）`
  );
  lines.push(
    `${chat.muted}种类: ${chat.info}${result.beforeTypes} → ${result.afterTypes}${chat.muted} 种  ·  容量: ${chat.info}${result.usedSlots}/${result.totalSlots}${chat.muted} 格`
  );

  // 按总量排序打印每种物品（最多 8 种）
  const sorted = Object.entries(result.perType).sort(([, a], [, b]) => b.total - a.total);
  for (const [typeId, stat] of sorted.slice(0, 8)) {
    lines.push(`  ${chat.muted}${getChineseName(typeId)}: ${chat.info}${stat.stacks}堆 ${stat.total}个`);
  }
  if (sorted.length > 8) {
    lines.push(`  ${chat.muted}…还有 ${sorted.length - 8} 种物品`);
  }
  return lines;
}

/** 0-1 混乱度 → 百分比 */
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
