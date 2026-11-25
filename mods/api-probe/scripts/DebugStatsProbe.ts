// ─── 模块级探针:debug-utilities 除形状之外的全部导出 ─────────────
//
// 该模块 1.21.100 版导出四样东西,本模组此前只用了 `debugDrawer`:
//
//   · `debugDrawer`                形状绘制(已在 DebugRenderer 覆盖)
//   · `collectRuntimeStats()`      脚本运行时内存/对象统计
//   · `collectPluginStats()`       各插件的句柄计数
//   · `disableWatchdogTimingWarnings(boolean)`  关掉看门狗卡顿告警
//
// 后三样对开发期排查很有用(尤其内存泄漏与句柄泄漏),但此前完全没接。
// 本文件把它们摊成报告。
//
// 注意 `disableWatchdogTimingWarnings` 会改全局行为:关掉之后看门狗不再告警,
// 卡顿就会被静默吞掉。所以本命令做成「报告当前状态 + 需要时显式开启」,
// 不默认关。

import {
  collectPluginStats,
  collectRuntimeStats,
  disableWatchdogTimingWarnings,
  type PluginStats,
  type RuntimeStats,
} from "@minecraft/debug-utilities";
import { Player } from "@minecraft/server";
import { attempt, errorText, heading, kv, report, verdict, warning } from "./DebugProbeShared";

/** 运行时统计里最值得看的几项(其余项一并列出但排在后面) */
const HIGHLIGHT_RUNTIME_KEYS: readonly (keyof RuntimeStats)[] = [
  "memoryUsedSize",
  "memoryAllocatedSize",
  "objectCount",
  "stringCount",
  "functionCount",
  "atomCount",
];

/** 把字节数换成人类可读形式 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * `/apitest:debugstats` 的实现:报告脚本运行时与各插件的统计。
 *
 * 用途是排查内存与句柄泄漏:反复召唤实体、反复建形状之后再看这两个数字,
 * 是否单调上升就是答案。
 */
export function runStatsProbeCommand(player: Player): void {
  const lines: string[] = [heading("运行时与插件统计")];

  // ── collectRuntimeStats ──
  const runtime = attempt(() => collectRuntimeStats());
  if (runtime.ok) {
    lines.push(heading("collectRuntimeStats()"));
    const stats = runtime.value;
    for (const key of HIGHLIGHT_RUNTIME_KEYS) {
      const value = stats[key];
      if (typeof value !== "number") continue;
      const display = key.endsWith("Size") ? formatBytes(value) : value;
      lines.push(`  ${kv(key, display)}`);
    }
    // 其余项一并列出,便于发现未预料到的字段
    const rest = (Object.keys(stats) as (keyof RuntimeStats)[]).filter((key) => !HIGHLIGHT_RUNTIME_KEYS.includes(key));
    if (rest.length > 0) {
      lines.push(`  §7其余 ${rest.length} 项:`);
      for (const key of rest) {
        const value = stats[key];
        const display = key.endsWith("Size") && typeof value === "number" ? formatBytes(value) : value;
        lines.push(`    ${kv(key, display)}`);
      }
    }
  } else {
    lines.push(warning(`collectRuntimeStats 抛错:${runtime.error}`));
  }

  // ── collectPluginStats ──
  const plugins = attempt(() => collectPluginStats());
  if (plugins.ok) {
    lines.push(heading("collectPluginStats()"));
    lines.push(`  ${kv("插件数量", plugins.value.plugins.length)}`);
    for (const entry of plugins.value.plugins) {
      lines.push(`  §b${entry.name}`);
      lines.push(`    ${kv("packId", entry.packId)}`);
      lines.push(`    ${kv("scriptModuleUUID", entry.scriptModuleUUID)}`);
      const handles = Object.entries(entry.handleCounts ?? {});
      if (handles.length === 0) {
        lines.push("    §7句柄计数为空");
      } else {
        for (const [handleName, count] of handles) {
          lines.push(`    ${kv(handleName, count)}`);
        }
      }
    }
  } else {
    lines.push(warning(`collectPluginStats 抛错:${plugins.error}`));
  }

  lines.push("§7用途:反复做同一个操作前后各跑一次,数字单调上升即为泄漏。");
  lines.push(verdict("统计采集完毕"));
  report(player, lines);
}

/**
 * `/apitest:debugwatchdog <0|1>` 的实现:开关看门狗卡顿告警。
 *
 * 关掉之后,脚本卡顿不再产生告警日志 —— 排查卡顿时会静默吞掉线索,
 * 所以默认保持开启,只在明确需要压测时临时关。
 */
export function runWatchdogProbeCommand(player: Player, disableInput?: number): void {
  const disable = (disableInput ?? 0) !== 0;
  const result = attempt(() => {
    disableWatchdogTimingWarnings(disable);
    return disable ? "已关闭告警" : "已恢复告警";
  });

  const lines = [heading("看门狗告警开关")];
  if (result.ok) {
    lines.push(`  §a${result.value}`);
    lines.push(
      disable
        ? "§c注意:关闭期间脚本卡顿不会再产生告警日志,排查完请执行 §f/apitest:debugwatchdog 0§c 恢复。"
        : "§7告警已恢复,卡顿会重新出现在内容日志里。"
    );
  } else {
    lines.push(warning(`调用失败:${result.error}`));
  }
  report(player, lines);
}

/**
 * `/apitest:debugall` 的实现:把上面几项一次跑完,用于快速摸底。
 *
 * 形状探针会因为排布密集而重叠,所以本命令只跑统计类,
 * 不重复画形状 —— 形状细节请用 `/apitest:debugshape`。
 */
export function runAllProbesCommand(player: Player): void {
  const lines: string[] = [heading("API 能力总览")];

  const runtime = attempt(() => collectRuntimeStats());
  const plugins = attempt(() => collectPluginStats());
  lines.push(`  ${kv("collectRuntimeStats", runtime.ok ? "可用" : `抛错:${runtime.error}`)}`);
  lines.push(`  ${kv("collectPluginStats", plugins.ok ? "可用" : `抛错:${plugins.error}`)}`);
  if (plugins.ok) {
    lines.push(`  ${kv("已注册插件数", plugins.value.plugins.length)}`);
  }
  lines.push(`  ${kv("debugDrawer", "可用(见 /apitest:debugshape)")}`);
  lines.push(`  ${kv("disableWatchdogTimingWarnings", "可用(见 /apitest:debugwatchdog)")}`);

  // 逐项列出本版模块导出的形状类,作为版本对照表
  lines.push(heading("本版形状类"));
  const shapeNames = ["DebugLine", "DebugArrow", "DebugBox", "DebugSphere", "DebugCircle", "DebugText"];
  lines.push(`  §7${shapeNames.join("、")}`);
  lines.push("  §7该模块 1.21.130+ 才有 addShape(shape, dimension);");
  lines.push("  §71.26.0+ 才有 visibleTo;1.26.60+ 才有 Cone/Cylinder/Ellipsoid/Pyramid。");
  lines.push("  §7本版(1.21.100)以上均无。");

  lines.push(verdict("总览采集完毕"));
  report(player, lines);
}

/** 供测试与文档引用的类型再导出 */
export type { PluginStats, RuntimeStats };

/** 把错误文本转成一行(供其它探针复用) */
export function describeError(error: unknown): string {
  return errorText(error);
}
