// ─── 框选绘制:把盒子形状变成一个粒子调用 ────────────────────────
//
// 整套 3D 线框由资源包里的一个驱动粒子 `apitest:box` 一次画完:
// 驱动粒子在第 0 帧把 6 个面(内外各一遍)+ 12 条棱线作为子发射器全部发出,
// 每个子发射器自己淡入淡出、到期自灭。脚本侧只负责把几何参数塞进
// MolangVariableMap 并 spawnParticle 一次 —— 不做逐帧驱动,不写世界。
//
// 之所以能用单次 spawnParticle 撑起整个盒子:子发射器的存活时长由
// v.duration 决定,与驱动粒子无关,驱动粒子自己在第 0 帧就过期了。

import { MolangVariableMap, system, type Dimension, type Player } from "@minecraft/server";
import { type BoxShape, MAX_BOX_EDGE } from "./BoxGeometry";

/** 驱动粒子标识(定义在 resource_packs/api-probe/particles/apitest/box.particle.json) */
export const BOX_PARTICLE = "apitest:box";

/** 默认存活时长(秒) */
export const DEFAULT_DURATION_SECONDS = 10;

/** 棱线线宽(格)。1/32 与参考模组同口径,远处几乎看不见但不闪。 */
export const EDGE_THICKNESS = 1 / 32;

/** 外侧面透明度 */
export const FACE_OPACITY = 0.18;

/** 内侧面透明度(比外面淡,钻进盒子才看得清结构) */
export const FACE_OPACITY_INNER = 0.06;

/** 棱线颜色:近白,在大多数背景上都读得出来 */
export const EDGE_COLOR = { red: 1, green: 1, blue: 1 };

/** 棱线透明度 */
export const EDGE_OPACITY = 1;

/** 白色,面片默认色 */
export const WHITE = { red: 1, green: 1, blue: 1 };

/** 淡入/淡出时长(秒)。太短会突兀,太长会让玩家以为框没出来。 */
export const FADE_SECONDS = 0.25;

/** 颜色分量,取值 0~1 */
export interface ColorComponents {
  red: number;
  green: number;
  blue: number;
}

/** 绘制参数 */
export interface DrawOptions {
  /** 存活秒数,默认 10 */
  durationSeconds?: number;
  /** 面片颜色,默认白 */
  faceColor?: ColorComponents;
  /** 棱线颜色,默认白 */
  edgeColor?: ColorComponents;
  /**
   * 尺寸缩放系数(诊断用,默认 1)。
   *
   * `particle_appearance_billboard.size` 到底是半径还是全宽,官方文档没有写清,
   * 实测会差 2 倍。这个系数乘在面片宽高与棱线长度上,让现场可以一键试出正确值:
   * 框大了一倍就传 0.5,小了一半就传 2。位置不受影响,始终落在盒子边界上。
   */
  sizeScale?: number;
}

/**
 * 构造驱动粒子的 Molang 变量表。
 *
 * 变量名必须与 `particles/apitest/box.particle.json` 的
 * `emitter_initialization` 一致;改一处必须同时改另一处。
 */
export function buildBoxMolang(shape: BoxShape, options: DrawOptions = {}): MolangVariableMap {
  const faceColor = options.faceColor ?? WHITE;
  const edgeColor = options.edgeColor ?? EDGE_COLOR;

  // 全部用独立标量变量,不用 setVector3/setColorRGB 生成的 struct(v.size.x 这类):
  // Molang 的 temp 变量不支持 struct,而驱动粒子需要在 sequence 里用 t.* 暂存
  // 父级取值再转发给子发射器,struct 会在这一步断掉。
  const molang = new MolangVariableMap();
  molang.setFloat("size_x", shape.size.x);
  molang.setFloat("size_y", shape.size.y);
  molang.setFloat("size_z", shape.size.z);
  molang.setFloat("duration", options.durationSeconds ?? DEFAULT_DURATION_SECONDS);
  molang.setFloat("fade_in", FADE_SECONDS);
  molang.setFloat("fade_out", FADE_SECONDS);
  molang.setFloat("face_opacity", FACE_OPACITY);
  molang.setFloat("face_opacity_inner", FACE_OPACITY_INNER);
  molang.setFloat("face_color_r", faceColor.red);
  molang.setFloat("face_color_g", faceColor.green);
  molang.setFloat("face_color_b", faceColor.blue);
  molang.setFloat("edge_opacity", EDGE_OPACITY);
  molang.setFloat("edge_color_r", edgeColor.red);
  molang.setFloat("edge_color_g", edgeColor.green);
  molang.setFloat("edge_color_b", edgeColor.blue);
  molang.setFloat("thickness", EDGE_THICKNESS);
  molang.setFloat("size_scale", options.sizeScale ?? 1);
  return molang;
}

/** 绘制结果:成功返回 true,失败带回原因 */
export type DrawResult = { ok: true } | { ok: false; reason: string };

/**
 * 在指定维度画一个框选盒子。
 *
 * 只调用 `spawnParticle`,不读写方块、不改世界状态,因此可在任意安全上下文调用。
 * 区块未加载时 `spawnParticle` 会抛错,这里转成可读原因而不是让上层崩掉。
 */
export function drawBox(dimension: Dimension, shape: BoxShape, options: DrawOptions = {}): DrawResult {
  if (shape.size.x > MAX_BOX_EDGE || shape.size.y > MAX_BOX_EDGE || shape.size.z > MAX_BOX_EDGE) {
    return {
      ok: false,
      reason: `框选单边超过 ${MAX_BOX_EDGE} 格(${shape.size.x}×${shape.size.y}×${shape.size.z}),拒绝绘制`,
    };
  }
  try {
    dimension.spawnParticle(BOX_PARTICLE, shape.center, buildBoxMolang(shape, options));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `绘制框选失败(区块可能未加载):${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 每个玩家当前持有的框选计时句柄,重复调用时先取消旧的 */
const activeHandles = new Map<string, number[]>();

/** 取消某玩家此前排队的全部框选 */
export function cancelPlayerBoxes(playerId: string): void {
  const handles = activeHandles.get(playerId);
  if (!handles) return;
  for (const handle of handles) {
    try {
      system.clearRun(handle);
    } catch {
      // 句柄已失效(可能已执行完),忽略
    }
  }
  activeHandles.delete(playerId);
}

/**
 * 画一个限时框选,到期自动消失。
 *
 * 粒子自身按 `duration` 自灭,因此这里**不需要**任何清理定时器;
 * 之所以仍然登记句柄,是为了让同一玩家重复调用时能取消尚未开始的绘制,
 * 避免叠出多个盒子。
 */
export function drawTimedBox(
  player: Player,
  dimension: Dimension,
  shape: BoxShape,
  options: DrawOptions = {}
): DrawResult {
  const duration = options.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  cancelPlayerBoxes(player.id);

  const result = drawBox(dimension, shape, { ...options, durationSeconds: duration });
  if (!result.ok) return result;

  const handle = system.runTimeout(
    () => {
      activeHandles.delete(player.id);
    },
    Math.ceil(duration * 20)
  );
  activeHandles.set(player.id, [handle]);
  return { ok: true };
}
