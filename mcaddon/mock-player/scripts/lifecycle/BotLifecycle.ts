// ─── Bot 生命周期编排器（OOP + 事件驱动核心） ─────
// 职责：作为假人生命周期的单一编排入口，负责
//   1. 组件注册与优先级排序（DI）
//   2. per-bot 串行队列（防同名并发 → "(2)" 重名）
//   3. 阶段编排：before 守卫 → 核心动作 → after 副作用，事件广播
//   4. 错误隔离：守卫抛错中断流程并广播失败事件；后置钩子异常仅告警
//
// 设计原则：
//   - 编排器不直接写业务（spawn / ticking area / 通知 均由组件实现）
//   - 核心动作（实际生成/断开/删记录）由编排器协调，组件通过 hook 介入
//   - 所有对外方法永不 reject（返回 { ok, reason, bot? }），调用方可直接展示 reason
//   - 组件可通过实现接口 hook 或订阅 LifecycleEvents 两种方式介入，二选一或兼用

import { system, world, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../rules/Types";
import { BOT_TAG } from "../rules/tags/BotTags";
import { LifecycleEvents } from "./LifecycleEvents";
import type { LifecycleComponent, CreateOptions } from "./LifecycleComponent";
import type { LifecycleContext } from "./LifecycleContext";

// ─── 结果类型 ────────────────────────────────────────

export interface LifecycleResult {
  ok: boolean;
  reason?: string;
  bot?: SimulatedPlayer;
}

export interface CreateResult extends LifecycleResult {
  record?: BotRecord;
}

// ─── 编排器 ──────────────────────────────────────────

export class BotLifecycle {
  private readonly components: LifecycleComponent[] = [];
  private readonly queue = new Map<string, Promise<void>>();
  private readonly ctx: LifecycleContext;
  private readonly name: string = "BotLifecycle";

  constructor(ctx: LifecycleContext) {
    this.ctx = ctx;
  }

  // ─── 组件管理（DI） ────────────────────────────────

  /** 注册组件（按 priority 升序排序；同 priority 保持注册顺序） */
  use(component: LifecycleComponent): this {
    if (this.components.some((c) => c.id === component.id)) {
      console.warn(`[${this.name}] 组件 ${component.id} 已存在，跳过重复注册`);
      return this;
    }
    this.components.push(component);
    this.components.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    try {
      component.onRegister?.(this.ctx);
    } catch (e: any) {
      console.warn(`[${this.name}] 组件 ${component.id} onRegister 异常: ${(e as any)?.message ?? String(e)}`);
    }
    console.info(`[${this.name}] + 组件 ${component.id} (priority=${component.priority ?? 100})`);
    return this;
  }

  /** 卸载组件 */
  unuse(id: string): boolean {
    const idx = this.components.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    const removed = this.components.splice(idx, 1)[0]!;
    try {
      removed.onUnregister?.(this.ctx);
    } catch (e: any) {
      console.warn(`[${this.name}] 组件 ${id} onUnregister 异常: ${e?.message ?? e}`);
    }
    console.info(`[${this.name}] - 组件 ${id}`);
    return true;
  }

  getComponent(id: string): LifecycleComponent | undefined {
    return this.components.find((c) => c.id === id);
  }

  listComponents(): string[] {
    return this.components.map((c) => `${c.id}(${c.priority ?? 100})`);
  }

  // ─── 串行队列（per-bot） ───────────────────────────

  private async withQueue<T>(botName: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queue.get(botName) ?? Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((resolve) => (release = resolve));
    this.queue.set(botName, cur);
    cur.finally(() => {
      if (this.queue.get(botName) === cur) this.queue.delete(botName);
    });
    try {
      await prev;
    } catch {}
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ─── Hook 调度（区分守卫与副作用） ────────────────

  /** 前置守卫：任一组件抛错即中断并向上抛 */
  private async runBefore<K extends keyof LifecycleComponent>(
    hook: K,
    ...args: unknown[]
  ): Promise<void> {
    for (const c of this.components) {
      const fn = c[hook] as unknown as (...args: unknown[]) => unknown;
      if (typeof fn === "function") {
        await fn.apply(c, [this.ctx, ...args]);
      }
    }
  }

  /** 后置副作用：异常隔离，仅告警 */
  private async runAfter<K extends keyof LifecycleComponent>(
    hook: K,
    ...args: unknown[]
  ): Promise<void> {
    for (const c of this.components) {
      const fn = c[hook] as unknown as (...args: unknown[]) => unknown;
      if (typeof fn === "function") {
        try {
          await fn.apply(c, [this.ctx, ...args]);
        } catch (e: any) {
          console.warn(`[${this.name}:${c.id}] ${String(hook)} 异常: ${e?.message ?? e}`);
        }
      }
    }
  }

  // ─── 核心动作：真实生成（不经组件，直接调 spawnMode.spawnBot） ─

  private async doSpawn(
    record: BotRecord,
    location: import("@minecraft/server").Vector3,
    dimension: import("@minecraft/server").Dimension,
    rotation: import("@minecraft/server").Vector2,
    lookTarget?: import("@minecraft/server").Vector3
  ): Promise<SimulatedPlayer> {
    const { spawnBot } = await import("../features/manage/spawnMode");
    return spawnBot(record, location, dimension, rotation, lookTarget);
  }

  // ─── 对外 API：创建 ────────────────────────────────

  /**
   * 创建假人（完整生命周期：校验 → 生成 → 组件后处理 → 事件广播）。
   * 聚合原 features/manage/createBot 全部前置校验与记录构建。
   */
  async create(options: {
    rawName: string;
    ownerName: string;
    location: import("@minecraft/server").Vector3;
    dimension: import("@minecraft/server").Dimension;
    initialTags: string[];
    rotation: { x: number; y: number; z: number };
    lookTarget: { x: number; y: number; z: number };
    isSneaking: boolean;
    spawnMode?: "normal" | "chunkload";
  }): Promise<CreateResult> {
    const { normalizeBotName, isValidBotName, MAX_BOT_NAME_LENGTH } = await import("../rules/Types");
    const name = normalizeBotName(options.rawName);

    const createOpts: CreateOptions = {
      rawName: options.rawName,
      name,
      ownerName: options.ownerName,
      location: options.location,
      dimensionId: options.dimension.id,
      initialTags: options.initialTags,
      rotation: { x: options.rotation.x, y: options.rotation.y },
      lookTarget: { x: options.lookTarget.x, y: options.lookTarget.y, z: options.lookTarget.z },
      isSneaking: options.isSneaking,
      spawnMode: options.spawnMode,
    };

    // 基础名字校验（不委托组件，编排器兜底，避免组件未注册时脏数据）
    if (!isValidBotName(name)) {
      const reason = `假人名字不合法：不能为空、超过 ${MAX_BOT_NAME_LENGTH} 字符或包含 ":inv:" / ":equip:"`;
      LifecycleEvents.createFailed.trigger({ phase: "beforeCreate", botName: name, error: reason });
      return { ok: false, reason };
    }
    if (this.ctx.registry.has(name)) {
      const reason = `假人 ${name} 已存在，请更换名字`;
      LifecycleEvents.createFailed.trigger({ phase: "beforeCreate", botName: name, error: reason });
      return { ok: false, reason };
    }

    return this.withQueue(name, async () => {
      try {
        LifecycleEvents.beforeCreate.trigger({
          name,
          ownerName: options.ownerName,
          dimension: options.dimension.id,
          location: options.location,
        });

        // 守卫组件（配额/重名世界占用 等）可在此中断
        await this.runBefore("onBeforeCreate", createOpts);

        // 构建记录并生成实体
        const rot2 = { x: options.rotation.x, y: options.rotation.y };
        const record: BotRecord = {
          name,
          ownerName: options.ownerName,
          online: true,
          death: false,
          tags: [...options.initialTags],
          workMode: "none",
          isSneaking: options.isSneaking,
          spawnMode: options.spawnMode,
          lastPoint: {
            location: options.location,
            dimension: options.dimension.id,
            rotation: rot2,
            lookTarget: options.lookTarget,
          },
          respawnPoint: {
            location: options.location,
            dimension: options.dimension.id,
            rotation: rot2,
            lookTarget: options.lookTarget,
          },
          deathPoint: null,
          experience: { level: 0, xpProgress: 0, totalXp: 0 },
        };

        const bot = await this.doSpawn(record, options.location, options.dimension, rot2, options.lookTarget);

        console.info(
          `[${this.name}] 创建假人 ${name} 主人=${options.ownerName} @ ${options.dimension.id} ${Math.floor(options.location.x)} ${Math.floor(options.location.y)} ${Math.floor(options.location.z)}`
        );

        LifecycleEvents.afterCreate.trigger({ record });

        await this.runAfter("onAfterCreate", record);

        // 自动触发上线后处理（ticking area 等）——复用 online 的 afterOnline 组件链
        // 注意：create 已在线，无需再走 online 流程；但 ticking area 等 afterOnline 逻辑需补一次
        // 由各组件自行决定：onAfterCreate vs onAfterOnline 的复用
        return { ok: true, bot, record };
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        console.warn(`[${this.name}] 创建失败 ${name}: ${reason}`);
        LifecycleEvents.createFailed.trigger({ phase: "create", botName: name, error: reason });
        LifecycleEvents.lifecycleError.trigger({ phase: "create", botName: name, error: reason });
        return { ok: false, reason };
      }
    });
  }

  private isActuallyOnline(record: BotRecord): boolean {
    if (!record.online) return false;
    if (!record.entityId) return false;
    try {
      const e = world.getEntity(record.entityId);
      return !!e && (e as { isValid?: boolean }).isValid !== false;
    } catch {
      return false;
    }
  }

  // ─── 上线 ──────────────────────────────────────────

  async online(record: BotRecord): Promise<LifecycleResult> {
    if (this.isActuallyOnline(record)) {
      return { ok: false, reason: `假人 ${record.name} 已在线` };
    }

    return this.withQueue(record.name, async () => {
      if (this.isActuallyOnline(record)) {
        return { ok: false, reason: `假人 ${record.name} 已在线` };
      }
      try {
        LifecycleEvents.beforeOnline.trigger({ botName: record.name });
        await this.runBefore("onBeforeOnline", record);

        // 核心生成
        const state = record.lastPoint ?? record.respawnPoint;
        let dim: import("@minecraft/server").Dimension;
        try {
          dim = world.getDimension(state.dimension);
        } catch (e: any) {
          throw new Error(`维度无效 ${state.dimension}: ${e?.message ?? e}`);
        }
        const bot = await this.doSpawn(
          record,
          state.location,
          dim,
          state.rotation,
          state.lookTarget
        );
        record.online = true;
        record.death = false;
        this.ctx.save.saveRecord(record);
        // 三叉戟追踪（原 onlineBot 内联）——移至组件或保留编排器内轻量调用
        try {
          const { trackBotOnline } = await import("../features/trident/tridentTracker");
          trackBotOnline(bot.id, record.name);
        } catch {}

        console.info(
          `[${this.name}] 上线 ${record.name} @ ${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}`
        );

        LifecycleEvents.afterOnline.trigger({
          botName: record.name,
          location: bot.location,
          dimension: bot.dimension.id,
        });

        await this.runAfter("onAfterOnline", record, bot);

        return { ok: true, bot };
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        console.warn(`[${this.name}] 上线失败 ${record.name}: ${reason}`);
        LifecycleEvents.onlineFailed.trigger({ phase: "online", botName: record.name, error: reason });
        LifecycleEvents.lifecycleError.trigger({ phase: "online", botName: record.name, error: reason });
        return { ok: false, reason };
      }
    });
  }

  // ─── 下线 ──────────────────────────────────────────

  async offline(record: BotRecord): Promise<LifecycleResult> {
    if (!record.online) {
      return { ok: false, reason: `假人 ${record.name} 已离线` };
    }

    return this.withQueue(record.name, async () => {
      if (!record.online) {
        return { ok: false, reason: `假人 ${record.name} 已离线` };
      }
      try {
        LifecycleEvents.beforeOffline.trigger({ botName: record.name });
        await this.runBefore("onBeforeOffline", record);

        // 组件可在 onBeforeOffline 中预申请 SingleChunk 等
        // 核心下线：保存状态 + disconnect + 置 offline
        await this.doRawOffline(record);

        LifecycleEvents.afterOffline.trigger({ botName: record.name });
        await this.runAfter("onAfterOffline", record);

        return { ok: true };
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        console.warn(`[${this.name}] 下线失败 ${record.name}: ${reason}`);
        LifecycleEvents.offlineFailed.trigger({ phase: "offline", botName: record.name, error: reason });
        LifecycleEvents.lifecycleError.trigger({ phase: "offline", botName: record.name, error: reason });
        return { ok: false, reason };
      }
    });
  }

  private async doRawOffline(record: BotRecord): Promise<void> {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    const online = entity as SimulatedPlayer | undefined;
    const oldEntityId = record.entityId;
    if (online && (online as unknown as { hasTag?: (tag: string) => boolean }).hasTag?.(BOT_TAG)) {
      record.lastPoint = {
        location: online.location,
        dimension: online.dimension.id,
        rotation: (online as unknown as SimulatedPlayer).getRotation(),
        lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
      };
      record.isSneaking = (online as unknown as SimulatedPlayer).isSneaking;
      this.ctx.save.saveFullState(online as unknown as Player, record);
      try {
        (online as SimulatedPlayer).disconnect();
      } catch {}
    } else {
      // 无实体也做一次 saveRecord 保证 offline 标记落库
      // 避免 saveFullState 被守卫拦截后记录仍显示在线
    }
    record.online = false;
    record.entityId = undefined;
    this.ctx.save.saveRecord(record);
    if (oldEntityId) {
      try {
        const { trackBotOffline } = await import("../features/trident/tridentTracker");
        trackBotOffline(oldEntityId);
      } catch {}
    }
    // 触发领域事件（与原 rawOffline 保持一致）
    const { BotEvents } = await import("../events/DomainEvents");
    BotEvents.botOffline.trigger({ botName: record.name });
  }

  // ─── 删除 ──────────────────────────────────────────

  async delete(record: BotRecord, reclaimTo?: Player): Promise<LifecycleResult> {
    const botName = record.name;
    return this.withQueue(botName, async () => {
      try {
        LifecycleEvents.beforeDelete.trigger({ botName });
        await this.runBefore("onBeforeDelete", record);

        // 回收（可选）
        if (reclaimTo) {
          try {
            const { reclaimBot } = await import("../features/manage/reclaim");
            const result = reclaimBot(reclaimTo, record);
            const parts: string[] = [];
            if (result.items > 0) parts.push(`${result.items} 件物品`);
            if (result.overflow > 0) parts.push(`${result.overflow} 件溢出掉落`);
            if (result.xp > 0) parts.push(`${result.xp} XP（Lv.${result.xpLevel}）`);
            if (parts.length > 0) {
              try {
                reclaimTo.sendMessage(`§7回收自 §e${record.name}§7: ${parts.join("、")}`);
              } catch {}
            }
          } catch (e: any) {
            try {
              reclaimTo?.sendMessage(`§c回收 ${record.name} 物品时出错: ${e.message}`);
            } catch {}
          }
        }

        // 断开在线实体
        if (record.online) {
          const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
          if (entity && (entity as unknown as { hasTag?: (tag: string) => boolean }).hasTag?.(BOT_TAG)) {
            try {
              const { trackBotOffline } = await import("../features/trident/tridentTracker");
              trackBotOffline(entity.id);
            } catch {}
            try {
              (entity as SimulatedPlayer).disconnect();
            } catch {}
          }
          const { BotEvents } = await import("../events/DomainEvents");
          BotEvents.botOffline.trigger({ botName: record.name });
        }

        this.ctx.save.removeRecord(record.name);
        this.ctx.inventory.forget(record.name);
        try {
          const { cleanupRaidMode } = await import("../features/flow/raidMode");
          cleanupRaidMode(record.name);
        } catch {}

        LifecycleEvents.afterDelete.trigger({ botName, reclaimed: !!reclaimTo });
        await this.runAfter("onAfterDelete", botName);

        console.info(`[${this.name}] 删除假人 ${botName}`);
        return { ok: true };
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        console.warn(`[${this.name}] 删除失败 ${botName}: ${reason}`);
        LifecycleEvents.deleteFailed.trigger({ phase: "delete", botName, error: reason });
        LifecycleEvents.lifecycleError.trigger({ phase: "delete", botName, error: reason });
        return { ok: false, reason };
      }
    });
  }

  // ─── 击杀 ──────────────────────────────────────────

  async kill(record: BotRecord): Promise<LifecycleResult> {
    try {
      LifecycleEvents.beforeKill.trigger({ botName: record.name });
      await this.runBefore("onBeforeKill", record);

      const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
      if (!entity || !(entity as unknown as { hasTag?: (tag: string) => boolean }).hasTag?.(BOT_TAG)) {
        throw new Error("无法在世界中找到该模拟玩家");
      }
      (entity as SimulatedPlayer).kill();
      return { ok: true };
    } catch (e: any) {
      const reason = e?.message ?? String(e);
      LifecycleEvents.lifecycleError.trigger({ phase: "kill", botName: record.name, error: reason });
      return { ok: false, reason };
    }
  }

  // ─── 重连（safeReconnect 语义） ────────────────────

  private readonly reconnecting = new Set<string>();

  async reconnect(
    record: BotRecord,
    options?: { onOffline?: (r: BotRecord) => void; onOnline?: (bot: SimulatedPlayer, r: BotRecord) => void }
  ): Promise<void> {
    if (this.reconnecting.has(record.name)) {
      console.warn(`[${this.name}] 重连跳过 ${record.name}——已有重连在进行`);
      return;
    }
    this.reconnecting.add(record.name);
    const run = async () => {
      await new Promise<void>((resolve) =>
        system.run(async () => {
          try {
            const res = await this.offline(record);
            if (!res.ok) console.warn(`[${this.name}] 重连 offline 失败 ${record.name}: ${res.reason}`);
          } catch (e: any) {
            console.warn(`[${this.name}] 重连 offline 异常 ${record.name}: ${e?.message ?? e}`);
          }
          try {
            options?.onOffline?.(record);
          } catch (e: any) {
            console.warn(`[${this.name}] 重连 onOffline 异常 ${record.name}: ${e?.message ?? e}`);
          }
          resolve();
        })
      );

      const { RECONNECT_DELAY_TICKS } = await import("../rules/Types");
      await new Promise<void>((res) => system.runTimeout(res, RECONNECT_DELAY_TICKS));
      const { waitForNameAvailable } = await import("../bot/PlayerGateway");
      try {
        await waitForNameAvailable(record.name);
      } catch {
        console.warn(`[${this.name}] 重连等待名称释放异常 ${record.name}，强制上线`);
      }

      const result = await this.online(record);
      if (!result.ok || !result.bot) {
        console.error(`[${this.name}] 重连上线失败 ${record.name}: ${result.reason ?? "unknown"}`);
        record.online = false;
        record.entityId = undefined;
        this.ctx.save.saveRecord(record);
        return;
      }
      try {
        options?.onOnline?.(result.bot, record);
      } catch (e: any) {
        console.warn(`[${this.name}] 重连回调异常 ${record.name}: ${e?.message ?? e}`);
      }
    };

    try {
      await run();
    } catch (e: any) {
      console.error(`[${this.name}] 重连异常 ${record.name}: ${e?.message ?? e}`);
    } finally {
      this.reconnecting.delete(record.name);
    }
  }

  isReconnecting(botName: string): boolean {
    return this.reconnecting.has(botName);
  }

  // ─── 世界加载 ──────────────────────────────────────

  async worldLoad(): Promise<BotRecord[]> {
    let restored: BotRecord[] = [];
    try {
      restored = this.ctx.registry.restoreAll({
        autoOnlineOnRestart: this.ctx.configStore.get().autoOnlineOnRestart,
      });
      console.info(`[${this.name}] 恢复 ${restored.length} 个记录（自动上线=${this.ctx.configStore.get().autoOnlineOnRestart}）`);
    } catch (e: any) {
      console.warn(`[${this.name}] 恢复记录失败: ${e?.message ?? e}`);
    }

    LifecycleEvents.worldLoad.trigger({ restoredCount: restored.length });
    await this.runAfter("onWorldLoad", restored);
    return restored;
  }

  // ─── 便捷：安全上下线（兼容旧 safeOnline/safeOffline 命名） ─

  safeOnline(record: BotRecord): Promise<LifecycleResult> {
    return this.online(record);
  }

  safeOffline(record: BotRecord): Promise<LifecycleResult> {
    return this.offline(record);
  }
}
