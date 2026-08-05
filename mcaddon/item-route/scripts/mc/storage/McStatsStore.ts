// ─── 统计仓储：每容器一条（v1 方案，overwrite + hash） ──
// 统计按**容器 ID** 分键：`ir2:cst:{containerId}`（容器 ID 全局唯一 `c@(x,y,z)@维度`，
// 无需仓库前缀；仓库 resize 不改变容器 ID → 统计键无需迁移）。
// overwrite 单键覆盖即可（快照小、聚合数字）；写后验由 ShardStore 兜底。
import type { ShardStore } from "./ShardStore";
import type { ContainerStatsData, StatsStore } from "../../core/storage/Stores";
import type { ContainerId } from "../../core/model/types";

const cstatsKey = (containerId: ContainerId): string => `ir2:cst:${containerId}`;

export class McStatsStore implements StatsStore {
  constructor(private readonly shards: ShardStore) {}

  loadContainer(containerId: ContainerId): ContainerStatsData | undefined {
    return this.shards.read<ContainerStatsData>(cstatsKey(containerId));
  }

  saveContainer(containerId: ContainerId, stats: ContainerStatsData): boolean {
    return this.shards.write(cstatsKey(containerId), stats, "overwrite");
  }

  removeContainer(containerId: ContainerId): void {
    this.shards.remove(cstatsKey(containerId));
  }
}
