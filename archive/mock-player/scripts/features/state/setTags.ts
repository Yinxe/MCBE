// ─── 标签更新（运行时） ─────────────────────────────────

import { world } from "@minecraft/server";

import { BotRecord } from "../../rules/Types";
import { TAG_CONTROL, BOT_TAG, validateTagSet } from "../../rules/tags/BotTags";
import { syncEntityTags } from "../basic/EntityTags";
import { saveCoordinator } from "../../bootstrap/context";
import { BotEvents } from "../../events/DomainEvents";

/**
 * 更新假人标签（运行时）。
 * 校验规则见 rules/tags/BotTags.validateTagSet（未知标签 / 身份标识不可移除 / 互斥唯一）；
 * 校验不通过则不改动 record，返回中文拒绝原因。
 * @returns 拒绝原因（未通过校验时）；undefined = 成功
 */
export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: any): string | undefined {
  // ── 校验（先全部通过再改动 record，保证原子性） ──
  const rejected = validateTagSet(newTags);
  if (rejected) {
    return rejected;
  }

  const hadControl = record.tags.includes(TAG_CONTROL.value);
  const hasControlNow = newTags.includes(TAG_CONTROL.value);

  record.tags = newTags;

  if (!hasControlNow) {
    record.controllerId = undefined;
  } else if (!hadControl && controllerPlayer) {
    record.controllerId = controllerPlayer.id;
  }

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  saveCoordinator.saveRecord(record);

  // ⚠️ 标签变更领域事件（唯一渠道落库成功后发布）：标签驱动模块
  // （劫掠模式等）订阅——挂上标签 → 启动、移除 → 停止。替代旧引擎
  // 10 tick 轮询对账；事件负载可序列化，core 纯净。
  BotEvents.botTagsChanged.trigger({ botName: record.name, tags: record.tags });

  return undefined;
}
