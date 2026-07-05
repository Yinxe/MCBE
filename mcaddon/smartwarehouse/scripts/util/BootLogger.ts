import { world } from "@minecraft/server";

/**
 * ============================================================================
 * BootLogger —— 模组启动阶段信息打印 + 世界广播
 * ============================================================================
 *
 * Phase 1-3 发生在世界加载之前，缓存消息到 Phase 4。
 * done() 一次性通过 world.sendMessage 广播给所有在线玩家。
 * ============================================================================
 */

export class BootLogger {
  private phaseIndex = 0;
  private readonly lines: string[] = [];

  constructor(
    private readonly meta: {
      version: string;
      buildTime?: string;
      projectUrl?: string;
    }
  ) {}

  /** 打印模组横幅（仅控制台，此时世界未加载） */
  banner(): void {
    console.warn(`[SmartWarehouse] ${this.meta.version} 正在启动...`);
    if (this.meta.projectUrl) {
      console.warn(`[SmartWarehouse] 项目地址: ${this.meta.projectUrl}`);
    }
    if (this.meta.buildTime) {
      console.warn(`[SmartWarehouse] 构建时间: ${this.meta.buildTime}`);
    }
  }

  /** 标记一个 Phase 完成（控制台 + 缓存，done 时广播） */
  phase(label: string): void {
    this.phaseIndex++;
    const msg = `Phase ${this.phaseIndex}/4 ✓ ${label}`;
    console.warn(`[SmartWarehouse] ${msg}`);
    this.lines.push(`§a${msg}`);
  }

  /**
   * 启动完成 → 控制台日志 + 世界广播（所有 Phase 消息 + 版本信息）。
   */
  done(): void {
    console.warn(`[SmartWarehouse] ${this.meta.version} 加载完成`);
    this.lines.unshift(`§a[SmartWarehouse] §f${this.meta.version}`);
    this.lines.unshift(`§a[SmartWarehouse] §f${this.meta.projectUrl}`);
    try {
      for (const line of this.lines) {
        world.sendMessage(line);
      }
    } catch {
      /* 忽略 */
    }
  }
}
