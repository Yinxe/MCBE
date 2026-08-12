// ─── 假人下线 ──────────────────────────────────────────

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { saveBotFullState } from "./saveState";
import { trackBotOffline } from "./tridentTracker";

/**
 * 主动下线假人
 * - 保存当前状态（最后位置 + 背包 + 装备 + 经验）
 * - disconnect 移除实体
 * - ⚠️ disconnect 后 playerLeave 事件会触发，但此时实体已不可访问
 *   所以保存必须在 disconnect 前完成
 */
export function offlineBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  const online = entity as SimulatedPlayer | undefined;

  // 下线前清理反查表（需要先保存 entityId）
  const oldEntityId = record.entityId;

  if (online && online.hasTag(BOT_TAG)) {
    record.lastPoint = {
      location: online.location,
      dimension: online.dimension.id,
      rotation: online.getRotation(),
      lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
    };
    record.isSneaking = online.isSneaking;

    console.info(
      `[MockPlayer] 下线保存 ${record.name}（${record.lastPoint.dimension} ${Math.floor(record.lastPoint.location.x)} ${Math.floor(record.lastPoint.location.y)} ${Math.floor(record.lastPoint.location.z)}）`,
    );
    saveBotFullState(online, record);

    online.disconnect();
  }

  record.online = false;
  record.entityId = undefined;
  botRegistry.save(record);

  if (oldEntityId) trackBotOffline(oldEntityId);
}
