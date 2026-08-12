// ─── 图腾领域服务（Facade） ────────────────────────────
// 不死图腾的副手自动补充。原版没有"图腾已触发"事件，由 main.ts 用
// entityHeal + cause 判别合成触发（TotemPolicy.isTotemHealCause）后调用：
//   副手已不持图腾（消耗/空）→ 从背包找备用图腾原子换入副手；
//   副手仍持图腾（多枚堆叠）或持其它物品 → 已保护/误报，跳过（幂等）。
// 换入经 InventoryService.refillOffhand（先铺目标后清源），防刷物；
// 绝不用 setEquipment 复制堆叠（那会双份）。

import { type Player } from "@minecraft/server";
import { InventoryService } from "./Inventory";
import { needsTotemRefill, TOTEM_TYPE_ID } from "./TotemPolicy";
import { logger } from "./Logger";

export class TotemManager {
  /**
   * @param playPop 补货成功后的反馈音效（注入便于维护，默认 random.pop）
   */
  constructor(private readonly playPop: (player: Player) => void = (p) => p.playSound("random.pop")) {}

  /**
   * 不死图腾触发后的副手补充：副手不再持图腾 → 找备用图腾原子换入。
   * 副手仍持图腾 / 持其它物品 → 跳过（已保护或误报，幂等）。
   * @param player 目标玩家
   */
  onTotemTriggered(player: Player): void {
    const inv = InventoryService.of(player);
    if (!inv) return;
    const offhand = inv.readOffhand();
    if (!needsTotemRefill(offhand?.typeId)) {
      logger.debug(`副手仍持图腾 ${player.name} → 跳过`);
      return;
    }
    const slot = inv.findEqualType(TOTEM_TYPE_ID, inv.mainhandSlot());
    if (slot === undefined) {
      logger.debug(`图腾耗尽 ${player.name} → 静默`);
      return;
    }
    if (!inv.refillOffhand(slot)) return;
    this.playPop(player);
    logger.info(`图腾补充 ${player.name} ← slot ${slot}`);
  }
}
