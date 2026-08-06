// ─── 统计仓储：**每容器一条**普通 DP 直存 ──
// 统计按**容器 ID** 分键：`ir2:cst:{containerId}`（容器 ID 全局唯一 `c@(x,y,z)@维度`，
// 无需仓库前缀；仓库 resize 不改变容器 ID → 统计键无需迁移）。
// 单容器统计是小值（聚合数字 + byType 计数），直接用 **DirectStore**（普通 DP 单键），
// 不经 ShardStore 分包/hash/世代——读写更快、键更少。
import type { DirectStore } from "./DirectStore";
import type { ContainerStatsData, StatsStore } from "../../core/storage/Stores";
import type { ContainerId } from "../../core/model/types";

const cstatsKey = (containerId: ContainerId): string => `ir2:cst:${containerId}`;

/**
 * 统计仓储：**每容器一条键** `ir2:cst:{containerId}`（普通 DP 直存，无分片）。
 * 对齐注册表（ir2:c:{cid}）/索引（ir2:idx:{cid}）的"每容器一单位"风格，事件驱动单容器写穿。
 */
export class McStatsStore implements StatsStore {
  constructor(private readonly store: DirectStore) {}

  loadContainer(containerId: ContainerId): ContainerStatsData | undefined {
    return this.store.read<ContainerStatsData>(cstatsKey(containerId));
  }

  saveContainer(containerId: ContainerId, stats: ContainerStatsData): boolean {
    this.store.write(cstatsKey(containerId), stats);
    return true;
  }

  removeContainer(containerId: ContainerId): void {
    this.store.remove(cstatsKey(containerId));
  }
}
