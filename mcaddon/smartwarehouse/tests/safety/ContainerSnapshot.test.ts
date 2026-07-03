import type { Container } from "@minecraft/server";
import { snapshotContainer, restoreContainerSnapshot } from "../../scripts/sorting/ContainerSnapshot";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 将 MockContainer 类型安全地转换为 @minecraft/server.Container */
function asContainer(container: MockContainer): Container {
  return container as unknown as Container;
}

export function runContainerSnapshotTests(): void {
  // ── Happy path ──────────────────────────────────────────────────
  {
    const container = new MockContainer(3, [new MockItemStack("minecraft:stone", 12), undefined, undefined]);
    const snapshot = snapshotContainer(asContainer(container));

    container.setItem(0, undefined);
    container.setItem(1, new MockItemStack("minecraft:dirt", 4));

    const restored = restoreContainerSnapshot(asContainer(container), snapshot);

    assert(restored.ok, `restore failed: ${restored.error ?? "unknown"}`);
    assert(container.getItem(0)?.typeId === "minecraft:stone", "slot 0 type should be restored");
    assert(container.getItem(0)?.amount === 12, "slot 0 amount should be restored");
    assert(container.getItem(1) === undefined, "slot 1 should be restored to empty");
  }

  // ── Failure path: setItem throws on slot 0, later slots still attempted ──
  {
    const container = new MockContainer(3, [
      new MockItemStack("minecraft:stone", 12),
      new MockItemStack("minecraft:dirt", 5),
      undefined,
    ]);
    const snapshot = snapshotContainer(asContainer(container));

    // Change all slots to something else before restore
    container.setItem(0, new MockItemStack("minecraft:diamond", 7));
    container.setItem(1, new MockItemStack("minecraft:diamond", 1));
    container.setItem(2, new MockItemStack("minecraft:diamond", 2));

    // Make only slot 0 fail
    container.failSetSlots.add(0);

    const result = restoreContainerSnapshot(asContainer(container), snapshot);

    assert(!result.ok, "restore should report failure when setItem throws on slot 0");
    assert(result.error?.includes("槽位 0") ?? false, `error should mention slot 0: ${result.error}`);

    // Slot 0 still has the post-change diamond because setItem threw
    assert(
      container.getItem(0)?.typeId === "minecraft:diamond" && container.getItem(0)?.amount === 7,
      "slot 0 should be unchanged because setItem threw"
    );

    // Slot 1 and slot 2 should have been restored even though slot 0 failed
    assert(
      container.getItem(1)?.typeId === "minecraft:dirt" && container.getItem(1)?.amount === 5,
      "slot 1 should still be restored despite slot 0 failure"
    );
    assert(container.getItem(2) === undefined, "slot 2 should still be restored to empty despite slot 0 failure");
  }

  // ── Failure path: multiple slots fail, all errors collected ─────
  {
    const container = new MockContainer(3, [
      new MockItemStack("minecraft:stone", 1),
      new MockItemStack("minecraft:stone", 2),
      new MockItemStack("minecraft:stone", 3),
    ]);
    const snapshot = snapshotContainer(asContainer(container));

    container.failSetSlots.add(0);
    container.failSetSlots.add(2);

    const result = restoreContainerSnapshot(asContainer(container), snapshot);

    assert(!result.ok, "restore should fail when any setItem throws");
    assert(result.error?.includes("槽位 0") ?? false, `error should mention slot 0: ${result.error}`);
    assert(result.error?.includes("槽位 2") ?? false, `error should mention slot 2: ${result.error}`);

    // Slot 1 should have been restored (only slots 0 and 2 failed)
    assert(
      container.getItem(1)?.typeId === "minecraft:stone" && container.getItem(1)?.amount === 2,
      "slot 1 should be restored despite failures on slots 0 and 2"
    );
  }

  // ── addItem does not mutate original MockItemStack ──────────────
  {
    const originalItem = new MockItemStack("minecraft:stone", 10);
    const container = new MockContainer(5, [originalItem]);

    // Add more stone — should not mutate originalItem
    container.addItem(new MockItemStack("minecraft:stone", 5));

    assert(originalItem.amount === 10, `original item amount should remain 10, got ${originalItem.amount}`);
  }
}
