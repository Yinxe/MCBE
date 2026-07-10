import type { Container } from "@minecraft/server";
import { restoreContainerSnapshot, snapshotContainer } from "../../scripts/sorting/ContainerSnapshot";
import { SlotOrganizer } from "../../scripts/sorting/SlotOrganizer";
import type { ContainerAnalysis } from "../../scripts/sorting/SlotOrganizer";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 将 MockContainer 类型安全地转换为 @minecraft/server.Container */
function asContainer(container: MockContainer): Container {
  return container as unknown as Container;
}

export function runSlotOrganizerRollbackTests(): void {
  // ── Snapshot restore after simulated write failure ──────────────
  {
    const container = new MockContainer(2, [
      new MockItemStack("minecraft:b", 1),
      new MockItemStack("minecraft:a", 1),
    ]);
    const snapshot = snapshotContainer(asContainer(container));
    container.failSetSlots.add(1);

    try {
      container.setItem(0, new MockItemStack("minecraft:a", 1));
      container.setItem(1, new MockItemStack("minecraft:b", 1));
    } catch {
      container.failSetSlots.clear();
      const restored = restoreContainerSnapshot(asContainer(container), snapshot);
      assert(restored.ok, "restore should succeed after write failure");
    }

    assert(container.getItem(0)?.typeId === "minecraft:b", "slot 0 should be original item");
    assert(container.getItem(0)?.amount === 1, "slot 0 amount should be original");
    assert(container.getItem(1)?.typeId === "minecraft:a", "slot 1 should be original item");
    assert(container.getItem(1)?.amount === 1, "slot 1 amount should be original");
  }

  // ── Snapshot restore after partial write success ────────────────
  {
    const container = new MockContainer(3, [
      new MockItemStack("minecraft:c", 1),
      new MockItemStack("minecraft:b", 1),
      new MockItemStack("minecraft:a", 1),
    ]);
    const snapshot = snapshotContainer(asContainer(container));
    // Slot 2 will fail when written to
    container.failSetSlots.add(2);

    try {
      container.setItem(0, new MockItemStack("minecraft:a", 1));
      container.setItem(1, new MockItemStack("minecraft:b", 1));
      container.setItem(2, new MockItemStack("minecraft:c", 1)); // this fails
    } catch {
      container.failSetSlots.clear();
      const restored = restoreContainerSnapshot(asContainer(container), snapshot);
      assert(restored.ok, "restore should succeed after partial write failure");
    }

    // All slots should be restored to original
    assert(container.getItem(0)?.typeId === "minecraft:c", "slot 0 should be original item");
    assert(container.getItem(1)?.typeId === "minecraft:b", "slot 1 should be original item");
    assert(container.getItem(2)?.typeId === "minecraft:a", "slot 2 should be original item");
  }

  // ── Snapshot handles range bounds correctly ─────────────────────
  {
    const container = new MockContainer(4, [
      new MockItemStack("minecraft:d", 1),
      new MockItemStack("minecraft:c", 1),
      new MockItemStack("minecraft:b", 1),
      new MockItemStack("minecraft:a", 1),
    ]);
    // Only snapshot slots 1-3 (excluding slot 0)
    const snapshot = snapshotContainer(asContainer(container), 1, 3);
    container.failSetSlots.add(2);

    try {
      container.setItem(1, new MockItemStack("minecraft:b", 1));
      container.setItem(2, new MockItemStack("minecraft:a", 1)); // this fails
    } catch {
      container.failSetSlots.clear();
      const restored = restoreContainerSnapshot(asContainer(container), snapshot);
      assert(restored.ok, "restore should succeed for bounded range");
    }

    // Slot 0 should be unchanged (not in snapshot)
    assert(container.getItem(0)?.typeId === "minecraft:d", "slot 0 should be unchanged");
    // Slots 1-2 should be restored
    assert(container.getItem(1)?.typeId === "minecraft:c", "slot 1 should be restored");
    assert(container.getItem(2)?.typeId === "minecraft:b", "slot 2 should be restored");
  }

  // ── SlotOrganizer.apply() rollback on write failure ────────────
  {
    const container = new MockContainer(2, [
      new MockItemStack("minecraft:b", 1),
      new MockItemStack("minecraft:a", 1),
    ]);

    const analysis = {
      rawItems: [new MockItemStack("minecraft:b", 1), new MockItemStack("minecraft:a", 1)],
      sortedItems: [new MockItemStack("minecraft:a", 1), new MockItemStack("minecraft:b", 1)],
      occupiedSlots: new Set([0, 1]),
      startSlot: 0,
      endSlot: 2,
      checksum: new Map([
        ["minecraft:a", { stacks: 1, total: 1 }],
        ["minecraft:b", { stacks: 1, total: 1 }],
      ]),
      messiness: {
        total: 0.5, order: 0.35, stack: 0.15,
        effectiveSlots: 2, disorderSlots: 1, nonEmptySlots: 2, suboptimalStacks: 0,
      },
    } as unknown as ContainerAnalysis;

    // Slot 1 will fail during apply() write — slot 0 writes before it should succeed
    container.failSetSlots.add(1);

    const org = new SlotOrganizer();
    const result = org.apply(asContainer(container), analysis);

    assert(result.success === false, "apply should return failure when a write fails");
    assert(
      result.error?.includes("回滚") ?? result.error?.includes("rollback") ?? false,
      `error should mention rollback, got: ${result.error}`
    );

    // Container should be fully restored to original state
    assert(container.getItem(0)?.typeId === "minecraft:b", "slot 0 should be restored to original item");
    assert(container.getItem(0)?.amount === 1, "slot 0 amount should be original");
    assert(container.getItem(1)?.typeId === "minecraft:a", "slot 1 should be restored to original item");
    assert(container.getItem(1)?.amount === 1, "slot 1 amount should be original");
  }
}
