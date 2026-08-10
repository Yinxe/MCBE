// ── 旁观模式 · 纯数据类型（零 @minecraft 依赖，可 node 单测） ──

/** 三维坐标 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 旁观功能全局配置 */
export interface SpConfig {
  /**
   * 功能开关（管理员 /sp:menu 控制）。
   * 关闭后玩家无法进入旁观，已在旁观中的灵魂强制回归。
   */
  enabled: boolean;
  /** 灵魂最大移动距离（米） */
  maxDistance: number;
  /** 是否渲染真身 ↔ 灵魂的连线粒子（默认关） */
  showLink: boolean;
}

/** 灵魂锚点 = 进入旁观时的真身（维度 / 位置 / 原游戏模式） */
export interface SoulAnchor extends Vec3 {
  /** 进入前所在维度 id（如 minecraft:overworld） */
  dimensionId: string;
  /** 进入前游戏模式（GameMode 字符串，如 Survival） */
  gameMode: string;
}
