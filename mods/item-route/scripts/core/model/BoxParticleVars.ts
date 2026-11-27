// ─── box 粒子的 Molang 变量契约（纯常量，零 MC 依赖，可单测） ──
// 这里是脚本侧与资源包粒子定义之间的**唯一契约**：
//   · 脚本 `BoxBoundary.buildBoxMolang` 按本清单 setFloat
//   · `resource_packs/item-route/particles/itemroute/box.particle.json` 的
//     `emitter_initialization` 按本清单声明 v.* 默认值
// 任一侧漏写/拼错，粒子会静默使用默认值（框尺寸变 1×1×1 之类），不报错。
// `tests/box-particle.test.ts` 用本清单核对两侧，把这条约束钉住。

/** 驱动粒子标识（`box.particle.json` 的 description.identifier） */
export const BOX_PARTICLE_ID = "itemroute:box";

/** 面粒子标识（box.particle.json 的 sequence 里引用） */
export const BOX_FACE_PARTICLE_ID = "itemroute:box_face";

/** 棱粒子标识（box.particle.json 的 sequence 里引用） */
export const BOX_EDGE_PARTICLE_ID = "itemroute:box_edge";

/**
 * 脚本必须注入的 Molang 变量名。
 *
 * 顺序即 `buildBoxMolang` 的注入顺序，便于人工核对。
 * ⚠️ 全部为独立标量，不用 struct（`v.size.x` 这类）：Molang 的 temp 变量不支持
 * struct，而驱动粒子要在 sequence 里用 `t.*` 转发给子发射器，struct 会在这一步断掉。
 */
export const BOX_MOLANG_VARS = [
  "size_x",
  "size_y",
  "size_z",
  "duration",
  "fade_in",
  "fade_out",
  "face_opacity",
  "face_opacity_inner",
  "face_color_r",
  "face_color_g",
  "face_color_b",
  "edge_opacity",
  "edge_color_r",
  "edge_color_g",
  "edge_color_b",
  "thickness",
  "size_scale",
] as const;

/** 棱线线宽（格）。1/32 与 api-probe 同口径，远处几乎看不见但不闪。 */
export const EDGE_THICKNESS = 1 / 32;

/** 外侧面透明度 */
export const FACE_OPACITY = 0.18;

/** 内侧面透明度（比外面淡，钻进盒子才看得清结构） */
export const FACE_OPACITY_INNER = 0.06;

/** 淡入/淡出时长（秒）。太短会突兀，太长会让玩家以为框没出来。 */
export const FADE_SECONDS = 0.25;

/**
 * `particle_appearance_billboard.size` 到底是半径还是全宽，官方文档没写清，
 * 实测会差 2 倍。这个系数乘在面片宽高与棱线长度上，让现场可一键校正。
 */
export const SIZE_SCALE = 1;

/** 颜色分量，取值 0~1 */
export interface ColorComponents {
  red: number;
  green: number;
  blue: number;
}

/** 正常仓库的线框色：近白，在大多数背景上都读得出来 */
export const COLOR_ACTIVE: ColorComponents = { red: 1, green: 1, blue: 1 };

/** 维护中仓库的线框色：橙红，一眼可辨「这个仓现在不工作」 */
export const COLOR_MAINTENANCE: ColorComponents = { red: 1, green: 0.45, blue: 0.1 };
