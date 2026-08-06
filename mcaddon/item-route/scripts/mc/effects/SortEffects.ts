// ─── 视觉反馈：路由闪光（角色颜色粒子 + 方块尺寸 + 音效，v1 同款） ──
// 订阅领域事件 `visualEffect`（route-flash / particle）→ 在命中容器坐标播放粒子。
// 关键约束（v1「无玩家在场不播放」）：先检查维度内 `getPlayers().length === 0` 则跳过。
// 细节对齐 v1 smartwarehouse/scripts/sorting/SortEffects.ts：
//   · 角色颜色：input 金 / single 浅绿 / multi 天蓝 / misc 粉红（molang color_rgb 变量）
//   · 粒子尺寸随方块类型：箱子/陷阱箱（非完整方块）0.96，木桶/潜影盒（完整方块）1.08
//     （完整方块用更大尺寸 + 更高偏移，让光效居中可见）
//   · 粒子贴方块面 y=+0.455（v1 同款）
//   · route-flash 播 `random.orb` 音效（pitch 0.65 / volume 0.35）
// 坐标/角色/方块类型经注入的 EffectLocator（装配层以 loaded warehouses 反查），本模块不持
// 仓库引用，保持薄订阅者角色。RP 粒子 identifier：itemroute:sort / itemroute:deposit。
import { MolangVariableMap, type Dimension } from "@minecraft/server";
import type { ContainerRole } from "../../core/model/Container";
import type { Location } from "../../core/model/types";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import { SORT_PARTICLE, DEPOSIT_PARTICLE } from "./ParticleIds";

export { SORT_PARTICLE, DEPOSIT_PARTICLE };

/** 路由闪光音效（v1 同款：random.orb，低音量轻滴一声） */
const SORT_SOUND = "random.orb";
const SORT_PITCH = 0.65;
const SORT_VOLUME = 0.35;

/** 箱子类型（非完整方块）的粒子尺寸 */
const CHEST_SIZE = 0.96;
/** 完整方块（木桶、潜影盒）的粒子尺寸——更大让光效贴满面、超边可见 */
const FULL_BLOCK_SIZE = 1.08;
/** 完整方块的粒子高度偏移（让光效居中可见） */
const FULL_BLOCK_OFF_H = -0.52;
/** 箱子类型的高度偏移 */
const CHEST_OFF_H = -0.475;
/** 粒子贴方块面高度（y = pos.y + 0.455，v1 同款） */
const PARTICLE_Y = 0.455;

/** 角色 → RGB 颜色（v1 SortEffects ROLE_COLORS 同款） */
const ROLE_COLORS: Record<ContainerRole, { r: number; g: number; b: number }> = {
  input: { r: 1.0, g: 0.84, b: 0.0 }, // 金色
  single: { r: 0.37, g: 0.8, b: 0.37 }, // 浅绿
  multi: { r: 0.53, g: 0.81, b: 0.92 }, // 天蓝
  misc: { r: 1.0, g: 0.41, b: 0.71 }, // 粉红
};

/** 搜索标记紫色（v1 playSearchEffect 同款 R=0.76 G=0.35 B=0.98） */
const SEARCH_COLOR = { r: 0.76, g: 0.35, b: 0.98 };

/** 方块类型是否为完整方块（非箱子/陷阱箱）——完整方块用更大粒子尺寸让光效可见 */
function isFullBlock(blockTypeId: string): boolean {
  return !blockTypeId.includes("chest") && !blockTypeId.includes("trapped_chest");
}

/** 按方块类型取粒子尺寸与高度偏移 */
function particleParams(blockTypeId: string): { size: number; off_h: number } {
  if (isFullBlock(blockTypeId)) return { size: FULL_BLOCK_SIZE, off_h: FULL_BLOCK_OFF_H };
  return { size: CHEST_SIZE, off_h: CHEST_OFF_H };
}

/** 构建角色颜色粒子参数（v1 同款 molang 变量：size/off_h/color_rgb） */
export function roleMolang(role: ContainerRole, blockTypeId: string): MolangVariableMap {
  const c = ROLE_COLORS[role];
  const { size, off_h } = particleParams(blockTypeId);
  const molang = new MolangVariableMap();
  molang.setFloat("size", size);
  molang.setFloat("size_w", size);
  molang.setFloat("size_l", size);
  molang.setFloat("size_h", size);
  molang.setFloat("off_h", off_h);
  molang.setFloat("color_r", c.r);
  molang.setFloat("color_g", c.g);
  molang.setFloat("color_b", c.b);
  return molang;
}

/** 构建搜索标记紫色粒子参数（v1 playSearchEffect 同款：完整方块尺寸 + 紫色） */
export function searchMarkerMolang(): MolangVariableMap {
  const molang = new MolangVariableMap();
  molang.setFloat("size", FULL_BLOCK_SIZE);
  molang.setFloat("size_w", FULL_BLOCK_SIZE);
  molang.setFloat("size_l", FULL_BLOCK_SIZE);
  molang.setFloat("size_h", FULL_BLOCK_SIZE);
  molang.setFloat("off_h", FULL_BLOCK_OFF_H);
  molang.setFloat("color_r", SEARCH_COLOR.r);
  molang.setFloat("color_g", SEARCH_COLOR.g);
  molang.setFloat("color_b", SEARCH_COLOR.b);
  return molang;
}

/** 事件 → 播放坐标/角色/方块类型的解析器（装配层注入：仓库/容器查找） */
export interface EffectTarget {
  /** 逻辑容器全部方块坐标（大箱子 = 双半） */
  occupiedLocations: Location[];
  /** 容器角色（决定粒子颜色） */
  role: ContainerRole;
  /** 源方块类型 ID（决定粒子尺寸；漏斗等由工厂捕获） */
  blockType: string;
}

export interface EffectLocator {
  dimensionOf(warehouseId: string): Dimension | undefined;
  targetOf(containerId: string): EffectTarget | undefined;
}

/** 单坐标播一次粒子（跳过未加载区块：getBlock 抛错则该坐标跳过） */
function playAt(
  dimension: Dimension,
  loc: Location,
  particleId: string,
  molang: MolangVariableMap,
  sound?: string
): void {
  try {
    dimension.getBlock({ x: loc.x, y: loc.y, z: loc.z });
  } catch {
    return; // 未加载区块：跳过
  }
  const center = { x: loc.x + 0.5, y: loc.y + PARTICLE_Y, z: loc.z + 0.5 };
  dimension.spawnParticle(particleId, center, molang);
  if (sound !== undefined) dimension.playSound(sound, center, { pitch: SORT_PITCH, volume: SORT_VOLUME });
}

/** 订阅领域事件 visualEffect：route-flash 播放角色颜色粒子+音效；维度内无玩家跳过 */
export function registerSortEffects(bus: EventBus, locator: EffectLocator): void {
  bus.visualEffect.subscribe((e: VisualEffectEvent) => {
    try {
      if (e.kind !== "route-flash" && e.kind !== "particle") return;
      const dimension = locator.dimensionOf(e.warehouseId);
      if (dimension === undefined) return;
      if (dimension.getPlayers().length === 0) return; // 无玩家在场不播放
      if (e.containerId === undefined) return;
      const target = locator.targetOf(e.containerId);
      if (target === undefined) return;
      const isFlash = e.kind === "route-flash";
      const molang = isFlash ? roleMolang(target.role, target.blockType) : searchMarkerMolang();
      const particleId = isFlash ? SORT_PARTICLE : DEPOSIT_PARTICLE;
      // 大箱子双半都闪光；route-flash 带音效
      const sound = isFlash ? SORT_SOUND : undefined;
      for (const loc of target.occupiedLocations) {
        playAt(dimension, loc, particleId, molang, sound);
      }
    } catch (err) {
      console.warn(`[item-route] 视觉反馈失败: ${err}`);
    }
  });
}
