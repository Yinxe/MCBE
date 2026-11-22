// ─── 传送转场纯逻辑的单元测试 ───────────────────────────────────
//
// 断言的对象是上游 Java 实现(GrandTeleport 26.1.2)的行为,
// 不是本仓库的发挥。每个数值都能在
// `TeleportTransitionController.java` 里找到出处。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_CAMERA_HEIGHT,
  CROSS_DIMENSION_WAIT_TICKS,
  DEFAULT_TRAVEL_TICKS,
  ENTER_BODY_TICKS,
  EXIT_BODY_TICKS,
  MAX_TRAVEL_TICKS,
  MIN_TRAVEL_TICKS,
  STAGE_GLIDE_HEIGHT,
  STAGE_HEIGHTS,
  STAGE_TICKS,
  TOP_DOWN_PITCH,
  TRAVEL_BLOCKS_PER_TICK,
  applyZoomShake,
  cameraFrameAt,
  computeTransitionLayout,
  easeOutCubic,
  hermiteEaseOutFromLinear,
  isCameraStepSoundTick,
  lerpDegrees,
  smoothStep,
  transitionTotalTicks,
  travelEaseProgress,
  resolveTransitionMode,
  SESSION_TIMEOUT_MARGIN_TICKS,
  shouldAbortSession,
  teleportTick,
  travelTicksForDistance,
  wrapDegrees,
  type TransitionContext,
} from "../scripts/core/transition";

const START_FEET = { x: 0, y: 64, z: 0 };
const START_EYE = { x: 0, y: 65.6, z: 0 };
const TARGET_FEET = { x: 0, y: 70, z: 120 };
const TARGET_EYE = { x: 0, y: 71.6, z: 120 };

function makeContext(
  distanceTicks = 40,
  crossDimension = false,
): TransitionContext {
  return {
    startFeet: START_FEET,
    startEye: START_EYE,
    targetFeet: TARGET_FEET,
    targetEye: TARGET_EYE,
    startYaw: 0,
    startPitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    timeline: computeTransitionLayout({ crossDimension, distanceTicks }),
  };
}

// ─── 3.1 导出面 ─────────────────────────────────────────────────

test("常量与上游一致", () => {
  assert.equal(EXIT_BODY_TICKS, 12);
  assert.equal(ENTER_BODY_TICKS, 12);
  assert.deepEqual([...STAGE_TICKS], [13, 13, 13]);
  assert.deepEqual([...STAGE_HEIGHTS], [20, 40, 60]);
  assert.equal(BODY_CAMERA_HEIGHT, 6.0);
  assert.equal(STAGE_GLIDE_HEIGHT, 0.5);
  assert.equal(MIN_TRAVEL_TICKS, 20);
  assert.equal(MAX_TRAVEL_TICKS, 60);
  assert.equal(DEFAULT_TRAVEL_TICKS, 40);
  assert.equal(TRAVEL_BLOCKS_PER_TICK, 30);
  assert.equal(TOP_DOWN_PITCH, 90);
});

// ─── 3.2 缓动与插值 ─────────────────────────────────────────────

test("smoothStep 端点与中点", () => {
  assert.equal(smoothStep(0), 0);
  assert.equal(smoothStep(1), 1);
  assert.equal(smoothStep(0.5), 0.5);
});

test("easeOutCubic 端点正确且单调递增", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let previous = -1;
  for (let i = 0; i <= 20; i += 1) {
    const value = easeOutCubic(i / 20);
    assert.ok(value >= previous - 1e-9, "应单调不减");
    previous = value;
  }
});

test("hermiteEaseOutFromLinear 单调且收尾于 1", () => {
  let previous = -1;
  for (let i = 0; i <= 20; i += 1) {
    const value = hermiteEaseOutFromLinear(i / 20, 0.64, 1.08);
    assert.ok(value >= previous - 1e-9, "应单调不减");
    assert.ok(value <= 1 + 1e-9, "不应超过 1");
    previous = value;
  }
  assert.ok(Math.abs(hermiteEaseOutFromLinear(1, 0.64, 1.08) - 1) < 1e-9);
});

test("travelEaseProgress 两端为 0 与 1,中点接近 0.5", () => {
  assert.ok(Math.abs(travelEaseProgress(0, 40)) < 1e-9);
  assert.ok(Math.abs(travelEaseProgress(1, 40) - 1) < 1e-9);
  const mid = travelEaseProgress(0.5, 40);
  assert.ok(mid > 0.4 && mid < 0.6, `中点应接近 0.5,实际 ${mid}`);
});

test("wrapDegrees 规整到 (-180, 180]", () => {
  assert.equal(wrapDegrees(190), -170);
  assert.equal(wrapDegrees(-190), 170);
  assert.equal(wrapDegrees(180), 180);
});

test("lerpDegrees 走最短路径", () => {
  // 170 → -170 的短路径经过 ±180,而不是穿过 0
  assert.equal(lerpDegrees(170, -170, 0.5), 180);
});

// ─── 3.3 时间轴 ─────────────────────────────────────────────────

test("同维度时间轴总长 = 12+10+39+10+N+10+39+10+12", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(timeline.totalTicks, 12 + 10 + 39 + 10 + 40 + 10 + 39 + 10 + 12);
  assert.equal(timeline.totalTicks, 182);
  assert.equal(transitionTotalTicks(timeline), 182);
});

test("跨维度时间轴总长 = 12+10+39+20+0+20+39+10+12", () => {
  const timeline = computeTransitionLayout({
    crossDimension: true,
    distanceTicks: 40,
  });
  assert.equal(timeline.travelTicks, 0);
  assert.equal(timeline.preTravelWait, CROSS_DIMENSION_WAIT_TICKS);
  assert.equal(timeline.prePushWait, CROSS_DIMENSION_WAIT_TICKS);
  assert.equal(timeline.totalTicks, 12 + 10 + 39 + 20 + 0 + 20 + 39 + 10 + 12);
  assert.equal(timeline.totalTicks, 162);
});

test("阶段边界按顺序衔接,无缝隙无重叠", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(timeline.exitStart, 0);
  assert.equal(timeline.exitEnd, timeline.bodyHoldStart);
  assert.equal(timeline.bodyHoldEnd, timeline.pullStart);
  assert.equal(timeline.pullEnd + timeline.preTravelWait, timeline.travelStart);
  assert.equal(timeline.travelStart + timeline.travelTicks, timeline.travelEnd);
  assert.equal(timeline.travelEnd + timeline.prePushWait, timeline.pushStart);
  assert.equal(timeline.pushEnd, timeline.enterHoldStart);
  assert.equal(timeline.enterHoldEnd, timeline.enterStart);
  assert.equal(timeline.enterEnd, timeline.totalTicks);
});

test("三段变焦各 13 tick,合计 39", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(timeline.pullEnd - timeline.pullStart, 39);
  assert.equal(timeline.pushEnd - timeline.pushStart, 39);
});

test("出体与入体各 12 tick,两端悬停各 10 tick", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(timeline.exitEnd - timeline.exitStart, 12);
  assert.equal(timeline.enterEnd - timeline.enterStart, 12);
  assert.equal(timeline.bodyHoldEnd - timeline.bodyHoldStart, 10);
  assert.equal(timeline.enterHoldEnd - timeline.enterHoldStart, 10);
});

// ─── 3.4 横越时长 ───────────────────────────────────────────────

test("横越时长按 30 格/tick 折算", () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 900 }), 30);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 1200 }), 40);
});

test("横越时长夹在 20–60 tick", () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 0 }), 20);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 599 }), 20);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 600 }), 20);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 601 }), 21);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 1800 }), 60);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 0, z: 5000 }), 60);
});

test("竖直位移不影响横越时长", () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(travelTicksForDistance(origin, { x: 0, y: 100, z: 0 }), 20);
  assert.equal(travelTicksForDistance(origin, { x: 0, y: -200, z: 0 }), 20);
});

// ─── 3.5 相机帧 ─────────────────────────────────────────────────

test("第 0 帧在玩家眼睛位置", () => {
  const frame = cameraFrameAt(makeContext(), 0);
  assert.ok(Math.abs(frame.position.x - START_EYE.x) < 1e-9);
  assert.ok(Math.abs(frame.position.y - START_EYE.y) < 1e-9);
  assert.ok(Math.abs(frame.position.z - START_EYE.z) < 1e-9);
});

test("出体结束时相机在脚上方 6 格且俯视为 90°", () => {
  const context = makeContext();
  const frame = cameraFrameAt(context, context.timeline.exitEnd - 1);
  assert.ok(
    Math.abs(frame.position.y - (START_FEET.y + BODY_CAMERA_HEIGHT)) < 0.2,
    `实际高度 ${frame.position.y - START_FEET.y}`,
  );
  assert.ok(
    Math.abs(frame.pitch - TOP_DOWN_PITCH) < 2,
    `实际俯仰 ${frame.pitch}`,
  );
});

test("拉远三段逐段升高,末段达到 60 格", () => {
  const context = makeContext();
  const timeline = context.timeline;
  const heights = [6, 19, 32].map(
    (offset) =>
      cameraFrameAt(context, timeline.pullStart + offset).position.y -
      START_FEET.y,
  );
  const [firstStage, secondStage, thirdStage] = heights as [
    number,
    number,
    number,
  ];
  assert.ok(secondStage > firstStage, "第二段应高于第一段");
  assert.ok(thirdStage > secondStage, "第三段应高于第二段");
  const end =
    cameraFrameAt(context, timeline.pullStart + 38).position.y - START_FEET.y;
  assert.ok(Math.abs(end - (STAGE_HEIGHTS[2] ?? 0)) < 1.2, `末段高度 ${end}`);
});

test("横越中段保持高空且朝落点移动", () => {
  const context = makeContext();
  const timeline = context.timeline;
  const before = cameraFrameAt(context, timeline.travelStart).position;
  const after = cameraFrameAt(context, timeline.travelEnd - 1).position;
  assert.ok(after.z > before.z, "应朝落点方向移动");
  assert.ok(Math.abs(before.z - START_FEET.z) < 1);
  const mid = cameraFrameAt(
    context,
    timeline.travelStart + Math.floor(timeline.travelTicks / 2),
  ).position;
  assert.ok(mid.y - START_FEET.y >= 59, `横越中段高度 ${mid.y - START_FEET.y}`);
});

test("推近降到 20 格,入体悬停降到 6 格", () => {
  const context = makeContext();
  const timeline = context.timeline;
  const pushEnd = cameraFrameAt(context, timeline.pushEnd - 1);
  assert.ok(
    Math.abs(pushEnd.position.y - (TARGET_FEET.y + STAGE_HEIGHTS[0])) < 1.5,
    `推近末段高度 ${pushEnd.position.y - TARGET_FEET.y}`,
  );
  const holdEnd = cameraFrameAt(context, timeline.enterHoldEnd - 1);
  assert.ok(
    Math.abs(holdEnd.position.y - (TARGET_FEET.y + BODY_CAMERA_HEIGHT)) < 1.5,
    `悬停末段高度 ${holdEnd.position.y - TARGET_FEET.y}`,
  );
});

test("入体结束时相机回到落点眼睛位置", () => {
  const context = makeContext();
  const frame = cameraFrameAt(context, context.timeline.totalTicks);
  assert.ok(Math.abs(frame.position.x - TARGET_EYE.x) < 1e-6);
  assert.ok(Math.abs(frame.position.z - TARGET_EYE.z) < 1e-6);
  assert.ok(Math.abs(frame.position.y - TARGET_EYE.y) < 0.1);
});

test("运镜全程相机都在俯视,不会朝天", () => {
  const context = makeContext();
  for (let tick = 0; tick <= context.timeline.totalTicks; tick += 1) {
    const frame = cameraFrameAt(context, tick);
    assert.ok(
      frame.pitch >= -1,
      `第 ${tick} tick 的俯仰 ${frame.pitch} 朝天了`,
    );
  }
});

// ─── 3.6 抖动 ───────────────────────────────────────────────────

test("抖动不改变俯视方向", () => {
  for (let tick = 0; tick < 200; tick += 1) {
    const shaken = applyZoomShake(tick, 0, TOP_DOWN_PITCH);
    assert.ok(shaken.pitch > 0, "正值向下,抖动后仍应俯视");
    assert.ok(
      Math.abs(shaken.pitch - TOP_DOWN_PITCH) < 2,
      `俯仰偏移 ${shaken.pitch - TOP_DOWN_PITCH} 超过 2°`,
    );
  }
});

test("俯仰抖动只向俯视方向单侧偏移", () => {
  for (let tick = 0; tick < 200; tick += 1) {
    const shaken = applyZoomShake(tick, 0, TOP_DOWN_PITCH);
    assert.ok(shaken.pitch <= TOP_DOWN_PITCH + 1e-9, "不应朝上偏移");
  }
});

test("偏航抖动幅度小于 1°且不是常数", () => {
  let previous: number | undefined;
  let sawChange = false;
  for (let tick = 0; tick < 200; tick += 1) {
    const shaken = applyZoomShake(tick, 0, TOP_DOWN_PITCH);
    assert.ok(Math.abs(shaken.yaw) < 1, `偏航偏移 ${shaken.yaw} 超过 1°`);
    if (previous !== undefined && Math.abs(shaken.yaw - previous) > 0.01) {
      sawChange = true;
    }
    previous = shaken.yaw;
  }
  assert.ok(sawChange, "抖动不应是常数");
});

test("抖动幅度随 envelope 收缩", () => {
  const full = applyZoomShake(7, 0, TOP_DOWN_PITCH, 1);
  const none = applyZoomShake(7, 0, TOP_DOWN_PITCH, 0);
  assert.ok(Math.abs(full.yaw) >= Math.abs(none.yaw));
  assert.equal(none.yaw, 0);
  assert.equal(none.pitch, TOP_DOWN_PITCH);
});

// ─── 3.7 音效点 ─────────────────────────────────────────────────

test("一次同维度转场恰好 9 个音效点", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  const hits: number[] = [];
  for (let tick = 0; tick <= timeline.totalTicks; tick += 1) {
    if (isCameraStepSoundTick(timeline, tick) !== undefined) hits.push(tick);
  }
  assert.equal(hits.length, 9, `实际命中 ${hits.length} 次:${hits.join(",")}`);
});

test("音效点与阶段起点一一对应", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.exitStart),
    "exit-body",
  );
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.pullStart),
    "pull-stage-1",
  );
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.pullStart + STAGE_TICKS[0]),
    "pull-stage-2",
  );
  assert.equal(
    isCameraStepSoundTick(
      timeline,
      timeline.pullStart + STAGE_TICKS[0] + STAGE_TICKS[1],
    ),
    "pull-stage-3",
  );
  assert.equal(isCameraStepSoundTick(timeline, timeline.travelStart), "travel");
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.pushStart + STAGE_TICKS[0]),
    "push-stage-2",
  );
  assert.equal(
    isCameraStepSoundTick(
      timeline,
      timeline.pushStart + STAGE_TICKS[0] + STAGE_TICKS[1],
    ),
    "push-stage-3",
  );
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.enterHoldStart),
    "enter-hold",
  );
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.enterStart),
    "enter-body",
  );
});

test("非阶段起点不播音效", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(isCameraStepSoundTick(timeline, 5), undefined);
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.pullStart + 1),
    undefined,
  );
  assert.equal(
    isCameraStepSoundTick(timeline, timeline.totalTicks - 1),
    undefined,
  );
});

// ─── 6.3 端到端场景的可自动化部分 ───────────────────────────────
//
// 这些用例覆盖「执行方式选择」与「兜底判定」两类纯逻辑。
// 真正需要眼睛与耳朵的部分(画面观感、音效是否正确)不在此列。

test("场景:同维度近距离(<600 格)走运镜", () => {
  const distance = travelTicksForDistance(
    { x: 0, y: 64, z: 0 },
    { x: 300, y: 64, z: 0 },
  );
  assert.equal(distance, MIN_TRAVEL_TICKS, "不足 600 格应取最短 20 tick");

  const mode = resolveTransitionMode({
    style: "cinematic",
    crossDimension: false,
    intent: "normal",
  });
  assert.equal(mode, "cinematic");
});

test("场景:同维度远距离(>1800 格)走运镜且横越取最长", () => {
  const distance = travelTicksForDistance(
    { x: 0, y: 64, z: 0 },
    { x: 2000, y: 64, z: 0 },
  );
  assert.equal(distance, MAX_TRAVEL_TICKS, "超过 1800 格应取最长 60 tick");

  const mode = resolveTransitionMode({
    style: "cinematic",
    crossDimension: false,
    intent: "normal",
  });
  assert.equal(mode, "cinematic");
});

test("场景:跨维度(主世界 ↔ 下界/末地)降档为淡入淡出", () => {
  assert.equal(
    resolveTransitionMode({
      style: "cinematic",
      crossDimension: true,
      intent: "normal",
    }),
    "fade",
    "跨维度即使风格是电影感也必须降档",
  );
});

test("场景:转场关闭时即时位移", () => {
  assert.equal(
    resolveTransitionMode({
      style: "off",
      crossDimension: false,
      intent: "normal",
    }),
    "immediate",
  );
  assert.equal(
    resolveTransitionMode({
      style: "off",
      crossDimension: true,
      intent: "normal",
    }),
    "immediate",
    "关闭优先于跨维度降档",
  );
});

test("场景:风格为淡入淡出时同维度也走淡入淡出", () => {
  assert.equal(
    resolveTransitionMode({
      style: "fade",
      crossDimension: false,
      intent: "normal",
    }),
    "fade",
  );
});

test("场景:转场中途被第二次传送接管时,前一次不强制补位移", () => {
  // 接管由适配层的 finish(existing, false, false) 保证:
  // 不补位移,新转场从玩家当前实际位置重新开始。
  //
  // 纯逻辑层能钉住的前提有两条:
  //   1. 位移点固定在横越起点,与距离无关(距离只影响横越长度)
  //   2. 两次转场的时间轴各自独立构造,不共享可变状态
  const first = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  const second = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 20,
  });

  assert.equal(teleportTick(first), first.travelStart);
  assert.equal(teleportTick(second), second.travelStart);

  // 位移点与距离无关:出体12 + 悬停10 + 拉远39 + 等待10 = 71
  assert.equal(teleportTick(first), 71);
  assert.equal(teleportTick(second), 71);

  // 距离只影响横越长度,因此两次转场总时长不同
  assert.notEqual(
    first.totalTicks,
    second.totalTicks,
    "距离影响总时长,不影响位移点",
  );

  // 时间轴是值对象,改一个不会污染另一个
  first.travelTicks = 999;
  assert.equal(second.travelTicks, 20, "两次转场的时间轴互不共享状态");
});

test("场景:转场中途死亡/退出时,兜底在合理时间内触发", () => {
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  const deadline = timeline.totalTicks * 2 + SESSION_TIMEOUT_MARGIN_TICKS;

  // 刚起播不该被判定超时
  assert.equal(
    shouldAbortSession({
      playerUsable: true,
      elapsed: 0,
      totalTicks: timeline.totalTicks,
    }),
    false,
  );
  // 恰好走到终点也不该超时
  assert.equal(
    shouldAbortSession({
      playerUsable: true,
      elapsed: timeline.totalTicks,
      totalTicks: timeline.totalTicks,
    }),
    false,
  );
  // 超过兜底线必须中止
  assert.equal(
    shouldAbortSession({
      playerUsable: true,
      elapsed: deadline + 1,
      totalTicks: timeline.totalTicks,
    }),
    true,
  );
  // 句柄失效立即中止,不等超时
  assert.equal(
    shouldAbortSession({
      playerUsable: false,
      elapsed: 0,
      totalTicks: timeline.totalTicks,
    }),
    true,
  );
});

test("场景:ticking area 名额耗尽时传送仍完成(时间轴与位移点不受预加载影响)", () => {
  // 预加载是优化:失败只记日志。时间轴与位移点不依赖它。
  const timeline = computeTransitionLayout({
    crossDimension: false,
    distanceTicks: 40,
  });
  assert.equal(teleportTick(timeline), timeline.travelStart);
  assert.ok(timeline.totalTicks > 0, "即使没有预加载,转场仍有完整时长");
});

// ─── 传送意图与分派顺序 ─────────────────────────────────────────

test("死亡点回传同维度走淡入淡出,不走运镜", () => {
  assert.equal(
    resolveTransitionMode({
      style: "cinematic",
      crossDimension: false,
      intent: "deathPoint",
    }),
    "fade",
  );
});

test("死亡点回传跨维度也走淡入淡出", () => {
  assert.equal(
    resolveTransitionMode({
      style: "cinematic",
      crossDimension: true,
      intent: "deathPoint",
    }),
    "fade",
  );
});

test("死亡点回传在全局淡入淡出风格下仍是淡入淡出", () => {
  assert.equal(
    resolveTransitionMode({
      style: "fade",
      crossDimension: false,
      intent: "deathPoint",
    }),
    "fade",
  );
});

test("总开关关闭优先于死亡点意图:一律即时位移", () => {
  assert.equal(
    resolveTransitionMode({
      style: "off",
      crossDimension: false,
      intent: "deathPoint",
    }),
    "immediate",
    "关闭语义是「不要任何动画」,不能被死亡点特例覆盖",
  );
  assert.equal(
    resolveTransitionMode({
      style: "off",
      crossDimension: true,
      intent: "deathPoint",
    }),
    "immediate",
  );
});

test("普通传送同维度仍走运镜,与死亡点意图区分开", () => {
  const normal = resolveTransitionMode({
    style: "cinematic",
    crossDimension: false,
    intent: "normal",
  });
  const deathPoint = resolveTransitionMode({
    style: "cinematic",
    crossDimension: false,
    intent: "deathPoint",
  });
  assert.equal(normal, "cinematic");
  assert.equal(deathPoint, "fade");
  assert.notEqual(normal, deathPoint, "同一目标两种意图应得到不同执行方式");
});

test("全局淡入淡出风格下普通传送仍是淡入淡出", () => {
  assert.equal(
    resolveTransitionMode({
      style: "fade",
      crossDimension: false,
      intent: "normal",
    }),
    "fade",
  );
});
