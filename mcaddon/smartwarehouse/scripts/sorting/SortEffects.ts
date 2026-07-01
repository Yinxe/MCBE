import { Dimension, MolangVariableMap } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { Logger } from "../util/Logger";

const log = new Logger("SortEffects");

/**
 * 智能仓库分拣动画效果工具。
 *
 * 在容器位置播放粒子和音效，提供视觉反馈。
 * 支持单箱和大箱子（双箱粒子居中，尺寸翻倍）。
 */

/** 箱子类型的默认粒子大小 */
const CHEST_SIZE = 0.96;
/** 非箱子类型（桶、潜影盒等）的粒子大小 */
const DEFAULT_SIZE = 1.02;

/**
 * 播放分拣成功效果（粒子 + 音效）。
 *
 * @param dimension  容器所在维度
 * @param occupiedLocations  容器占用的所有方块位置（双箱有两个坐标）
 */
export function playSortEffect(dimension: Dimension, occupiedLocations: BlockLocation[]): void {
  try {
    const isDoubleChest = occupiedLocations.length > 1;
    const primary = occupiedLocations[0];
    const molang = new MolangVariableMap();

    // 设置粒子大小：双箱在连接轴上翻倍
    const size = CHEST_SIZE;
    molang.setFloat("size", size);

    if (isDoubleChest) {
      const offset = {
        x: occupiedLocations[1].x - primary.x,
        y: occupiedLocations[1].y - primary.y,
        z: occupiedLocations[1].z - primary.z,
      };
      // 双箱在水平连接轴上尺寸翻倍（x 轴或 z 轴）
      const doubleW = offset.x !== 0 ? size * 2 : size;
      const doubleL = offset.z !== 0 ? size * 2 : size;
      molang.setFloat("size_w", doubleW);
      molang.setFloat("size_l", doubleL);
      molang.setFloat("off_h", -0.025);
    } else {
      molang.setFloat("size_w", size);
      molang.setFloat("size_l", size);
      molang.setFloat("off_h", -0.025);
    }

    // 计算容器中心坐标
    const center = isDoubleChest
      ? {
          x: (occupiedLocations[0].x + occupiedLocations[1].x) / 2 + 0.5,
          y: primary.y + 0.5,
          z: (occupiedLocations[0].z + occupiedLocations[1].z) / 2 + 0.5,
        }
      : {
          x: primary.x + 0.5,
          y: primary.y + 0.5,
          z: primary.z + 0.5,
        };

    // 绿色旋转粒子（分拣成功）
    dimension.spawnParticle("smartwarehouse:sort", center, molang);

    // 音效
    dimension.playSound("random.orb", center, { pitch: 0.7, volume: 0.4 });
  } catch (error) {
    log.error(`播放分拣效果失败: ${error}`);
  }
}

/**
 * 播放物品存入效果（金色光晕）。
 *
 * @param dimension  容器所在维度
 * @param occupiedLocations  容器占用的所有方块位置
 */
export function playDepositEffect(dimension: Dimension, occupiedLocations: BlockLocation[]): void {
  try {
    const isDoubleChest = occupiedLocations.length > 1;
    const primary = occupiedLocations[0];
    const molang = new MolangVariableMap();

    const size = CHEST_SIZE;
    molang.setFloat("size", size);

    if (isDoubleChest) {
      const offset = {
        x: occupiedLocations[1].x - primary.x,
        y: occupiedLocations[1].y - primary.y,
        z: occupiedLocations[1].z - primary.z,
      };
      const doubleW = offset.x !== 0 ? size * 2 : size;
      const doubleL = offset.z !== 0 ? size * 2 : size;
      molang.setFloat("size_w", doubleW);
      molang.setFloat("size_l", doubleL);
      molang.setFloat("off_h", -0.025);
    } else {
      molang.setFloat("size_w", size);
      molang.setFloat("size_l", size);
      molang.setFloat("off_h", -0.025);
    }

    const center = isDoubleChest
      ? {
          x: (occupiedLocations[0].x + occupiedLocations[1].x) / 2 + 0.5,
          y: primary.y + 0.5,
          z: (occupiedLocations[0].z + occupiedLocations[1].z) / 2 + 0.5,
        }
      : {
          x: primary.x + 0.5,
          y: primary.y + 0.5,
          z: primary.z + 0.5,
        };

    // 金色旋转粒子（存入效果）
    dimension.spawnParticle("smartwarehouse:deposit", center, molang);
    dimension.playSound("random.pop", center, { pitch: 0.8, volume: 0.3 });
  } catch (error) {
    log.error(`播放存入效果失败: ${error}`);
  }
}
