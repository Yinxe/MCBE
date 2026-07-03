import type { Container } from "@minecraft/server";
import { MoveJournal } from "../../scripts/sorting/MoveJournal";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 将 MockContainer 类型安全地转换为 @minecraft/server.Container */
function asContainer(container: MockContainer): Container {
  return container as unknown as Container;
}

export function runMoveJournalTests(): void {
  // ── Happy path: single target rollback ───────────────────────────
  {
    const target = new MockContainer(2, [new MockItemStack("minecraft:stone", 60), undefined]);
    const journal = new MoveJournal();

    journal.snapshotTarget("target-1", asContainer(target));
    target.addItem(new MockItemStack("minecraft:stone", 8));

    const rollback = journal.rollback();

    assert(rollback.ok, `rollback failed: ${rollback.error ?? "unknown"}`);
    assert(target.getItem(0)?.amount === 60, "slot 0 amount should roll back");
    assert(target.getItem(1) === undefined, "slot 1 should roll back to empty");
  }

  // ── Empty journal rollback ──────────────────────────────────────
  {
    const journal = new MoveJournal();
    const rollback = journal.rollback();
    assert(rollback.ok, "empty journal rollback should succeed");
  }

  // ── Multiple targets rollback ───────────────────────────────────
  {
    const t1 = new MockContainer(1, [new MockItemStack("minecraft:stone", 10)]);
    const t2 = new MockContainer(1, [new MockItemStack("minecraft:dirt", 20)]);
    const journal = new MoveJournal();

    journal.snapshotTarget("target-1", asContainer(t1));
    journal.snapshotTarget("target-2", asContainer(t2));

    t1.setItem(0, new MockItemStack("minecraft:diamond", 5));
    t2.setItem(0, new MockItemStack("minecraft:diamond", 8));

    const rollback = journal.rollback();

    assert(rollback.ok, `multi-target rollback failed: ${rollback.error ?? "unknown"}`);
    assert(t1.getItem(0)?.typeId === "minecraft:stone", "t1 slot 0 type should restore");
    assert(t1.getItem(0)?.amount === 10, "t1 slot 0 amount should restore");
    assert(t2.getItem(0)?.typeId === "minecraft:dirt", "t2 slot 0 type should restore");
    assert(t2.getItem(0)?.amount === 20, "t2 slot 0 amount should restore");
  }

  // ── Duplicate snapshotTarget uses first snapshot only ───────────
  {
    const target = new MockContainer(1, [new MockItemStack("minecraft:stone", 5)]);
    const journal = new MoveJournal();

    // First snapshot captures stone=5
    journal.snapshotTarget("dup-target", asContainer(target));
    target.setItem(0, new MockItemStack("minecraft:iron", 10));
    // Second snapshotTarget call on same id should be ignored
    journal.snapshotTarget("dup-target", asContainer(target));

    // Now modify to something else
    target.setItem(0, new MockItemStack("minecraft:diamond", 3));

    const rollback = journal.rollback();
    assert(rollback.ok, `dup-rollback failed: ${rollback.error ?? "unknown"}`);
    // Should restore to stone=5 (first snapshot), not iron=10
    assert(
      target.getItem(0)?.typeId === "minecraft:stone" && target.getItem(0)?.amount === 5,
      `expected stone 5, got ${target.getItem(0)?.typeId} ${target.getItem(0)?.amount}`
    );
  }

  // ── Rollback failure includes container id ──────────────────────
  {
    const container = new MockContainer(1, [new MockItemStack("minecraft:stone", 1)]);
    container.failSetSlots.add(0);
    const journal = new MoveJournal();

    journal.snapshotTarget("my-broken-container", asContainer(container));

    const rollback = journal.rollback();
    assert(!rollback.ok, "rollback should fail when setItem throws");
    assert(
      rollback.error?.includes("my-broken-container") ?? false,
      `error should include container id: ${rollback.error}`
    );
  }

  // ── Multi-target: one target fails, others still restore ────────
  {
    const failContainer = new MockContainer(1, [new MockItemStack("minecraft:stone", 10)]);
    const goodContainer = new MockContainer(1, [new MockItemStack("minecraft:dirt", 20)]);

    const journal = new MoveJournal();

    journal.snapshotTarget("failing-one", asContainer(failContainer));
    journal.snapshotTarget("good-one", asContainer(goodContainer));

    // Modify contents after snapshot (no fail slots active yet)
    failContainer.setItem(0, new MockItemStack("minecraft:diamond", 100));
    goodContainer.setItem(0, new MockItemStack("minecraft:diamond", 200));

    // Now enable failure so rollback restore triggers it
    failContainer.failSetSlots.add(0);

    const rollback = journal.rollback();

    assert(!rollback.ok, "rollback should fail when one target fails");
    assert(
      rollback.error?.includes("failing-one") ?? false,
      `error should mention failing container: ${rollback.error}`
    );
    // good-one should still be restored despite failing-one failure
    assert(
      goodContainer.getItem(0)?.typeId === "minecraft:dirt" && goodContainer.getItem(0)?.amount === 20,
      `good container should restore despite failure: ${goodContainer.getItem(0)?.typeId} ${goodContainer.getItem(0)?.amount}`
    );
  }
}
