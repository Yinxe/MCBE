// ─── 索引仓储：**每容器一条**普通 DP 直存（事件驱动，无定时 flush） ──
// 索引本为"路由加速"派生缓存（权威源 = 容器内容），持久化仅为重载加速，非崩溃关键。
// 每容器一条 `ir2:idx:{cid}`（items + singleBinding），对齐注册表/统计的"每容器一单位"风格：
//   · 写入时机（mc 层）/容器粒度事件驱动——结构事件（容器增删/角色/优先级）只写该容器，
//     卸载/离仓/删仓时写全部容器；itemRouted 只更新内存不落盘（重载后惰性自愈）。
//   · 单容器索引条目是小值 → **DirectStore**（普通 DP 单键）直存，无分片/hash 开销。
// 崩溃安全：只内存不落盘时崩溃丢"本次会话增量"，启动时缺条目回退全容器扫描重建。
import type { DirectStore } from "./DirectStore";
import type { ContainerIndexEntry, IndexStore } from "../../core/storage/Stores";
import type { ContainerId } from "../../core/model/types";

const indexKey = (cid: ContainerId): string => `ir2:idx:${cid}`;

/**
 * 索引仓储：**每容器一条键** `ir2:idx:{cid}`（items + singleBinding，普通 DP 直存）。
 * 事件驱动、容器粒度写入（结构事件/卸载/离仓时落盘）；无 markDirty/flush/定时批量落盘。
 */
export class McIndexStore implements IndexStore {
  constructor(private readonly store: DirectStore) {}

  saveContainer(cid: ContainerId, entry: ContainerIndexEntry): void {
    this.store.write(indexKey(cid), entry);
  }

  loadContainer(cid: ContainerId): ContainerIndexEntry | undefined {
    return this.store.read<ContainerIndexEntry>(indexKey(cid));
  }

  removeContainer(cid: ContainerId): void {
    this.store.remove(indexKey(cid));
  }
}
