// ─── BotManager：假人实例注册表 + 全局驱动器（mc/bot） ──
// 每个假人一个 MockBot 实例（懒创建 getOrCreate，删除时 remove）；
// 全局单 runInterval(1tick) 驱动器遍历**在线未死亡**实例调 engine.tick
// （引擎对象按假人独立——能力/任务/状态隔离；驱动集中——性能与异常可控）。
// 生命周期挂钩：botOnline 创建实例（驱动器只 tick active），
// botOffline/botDeath 实例保留（isActive 判定跳过），删除假人 remove。

import { system } from "@minecraft/server";

import { BotEvents } from "../../core/events/DomainEvents";
import type { BotRecord } from "../../core/model/Types";
import { botRegistry } from "../bootstrap/context";
import { MockBot } from "./MockBot";

export class BotManager {
  private readonly bots = new Map<string, MockBot>();
  private driverHandle: number | undefined;

  /** 按名字取实例（未创建 → undefined） */
  get(name: string): MockBot | undefined {
    return this.bots.get(name);
  }

  /** 按记录取实例（懒创建；调用方应保证 record 已注册） */
  getOrCreate(record: BotRecord): MockBot {
    let bot = this.bots.get(record.name);
    if (!bot) {
      bot = new MockBot(record);
      this.bots.set(record.name, bot);
    }
    return bot;
  }

  /** 删除假人时清理实例（引擎/任务随实例释放） */
  remove(name: string): void {
    this.bots.delete(name);
  }

  /** 全部活跃实例（调试/遍历用） */
  all(): MockBot[] {
    return [...this.bots.values()];
  }

  /**
   * 启动驱动器（worldLoad 后调用一次，幂等）：
   * 订阅生命周期事件创建实例 + runInterval(1) 推进所有在线未死亡实例的引擎。
   */
  start(): void {
    if (this.driverHandle !== undefined) return;

    // 生命周期挂钩：上线创建实例（驱动器只 tick active；下线/死亡自动跳过）
    BotEvents.botOnline.subscribe((e) => {
      const record = botRegistry.get(e.botName);
      if (record) this.getOrCreate(record);
    });
    BotEvents.botOffline.subscribe((e) => {
      // 实例保留（isActive 判定），仅确保存在（离线改名等场景 record 仍在）
      const record = botRegistry.get(e.botName);
      if (record) this.getOrCreate(record);
    });

    this.driverHandle = system.runInterval(() => this.drive(), 1);
    console.info("[MockPlayer] BotManager 驱动器已启动（每假人独立引擎）");
  }

  /** 停止驱动器（worldUnload/测试用） */
  stop(): void {
    if (this.driverHandle !== undefined) {
      try {
        system.clearRun(this.driverHandle);
      } catch {
        /* ignore */
      }
      this.driverHandle = undefined;
    }
  }

  // ── 私有 ────────────────────────────────────────────

  /** 每 tick 推进所有在线未死亡实例的引擎（单实例异常隔离） */
  private drive(): void {
    for (const bot of this.bots.values()) {
      if (!bot.isActive()) continue;
      try {
        bot.engine.tick(bot.context);
      } catch (e: any) {
        console.warn(`[MockPlayer] ${bot.name} 引擎异常: ${e?.message ?? e}`);
      }
    }
  }
}

/** 模块级单例（bootstrap 装配） */
export const botManager = new BotManager();
