// ─── 能力：周期持久化（100tick） ─────────────────────
// 每假人独立执行自己的持久化兜底（替代原全局 100tick 循环段）：
// 位置（lastPoint 含 rotation）+ 潜行 + 经验 + **效果（buff 在线刷新——
// 修复在线效果丢失：效果无事件，仅下线/死亡保存会丢在线期间的时长）**
// + 装备槽指纹对比零写入。
// ⚠️ isRestored 守卫（防空背包覆写）保留。

import { EQUIP_SLOT_NAMES } from "../../../core/model/Types";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import { captureEffects, captureExperience } from "../../adapters/McItemCodec";
import { savePoseToRecord } from "../../adapters/PoseGateway";
import { botRegistry, inventoryStorage, saveCoordinator } from "../../bootstrap/context";
import type { MockBot } from "../MockBot";

/** 周期持久化能力工厂（常开；恢复标记守卫 + 静默保存） */
export function persistCapability(bot: MockBot): BotCapability {
  return {
    id: "persist",
    tickInterval: 100,
    enabled: () => true,
    tick: (): void => {
      const record = bot.record;
      if (record.death) return;
      // ⚠️ 恢复标记守卫：spawn 自带空背包覆盖持久化数据的高危漏洞防护
      if (!botRegistry.isRestored(record.name)) return;
      const entity = bot.getEntity();
      if (!entity) return;
      try {
        if (!record.lastPoint) {
          record.lastPoint = {
            location: entity.location,
            dimension: entity.dimension.id,
            rotation: entity.getRotation(),
            lookTarget: record.respawnPoint.lookTarget,
          };
        } else {
          savePoseToRecord(record, entity.location, entity.dimension.id, entity.getRotation());
        }
        record.isSneaking = entity.isSneaking;
        record.experience = captureExperience(entity);
        // buff 在线刷新（排除流程性效果；旧记录缺失 = 无效果，升级兼容）
        record.effects = captureEffects(entity);
        // 静默保存（silent）：高频轮询路径防止每 5 秒刷日志
        saveCoordinator.saveRecord(record, true);
        // 装备兜底：假人可能通过引擎行为（捡起自动穿上等）改变装备而无事件——
        // 复用装备槽快照对比（无变化零写入），事件驱动的安全网
        for (const slotName of EQUIP_SLOT_NAMES) {
          inventoryStorage.handleEquipSlotChanged(record.name, slotName);
        }
      } catch (e: any) {
        console.warn(`[MockPlayer] 周期持久化异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
  };
}
