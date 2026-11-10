// ─── 整理服务：单容器整理（v1 smartwarehouse SlotOrganizer 语义） ──
// `organizeContainer(container)`：把一个容器的槽位**就地**整理——
//   取出全部物品 → 清空 → 按 typeId 排序 → 逐堆 addItem 重放。
//   合并权委托 `container.addItem`（生产 = mc.addItem，权威 NBT 级判定）：
//   概念层 ItemStack 不感知 NBT，同型不同 NBT 不可合并，故不在此层手动 merge，
//   由适配器裁决——这正是"不吞附魔/耐久"的保证（与路由 transfer 同源）。
//   结果：同型可堆叠合并、槽位按 typeId 有序 → 混乱度归零、堆叠数下降。
//
// 事件：整理成功发 organize-completed（汇总）+ container-changed（该容器，统计失效/成员通知）。
// **整理后不重建索引**：单容器就地重排不改变物品种类与总量，路由候选条目不变。
//
// TODO（跨容器整理，暂不实现）：未来可加"聚合/归并"——把散落在 misc/multi 里的同类物品
// 跨容器聚合（如 ir:consolidate 命令，或并入路由策略）。与单容器整理正交：单容器整理只重排
// 槽位不跨容器，聚合涉及跨容器搬移与索引/统计联动，需单独设计，早期不做。
import type { Organizer, MessinessScore } from "../organizing/Organizer";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ItemId } from "../model/types";
import type { ItemStack } from "../model/ItemStack";
import { scanContainer } from "../model/ContainerScan";
import type { MoveJournal } from "../routing/Move";
import type { EventBus } from "../events/DomainEvents";

/** 某物品种类的堆叠/数量汇总（perType 条目） */
export interface OrganizeTypeStat {
  stacks: number;
  total: number;
}

/** 单容器整理结果（v1 风格明细，供 OrganizeFormatter 展示） */
export interface OrganizeResult {
  ok: boolean;
  /** 合并的堆数（= beforeStacks - afterStacks） */
  moves: number;
  beforeStacks: number;
  afterStacks: number;
  beforeTypes: number;
  afterTypes: number;
  /** 容量（该容器） */
  totalSlots: number;
  /** 整理后占用槽位数 */
  usedSlots: number;
  /** 整理前混乱度分解（v1：order/stack） */
  messiness: MessinessScore;
  /** 整理后混乱度总分（整理后应 ≈0） */
  chaosAfter: number;
  /** 整理后每物品汇总（供 top-N 展示） */
  perType: Record<ItemId, OrganizeTypeStat>;
}

/**
 * 整理服务：**单容器就地整理**（v1 SlotOrganizer 语义）——取出全部物品 → 清空 →
 * 按 typeId 排序 → 逐堆重放（合并权委托适配器 addItem，概念层不感知 NBT）。不跨容器、不重建索引。
 * 结果：同型可堆叠合并、槽位有序、混乱度归零；重放失败用 MoveJournal 回滚保证数量守恒。
 * 触发点：/ir:organize、潜行右键、路由自动整理（container-scanned 订阅）。整理后发 container-changed。
 */
export class OrganizeService {
  constructor(
    private readonly organizer: Organizer,
    private readonly bus: EventBus
  ) {}

  /** 单容器整理（就地排序 + 合并可堆叠堆）；warehouse 仅供事件定位 */
  organizeContainer(warehouse: Warehouse, container: Container, journal: MoveJournal): OrganizeResult {
    const { result, didWork } = this.runOrganize(container, journal);
    // 仅"实际清空+重放"的整理发事件（空/已整齐的 no-op 不打扰下游，与 v1 onDeposit 一致）
    if (didWork && result.ok) {
      this.bus.organizeCompleted.trigger({
        type: "organize-completed",
        warehouseId: warehouse.id,
        moves: result.moves,
      });
      this.bus.containerChanged.trigger({
        type: "container-changed",
        warehouseId: warehouse.id,
        containerId: container.id,
      });
    }
    return result;
  }

  /**
   * 独立整理（不关联仓库、不发领域事件）：对任意满足 core Container 契约的对象就地整理，
   * 返回与 organizeContainer 相同的 OrganizeResult。用于**玩家背包整理**（PlayerInventoryContainer
   * 包装背包槽位，见 mc/adapters/PlayerInventoryContainer.ts）——背包不属于任何仓库，不该触发
   * 容器统计/索引事件。
   */
  organizeStandalone(container: Container, journal: MoveJournal): OrganizeResult {
    return this.runOrganize(container, journal).result;
  }

  /**
   * 整理核心：取出全部物品 → 清空 → 按 typeId 排序 → 逐堆 addItem 重放（合并权委托适配器，
   * 概念层不感知 NBT）。返回结果 + 是否实际执行了"清空+重放"（didWork=false = 空/已整齐 no-op）。
   * 写失败/数量不守恒 → MoveJournal 回滚（不吞物不复制）。
   */
  private runOrganize(container: Container, journal: MoveJournal): { result: OrganizeResult; didWork: boolean } {
    // 取出全部物品 + 整理前统计（保留 ItemStack 引用，重放时经适配器保 NBT）
    const items: ItemStack[] = [];
    const beforeByType: Record<ItemId, OrganizeTypeStat> = {};
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item === undefined) continue;
      items.push(item);
      const stat = beforeByType[item.itemId] ?? { stacks: 0, total: 0 };
      stat.stacks++;
      stat.total += item.amount;
      beforeByType[item.itemId] = stat;
    }
    const beforeStacks = items.length;
    const beforeTypes = Object.keys(beforeByType).length;
    const messiness = this.organizer.messiness(container);
    const tidy = (): OrganizeResult => ({
      ok: true,
      moves: 0,
      beforeStacks,
      afterStacks: beforeStacks,
      beforeTypes,
      afterTypes: beforeTypes,
      totalSlots: container.capacity,
      usedSlots: beforeStacks,
      messiness,
      chaosAfter: messiness.total,
      perType: beforeByType,
    });
    // 空 / **完全归零**（messiness === 0，而非 < 0.05）→ 无需整理（didWork=false，不发事件）。
    // 手动整理是**强制整理**：无视任何非 0 混乱度（低混乱度也照样清空重排），只有归 0 才算整齐。
    // ⚠️ 单物品也不算"无需整理"：若空槽前置导致混乱度>0（如 [空,钻石,空]），应整理把物品归到首位
    // （`beforeStacks<=1` 短路会让混乱度恒不为 0 的单物品容器永不整理——item 单物品整理修复）。
    if (messiness.total === 0) return { result: tidy(), didWork: false };

    const beforeTotal = items.reduce((s, i) => s + i.amount, 0);

    // 清空 + 按 typeId 排序重放（addItem 权威合并）
    journal.snapshot(container);
    for (let i = 0; i < container.capacity; i++) container.setItem(i, undefined);
    // 清空校验：适配器 setItem 失败会静默吞掉，若未清干净则回滚，避免重放时重复物品
    for (let i = 0; i < container.capacity; i++) {
      if (container.getItem(i) !== undefined) {
        journal.rollback();
        return { result: { ...tidy(), ok: false }, didWork: true };
      }
    }
    items.sort((a, b) => a.itemId.localeCompare(b.itemId));
    for (const item of items) {
      const remaining = container.addItem(item);
      if (remaining !== undefined) {
        journal.rollback(); // 放不下（适配器异常等）→ 恢复整理前
        return { result: { ...tidy(), ok: false }, didWork: true };
      }
    }

    // 整理后统计（单容器重扫成本可忽略）
    const afterScan = scanContainer(container);
    // 数量守恒校验：清空+重放不得丢失/重复（v1 checksum 思想），不一致即回滚
    const afterTotal = afterScan.items.reduce((s, i) => s + i.amount, 0);
    if (afterTotal !== beforeTotal) {
      journal.rollback();
      return { result: { ...tidy(), ok: false }, didWork: true };
    }
    const afterByType: Record<ItemId, OrganizeTypeStat> = {};
    for (const item of afterScan.items) {
      const stat = afterByType[item.itemId] ?? { stacks: 0, total: 0 };
      stat.stacks++;
      stat.total += item.amount;
      afterByType[item.itemId] = stat;
    }
    const chaosAfter = this.organizer.messinessFromScan(afterScan).total;
    const afterStacks = afterScan.usedSlots;
    return {
      didWork: true,
      result: {
        ok: true,
        moves: beforeStacks - afterStacks,
        beforeStacks,
        afterStacks,
        beforeTypes,
        afterTypes: Object.keys(afterByType).length,
        totalSlots: container.capacity,
        usedSlots: afterStacks,
        messiness,
        chaosAfter,
        perType: afterByType,
      },
    };
  }
}
