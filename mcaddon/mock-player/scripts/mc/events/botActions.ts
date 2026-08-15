// ─── 假人行为事件生产端 ────────────────────────────────
// 订阅世界事件（破坏/放置/使用/攻击/主手切换），过滤 MockPlayer 假人，
// 触发领域事件（core/events/DomainEvents）：
//   playerBreakBlock            → botBlockBroken
//   playerPlaceBlock            → botBlockPlaced
//   itemUse                     → botItemUsed
//   entityHurt（伤害来源是假人）  → botEntityAttacked
//   playerHotbarSelectedSlotChange → botMainhandChanged
// 订阅方（统计/通知/联动）只依赖领域事件，不感知世界事件细节。

import { world } from "@minecraft/server";

import { BOT_TAG } from "../../tags/BotTags";
import { EQUIP_SLOT_NAMES } from "../../model/Types";
import { BotEvents } from "../../events/DomainEvents";

/** 订阅假人行为事件（在 worldLoad 后由 registerAllEvents 调用一次） */
export function registerBotActionEvents(): void {
  // ── 成功破坏方块 ──
  world.afterEvents.playerBreakBlock.subscribe((event) => {
    try {
      const player = event.player;
      if (!player.hasTag(BOT_TAG)) return;
      const block = event.brokenBlockPermutation;
      BotEvents.botBlockBroken.trigger({
        botName: player.name,
        blockTypeId: block.type.id,
        position: { x: event.block.location.x, y: event.block.location.y, z: event.block.location.z },
        dimension: event.block.dimension.id,
        itemId: event.itemStackAfterBreak?.typeId,
      });
    } catch {
      // 单事件异常隔离
    }
  });

  // ── 成功放置方块 ──
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    try {
      const player = event.player;
      if (!player?.hasTag(BOT_TAG)) return;
      BotEvents.botBlockPlaced.trigger({
        botName: player.name,
        blockTypeId: event.block.typeId,
        position: { x: event.block.location.x, y: event.block.location.y, z: event.block.location.z },
        dimension: event.block.dimension.id,
      });
    } catch {
      // 单事件异常隔离
    }
  });

  // ── 成功使用物品（itemUse 事件；与主菜单快捷键订阅并存，互不干扰） ──
  world.afterEvents.itemUse.subscribe((event) => {
    try {
      const source = event.source;
      if (!source?.hasTag(BOT_TAG)) return;
      BotEvents.botItemUsed.trigger({
        botName: source.name,
        itemId: event.itemStack.typeId,
      });
    } catch {
      // 单事件异常隔离
    }
  });

  // ── 成功攻击实体（实体受伤且伤害来源是假人） ──
  world.afterEvents.entityHurt.subscribe((event) => {
    try {
      const attacker = event.damageSource.damagingEntity;
      if (attacker?.hasTag(BOT_TAG)) {
        // 假人攻击（attacker 恒为假人 Player，name 可用）
        BotEvents.botEntityAttacked.trigger({
          botName: (attacker as { name?: string }).name ?? attacker.id,
          targetTypeId: event.hurtEntity.typeId,
          damage: event.damage,
        });
      }

      // 假人受伤：触发全部 5 个装备槽变化事件（不判断掉血——护甲吸收也算，
      // 装备耐久可能损耗/被破坏；订阅方快照对比，没变的槽零写入）
      if (event.hurtEntity.hasTag(BOT_TAG)) {
        const botName = (event.hurtEntity as { name?: string }).name ?? event.hurtEntity.id;
        for (const slot of EQUIP_SLOT_NAMES) {
          BotEvents.botEquipSlotChanged.trigger({
            botName,
            slot,
            via: "hurt",
          });
        }
      }
    } catch {
      // 单事件异常隔离
    }
  });

  // ── 主手切换（热栏槽位变化） ──
  world.afterEvents.playerHotbarSelectedSlotChange.subscribe((event) => {
    try {
      if (!event.player.hasTag(BOT_TAG)) return;
      BotEvents.botMainhandChanged.trigger({
        botName: event.player.name,
        slot: event.newSlotSelected,
        itemId: event.itemStack?.typeId,
      });
    } catch {
      // 单事件异常隔离
    }
  });
}