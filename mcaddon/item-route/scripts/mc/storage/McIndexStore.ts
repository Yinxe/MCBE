// ─── 索引仓储：**每容器一条键**（事件驱动，无定时 flush） ──
// 索引本为"路由加速"派生缓存（权威源 = 容器内容），持久化仅为重载加速，非崩溃关键。
// 存储改为**每容器一条** `ir2:idx:{cid}`（items + singleBinding），对齐容器注册表
// `ir2:c:{cid}` / 统计 `ir2:cst:{cid}` 的"每容器一单位"风格：
//   · 写入时机（mc 层）/容器粒度事件驱动——结构事件（容器增删/角色/优先级）只写该容器，
//     卸载/离仓/删仓时写全部容器；itemRouted 只更新内存不落盘（重载后惰性自愈）。
//   · 无 markDirty / flush / 定时批量落盘。
// 崩溃安全：只内存不落盘时崩溃丢"本次会话增量"，启动时缺条目回退全容器扫描重建，
// 候选过期由策略侧 reconcile 惰性兜底——不产生持久损坏。
import type { ShardStore } from "./ShardStore";
import type { ContainerIndexEntry, IndexStore } from "../../core/storage/Stores";
import type { ContainerId } from "../../core/model/types";

const indexKey = (cid: ContainerId): string => `ir2:idx:${cid}`;

/**
 * 索引仓储：**每容器一条键** `ir2:idx:{cid}`（items + singleBinding）。事件驱动、容器粒度写入
 * （结构事件/卸载/离仓时落盘），对齐注册表/统计风格；无 markDirty/flush/定时批量落盘。
 */
export class McIndexStore implements IndexStore {
  constructor(private readonly shards: ShardStore) {}

  saveContainer(cid: ContainerId, entry: ContainerIndexEntry): void {
    this.shards.write(indexKey(cid), entry, "overwrite");
  }

  loadContainer(cid: ContainerId): ContainerIndexEntry | undefined {
    return this.shards.read<ContainerIndexEntry>(indexKey(cid));
  }

  removeContainer(cid: ContainerId): void {
    this.shards.remove(indexKey(cid));
  }
}
