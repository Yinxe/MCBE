// ─── 立体盒子边界：一次 spawnParticle 画完整线框 ─────────────
// 移植自 `mods/api-probe` 的 BoxRenderer：整套 3D 线框由资源包里的一个驱动
// 粒子 `itemroute:box` 一次画完 —— 驱动粒子在第 0 帧把 6 个面（内外各一遍）
// + 12 条棱线作为子发射器全部发出，每个子发射器自己淡入淡出、到期自灭。
// 脚本侧只负责把几何参数塞进 MolangVariableMap 并 spawnParticle 一次。
//
// 相比旧的「逐点撒 endrod」：32×16×32 的仓库每轮约 500 次 spawnParticle，
// 现在只要 1 次，且自带淡入淡出。
import { MolangVariableMap, type Dimension } from "@minecraft/server";
import type { BoxShape } from "../../core/model/BoxShape";
import {
  BOX_PARTICLE_ID,
  COLOR_ACTIVE,
  EDGE_THICKNESS,
  FACE_OPACITY,
  FACE_OPACITY_INNER,
  FADE_SECONDS,
  SIZE_SCALE,
  type ColorComponents,
} from "../../core/model/BoxParticleVars";

export { BOX_PARTICLE_ID, COLOR_ACTIVE, COLOR_MAINTENANCE } from "../../core/model/BoxParticleVars";

/** 绘制参数 */
export interface DrawOptions {
  /** 存活秒数 */
  durationSeconds: number;
  /** 面片颜色 */
  faceColor?: ColorComponents;
  /** 棱线颜色 */
  edgeColor?: ColorComponents;
}

/**
 * 构造驱动粒子的 Molang 变量表。
 *
 * 变量名必须与 `particles/itemroute/box.particle.json` 的
 * `emitter_initialization` 一致（清单见 `core/model/BoxParticleVars.BOX_MOLANG_VARS`）。
 */
export function buildBoxMolang(shape: BoxShape, options: DrawOptions): MolangVariableMap {
  const faceColor = options.faceColor ?? COLOR_ACTIVE;
  const edgeColor = options.edgeColor ?? COLOR_ACTIVE;

  const molang = new MolangVariableMap();
  molang.setFloat("size_x", shape.size.x);
  molang.setFloat("size_y", shape.size.y);
  molang.setFloat("size_z", shape.size.z);
  molang.setFloat("duration", options.durationSeconds);
  molang.setFloat("fade_in", FADE_SECONDS);
  molang.setFloat("fade_out", FADE_SECONDS);
  molang.setFloat("face_opacity", FACE_OPACITY);
  molang.setFloat("face_opacity_inner", FACE_OPACITY_INNER);
  molang.setFloat("face_color_r", faceColor.red);
  molang.setFloat("face_color_g", faceColor.green);
  molang.setFloat("face_color_b", faceColor.blue);
  molang.setFloat("edge_opacity", 1);
  molang.setFloat("edge_color_r", edgeColor.red);
  molang.setFloat("edge_color_g", edgeColor.green);
  molang.setFloat("edge_color_b", edgeColor.blue);
  molang.setFloat("thickness", EDGE_THICKNESS);
  molang.setFloat("size_scale", SIZE_SCALE);
  return molang;
}

/** 绘制结果：成功，或带可读原因的失败 */
export type DrawResult = { ok: true } | { ok: false; reason: string };

/**
 * 在指定维度画一个仓库盒子。
 *
 * 只调用 `spawnParticle`，不读写方块、不改世界状态，因此可在任意安全上下文调用。
 * 区块未加载时 `spawnParticle` 会抛错，这里转成可读原因而不是让上层崩掉。
 */
export function drawBox(dimension: Dimension, shape: BoxShape, options: DrawOptions): DrawResult {
  try {
    dimension.spawnParticle(BOX_PARTICLE_ID, shape.center, buildBoxMolang(shape, options));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `盒子粒子绘制失败: ${error}` };
  }
}
