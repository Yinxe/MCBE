// ─── 测试共享工具 ──────────────────────────────────────
// 构造标准 BotRecord / Vec3 / SerializedItemStack 的工厂函数

import type { BotRecord, PositionState, SerializedItemStack } from "../../scripts/core/model/Types";

export function makeState(overrides: Partial<PositionState> = {}): PositionState {
  return {
    location: { x: 0, y: 64, z: 0 },
    dimension: "minecraft:overworld",
    rotation: { x: 0, y: 0 },
    lookTarget: { x: 10, y: 64, z: 10 },
    ...overrides,
  };
}

/** 构造标准假人记录（默认离线、带 bot+respawn+idle 标签） */
export function makeRecord(name = "bot1", overrides: Partial<BotRecord> = {}): BotRecord {
  const record: BotRecord = {
    name,
    online: false,
    death: false,
    tags: ["mockplayer:tag:bot", "mockplayer:tag:respawn", "mockplayer:tag:idle"],
    isSneaking: false,
    lastPoint: null,
    respawnPoint: makeState(),
    deathPoint: null,
    experience: { level: 0, xpProgress: 0, totalXp: 0 },
    ...overrides,
  };
  return record;
}

export function makeItem(typeId: string, amount = 1, overrides: Partial<SerializedItemStack> = {}): SerializedItemStack {
  return { typeId, amount, ...overrides };
}

/** 空背包（36 格） */
export function emptyInventory(): (SerializedItemStack | null)[] {
  return new Array(36).fill(null);
}