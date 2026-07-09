import type { BlockInventoryComponent, Dimension, ItemInventoryComponent } from "@minecraft/server";
import { Container, ItemStack } from "@minecraft/server";
import type { StoredContainer } from "../types";
import { SHULKER_BOX_IDS } from "../warehouse/ContainerTypes";
import type { MoveJournal } from "./MoveJournal";

/**
 * 安全地从持久化存储的容器信息中获取 Minecraft 方块容器对象（`Container`）。
 *
 * 本方法在多个场景中被调用：
 * - `SorterEngine.processInputContainer`：获取输入容器的方块对象。
 * - `SorterEngine.tryContainers`：获取目标存储容器的方块对象。
 * - `SorterEngine.findExistingTypeContainers`：校验容器内是否包含某类物品。
 *
 * **安全设计**：所有可能抛出异常的操作（`getBlock`、`getComponent`）都在
 * try-catch 中，避免因区块未加载、方块被破坏或维度无效等异常导致分拣流程崩溃。
 *
 * @param dimension - 容器所在的维度（世界）
 * @param stored - 持久化存储的容器信息（包含位置坐标、维度 ID 等）
 * @returns 方块容器对象，如果容器不可达或不存在则返回 undefined
 */
export function getContainerFromStored(dimension: Dimension, stored: StoredContainer): Container | undefined {
  try {
    const block = dimension.getBlock(stored.primaryLocation);
    if (!block) return undefined;
    const inv = block.getComponent("inventory") as BlockInventoryComponent | undefined;
    return inv?.container;
  } catch {
    // 任何异常（如维度 ID 无效、坐标越界等）都视为"容器不可达"
    return undefined;
  }
}

/**
 * 查找容器中的第一个非空物品槽位。
 *
 * 这是分拣流程的起点 —— `SorterEngine` 在处理每个输入容器时，
 * 首先调用此方法定位要分拣的物品堆。
 *
 * 采用线性扫描方式遍历所有槽位（0 ~ container.size - 1），
 * 返回第一个有物品的槽位索引。对于小型容器（如单个箱子 27 格），
 * 线性扫描的开销可以忽略不计。
 *
 * @param container - 要扫描的容器对象
 * @returns 第一个非空槽位的索引，如果所有槽位都为空则返回 -1
 */
export function findFirstNonEmptySlot(container: Container): number {
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item !== undefined) return slot;
  }
  return -1;
}

/**
 * 检查容器中是否包含指定类型的物品。
 *
 * **用途**：在 `SorterEngine.findExistingTypeContainers` 中用于校验
 * 索引的记录是否仍然有效 —— 如果一个容器曾被记录为包含某类物品，
 * 但实际扫描时已找不到该类物品，则该索引条目被标记为"脏"（stale），
 * 后续会被惰性清除。
 *
 * **设计**：采用两级降级策略 ——
 * 1. 优先使用原生 `Container.contains()`，对无 NBT 差异的普通物品准确且高效
 * 2. `contains()` 返回 false 时，降级为逐槽位比对 typeId（解决耐久/附魔等 NBT 差异导致的误判）
 *
 * @param container - 要检查的容器对象
 * @param typeId - 物品类型 ID（如 "minecraft:diamond"）
 * @returns 如果容器中至少有一个物品的 typeId 匹配，则返回 true
 */
export function containerHasType(container: Container, typeId: string): boolean {
  try {
    // 快速路径：利用原生 API，对无 NBT 差异的物品（石头、泥土等）准确且高效
    if (container.contains(new ItemStack(typeId, 1))) return true;
  } catch {
    // 未知物品 ID（如 Bedrock 不存在的 Java 版 ID），当作"不包含"
    return false;
  }
  // 降级路径：contains() 返回 false，但可能是耐久/附魔等 NBT 差异导致的误判，
  // 改用逐槽位比对 typeId
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item && item.typeId === typeId) return true;
  }
  return false;
}

/**
 * 判断容器是否全空。
 *
 * **用途**：当 `autoCreateCategories` 功能开启时，
 * `SorterEngine` 需要找到空的普通容器来存放新种类物品。
 * 本方法利用 Minecraft 提供的 `emptySlotsCount` API，
 * 比手动遍历槽位更高效。
 *
 * @param container - 要检查的容器对象
 * @returns 如果容器的每个槽位都为空，返回 true
 */
export function isContainerEmpty(container: Container): boolean {
  return container.emptySlotsCount === container.size;
}

/**
 * 尝试将物品堆放入目标容器中。
 *
 * 底层调用 Minecraft 的 `Container.addItem()` API。
 * 该方法会尝试将物品堆合并到容器中已有的同类物品上，
 * 或占用空槽位。如果容器空间不足，剩余物品会以新的
 * `ItemStack` 对象返回。
 *
 * **注意事项**：
 * - 直接传入原始 `ItemStack` 对象（不做克隆），API 内部
 *   会在有剩余时返回一个新的 `ItemStack`，未消耗完的原对象
 *   不应再被使用。
 * - 调用方 `processInputContainer` 在调用前记录了原始数量，
 *   通过比较返回值与原始数量来确定实际放置了多少物品，
 *   因此 API 对输入对象的潜在修改不影响决策逻辑。
 *
 * @param stack - 待放入的物品堆
 * @param target - 目标容器
 * @returns 未能放入的剩余物品堆；如果全部成功放入则返回 undefined
 */
/**
 * 尝试将物品堆放入目标容器中。
 *
 * 底层调用 Minecraft 的 `Container.addItem()` API。
 * 使用 try-catch 包裹，任何异常（如容器在调用过程中被破坏、区块卸载）
 * 都会被捕获并记录，异常时返回原始物品堆，避免调用方误判为"全部放入"
 * 而清空输入槽，从而防止物品丢失。
 *
 * @param stack - 待放入的物品堆
 * @param target - 目标容器
 * @returns 未能放入的剩余物品堆；全部放入返回 undefined；异常时返回原堆
 */
export function tryMoveStackIntoContainer(stack: ItemStack, target: Container): ItemStack | undefined {
  try {
    return target.addItem(stack);
  } catch (error) {
    console.error(`[SmartWarehouse] addItem 失败: ${error}`);
    // 返回原始物品堆，防止调用方误认为全部放完而清空输入槽
    return stack;
  }
}

/**
 * 在写入前记录目标容器快照，然后尝试放入物品堆。
 *
 * @param stack - 待放入的物品堆
 * @param target - 目标容器
 * @param journal - 当前分拣事务的日志
 * @param containerId - 目标容器 ID（用于日志追踪）
 * @returns 未能放入的剩余物品堆
 */
export function tryMoveStackIntoContainerWithJournal(
  stack: ItemStack,
  target: Container,
  journal: MoveJournal,
  containerId: string
): ItemStack | undefined {
  journal.snapshotTarget(containerId, target);
  return tryMoveStackIntoContainer(stack, target);
}

/**
 * 计算容器对于指定家族的纯度分数。
 *
 * 纯度 = 容器中属于目标家族的物品种类数 ÷ 容器中所有物品种类总数。
 *
 * 分数范围 [0, 1]：
 * - `1.0` = 容器中只有该家族的物品（最纯，优先选择）
 * - `0.0` = 容器中没有该家族的物品
 *
 * **用途**：
 * - 家族分拣时对候选容器按纯度降序排列，让物品优先流入更"专一"的容器，
 *   避免已混杂多个家族的容器承受过大的物品压力。
 * - UI 展示容器的家族纯度排行。
 *
 * @param container - Minecraft 容器实例
 * @param familyMemberSet - 目标家族的所有物品 typeId 集合（Set 用于 O(1) 查找）
 * @returns 纯度分数（0-1）
 */
export function getFamilyPurity(container: Container, familyMemberSet: Set<string>): number {
  const allTypes = new Set<string>();
  const targetTypes = new Set<string>();

  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;
    const typeId = item.typeId;
    if (allTypes.has(typeId)) continue;
    allTypes.add(typeId);
    if (familyMemberSet.has(typeId)) {
      targetTypes.add(typeId);
    }
  }

  if (allTypes.size === 0) return 0;
  return targetTypes.size / allTypes.size;
}

// ─── 大宗容器专用函数（潜影盒内容读取与填充） ────────────────────

/**
 * 判断物品堆是否为潜影盒（任意颜色）。
 *
 * @param stack - 要检查的物品堆
 * @returns 如果是潜影盒则返回 true
 */
export function isShulkerBoxItem(stack: ItemStack): boolean {
  return SHULKER_BOX_IDS.has(stack.typeId);
}

/**
 * 获取大宗容器当前存储的物品种类。
 *
 * 逻辑：
 * - 扫描容器所有非空槽位，跳过空的潜影盒。
 * - 如果第一个有效物品是潜影盒，则读取盒内的第一个物品类型。
 * - 容器全空时返回 `undefined`（表示尚未确定种类）。
 *
 * **已知限制**：潜影盒内部的读取依赖 `ItemInventoryComponent`，
 * 而该组件在原版潜影盒上暂不可用（用 NBT 而非 storage_item 体系），
 * 因此当前运行时下本函数会跳过所有潜影盒，只识别散装物品的种类。
 * 详见 `tryFillShulkerBoxes` 的注释。
 *
 * @param container - 大宗容器的容器对象
 * @returns 物品种类 ID，或 undefined（空箱/无法读取）
 */
export function getBulkChestFirstType(container: Container): string | undefined {
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;

    if (isShulkerBoxItem(item)) {
      // 当 API 不可用时，getComponent 返回 undefined → 跳过该盒子
      try {
        const invComp =
          (item.getComponent("inventory") as ItemInventoryComponent | undefined) ??
          (item.getComponent("minecraft:inventory") as ItemInventoryComponent | undefined);
        if (!invComp?.container) continue; // 空盒或 API 不可用，跳过
        const innerFirst = findFirstNonEmptySlot(invComp.container);
        if (innerFirst < 0) continue; // 空盒，继续找下一个
        const innerItem = invComp.container.getItem(innerFirst);
        if (innerItem) return innerItem.typeId;
      } catch {
        console.warn(`[SmartWarehouse] 读取潜影盒内容失败（API 可能不可用），跳过`);
        continue;
      }
    } else {
      // 散装物品：直接返回其类型
      return item.typeId;
    }
  }
  return undefined; // 全空或所有物品都是空盒
}

/**
 * 尝试将物品堆放入容器内已有的潜影盒中。
 *
 * 遍历容器的所有槽位，对每个潜影盒：
 * 1. 获取其内部的 `Container`。
 * 2. 调用 `Container.addItem()` 尝试放入。
 * 3. 如果有物品成功放入，将修改后的潜影盒写回外层容器的槽位。
 *
 * **已知限制**：`ItemInventoryComponent`（即 `getComponent("inventory")`）
 * 仅在绑定了 `minecraft:storage_item` 组件的物品上可用。原版潜影盒
 * 沿用的是旧 NBT 系统（`BlockEntityTag`），而 Script API 不暴露 NBT，
 * 因此**当前游戏运行时无法通过 Script API 读取/修改潜影盒物品的内部容器**。
 *
 * 参考调研结论：
 * - GitHub 上没有任何项目能通过 Script API 读取潜影盒 ItemStack 内部物品。
 * - 所有 ItemEditor 类项目只改名字/lore/附魔等表层属性，不读容器内容。
 * - `getComponents()` 在潜影盒 ItemStack 上返回空数组，说明组件框架
 *   本身未对该物品类型启用。
 * - 社区目前没有绕过方案。
 *
 * 解决路径（需等待 Mojang 推进）：
 * - **路径 A**：Mojang 将潜影盒从 `BlockEntityTag` 迁移到
 *   `minecraft:storage_item` 组件体系（时间未知）。
 * - **路径 B**：本插件自定义实现 `minecraft:storage_item` 物品替代潜影盒
 *   （可完全控制，但需要玩家使用自定义容器）。
 *
 * 当前降级行为：API 不可用时打印警告并跳过所有潜影盒，
 * 物品通过常规空槽位流程放置，不崩溃不丢物品。
 *
 * @param outerContainer - 大宗容器的容器对象
 * @param stack - 待放入的物品堆
 * @returns 未能放入的剩余物品堆；全部放入则返回 undefined
 */
export function tryFillShulkerBoxes(outerContainer: Container, stack: ItemStack): ItemStack | undefined {
  let remaining: ItemStack | undefined = stack;

  for (let slot = 0; slot < outerContainer.size; slot++) {
    if (remaining === undefined) return undefined;

    const slotStack: ItemStack | undefined = outerContainer.getItem(slot);
    if (!slotStack) continue;
    if (!isShulkerBoxItem(slotStack)) continue;

    try {
      // 尝试两种组件 ID 格式（Bedrock 不同版本可能有差异）
      const invComp =
        (slotStack.getComponent("inventory") as ItemInventoryComponent | undefined) ??
        (slotStack.getComponent("minecraft:inventory") as ItemInventoryComponent | undefined);

      if (!invComp?.container) {
        // API 不可用：打印所有可用组件供诊断，说明根因
        const available = slotStack
          .getComponents()
          .map((c) => c.typeId)
          .join(", ");
        console.warn(
          `[SmartWarehouse] 潜影盒 ${slotStack.typeId} 没有 inventory 组件，` +
            `可用组件: [${available}]。` +
            `根因：原版潜影盒使用旧 NBT 系统（BlockEntityTag），` +
            `Script API 的 ItemInventoryComponent 仅对 ` +
            `minecraft:storage_item 组件生效，潜影盒尚未迁移至此体系。` +
            `降级：跳过潜影盒填充，物品转为放入空槽位。`
        );
        // 跳过所有潜影盒（无需再试，一次警告就够了）
        return remaining;
      }

      const innerContainer = invComp.container;
      // 如果盒子已满且没有同类物品，跳过
      if (innerContainer.emptySlotsCount === 0 && !containerHasType(innerContainer, remaining.typeId)) {
        continue;
      }

      const before = remaining.amount;
      remaining = innerContainer.addItem(remaining);

      if (remaining === undefined || remaining.amount < before) {
        // 潜影盒内容有变化，将修改后的物品写回外层容器
        //
        // 为什么需要 setItem？Container.getItem(slot) 返回的是 ItemStack
        // 副本而非引用。对副本内部容器（invComp.container）的修改只影响
        // 这个副本，不会自动同步回外层槽位。必须显式 setItem 持久化。
        // ContainerScanner.ts 的探针模式也印证了这一行为（先 getItem 取出，
        // 修改后 setItem 写回）。
        outerContainer.setItem(slot, slotStack);
      }
    } catch (error) {
      console.warn(`[SmartWarehouse] 潜影盒操作异常: ${error}，跳过`);
      continue;
    }
  }

  return remaining;
}
