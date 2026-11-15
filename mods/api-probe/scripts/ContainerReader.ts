// ─── 容器读取:坐标 → Container,失败时给出可读原因 ────────────────
//
// 这一层只负责「把坐标变成一个可用的 Container」,不关心界面怎么画。
// 失败一律返回 `{ ok: false, reason }`,不抛异常 —— 命令回调与表单都在
// 受限/安全上下文里跑,未捕获异常会变成玩家侧的无提示失败。
//
// 探针本身要核对 API 的返回值,因此 `size` 与 `emptySlotsCount` 在这里
// 就一并快照,而不是让上层去猜。

import { type Container, type Dimension, type Vector3 } from "@minecraft/server";

/** 读取容器的结果:成功时带回 Container 与两处槽位统计,失败时带回原因 */
export type ContainerReadResult =
  | {
      ok: true;
      container: Container;
      /** 目标方块的标识,用于界面标题与失败提示 */
      blockTypeId: string;
      /** 容器总槽位数(API 返回值,非硬编码) */
      size: number;
      /** 空槽数量(API 返回值,非硬编码) */
      emptySlotsCount: number;
    }
  | { ok: false; reason: string };

/** 把任意抛出物转成一句可读文本 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 把坐标规整到所在方块的整数坐标。
 *
 * 用 `Math.floor` 而不是截断:负坐标下截断会把 -20.9 算成 -20,
 * 而该位置实际属于 -21 号方块。
 */
export function toBlockLocation(location: Vector3): Vector3 {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

/**
 * 读取指定维度、指定方块坐标处的容器。
 *
 * 依次排除:坐标无方块(越界/未加载)→ 方块没有容器组件 → 容器不可用 →
 * 容器已失效。每一种都返回各自的失败原因,便于探针区分 API 的真实行为。
 */
export function readBlockContainer(dimension: Dimension, location: Vector3): ContainerReadResult {
  const blockLocation = toBlockLocation(location);

  let block;
  try {
    block = dimension.getBlock(blockLocation);
  } catch (error) {
    return {
      ok: false,
      reason: `无法读取坐标 ${formatLocation(blockLocation)} 的方块:${errorText(error)}`,
    };
  }
  if (!block) {
    return {
      ok: false,
      reason: `坐标 ${formatLocation(blockLocation)} 没有方块(超出世界边界,或区块未加载)`,
    };
  }

  const blockTypeId = block.typeId;

  let component;
  try {
    component = block.getComponent("minecraft:inventory");
  } catch (error) {
    return {
      ok: false,
      reason: `读取「${blockTypeId}」的容器组件失败:${errorText(error)}`,
    };
  }
  if (!component) {
    return { ok: false, reason: `「${blockTypeId}」没有容器` };
  }

  const container = component.container;
  if (!container) {
    return { ok: false, reason: `「${blockTypeId}」的容器当前不可用` };
  }

  try {
    if (!container.isValid) {
      return {
        ok: false,
        reason: `「${blockTypeId}」的容器已失效(方块可能已被破坏,或区块已卸载)`,
      };
    }
    return {
      ok: true,
      container,
      blockTypeId,
      size: container.size,
      emptySlotsCount: container.emptySlotsCount,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `读取「${blockTypeId}」的容器数据失败:${errorText(error)}`,
    };
  }
}

/** 把方块坐标格式化成 `100 64 -20` 形式,用于提示文本 */
export function formatLocation(location: Vector3): string {
  return `${location.x} ${location.y} ${location.z}`;
}
