// ─── 整理服务：分析/执行/索引联动 ─────────────────────────
// 封装 Organizer 的 analyze+apply，并在成功后对**涉及容器**重建索引
// （onContainerChanged 全量重算受影响容器）——保证整理后的索引与真实内容一致。
// 索引按仓库解析（`resolveIndex(warehouse)`），配合"每仓库独立索引"的隔离：
// 未加载（仓库未激活）时跳过索引更新，由三层兜底在下次加载时自愈。
import type { Organizer } from "../organizing/Organizer";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { MoveJournal } from "../routing/Move";
import type { EventBus } from "../events/DomainEvents";

export class OrganizeService {
  constructor(
    private readonly organizer: Organizer,
    private readonly resolveIndex: (warehouse: Warehouse) => { onContainerChanged(container: Container): void } | undefined,
    private readonly bus: EventBus
  ) {}

  /** 执行整理：analyze + apply；成功后对涉及容器更新索引（该仓库自己的索引） */
  organize(warehouse: Warehouse, journal: MoveJournal): boolean {
    const plan = this.organizer.analyze(warehouse);
    if (plan.actions.length === 0) return true;
    const ok = this.organizer.apply(warehouse, plan, journal);
    if (!ok) return false;
    const index = this.resolveIndex(warehouse);
    if (index === undefined) return true;
    const touched = new Set<string>();
    for (const action of plan.actions) {
      touched.add(action.from);
      touched.add(action.to);
    }
    for (const id of touched) {
      const container = warehouse.containers.get(id);
      if (container) index.onContainerChanged(container);
    }
    return true;
  }
}