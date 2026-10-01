// ─── 编程模式能力（工作模式 "script"：按脚本顺序执行指令） ──
// 设计（对齐现有能力框架 scripts/ai）：
//   - canActivate 只认 workMode === "script"
//   - step：把当前假人交给常驻协程（每假人一条，重复 step 不重复启动）
//   - reset（卸载/切换模式）：token.cancel() 立即唤醒 + stopMoving，不留残留
//   - 脚本被编辑或手动 run → requestScriptKick，令协程丢弃旧进度重开一轮
//   - 失败默认「停下并报告」：主人聊天栏 + 运行时快照（供界面显示）
//
// 执行语义：
//   - 顺序执行；jump 模块把光标移到第 N 条（向前=跳过，向后=自定义循环）
//   - 整段循环：loopCount = -1 一直 / 1 只跑一遍 / N 循环 N 次
//   - 连续纯跳转超过上限 → 判定死循环并停下（防刷屏）
import { system, world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";
import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { botRegistry } from "../../../bootstrap/context";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { createCancelToken, type CancelToken } from "../../../rules/utils/CancelToken";
import { createDefaultScriptProgram, type ScriptStep } from "../../../rules/Types";
import { describeStep } from "../../../rules/script/ScriptRules";
import { breakBlockOnce, placeBlockOnce, viewBlock } from "../../basic/blocks";
import { longNavigateBot, navigateBot, NavigateResult } from "../../basic/move";
import { lookAt } from "../../basic/PoseGateway";
import { useItemOnce, UseItemResult } from "../../basic/items/useItem";
import { getScriptKick, patchScriptRuntime } from "../../script/runtime";
import { notifyPlayer } from "../../notify/NotifyPrefs";

/** 破坏/视线探测的轮询间隔（tick） */
const POLL_TICKS = 5;
/** 每条指令之间的最小间隔（tick）：防刷 */
const STEP_PACE_TICKS = 1;
/** 空闲重查间隔（tick）：离线/空脚本时低息等待 */
const IDLE_RECHECK_TICKS = 20;
/** 说话前最小间隔（tick） */
const SAY_MIN_GAP_TICKS = 10;
/** 每次挥击间隔（tick） */
const ATTACK_SWING_TICKS = 4;
/** 放置前看向目标的稳定时间（tick） */
const PLACE_LOOK_SETTLE_TICKS = 5;
/** 方块类动作的最大作用距离（格） */
const ACTION_MAX_DISTANCE = 6;
/** 连续纯跳转上限（超过判定死循环） */
const JUMP_STREAK_LIMIT = 40;

/** 单步执行结果 */
type StepOutcome =
  | { status: "ok" }
  | { status: "fail"; message: string }
  | { status: "cancelled" };

/** 整段执行结果 */
type ProgramOutcome = "done" | "fail" | "cancelled";

/** 假人实体引用（step 与协程之间共享当前实体） */
interface SharedBotRef {
  current: SimulatedPlayer | undefined;
}

/** 可被取消令牌立即唤醒的等待（token.cancel() 不必等定时器到期） */
function waitTicks(ticks: number, token: CancelToken): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      system.runTimeout(() => resolve(), ticks);
    }),
    token.signal,
  ]);
}

/** 调试日志（内容日志可见） */
function logLine(botName: string, text: string): void {
  console.info(`[MockPlayer][script] ${botName}: ${text}`);
}

/** 通知假人主人（按主人的通知偏好过滤；主人不在线则静默） */
function tellOwner(botName: string, text: string): void {
  try {
    const rec = botRegistry.get(botName);
    if (!rec?.ownerName) return;
    const owner = world.getAllPlayers().find((p) => p.name === rec.ownerName);
    if (owner) notifyPlayer(owner, "info", text);
  } catch {
    // 通知失败不影响脚本执行
  }
}

/** 寻路结果 → 中文原因 */
function navigateReasonText(result: NavigateResult): string {
  switch (result) {
    case NavigateResult.Arrived:
      return "已到达";
    case NavigateResult.TooFar:
      return "超出最远距离（16 格）";
    case NavigateResult.NoPath:
      return "无路径可达";
    case NavigateResult.StillTimeout:
      return "移动卡住（0.5 秒未位移）";
    case NavigateResult.Timeout:
      return "移动超时（30 秒）";
    case NavigateResult.Unavailable:
      return "假人不可用（离线/死亡）";
    case NavigateResult.EntityInvalid:
      return "移动中实体失效";
    case NavigateResult.Error:
      return "异常";
  }
}

/** 破坏结果 → 中文原因 */
function breakReasonText(result: string): string {
  switch (result) {
    case "far":
      return "目标太远（>6 格）";
    case "offline":
      return "假人不可用（离线/死亡）";
    case "busy":
      return "已有进行中的破坏动作";
    case "blocked":
      return "视线被遮挡";
    default:
      return `未完成（${result}）`;
  }
}

// ─── 单步执行 ────────────────────────────────────────────
/** 执行一条指令（含取消检查；永不 reject） */
async function executeStep(
  botName: string,
  step: ScriptStep,
  token: CancelToken,
  sharedBot: SharedBotRef,
): Promise<StepOutcome> {
  const bot = sharedBot.current?.isValid ? sharedBot.current : resolveBotPlayer(botName);
  if (!bot) return { status: "fail", message: "假人暂时不可用（离线/死亡/重连中）" };

  switch (step.type) {
    case "moveTo": {
      const target = { x: step.x, y: step.y, z: step.z };
      const dist = Math.hypot(target.x - bot.location.x, target.z - bot.location.z);
      const result = dist > 16 ? await longNavigateBot(botName, target) : await navigateBot(botName, target);
      if (token.cancelled) return { status: "cancelled" };
      return result === NavigateResult.Arrived
        ? { status: "ok" }
        : { status: "fail", message: `寻路失败（${navigateReasonText(result)}）` };
    }
    case "wait": {
      await waitTicks(Math.max(1, step.ticks), token);
      return token.cancelled ? { status: "cancelled" } : { status: "ok" };
    }
    case "mine": {
      const result = await breakBlockOnce(
        bot,
        { x: step.x, y: step.y, z: step.z },
        { token, pollTicks: POLL_TICKS, maxDistance: ACTION_MAX_DISTANCE },
      );
      if (result === "broken") return { status: "ok" };
      if (result === "aborted") {
        return token.cancelled
          ? { status: "cancelled" }
          : { status: "fail", message: "挖掘被中止（实体失效）" };
      }
      return { status: "fail", message: `挖掘失败（${breakReasonText(result)}）` };
    }
    case "mineLook": {
      if (step.look) {
        lookAt(bot, step.look);
        await waitTicks(PLACE_LOOK_SETTLE_TICKS, token);
        if (token.cancelled) return { status: "cancelled" };
      }
      const target = viewBlock(bot, ACTION_MAX_DISTANCE);
      if (!target) return { status: "fail", message: "视线内没有可挖掘的方块" };
      const result = await breakBlockOnce(bot, target.location, {
        token,
        pollTicks: POLL_TICKS,
        maxDistance: ACTION_MAX_DISTANCE,
        requireLineOfSight: true,
      });
      if (result === "broken") return { status: "ok" };
      if (result === "aborted") {
        return token.cancelled
          ? { status: "cancelled" }
          : { status: "fail", message: "挖掘被中止（实体失效）" };
      }
      return { status: "fail", message: `挖掘失败（${breakReasonText(result)}）` };
    }
    case "place": {
      const target = { x: step.x, y: step.y, z: step.z };
      const dx = target.x - bot.location.x;
      const dy = target.y - bot.location.y;
      const dz = target.z - bot.location.z;
      if (Math.hypot(dx, dy, dz) > ACTION_MAX_DISTANCE) {
        return { status: "fail", message: "距离过远（放置需 ≤6 格）" };
      }
      lookAt(bot, target);
      await waitTicks(PLACE_LOOK_SETTLE_TICKS, token);
      if (token.cancelled) return { status: "cancelled" };
      const ok = await placeBlockOnce(bot);
      if (token.cancelled) return { status: "cancelled" };
      return ok ? { status: "ok" } : { status: "fail", message: "放置失败（主手需为可放置方块）" };
    }
    case "useItem": {
      if (step.look) {
        lookAt(bot, step.look);
        await waitTicks(PLACE_LOOK_SETTLE_TICKS, token);
        if (token.cancelled) return { status: "cancelled" };
      }
      const rec = botRegistry.get(botName);
      if (!rec) return { status: "fail", message: "假人记录不可用" };
      const result = await useItemOnce(rec);
      if (token.cancelled) return { status: "cancelled" };
      if (result === UseItemResult.Ok) return { status: "ok" };
      if (result === UseItemResult.Full) return { status: "fail", message: "饱食度已满，无法进食" };
      if (result === UseItemResult.Unavailable) {
        return { status: "fail", message: "主手物品当前不可用（空手或不能使用）" };
      }
      if (result === UseItemResult.Offline || result === UseItemResult.EntityInvalid) {
        return { status: "fail", message: "假人不可用（离线/失效）" };
      }
      return { status: "fail", message: "使用物品异常" };
    }
    case "attack": {
      for (let i = 0; i < step.count; i++) {
        if (token.cancelled) return { status: "cancelled" };
        try {
          bot.attack();
        } catch {
          // 实体瞬时不可用时忽略本次挥击，继续计数
        }
        await waitTicks(ATTACK_SWING_TICKS, token);
      }
      return { status: "ok" };
    }
    case "say": {
      await waitTicks(SAY_MIN_GAP_TICKS, token);
      if (token.cancelled) return { status: "cancelled" };
      try {
        bot.chat(step.text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "fail", message: `发送聊天失败：${msg}` };
      }
      return { status: "ok" };
    }
    case "look": {
      lookAt(bot, { x: step.x, y: step.y, z: step.z });
      return { status: "ok" };
    }
    case "sneak": {
      if (step.look) lookAt(bot, step.look);
      try {
        bot.isSneaking = step.on;
      } catch {
        // 实体失效时忽略；记录仍会同步，上线后恢复
      }
      const rec = botRegistry.get(botName);
      if (rec) rec.isSneaking = step.on;
      return { status: "ok" };
    }
    case "hop": {
      if (step.look) lookAt(bot, step.look);
      try {
        bot.jump();
      } catch {
        // 实体失效时忽略
      }
      return { status: "ok" };
    }
    case "jump":
      // 跳转本身不做事，光标推进在 executeProgram 里处理
      return { status: "ok" };
  }
}

// ─── 整段执行 ────────────────────────────────────────────
/** 记录失败并停下（主人通知 + 日志 + 运行时快照） */
function failStep(
  botName: string,
  stepNo: number,
  total: number,
  cycle: number,
  reason: string,
): ProgramOutcome {
  tellOwner(
    botName,
    `${color.error}[编程]${color.black} 第 ${stepNo}/${total} 条失败：${reason}` +
      `${color.muted}（已停止；可用 /mp:script ${botName} run 重跑）`,
  );
  logLine(botName, `第 ${stepNo} 条失败：${reason}`);
  patchScriptRuntime(botName, { phase: "failed", stepIndex: stepNo, total, cycle, message: reason });
  return "fail";
}

/**
 * 执行整段脚本（含循环与跳转）。
 * @param quiet 第一轮之后不再逐条播报，避免刷屏
 */
async function executeProgram(
  botName: string,
  steps: readonly ScriptStep[],
  loopCount: number,
  token: CancelToken,
  sharedBot: SharedBotRef,
  quiet: boolean,
): Promise<ProgramOutcome> {
  const total = steps.length;
  let cycle = 0;
  for (;;) {
    if (token.cancelled) return "cancelled";
    cycle++;
    let pc = 0;
    let jumpStreak = 0;
    while (!token.cancelled && pc < steps.length) {
      const step = steps[pc];
      if (!step) break;
      if (step.type === "jump") {
        if (!Number.isInteger(step.target) || step.target < 1 || step.target > total) {
          return failStep(botName, pc + 1, total, cycle, `跳转目标 ${step.target} 超出范围（1-${total}）`);
        }
        jumpStreak++;
        if (jumpStreak > JUMP_STREAK_LIMIT) {
          return failStep(botName, pc + 1, total, cycle, "检测到连续跳转死循环（无实际动作）");
        }
        patchScriptRuntime(botName, { phase: "running", stepIndex: pc + 1, total, cycle, message: "" });
        pc = step.target - 1;
      } else {
        jumpStreak = 0;
        patchScriptRuntime(botName, { phase: "running", stepIndex: pc + 1, total, cycle, message: "" });
        if (!quiet) {
          tellOwner(
            botName,
            `${color.accent}[编程]${color.black} ${describeStep(step)} ${color.muted}（第 ${pc + 1}/${total} 条）`,
          );
        }
        const r = await executeStep(botName, step, token, sharedBot);
        if (r.status === "cancelled") return "cancelled";
        if (r.status === "fail") return failStep(botName, pc + 1, total, cycle, r.message);
        pc++;
      }
      await waitTicks(STEP_PACE_TICKS, token);
    }
    if (token.cancelled) return "cancelled";
    if (loopCount >= 0 && cycle >= loopCount) {
      tellOwner(botName, `${color.success}[编程]${color.black} 脚本已完成（${total} 条 × ${cycle} 轮）`);
      logLine(botName, `完成：${total} 条 × ${cycle} 轮`);
      patchScriptRuntime(botName, { phase: "completed", stepIndex: 0, total, cycle, message: "已完成" });
      return "done";
    }
  }
}

// ─── 常驻协程 ────────────────────────────────────────────
/** 常驻循环：等待脚本可跑 → 执行整段 → 按需重跑（kick / 内容变化） */
async function runScriptLoop(botName: string, sharedBot: SharedBotRef, token: CancelToken): Promise<void> {
  let completed = false;
  let ranOnce = false;
  let lastKey = "";
  let kickSeen = getScriptKick(botName);

  while (!token.cancelled) {
    const rec = botRegistry.get(botName);
    if (!rec || rec.death || !rec.online) {
      await waitTicks(IDLE_RECHECK_TICKS, token);
      continue;
    }
    const program = rec.script ?? createDefaultScriptProgram();
    const steps = program.steps;
    const loopCount = program.loopCount > 0 || program.loopCount === -1 ? program.loopCount : 1;

    // 脚本内容或循环设置变化 → 视为新任务，重新跑
    const kick = getScriptKick(botName);
    const key = `${JSON.stringify(steps)}@${loopCount}`;
    if (kick !== kickSeen) {
      kickSeen = kick;
      completed = false;
      ranOnce = false;
      lastKey = "";
    }

    if (steps.length === 0) {
      patchScriptRuntime(botName, { phase: "empty", stepIndex: 0, total: 0, cycle: 0, message: "脚本为空" });
      await waitTicks(IDLE_RECHECK_TICKS, token);
      continue;
    }
    if (completed && key === lastKey) {
      await waitTicks(IDLE_RECHECK_TICKS, token);
      continue;
    }
    lastKey = key;
    completed = false;

    const outcome = await executeProgram(botName, steps, loopCount, token, sharedBot, ranOnce);
    if (token.cancelled) return;
    ranOnce = true;
    if (outcome === "done" || outcome === "fail") completed = true;
  }
}

// ─── 能力对象 ────────────────────────────────────────────
/** 创建编程模式能力（workMode === "script" 时由引擎注册） */
export function makeScriptBehavior(): Behavior {
  let token: CancelToken | undefined;
  let runLoop: Promise<void> | undefined;
  let botNameRef: string | undefined;
  const sharedBot: SharedBotRef = { current: undefined };

  const startLoop = (botName: string): void => {
    if (runLoop) return;
    botNameRef = botName;
    const t = createCancelToken();
    token = t;
    runLoop = runScriptLoop(botName, sharedBot, t)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[MockPlayer] 编程模式协程异常 ${botName}: ${msg}`);
      })
      .finally(() => {
        if (token === t) token = undefined;
        runLoop = undefined;
      });
  };

  return {
    name: "script",
    priority: 10,
    canActivate: (ctx: AiBehaviorContext): boolean => ctx.memory.get("workMode") === "script",
    step: (ctx: AiBehaviorContext): void => {
      sharedBot.current = ctx.bot;
      startLoop(ctx.botName);
    },
    reset: (): void => {
      token?.cancel();
      try {
        const b = sharedBot.current?.isValid
          ? sharedBot.current
          : botNameRef
            ? resolveBotPlayer(botNameRef)
            : undefined;
        b?.stopMoving();
      } catch {
        // 实体已失效时忽略
      }
      if (botNameRef) patchScriptRuntime(botNameRef, { phase: "idle", message: "已停止" });
    },
  };
}