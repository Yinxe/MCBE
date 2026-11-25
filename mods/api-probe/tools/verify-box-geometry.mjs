#!/usr/bin/env node
// ─── 校验框选粒子的几何是否与盒子尺寸自洽 ────────────────────────
//
// 这个脚本不依赖游戏:它读 box.particle.json,按 STAGE 里的公式重建
// 每个面片/棱线的实际跨度,再与盒子尺寸对比。用来在没有实机的情况下
// 回答「框会不会比盒子大」这个问题。
//
// 用法:
//   node tools/verify-box-geometry.mjs [尺寸X 尺寸Y 尺寸Z]
//   默认校验 10 8 10(即 /apitest:box 100 64 -20 109 71 -11)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const particlePath = join(here, "..", "resource_packs", "api-probe", "particles", "apitest", "box.particle.json");

const [sizeX, sizeY, sizeZ] = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const SIZE = {
  x: sizeX || 10,
  y: sizeY || 8,
  z: sizeZ || 10,
};

const effect = JSON.parse(readFileSync(particlePath, "utf8")).particle_effect;
const sequence = effect.events.emit.sequence;

// ── 从 STAGE 表达式重建符号表 ──────────────────────────────────
// 只支持形如 `t.name = <expr>;` 的赋值,expr 里允许引用已定义的 t.*。
// STAGE 会读 v.size_x 这类驱动粒子输入,先按校验用的盒子尺寸注入。
const INPUTS = {
  size_x: SIZE.x,
  size_y: SIZE.y,
  size_z: SIZE.z,
  duration: 10,
  fade_in: 0.25,
  fade_out: 0.25,
  face_opacity: 0.18,
  face_opacity_inner: 0.06,
  face_color_r: 1,
  face_color_g: 1,
  face_color_b: 1,
  edge_color_r: 1,
  edge_color_g: 1,
  edge_color_b: 1,
  edge_opacity: 1,
  thickness: 0.03125,
  // 尺寸缩放系数:默认 1 表示"粒子尺寸 = 盒子尺寸"(即 size 按半径解释)。
  // 实机若发现差 2 倍,把它改成 0.5 再跑本脚本,即可看到修正后的跨度。
  size_scale: Number(process.env.SIZE_SCALE ?? 1),
};
const symbols = { ...INPUTS };
const stage = sequence[0].expression;
for (const statement of stage.split(";")) {
  const m = /^\s*t\.([a-z_]+)\s*=\s*(.+?)\s*$/.exec(statement);
  if (!m) continue;
  symbols[m[1]] = evaluate(m[2]);
}

function evaluate(expression) {
  // 把 t.xxx 换成具体数值,再交给 Function 求值(表达式里只有四则运算与 math.sqrt)
  const substituted = expression
    .replace(/\bv\.([a-z_]+)\b/g, (_, name) => {
      if (!(name in INPUTS)) throw new Error(`未定义的输入 v.${name}`);
      return `(${INPUTS[name]})`;
    })
    .replace(/t\.([a-z_]+)/g, (_, name) => {
      if (!(name in symbols)) throw new Error(`未定义的符号 t.${name}(检查 STAGE 的赋值顺序)`);
      return `(${symbols[name]})`;
    })
    .replace(/\bmath\.sqrt\b/g, "Math.sqrt");
  return Function(`"use strict"; return (${substituted});`)();
}

// ── 提取每个子发射器的参数 ─────────────────────────────────────
function readParams(preEffectExpression) {
  const params = {};
  for (const m of preEffectExpression.matchAll(/v\.([a-z_]+)\s*=\s*([^;]+);/g)) {
    const raw = m[2].trim();
    // 纯数字直接取;引用 t.* 的走求值
    params[m[1]] = /^-?[\d.]+$/.test(raw) ? Number(raw) : evaluate(raw);
  }
  return params;
}

let failures = 0;
function check(label, actual, expected, tolerance = 1e-6) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  const mark = ok ? "OK  " : "FAIL";
  console.log(
    `  ${mark} ${label.padEnd(34)} 实际 ${actual.toFixed(4).padStart(9)}  期望 ${expected.toFixed(4).padStart(9)}`
  );
}

console.log(`盒子尺寸 ${SIZE.x} × ${SIZE.y} × ${SIZE.z}`);
console.log(`面片平面 ±${(SIZE.x / 2 + symbols.eps).toFixed(4)} 之外(eps=${symbols.eps})`);
console.log();

// ── 面片:跨度必须等于盒子的两个边长 ───────────────────────────
console.log("面片(billboard size 是半径 → 跨度 = 2 × size)");
const FACE_SPAN_AXES = {
  x: ["z", "y"], // 法线沿 X 的面,跨度落在 Z 与 Y
  y: ["x", "z"],
  z: ["x", "y"],
};
for (const step of sequence.slice(1)) {
  const child = step.particle_effect;
  if (child?.effect !== "apitest:box_face") continue;
  const p = readParams(child.pre_effect_expression);
  const normalAxis = p.normal_x ? "x" : p.normal_y ? "y" : "z";
  const sign = p[`normal_${normalAxis}`] > 0 ? "+" : "-";
  const [spanAxisA, spanAxisB] = FACE_SPAN_AXES[normalAxis];
  check(
    `法线 ${normalAxis}${sign} 宽(沿 ${spanAxisA})`,
    2 * p.width,
    SIZE[spanAxisA]
  );
  check(
    `法线 ${normalAxis}${sign} 高(沿 ${spanAxisB})`,
    2 * p.height,
    SIZE[spanAxisB]
  );
}

console.log();
// ── 棱线:跨度必须等于盒子对应轴的边长 ─────────────────────────
console.log("棱线(billboard size[0] 是半径 → 跨度 = 2 × length)");
for (const step of sequence.slice(1)) {
  const child = step.particle_effect;
  if (child?.effect !== "apitest:box_edge") continue;
  const p = readParams(child.pre_effect_expression);
  const axis = p.normal_x ? "x" : p.normal_y ? "y" : "z";
  check(`沿 ${axis} 轴的棱线长度`, 2 * p.length, SIZE[axis]);
}

console.log();
if (failures > 0) {
  console.log(`✗ ${failures} 项不匹配:线框会比盒子大或小,需要修正 box.particle.json`);
  process.exit(1);
}
console.log("✓ 全部匹配:线框与盒子尺寸自洽");
