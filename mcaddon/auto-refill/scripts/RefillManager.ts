// ─── 消耗品领域服务（Facade） ──────────────────────────
// 主手消耗品的自动补货，触发于"使用物品/交互"类事件。
// 判断基于"使用后主手状态"细分（而非简单地按 typeId 拦）：
//   1. 主手为 undefined      → 该物品被完全消耗 → 安全补充同类
//   2. 主手是已枚举的副作用残留（空瓶/空桶/碗）→ 补充同类 + 堆叠残留
//   3. 主手是其他物品         → 与消耗无关 → 忽略
//
// 场景 3 正是过去"补充逻辑撤销挖掘换上的工具"的根源：挖掘会连带触发
// itemUse 之类事件并携带使用前的工具，但主手已被 ToolManager 换成正确
// 工具——此刻既非 undefined、也非副作用残留，故不补充。冲突按主手状态
// 化解，而非靠调用点给工具打标记。
//
// 完全消耗分支再按物品域兜底：耐久工具不会因"使用"消失，工具破碎替换
// 由 ToolManager（playerBreakBlock）负责，这里不补。

import { type Player } from "@minecraft/server";
import { resolve as resolveItemDomain } from "./ItemDomain";
import { InventoryService } from "./Inventory";

/** 使用消耗品后留在主手的副作用残留物品（产出：补充同类 + 残留堆叠回收） */
const SIDE_EFFECT_ITEMS: ReadonlySet<string> = new Set([
  "minecraft:glass_bottle", // 药水 / 蜂蜜瓶 / 龙息瓶喝完
  "minecraft:bucket",       // 水/牛奶桶喝掉、水/岩浆放置后
  "minecraft:bowl",         // 蘑菇煲 / 迷之炖菜 / 兔肉煲 / 甜菜汤吃完
]);

export class RefillManager {
  /**
   * @param playPop 补货成功后的反馈音效（注入便于维护，默认 random.pop）
   */
  constructor(
    private readonly playPop: (player: Player) => void = (p) => p.playSound("random.pop"),
  ) {}

  /**
   * 使用/交互事件后的自动补充。按使用后主手状态分派：
   *   1. undefined                 → 完全消耗，补充同类
   *   2. 已枚举的副作用残留（主手） → 交换同类 + 堆叠残留（交换+堆叠原子流程）
   *   3. 其他（工具切换已换主手 / 主手仍同类仅数量减少）→ 忽略
   * @param player     目标玩家
   * @param usedTypeId 被使用物品的类型（事件携带的使用前类型）
   */
  onConsumed(player: Player, usedTypeId: string): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const hotbarSlot = inv.mainhandSlot();
    const mainhand = inv.readMainhand();

    // 分派：按使用后主手状态
    let refillType: string;
    let residueSlot: number | null = null;
    if (mainhand === undefined) {
      // 1. 完全消耗 → 安全补充同类（仅消耗品域；工具不会因使用消失，见文件头）
      if (resolveItemDomain(usedTypeId) !== "consumable") return;
      refillType = usedTypeId;
    } else if (SIDE_EFFECT_ITEMS.has(mainhand.typeId)) {
      // 2. 副作用残留 → 补充同类 + 残留随交换落到槽位后堆叠回背包
      refillType = usedTypeId;
      residueSlot = hotbarSlot;
    } else {
      // 3. 其他不一致（工具切换已换入主手 / 主手仍是同类）→ 与消耗无关，忽略
      return;
    }

    // 补充：从背包找同类换入主手（交换 + 堆叠）
    const slot = inv.findEqualType(refillType, hotbarSlot);
    if (slot === undefined) {
      // 背包无同类（最后一件也已用完）→ 主手残留物堆叠回背包
      if (residueSlot !== null) inv.stackRemainder(residueSlot);
      return;
    }
    if (!inv.swapMainhand(slot)) return;
    // 副作用残留已随交换落到该槽位 → 堆叠回背包
    if (residueSlot !== null && inv.container.getItem(slot)) {
      inv.stackRemainder(slot);
    }
    this.playPop(player);
    console.warn(`[AutoRefill] 替换 ${player.name}: ${refillType} ← slot ${slot}`);
  }
}