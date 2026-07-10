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
 *
 * 粒子大小根据方块类型调整：
 * - 箱子/陷阱箱（非完整方块）：小尺寸，光效贴箱表面
 * - 木桶/潜影盒（完整方块）：大尺寸，光效超出方块边缘
 */

/** 箱子类型（非完整方块）的粒子大小 */
const CHEST_SIZE = 0.96;
/** 完整方块（木桶、潜影盒）的粒子大小 */
const FULL_BLOCK_SIZE = 1.08;
/** 完整方块的粒子高度偏移（让光效居中可见） */
const FULL_BLOCK_OFF_H = -0.52;
/** 箱子类型的高度偏移 */
const CHEST_OFF_H = -0.475;

/** 角色 → RGB 颜色映射 */
const ROLE_COLORS: Record<ContainerRole, { r: number; g: number; b: number }> = {
  normal: { r: 0.37, g: 0.8, b: 0.37 }, // 浅绿
  misc: { r: 1.0, g: 0.41, b: 0.71 }, // 粉红
  bulk: { r: 0.53, g: 0.81, b: 0.92 }, // 天蓝
  input: { r: 1.0, g: 0.84, b: 0.0 }, // 金色
};

/**
 * 判断方块类型是否为完整方块（木桶、潜影盒等）。
 * 完整方块需要用更大的粒子尺寸让光效可见。
 */
function isFullBlock(blockTypeId: string): boolean {
  return !blockTypeId.includes("chest") && !blockTypeId.includes("trapped_chest");
}

/**
 * 获取方块对应的粒子大小和高度偏移。
 */
function getParticleParams(blockTypeId: string): { size: number; off_h: number } {
  if (isFullBlock(blockTypeId)) {
    return { size: FULL_BLOCK_SIZE, off_h: FULL_BLOCK_OFF_H };
  }
  return { size: CHEST_SIZE, off_h: CHEST_OFF_H };
}

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

  // 查方块类型选择粒子大小
  let blockTypeId = "minecraft:chest";
  try {
    const block = dimension.getBlock(pos);
    if (block) blockTypeId = block.typeId;
  } catch {
    /* 默认使用箱子尺寸 */
  }

  const { size, off_h } = getParticleParams(blockTypeId);
  const molang = new MolangVariableMap();
  molang.setFloat("size", size);
  molang.setFloat("size_w", size);
  molang.setFloat("size_l", size);
  molang.setFloat("size_h", size);
  molang.setFloat("off_h", off_h);
  molang.setFloat("color_r", color.r);
  molang.setFloat("color_g", color.g);
  molang.setFloat("color_b", color.b);

  // 跳过未加载区块
  try {
    dimension.getBlock(pos);
  } catch {
    return;
  }

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
export function playSortEffect(dimension: Dimension, occupiedLocations: BlockLocation[], role: ContainerRole): void {
  try {
    for (const loc of occupiedLocations) {
      playEffect(dimension, loc, role, "smartwarehouse:sort", "random.orb", 0.65, 0.35);
    }
  } catch (error) {
    log.error(`播放分拣效果失败: ${error}`);
  }
}

/**
 * 播放搜索标记效果。
 * 使用紫色粒子标记匹配到的容器位置。每个方块位置播放一次。
 *
 * @param dimension - 容器所在维度
 * @param locations - 要标记的方块坐标列表
 */
export function playSearchEffect(dimension: Dimension, locations: BlockLocation[]): void {
  try {
    // 紫色：R=0.76 G=0.35 B=0.98
    const size = FULL_BLOCK_SIZE;
    const off_h = FULL_BLOCK_OFF_H;
    const molang = new MolangVariableMap();
    molang.setFloat("size", size);
    molang.setFloat("size_w", size);
    molang.setFloat("size_l", size);
    molang.setFloat("size_h", size);
    molang.setFloat("off_h", off_h);
    molang.setFloat("color_r", 0.76);
    molang.setFloat("color_g", 0.35);
    molang.setFloat("color_b", 0.98);

    for (const loc of locations) {
      // 跳过未加载区块（区块未加载时 getBlock 抛出异常）
      try {
        dimension.getBlock(loc);
      } catch {
        continue;
      }
      dimension.spawnParticle(
        "smartwarehouse:sort",
        {
          x: loc.x + 0.5,
          y: loc.y + 0.455,
          z: loc.z + 0.5,
        },
        molang
      );
    }
  } catch (error) {
    log.error(`播放搜索标记效果失败: ${error}`);
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
