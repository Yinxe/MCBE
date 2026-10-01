// ─── 创建假人（组件化代理） ─────────────────────
// 旧实现已迁移至 lifecycle/BotLifecycle + Quota/NameGuard 组件。
// 本文件保留为兼容薄壳：校验与配额由组件守卫完成，生成由编排器统一调度。
// 直接调用者无需改动，仍抛错语义保持一致。

import type { Vector3, Dimension } from "@minecraft/server";

import type { BotRecord } from "../../rules/Types";

export interface CreateBotOptions {
  name: string;
  /** 主人玩家名（创建者，用于配额统计与权限） */
  ownerName: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
  spawnMode?: "normal" | "chunkload";
}

/**
 * 创建新假人（代理至 BotLifecycle.create）。
 * 保留抛错语义：失败直接 throw，供命令/UI 捕获提示。
 */
export async function createBot(options: CreateBotOptions): Promise<BotRecord> {
  const { botLifecycle } = await import("../../bootstrap/context");
  const result = await botLifecycle.create({
    rawName: options.name,
    ownerName: options.ownerName,
    location: options.location as any,
    dimension: options.dimension as any,
    initialTags: options.initialTags,
    rotation: options.rotation as any,
    lookTarget: options.lookTarget as any,
    isSneaking: options.isSneaking,
    spawnMode: options.spawnMode,
  });
  if (!result.ok || !result.record) {
    throw new Error(result.reason ?? "创建失败");
  }
  return result.record;
}
