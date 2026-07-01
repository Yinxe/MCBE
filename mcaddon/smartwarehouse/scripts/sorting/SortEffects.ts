import { Dimension, MolangVariableMap } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { Logger } from "../util/Logger";

const log = new Logger("SortEffects");

/**
 * 智能仓库分拣动画效果工具。
 *
 * 在容器位置播放粒子和音效，提供视觉反馈。
 * 粒子发射位置在容器底部中心（bottomCenter），
 * 双箱在连接轴偏移半个箱距使粒子居中。
 */

/** 箱子类型的默认粒子大小 */
const CHEST_SIZE = 0.96;

/**
 * 计算粒子发射位置和 Molang 变量。
 *
 * @param occupiedLocations 容器占用的所有方块位置
 * @returns [pos, molang] 发射坐标和变量映射
 */
function buildParticleParams(occupiedLocations: BlockLocation[]): [{ x: number; y: number; z: number }, MolangVariableMap] {
  const isDoubleChest = occupiedLocations.length > 1;
  const primary = occupiedLocations[0];
  const molang = new MolangVariableMap();

  // 基准大小
  molang.setFloat("size", CHEST_SIZE);
  molang.setFloat("size_h", CHEST_SIZE);

  if (isDoubleChest) {
    const offset = {
      x: occupiedLocations[1].x - primary.x,
      y: 0,
      z: occupiedLocations[1].z - primary.z,
    };

    // 双箱连接轴尺寸翻倍
    const doubleW = offset.x !== 0 ? CHEST_SIZE * 2 : CHEST_SIZE;
    const doubleL = offset.z !== 0 ? CHEST_SIZE * 2 : CHEST_SIZE;
    molang.setFloat("size_w", doubleW);
    molang.setFloat("size_l", doubleL);

    // 粒子效果偏移到双箱正中：连接轴方向偏移半格
    molang.setFloat("off_w", offset.x * 0.5);
    molang.setFloat("off_l", offset.z * 0.5);
    molang.setFloat("off_h", -0.025);

    // 发射位置在底部中心（两个方块的中点），下移 0.25 让粒子视觉居中
    const center = {
      x: (primary.x + occupiedLocations[1].x) / 2 + 0.5,
      y: primary.y - 0.25,
      z: (primary.z + occupiedLocations[1].z) / 2 + 0.5,
    };
    return [center, molang];
  }

  // 单箱
  molang.setFloat("size_w", CHEST_SIZE);
  molang.setFloat("size_l", CHEST_SIZE);
  molang.setFloat("off_h", -0.025);

  // 发射位置在底部中心，下移 0.25 让粒子视觉居中
  const center = {
    x: primary.x + 0.5,
    y: primary.y - 0.25,
    z: primary.z + 0.5,
  };
  return [center, molang];
}

/**
 * 播放分拣成功效果（粒子 + 音效）。
 *
 * @param dimension  容器所在维度
 * @param occupiedLocations  容器占用的所有方块位置（双箱有两个坐标）
 */
export function playSortEffect(dimension: Dimension, occupiedLocations: BlockLocation[]): void {
  try {
    const [center, molang] = buildParticleParams(occupiedLocations);
    dimension.spawnParticle("smartwarehouse:sort", center, molang);
    dimension.playSound("random.orb", center, { pitch: 0.65, volume: 0.35 });
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
    const [center, molang] = buildParticleParams(occupiedLocations);
    dimension.spawnParticle("smartwarehouse:deposit", center, molang);
    dimension.playSound("random.pop", center, { pitch: 0.8, volume: 0.3 });
  } catch (error) {
    log.error(`播放存入效果失败: ${error}`);
  }
}
