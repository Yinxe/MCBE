// ─── 行为状态机（core/ai，3.3.24 执行层重写） ─────────────
// 对齐 V2 树模型 + 游戏引擎语义：每假人一个行为状态机，由大脑引擎每
// BRAIN_ENGINE_TICKS **同步推进一阶段**——无常驻 while 协程、无裸
// continue、无同 tick 自旋（3.3.10 vault / 3.3.24 fishing 曾因裸 continue
// 同 tick 死循环触发 Watchdog hang 杀服——V3 常驻工作流引入的失效类）。
// 约定：
//   - step() 同步短步（<1ms），内部**无循环、无 await**；失败直接 return
//     （下一轮重新决策），绝不原地重试
//   - 长等待用阶段计数（phaseTicks）；短命协程（导航/一次钓鱼/单块破坏——
//     V2 验证形态，硬超时+isAborted）由 step 启动，完成标志在后续 step
//     轮询——协程自身有界，状态机永不阻塞
//   - reset() 清全部状态（abort/切换/行为关闭），无残留协程

import type { AiMemory } from "./Memory";

/** 行为推进上下文（大脑注入：botName + 共享记忆 + 引擎 tick） */
export interface BehaviorContext {
  botName: string;
  tick: number;
  memory: AiMemory;
}

/** 行为状态机（能力 = 感知驱动决策 + 步进执行；替换常驻 while 工作流） */
export interface Behavior {
  readonly name: string;
  /** 优先级（数字小优先：防御 1 < 拾取 5 < 工作 10） */
  readonly priority: number;
  /** 当前是否可激活（同步短查，每引擎周期一次） */
  canActivate(ctx: BehaviorContext): boolean;
  /** 激活钩子（如停止导航）；切换/首次激活时调用 */
  onActivate?(ctx: BehaviorContext): void;
  /** 每引擎周期推进一阶段（同步、无循环、无 await） */
  step(ctx: BehaviorContext): void;
  /** 中止/切换/行为关闭：清状态（短命协程有 isAborted 自行退出） */
  reset(): void;
}

/** 行为注册表（大脑级：单主目标 + 优先级抢占；替换 GoalSelector 能力调度） */
export class BehaviorRunner {
  private behaviors: Behavior[] = [];
  private active: Behavior | undefined;

  /** 当前运行中的行为（undefined = idle） */
  get activeBehavior(): Behavior | undefined {
    return this.active;
  }

  /** 注册行为（同名忽略；按优先级升序维护——数字小优先） */
  register(behavior: Behavior): void {
    if (this.behaviors.some((b) => b.name === behavior.name)) return;
    this.behaviors.push(behavior);
    this.behaviors.sort((a, b) => a.priority - b.priority);
  }

  /** 卸载行为（运行中 → reset + 释放） */
  unregister(name: string): void {
    this.behaviors = this.behaviors.filter((b) => b.name !== name);
    if (this.active?.name === name) {
      this.active.reset();
      this.active = undefined;
    }
  }

  /**
   * 每引擎周期调用一次（同步）：
   *   1. 当前行为延续条件失效（canActivate）→ reset 释放
   *   2. 高→低选第一个可激活行为
   *   3. 切换（新行为 → 旧 reset + 新 onActivate）
   *   4. 推进当前行为一阶段（异常打印 + reset，不阻断调度）
   */
  step(ctx: BehaviorContext): void {
    if (this.active && !this.active.canActivate(ctx)) {
      try {
        this.active.reset();
      } catch (e: any) {
        console.error(`[MockPlayer] 行为 reset 异常(${this.active.name}, ${ctx.botName}): ${e?.message ?? e}`);
      }
      this.active = undefined;
    }
    let selected: Behavior | undefined;
    for (const b of this.behaviors) {
      if (b.canActivate(ctx)) {
        selected = b;
        break;
      }
    }
    if (selected !== this.active) {
      try {
        this.active?.reset();
      } catch (e: any) {
        console.error(`[MockPlayer] 行为 reset 异常(${this.active?.name}, ${ctx.botName}): ${e?.message ?? e}`);
      }
      this.active = selected;
      if (selected) {
        try {
          selected.onActivate?.(ctx);
        } catch (e: any) {
          console.error(`[MockPlayer] 行为 onActivate 异常(${selected.name}, ${ctx.botName}): ${e?.message ?? e}`);
        }
      }
    }
    if (!this.active) return;
    try {
      this.active.step(ctx);
    } catch (e: any) {
      console.error(`[MockPlayer] 行为 step 异常(${this.active.name}, ${ctx.botName}): ${e?.message ?? e}\n${e?.stack ?? ""}`);
      try {
        this.active.reset();
      } catch {
        /* 复位失败忽略 */
      }
      this.active = undefined;
    }
  }
}
