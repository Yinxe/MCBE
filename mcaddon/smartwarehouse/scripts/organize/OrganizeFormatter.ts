import type { OrganizeResult } from "./SlotOrganizer";

/**
 * 将整理结果格式化为玩家可读的消息行列表。
 * 用于背包整理命令和容器菜单中统一展示整理结果。
 */
export function formatOrganizeResult(result: OrganizeResult, containerName: string): string[] {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(`§c${containerName} 整理失败: ${result.error}`);
    return lines;
  }

  // 混乱度（如果有）
  if (result.messiness) {
    const m = result.messiness;
    lines.push(
      `§7混乱度: §f${(m.total * 100).toFixed(0)}% ` +
        `§7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`
    );
  }

  if (result.movedStacks === 0 && result.beforeStacks === 0) {
    lines.push(`§e${containerName} 空的，无需整理`);
    return lines;
  }

  if (result.movedStacks === 0 && result.messiness && result.messiness.total < 0.05) {
    lines.push(`§e${containerName} 已经很整齐了，无需整理`);
    return lines;
  }

  lines.push(`§a${containerName} 整理完成`);
  lines.push(`§7堆叠: §f${result.beforeStacks} → ${result.afterStacks} §7(合并 §e${result.movedStacks} §7组)`);
  lines.push(
    `§7种类: §f${result.beforeTypes} §7种  §7容量: §f${result.usedSlots}/${result.totalSlots} §7(${result.usagePercent}%)`
  );

  // 按总量排序打印每种物品（最多 8 种）
  const sorted = Object.entries(result.perType).sort(([, a], [, b]) => b.total - a.total);
  for (const [typeId, stat] of sorted.slice(0, 8)) {
    const shortName = typeId.includes(":") ? typeId.split(":")[1] : typeId;
    lines.push(`  §7${shortName}: §f${stat.stacks}堆 §f${stat.total}个`);
  }
  if (sorted.length > 8) {
    lines.push(`  §8...还有 ${sorted.length - 8} 种物品`);
  }

  return lines;
}
