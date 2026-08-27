// ─── 库存组件（生命周期内聚） ─────────────────
// 职责：背包/装备库存的**唯一**生命周期管理者。
//  - 拥有 InventoryStorage 实例（经 LifecycleContext 注入，不再外部孤立）
//  - 集中订阅：world.playerInventoryItemChange + BotEvents.botEquipSlotChanged
//  - 提供增量保存、对账、恢复、指纹清理的统一入口
//  - 删除/下线等生命周期钩子内聚于此，不再散落于 events/index / inventoryStorage 外部
//
// 设计：组件在 onRegister 时集中订阅世界事件与领域事件；
//      onUnregister 时集中取消订阅；
//      库存写操作仍委托 ctx.inventory（保持存储实现可单测），
//      但“何时订阅、如何过滤、如何守卫”全部内聚于此组件，外部不再直接操作库存。

import { world, type Player } from "@minecraft/server";
import type { PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { checkMainHandDurability } from "../../features/basic/items";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import type { BotRecord } from "../../rules/Types";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

export class InventoryComponent implements LifecycleComponent {
  readonly id = "inventory";
  readonly priority = 60;

  private ctx!: LifecycleContext;
  private unsubs: (() => void)[] = [];
  private worldHandler?: (e: PlayerInventoryItemChangeAfterEvent) => void;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;

    // ── 1. 装备槽变化：领域事件订阅（互换/穿卸/受伤 → 快照对比 → 单槽保存） ──
    const offEquip = BotEvents.botEquipSlotChanged.subscribe((event) => {
      try {
        this.ctx.inventory.handleEquipSlotChanged(event.botName, event.slot);
      } catch (e: unknown) {
        console.warn(`[Inventory] 装备保存异常 ${event.botName} ${event.slot}: ${e?.message ?? e}`);
      }
    });
    this.unsubs.push(offEquip);

    // ── 2. 背包单格变化：世界事件订阅（捡起/移动/丢弃/合成 → 单格直存 NBT） ──
    this.worldHandler = (event: PlayerInventoryItemChangeAfterEvent) => {
      const { player, slot, itemStack, beforeItemStack } = event;
      try {
        if (!(player as unknown as { hasTag?: (tag: string) => boolean })?.hasTag?.(BOT_TAG)) return;
      } catch { return; }
      try {
        this.ctx.inventory.saveInventorySlot(player as Player, slot, itemStack ?? null, beforeItemStack ?? null);
      } catch (e: unknown) {
        console.warn(`[Inventory] 背包保存异常 ${player.name} slot=${slot}: ${e?.message ?? e}`);
      }
      // 额外：检视主手工具耐久（原 playerInventoryItemChange 逻辑，现内聚）
      try {
        checkMainHandDurability(player as Player, slot);
      } catch {}
    };

    try {
      world.afterEvents.playerInventoryItemChange.subscribe(this.worldHandler);
    } catch (e: unknown) {
      console.warn(`[Inventory] 订阅 playerInventoryItemChange 失败: ${e?.message ?? e}`);
    }

    console.info(`[Inventory] 已集中订阅 背包单格 + 装备槽 变化事件（生命周期内聚）`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    for (const off of this.unsubs) try { off(); } catch {}
    this.unsubs = [];
    if (this.worldHandler) {
      try { world.afterEvents.playerInventoryItemChange.unsubscribe(this.worldHandler); } catch {}
      this.worldHandler = undefined;
    }
  }

  async onAfterOnline(_ctx: LifecycleContext, _record: BotRecord, _bot: SimulatedPlayer): Promise<void> {
    // 库存恢复已在 SessionComponent 的 playerJoin 中完成
  }

  async onAfterOffline(_ctx: LifecycleContext, record: BotRecord): Promise<void> {
    void record;
  }

  async onAfterDelete(_ctx: LifecycleContext, botName: string): Promise<void> {
    try {
      this.ctx.inventory.forget(botName);
    } catch {}
  }

  get storage(): import("../../features/inventoryStorage").InventoryStorage | undefined {
    return this.ctx.inventory;
  }

  static ensureRegistered(): void {
    console.info(`[Inventory] ensureRegistered 已废弃：库存订阅已由 InventoryComponent 内聚管理`);
  }
}
