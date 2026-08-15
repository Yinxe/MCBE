// ─── 实体标签同步（mc 层） ──────────────────────────────
// 将标签列表同步到实体（Entity 绑定，core 层不涉及）。

import type { Entity } from "@minecraft/server";
import { TAG_PREFIX } from "../../model/Types";

/**
 * 将标签列表同步到实体：
 * 1. 移除所有 `mockplayer:tag:` 前缀的自定义标签
 * 2. 重新添加当前标签列表中的所有标签
 */
export function syncEntityTags(entity: Entity, tags: string[]): void {
  const existing = entity.getTags();
  for (const tag of existing) {
    if (tag.startsWith(TAG_PREFIX)) {
      entity.removeTag(tag);
    }
  }
  for (const tag of tags) {
    entity.addTag(tag);
  }
}