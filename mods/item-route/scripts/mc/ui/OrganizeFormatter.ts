// ─── 整理结果格式化（v1 smartwarehouse OrganizeFormatter 风格） ──
// 把单容器 OrganizeResult 转成玩家可读消息行：
//   · 失败 → 一行错误
//   · 空 → "空的，无需整理"
//   · 已整齐 → "已经很整齐了"
//   · 成功 → 混乱度分解、堆叠 before→after（合并 N 组）、种类/容量、perType top-8
import type { OrganizeResult } from "../../core/services/OrganizeService";
import { getChineseName } from "../../core/data/ItemNameMap";
import { chat } from "./uiColor";

/** 整理结果 → 玩家可读消息行列表（每条 sendMessage 一行） */
export function formatOrganizeResult(result: OrganizeResult, containerName: string): string[] {
  const lines: string[] = [];

  if (!result.ok) {
    lines.push(`${chat.error}${containerName} 整理失败`);
    return lines;
  }
  if (result.moves === 0 && result.beforeStacks === 0) {
    lines.push(`${chat.info}${containerName} 空的，无需整理`);
    return lines;
  }
  // 手动整理为强制整理：只有混乱度**归 0** 才提示整齐（非 0 但整理不出合并也如实展示）
  if (result.moves === 0 && result.messiness.total === 0) {
    lines.push(`${chat.info}${containerName} 已经很整齐了，无需整理`);
    return lines;
  }

  const m = result.messiness;
  lines.push(`${chat.success}${containerName} 整理完成`);
  lines.push(
    `${chat.muted}混乱度: ${chat.info}${pct(m.total)} → ${pct(result.chaosAfter)}` +
      `${chat.muted}（顺序 ${chat.info}${pct(m.order)}${chat.muted} 堆叠 ${chat.info}${pct(m.stack)}${chat.muted}）`
  );
  lines.push(
    `${chat.muted}堆叠: ${chat.info}${result.beforeStacks} → ${result.afterStacks}${chat.muted}（合并 ${chat.info}${result.moves}${chat.muted} 组）`
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

/** 0-1 值 → 百分比 */
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
