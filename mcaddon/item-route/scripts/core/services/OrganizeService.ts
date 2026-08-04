// ─── 整理服务：分析/执行/索引联动 ─────────────────────────
import type { Organizer } from "../organizing/Organizer";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { MoveJournal } from "../routing/Move";
import type { EventBus } from "../events/DomainEvents";

export class OrganizeService {
  constructor(
    private readonly organizer: Organizer,
    private readonly index: { onContainerChanged(container: Container): void },
    private readonly bus: EventBus
  ) {}

  /** 执行整理：analyze + apply；成功后对涉及容器更新索引 */
  organize(warehouse: Warehouse, journal: MoveJournal): boolean {
    const plan = this.organizer.analyze(warehouse);
    if (plan.actions.length === 0) return true;
    const ok = this.organizer.apply(warehouse, plan, journal);
    if (!ok) return false;
    const touched = new Set<string>();
    for (const action of plan.actions) {
      touched.add(action.from);
      touched.add(action.to);
    }
    for (const id of touched) {
      const container = warehouse.containers.get(id);
      if (container) this.index.onContainerChanged(container);
    }
    return true;
  }
}