// ─── DP 后端：KeyValueStore 的 world 实现（薄，无业务逻辑） ──
import { world } from "@minecraft/server";
import type { KeyValueStore } from "../../core/storage/KeyValueStore";

const PREFIX = "ir2:";

/** DP 当字符串键值存储；分片/校验由 ShardStore 负责 */
export class DynamicPropertyStore implements KeyValueStore {
  read<T>(key: string): T | undefined {
    const raw = world.getDynamicProperty(PREFIX + key);
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  write<T>(key: string, value: T): void {
    world.setDynamicProperty(PREFIX + key, JSON.stringify(value));
  }

  remove(key: string): void {
    world.setDynamicProperty(PREFIX + key, undefined);
  }

  /** 当前 DP 总用量（1MB 预算判定） */
  totalBytes(): number {
    return world.getDynamicPropertyTotalByteCount();
  }
}