// ─── DP 后端：KeyValueStore 的 world 实现（薄，无业务逻辑） ──
// 唯一 import @minecraft/server 的存储文件。只做"字符串键 ↔ world.get/setDynamicProperty"
// 的 JSON 序列化包装，无任何分片/校验逻辑——那些由上层 ShardStore 负责。
// 因此本文件不进 node 测试构建（tsconfig.test.json exclude），仅编译检查 + 游戏内冒烟。
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
}
