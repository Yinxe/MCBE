import { Dimension, MolangVariableMap } from "@minecraft/server";
import type { BlockLocation, ContainerRole } from "../types";
import { Logger } from "../util/Logger";

const log = new Logger("SortEffects");

/**
 * 智能仓库分拣动画效果工具。
 * 根据容器角色使用不同颜色：
 *   normal → 浅绿
 *   misc   → 粉红
 *   bulk   → 天蓝
 *   input  → 金色
 * 对于大箱子，每个半块位置各播放一次。
 */

/** 箱子类型的默认粒子大小 */
const CHEST_SIZE = 0.96;
/** 粒子高度偏移 */
const OFF_H = -0.475;

/** 角色 → RGB 颜色映射 */
const ROLE_COLORS: Record<ContainerRole, { r: number; g: number; b: number }> = {
  normal: { r: 0.37, g: 0.80, b: 0.37 },  // 浅绿
  misc:   { r: 1.00, g: 0.41, b: 0.71 },  // 粉红
  bulk:   { r: 0.53, g: 0.81, b: 0.92 },  // 天蓝
  input:  { r: 1.00, g: 0.84, b: 0.00 },  // 金色
};

/**
 * 在单个方块位置播放一次粒子效果。
 *
 * @param dimension 维度
 * @param pos 方块坐标
 * @param role 容器角色（决定颜色）
 * @param particleId 粒子标识符
 * @param soundId 音效标识符
 * @param pitch 音高
 * @param volume 音量
 */
function playEffect(
  dimension: Dimension,
  pos: BlockLocation,
  role: ContainerRole,
  particleId: string,
  soundId: string,
  pitch: number,
  volume: number
): void {
  const color = ROLE_COLORS[role];
  const molang = new MolangVariableMap();
  molang.setFloat("size", CHEST_SIZE);
  molang.setFloat("size_w", CHEST_SIZE);
  molang.setFloat("size_l", CHEST_SIZE);
  molang.setFloat("size_h", CHEST_SIZE);
  molang.setFloat("off_h", OFF_H);
  molang.setFloat("color_r", color.r);
  molang.setFloat("color_g", color.g);
  molang.setFloat("color_b", color.b);

  const center = {
    x: pos.x + 0.5,
    y: pos.y + 0.455,
    z: pos.z + 0.5,
  };

  dimension.spawnParticle(particleId, center, molang);
  dimension.playSound(soundId, center, { pitch, volume });
}

/**
 * 播放分拣成功效果。
 * 颜色由容器角色决定。大箱子的每个半块各播一次。
 *
 * @param dimension  容器所在维度
 * @param occupiedLocations  容器占用的所有方块位置
 * @param role  容器角色
 */
export function playSortEffect(
  dimension: Dimension,
  occupiedLocations: BlockLocation[],
  role: ContainerRole
): void {
  try {
    for (const loc of occupiedLocations) {
      playEffect(dimension, loc, role, "smartwarehouse:sort", "random.orb", 0.65, 0.35);
    }
  } catch (error) {
    log.error(`播放分拣效果失败: ${error}`);
  }
}

/**
 * 播放物品存入效果。
 * 颜色由容器角色决定。大箱子的每个半块各播一次。
 *
 * @param dimension  容器所在维度
 * @param occupiedLocations  容器占用的所有方块位置
 * @param role  容器角色
 */
export function playDepositEffect(
  dimension: Dimension,
  occupiedLocations: BlockLocation[],
  role: ContainerRole
): void {
  try {
    for (const loc of occupiedLocations) {
      playEffect(dimension, loc, role, "smartwarehouse:deposit", "random.pop", 0.8, 0.3);
    }
  } catch (error) {
    log.error(`播放存入效果失败: ${error}`);
  }
}
