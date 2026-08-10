// ── 粒子效果：灵魂体光环 + 真身标记 + 灵魂锁链连线 ──
// 连线复刻"嘎吱受击时本体↔心"的双向语义（玩家侧映射：真身=心，灵魂=嘎吱）：
//   - 心(真身) → 嘎吱(灵魂)：琥珀色
//   - 嘎吱(灵魂) → 心(真身)：灰色
//
// 诚实说明：`creaking_heart_trail` 的真实轨迹在引擎内部驱动，脚本传的
// Molang 变量无法可靠左右它的方向（实测琥珀能看到但方向漂移）；脚本能绝对
// 控制方向/数量/颜色的做法是「自己算沿线坐标 + 相位推进」的扫掠动画。
// 默认用该可靠方案；`creaking` 原粒保留为实验开关（SOUL_LINK_MODE 切换）。
import { MolangVariableMap, type Dimension, type RGBA, type Vector3 } from "@minecraft/server";

/**
 * 连线渲染模式：
 * - "sweep"（默认）：自控双向扫掠，方向/数量/颜色完全自带。
 * - "creaking"（实验）：直接用 creaking_heart_trail 点播，方向受引擎左右不可靠。
 */
export const SOUL_LINK_MODE: "sweep" | "creaking" = "sweep";

/** 扫掠粒子（colored_flame_particle，@minecraft/server spawnParticle 文档示例，保证可点播） */
const SWEEP_EFFECT = "minecraft:colored_flame_particle";
/** 心→嘎吱 琥珀（真身→灵魂） */
const SWEEP_AMBER_COLOR: RGBA = { red: 1, green: 0.7, blue: 0.3, alpha: 1 };
/** 嘎吱→心 灰（灵魂→真身） */
const SWEEP_GRAY_COLOR: RGBA = { red: 0.6, green: 0.6, blue: 0.6, alpha: 1 };
/** 每支流每帧显示的粒子数（数量不够就调大、太密就调小） */
const SWEEP_DOTS_PER_LINE = 6;
/** 相位推进量（0~1）：每帧扫掠前进比例（越大动得越快） */
const SWEEP_PHASE_STEP = 0.08;

/** 实验性：creaking 原粒 */
const CREAKING_EFFECT = "minecraft:creaking_heart_trail";

/** 灵魂体身边光环粒子（试炼之兆） */
export const SOUL_GLOW_EFFECT = "minecraft:trial_omen_single";
/** 真身位置持续标记粒子（袭击之兆，环绕真身） */
export const BODY_GLOW_EFFECT = "minecraft:raid_omen_ambient";

/** 标记粒子散布半径（米） */
const MARKER_RADIUS = 1.2;

/**
 * 双向扫掠连线：
 * - 琥珀色点：真身 → 灵魂（心射向嘎吱方向）
 * - 灰色点：  灵魂 → 真身（嘎吱射向心方向）
 * phase 每帧 +SWEEP_PHASE_STEP，让两列车沿各自方向游走。
 *
 * @param dimension - 目标维度
 * @param from      - 真身锚点
 * @param to        - 灵魂当前位置
 * @param frame     - 帧计数（每 tick 传 session.run）
 */
export function spawnTetherLine(dimension: Dimension, from: Vector3, to: Vector3, frame = 0): void {
  const phase = (frame * SWEEP_PHASE_STEP) % 1;

  if (SOUL_LINK_MODE === "creaking") {
    spawnCreakingBurst(dimension, from, to);
    spawnCreakingBurst(dimension, to, from);
    return;
  }

  sweepLine(dimension, from, to, SWEEP_AMBER_COLOR, phase); // 心→嘎吱 琥珀
  sweepLine(dimension, to, from, SWEEP_GRAY_COLOR, phase); // 嘎吱→心 灰
}

/** 单支扫掠流：在 from→to 上按 phase 排 SWEEP_DOTS_PER_TOTAL 颗粒子（列成移动的流） */
function sweepLine(dimension: Dimension, from: Vector3, to: Vector3, color: RGBA, phase: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const molang = new MolangVariableMap();
  molang.setColorRGBA("variable.color", color);

  for (let i = 0; i < SWEEP_DOTS_PER_LINE; i++) {
    const s = (phase + i / SWEEP_DOTS_PER_LINE) % 1;
    dimension.spawnParticle(
      SWEEP_EFFECT,
      {
        x: from.x + dx * s,
        y: from.y + dy * s + 0.5, // 略抬升便于可视
        z: from.z + dz * s,
      },
      molang
    );
  }
}

/** 实验性：直接抛 creaking_heart_trail（方向不可控，仅作留存切换） */
function spawnCreakingBurst(dimension: Dimension, from: Vector3, to: Vector3): void {
  const molang = new MolangVariableMap();
  molang.setColorRGBA("variable.color", SWEEP_AMBER_COLOR);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  molang.setVector3("variable.velocity", { x: dx / len, y: dy / len, z: dz / len });
  molang.setFloat("variable.particle_initial_speed", len * 0.5);
  molang.setFloat("variable.max_lifetime", 0.8);
  molang.setFloat("variable.particle_lifetime", 0.8);
  dimension.spawnParticle(CREAKING_EFFECT, from, molang);
}

/**
 * 灵魂体身边撒光环粒子（试炼之兆），每次 tick 调用以保持环绕。
 * @param dimension - 目标维度
 * @param at        - 灵魂当前位置
 * @param count     - 粒子数量
 */
export function spawnSoulGlow(dimension: Dimension, at: Vector3, count = 3): void {
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1); // 均匀球面
    const r = 0.9 * Math.random();
    dimension.spawnParticle(SOUL_GLOW_EFFECT, {
      x: at.x + r * Math.sin(phi) * Math.cos(theta),
      y: at.y + 0.4 + r * Math.cos(phi),
      z: at.z + r * Math.sin(phi) * Math.sin(theta),
    });
  }
}

/**
 * 真身位置持续标记粒子：环绕锚点。
 * 进入/回归满帧传大 count 当爆发；旁观期间每次 tick 传小 count 保持标记。
 * @param dimension - 目标维度
 * @param at        - 真身锚点
 * @param count     - 粒子数量（6~8 持续 / 24 瞬间爆发）
 */
export function spawnBodyGlow(dimension: Dimension, at: Vector3, count = 8): void {
  for (let i = 0; i < count; i++) {
    const theta = (Math.PI * 2 * i) / count;
    const radius = MARKER_RADIUS * (0.5 + 0.5 * Math.random());
    dimension.spawnParticle(BODY_GLOW_EFFECT, {
      x: at.x + Math.cos(theta) * radius,
      y: at.y + Math.random() * 0.6,
      z: at.z + Math.sin(theta) * radius,
    });
  }
}
