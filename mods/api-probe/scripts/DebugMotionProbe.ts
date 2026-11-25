// ─── 动态探针:静态读数测不出来的那几件事 ────────────────────────
//
// 有一类问题读属性读不出来,只能「改完盯着看」:
//
//   1. `timeLeft` 会不会自己倒数?读到的值是实时剩余时间还是写入的快照?
//   2. 改了 `location` 之后,形状会移动还是纹丝不动?
//   3. 改了 `bound` / `scale` / `color` 之后,已在世界上的形状会重新渲染吗?
//   4. 形状到期后 `hasDuration` 变成什么,句柄还能不能碰?
//   5. 一次能画多少个形状?超过多少会开始失败?
//
// 这些是本模组最该测的东西,也是别人踩坑最多的地方。做法:先画一个形状,
// 再用 `system.runInterval` 每隔 1 秒采样并回执,同时写明「肉眼该看到什么」。
//
// 采样窗口必须严格短于 timeLeft —— 形状到期后句柄不可再碰(见 DebugRenderer)。

import { DebugBox, debugDrawer, type DebugShape } from "@minecraft/debug-utilities";
import { Player, system } from "@minecraft/server";
import { toNativeColor } from "./DebugColor";
import { attempt, errorText, heading, kv, report, rowPositions, verdict } from "./DebugProbeShared";
import { clearPlayerShapes } from "./DebugRenderer";

/** 采样间隔(tick)。20 tick = 1 秒 */
const SAMPLE_INTERVAL_TICKS = 20;

/** 观察用形状的存活秒数:必须明显长于采样窗口 */
const OBSERVE_SECONDS = 20;

/**
 * `/apitest:debugmotion` 的实现:验证「改属性会不会真的动」。
 *
 * 观察对象是玩家正前方 4 格处的 1×1×1 橙色盒子。四步各隔 1 秒,
 * 每步回执都写明读数与「该看到什么」,玩家对照画面即可判定。
 */
export function runMotionProbeCommand(player: Player): void {
  clearPlayerShapes(player.id);
  const [origin] = rowPositions(player, 1, 0, 4, 1);
  const box = new DebugBox(origin);
  box.bound = { x: 1, y: 1, z: 1 };
  box.scale = 1;
  box.color = toNativeColor({ red: 1, green: 0.5, blue: 0.2 });
  box.timeLeft = OBSERVE_SECONDS;

  try {
    debugDrawer.addShape(box);
  } catch (error) {
    player.sendMessage(`§c[API 探针] 无法创建观察用形状:${errorText(error)}`);
    return;
  }

  report(player, [
    heading("动态探针:改属性会不会真的动"),
    `§7观察对象:正前方 4 格处的 1×1×1 橙色盒子,存活 ${OBSERVE_SECONDS} 秒`,
    "§7每 1 秒采样一次,共 4 次。请盯着它看,回执会写明每步「该看到什么」。",
  ]);

  let step = 0;
  const handle = system.runInterval(() => {
    if (!player.isValid) {
      system.clearRun(handle);
      return;
    }
    step += 1;

    // ── 第 1 步:timeLeft 会不会自己倒数 ──
    if (step === 1) {
      report(player, [
        heading(`采样 ${step}:timeLeft 是否实时`),
        `  ${kv(
          "timeLeft",
          attempt(() => box.timeLeft)
        )}`,
        `  ${kv(
          "totalTimeLeft",
          attempt(() => box.totalTimeLeft)
        )}`,
        `  ${kv(
          "hasDuration",
          attempt(() => box.hasDuration)
        )}`,
        `  §7初始写了 ${OBSERVE_SECONDS}。读到 ~19 说明 timeLeft 实时倒数;`,
        "  §7仍是 ${OBSERVE_SECONDS} 说明它只是写入值的快照。",
      ]);
      return;
    }

    // ── 第 2 步:改 location 会不会移动 ──
    //
    // 注意:`DebugShape.location` 在 1.21.130 起变成 **readonly**,
    // 1.21.100 时它还是可写属性。所以这里必须走 `setLocation()`,
    // 直接赋值会编译失败。这也是本次升级带来的第一个破坏性变更。
    if (step === 2) {
      const moved = { x: origin.x + 2, y: origin.y, z: origin.z };
      const write = attempt(() => {
        box.setLocation(moved);
        return box.location;
      });
      report(player, [
        heading(`采样 ${step}:改 location`),
        `  ${kv("setLocation 并读回", write)}`,
        "  §7预期:盒子向右平移 2 格。",
        "  §c若画面里纹丝不动,说明 location 只在 addShape 时读一次,改它无效。",
      ]);
      return;
    }

    // ── 第 3 步:改 bound / scale / color 会不会重新渲染 ──
    if (step === 3) {
      const write = attempt(() => {
        box.bound = { x: 3, y: 3, z: 3 };
        box.scale = 2;
        box.color = toNativeColor({ red: 0.3, green: 1, blue: 0.6 });
        return { bound: box.bound, scale: box.scale, color: box.color };
      });
      report(player, [
        heading(`采样 ${step}:改 bound / scale / color`),
        `  ${kv("写入并读回", write)}`,
        "  §7预期:盒子放大到 3×2=6 倍并变绿。",
        "  §c若画面不变,说明这些属性同样只在 addShape 时读一次 —— 那就必须 remove 后重加。",
      ]);
      return;
    }

    // ── 第 4 步:收尾 ──
    const finalState = attempt(() => ({
      location: box.location,
      hasDuration: box.hasDuration,
      timeLeft: box.timeLeft,
      totalTimeLeft: box.totalTimeLeft,
    }));
    const removed = attempt(() => {
      box.remove();
      return "已移除";
    });
    report(player, [
      heading(`采样 ${step}:收尾`),
      `  ${kv("末次读数", finalState)}`,
      `  ${attemptLabel("手动 remove", removed)}`,
      verdict("动态探针结束:把上面三步的画面结果对照回执即可下结论"),
    ]);
    system.clearRun(handle);
  }, SAMPLE_INTERVAL_TICKS);
}

/** 把 attempt 结果写成一行 */
function attemptLabel(label: string, result: ReturnType<typeof attempt<string>>): string {
  return result.ok ? `${kv(label, result.value)} §a✓` : `${kv(label, "抛错")} §c${result.error}`;
}

/**
 * `/apitest:debuglimits` 的实现:探明可绘制规模上限。
 *
 * 该模块没有公开数量上限(不像 26.20 的 `PrimitiveShapesManager` 有 1000 个上限),
 * 因此只能实测:一次画 N 个,看加到第几个开始抛错,并回执耗时供估算性能。
 */
export function runLimitsProbeCommand(player: Player, countInput?: number): void {
  const count = Math.min(Math.max(countInput ?? 200, 1), 2000);
  clearPlayerShapes(player.id);

  const [base] = rowPositions(player, 1, 0, 6, 1);
  const added: DebugShape[] = [];
  let firstFailureAt = -1;
  let lastError = "";

  const startedAt = Date.now();
  for (let index = 0; index < count; index += 1) {
    // 铺成 20×20 的方格阵,再逐层向上,避免全部重叠看不出数量
    const box = new DebugBox({
      x: base.x + (index % 20) * 1.2,
      y: base.y + Math.floor(index / 400) * 1.2,
      z: base.z + (Math.floor(index / 20) % 20) * 1.2,
    });
    box.bound = { x: 0.8, y: 0.8, z: 0.8 };
    box.scale = 1;
    box.color = toNativeColor({ red: 0.3, green: 0.9, blue: 1 });
    box.timeLeft = 30;
    try {
      debugDrawer.addShape(box);
      added.push(box);
    } catch (error) {
      firstFailureAt = index;
      lastError = errorText(error);
      break;
    }
  }

  const elapsed = Date.now() - startedAt;
  const lines = [
    heading("规模上限探针"),
    `  ${kv("请求数量", count)}`,
    `  ${kv("成功加入", added.length)}`,
    `  ${kv("耗时(毫秒)", elapsed)}`,
    `  ${kv("首次失败于第几个", firstFailureAt < 0 ? "未失败" : firstFailureAt)}`,
  ];
  if (lastError) {
    lines.push(`  ${kv("失败原因", lastError)}`);
  }
  lines.push("  §7请观察帧率:形状越多越卡。若卡到不可用,记下这个数量作为实践上限。");
  lines.push("  §7这些形状 30 秒后自行消失,不会残留。");
  report(player, lines);
}

/**
 * `/apitest:debugcontext` 的实现:验证能否在受限上下文调用。
 *
 * 这是「安全调用」问题的直接实验。类型定义里查不到依据
 * (`@minecraft/debug-utilities` 从 1.21.100 到 1.26.60 都没有
 * `can't be called in read-only mode` 标注,而 `@minecraft/server` 2.1.0 有 335 处),
 * 所以只能实测。
 *
 * 实验设计:命令回调**本身就是只读上下文**,所以在回调里直接调 `addShape`
 * 就是最真实的测法,不需要绕任何前置事件。调用结果由回调捕获,
 * 再由推迟后的安全 tick 负责回执(回调里不能 sendMessage)。
 *
 * 结论对写代码有直接影响:
 *   · 抛错 → 必须推迟到安全 tick(本模组现行做法正确);
 *   · 不抛错 → 可以省掉推迟,但形状是否真的渲染出来仍需看画面确认。
 */
export interface ContextProbeOutcome {
  /** 在命令回调里直接调 addShape 的结果 */
  restricted: { ok: boolean; detail: string };
  /** 形状实例(已尝试加入,可能失败) */
  shape: DebugShape;
}

/**
 * 在受限上下文里尝试直接 `addShape`。
 *
 * MUST 由命令回调同步调用 —— 回调即只读上下文,这是实验的前提。
 * 本函数不碰任何受限 API,只构造与加入形状,因此可在回调内安全执行。
 */
export function attemptRestrictedAdd(origin: { x: number; y: number; z: number }): ContextProbeOutcome {
  const box = new DebugBox(origin);
  box.bound = { x: 1, y: 1, z: 1 };
  box.scale = 1;
  box.color = toNativeColor({ red: 1, green: 0.2, blue: 1 });
  box.timeLeft = 15;

  const result = attempt(() => {
    debugDrawer.addShape(box);
    return "addShape 未抛错";
  });
  return {
    restricted: result.ok ? { ok: true, detail: result.value } : { ok: false, detail: result.error },
    shape: box,
  };
}

/** 在安全 tick 里把受限上下文实验的结果告诉玩家 */
export function reportContextProbe(player: Player, outcome: ContextProbeOutcome): void {
  const lines = [heading("受限上下文探针")];
  if (outcome.restricted.ok) {
    lines.push(`§a命令回调内直接 addShape:§f${outcome.restricted.detail}`);
    lines.push("§7结论:不抛错。但形状是否真的渲染出来,必须看画面 ——");
    lines.push("§7静默成功不等于生效。若画面里看不到紫色盒子,说明需推迟才能生效。");
    lines.push("§7对照:本模组其余命令都在安全 tick 里调 addShape,那一路已验证可用。");
  } else {
    lines.push(`§c命令回调内直接 addShape 抛错:§f${outcome.restricted.detail}`);
    lines.push("§7结论:受限上下文不可调用,必须推迟到安全 tick。本模组现行做法正确。");
  }
  report(player, lines);

  // 观察窗口结束后清掉,避开「到期后碰句柄」
  system.runTimeout(
    () => {
      attempt(() => {
        outcome.shape.remove();
        return "已清理";
      });
    },
    15 * 20 - 20
  );
}
