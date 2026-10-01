# SmartWarehouse Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce item loss/duplication risk in double-chest scanning, item transfers, and automatic slot organizing while keeping the existing SmartWarehouse architecture intact.

**Architecture:** Add small, focused safety helpers around the existing risky operations instead of rewriting the sorter. `SafeProbe` owns temporary container probing, `MoveJournal` owns in-memory rollback for one sorter tick, and `SlotOrganizer` gains snapshot/rollback around its write phase. `sw:rescan` remains the existing direct rescan command; this plan adds a preview/repair path rather than replacing it.

**Tech Stack:** TypeScript strict mode, Minecraft Bedrock Script API `@minecraft/server` 2.6, just-scripts build/lint, lightweight pure TypeScript test harness for mock container behavior.

---

## File Structure

- Create: `scripts/sorting/ContainerSnapshot.ts`  
  Owns clone-based slot snapshots, restore helpers, and equality checks for `ItemStack` snapshots.
- Create: `scripts/warehouse/SafeProbe.ts`  
  Owns double-chest temporary probe logic. It uses the existing probe approach but chooses safer slots, clones originals, restores in `finally`, and reports whether restore verification passed.
- Create: `scripts/sorting/MoveJournal.ts`  
  Owns short-lived, in-memory transaction snapshots for target containers touched by one input-slot transfer.
- Modify: `scripts/warehouse/ContainerScanner.ts`  
  Delegates probe-based double-chest detection to `SafeProbe`.
- Modify: `scripts/sorting/ContainerInventory.ts`  
  Adds a journal-aware transfer helper that snapshots a target container before `addItem()`.
- Modify: `scripts/sorting/SorterEngine.ts`  
  Wraps each input-slot move in `MoveJournal`; if input-slot commit fails, rollback targets and disable/skip warehouse on unrecoverable failure.
- Modify: `scripts/sorting/SlotOrganizer.ts`  
  Snapshots the target range before rewriting slots and restores it if any write fails.
- Modify: `scripts/commands/CommandRouter.ts`  
  Adds preview/repair command handling for rescan if command registration structure supports optional variants cleanly.
- Modify: `scripts/warehouse/WarehouseService.ts`  
  Adds rescan diff calculation and safe apply helpers.
- Create: `scripts/warehouse/WarehouseRescanDiff.ts`  
  Owns comparison between current records and freshly scanned records.
- Create: `tests/safety/MockContainer.ts`  
  Minimal pure TypeScript mock for container get/set/add behavior.
- Create: `tests/safety/MoveJournal.test.ts`  
  Tests rollback behavior without Minecraft runtime.
- Create: `tests/safety/SlotOrganizer.test.ts`  
  Tests organizer restores snapshots on simulated write failure.
- Create: `tests/run-safety-tests.mjs`  
  Compiles and runs safety tests using the project TypeScript compiler.
- Modify: `package.json`  
  Adds `test:safety` script.

## Task 1: Add Clone-Based Container Snapshots

**Files:**
- Create: `scripts/sorting/ContainerSnapshot.ts`
- Create: `tests/safety/MockContainer.ts`
- Create: `tests/run-safety-tests.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the failing snapshot test**

Create `tests/safety/ContainerSnapshot.test.ts` with this content:

```typescript
import { snapshotContainer, restoreContainerSnapshot } from "../../scripts/sorting/ContainerSnapshot";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runContainerSnapshotTests(): void {
  const container = new MockContainer(3, [new MockItemStack("minecraft:stone", 12), undefined, undefined]);
  const snapshot = snapshotContainer(container as any);

  container.setItem(0, undefined);
  container.setItem(1, new MockItemStack("minecraft:dirt", 4) as any);

  const restored = restoreContainerSnapshot(container as any, snapshot);

  assert(restored.ok, `restore failed: ${restored.error ?? "unknown"}`);
  assert(container.getItem(0)?.typeId === "minecraft:stone", "slot 0 type should be restored");
  assert(container.getItem(0)?.amount === 12, "slot 0 amount should be restored");
  assert(container.getItem(1) === undefined, "slot 1 should be restored to empty");
}
```

- [ ] **Step 2: Add the test runner and mock container**

Create `tests/safety/MockContainer.ts`:

```typescript
export class MockItemStack {
  readonly maxAmount = 64;

  constructor(
    readonly typeId: string,
    public amount: number
  ) {}

  clone(): MockItemStack {
    return new MockItemStack(this.typeId, this.amount);
  }

  isStackableWith(other: MockItemStack): boolean {
    return this.typeId === other.typeId;
  }
}

export class MockContainer {
  failSetSlots = new Set<number>();

  constructor(
    readonly size: number,
    private readonly slots: (MockItemStack | undefined)[] = []
  ) {
    while (this.slots.length < size) this.slots.push(undefined);
  }

  getItem(slot: number): MockItemStack | undefined {
    return this.slots[slot]?.clone();
  }

  setItem(slot: number, item?: MockItemStack): void {
    if (this.failSetSlots.has(slot)) throw new Error(`setItem failed at slot ${slot}`);
    this.slots[slot] = item?.clone();
  }

  addItem(item: MockItemStack): MockItemStack | undefined {
    let remaining = item.amount;
    for (let slot = 0; slot < this.size; slot++) {
      const existing = this.slots[slot];
      if (!existing || existing.typeId !== item.typeId || existing.amount >= existing.maxAmount) continue;
      const moved = Math.min(remaining, existing.maxAmount - existing.amount);
      existing.amount += moved;
      remaining -= moved;
      if (remaining === 0) return undefined;
    }
    for (let slot = 0; slot < this.size; slot++) {
      if (this.slots[slot]) continue;
      const moved = Math.min(remaining, item.maxAmount);
      this.slots[slot] = new MockItemStack(item.typeId, moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }
    return new MockItemStack(item.typeId, remaining);
  }
}
```

Create `tests/run-safety-tests.mjs`:

```javascript
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

if (!existsSync("tmp/safety-tests")) mkdirSync("tmp/safety-tests", { recursive: true });

execSync(
  "npx tsc --target ES2020 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --outDir tmp/safety-tests tests/safety/*.ts scripts/sorting/ContainerSnapshot.ts",
  { stdio: "inherit" }
);

const { runContainerSnapshotTests } = await import("../tmp/safety-tests/tests/safety/ContainerSnapshot.test.js");
runContainerSnapshotTests();
console.log("safety tests passed");
```

Modify `package.json` scripts:

```json
"test:safety": "node tests/run-safety-tests.mjs"
```

- [ ] **Step 3: Run the test and verify it fails because the snapshot module does not exist**

Run: `npm run test:safety`

Expected: TypeScript reports it cannot find `../../scripts/sorting/ContainerSnapshot`.

- [ ] **Step 4: Implement `ContainerSnapshot`**

Create `scripts/sorting/ContainerSnapshot.ts`:

```typescript
import type { Container, ItemStack } from "@minecraft/server";

export interface SlotSnapshot {
  slot: number;
  item?: ItemStack;
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * 克隆容器指定槽位范围的当前物品状态。
 *
 * @param container - 目标容器
 * @param startSlot - 起始槽位，默认 0
 * @param endSlot - 结束槽位（不含），默认容器大小
 * @returns 可用于回滚的槽位快照
 */
export function snapshotContainer(container: Container, startSlot = 0, endSlot = container.size): SlotSnapshot[] {
  const result: SlotSnapshot[] = [];
  const end = Math.min(endSlot, container.size);
  for (let slot = Math.max(0, startSlot); slot < end; slot++) {
    const item = container.getItem(slot);
    result.push({ slot, item: item?.clone() });
  }
  return result;
}

/**
 * 将容器恢复到给定快照。
 *
 * @param container - 目标容器
 * @param snapshot - 之前通过 snapshotContainer 创建的快照
 * @returns 恢复是否成功
 */
export function restoreContainerSnapshot(container: Container, snapshot: SlotSnapshot[]): RestoreResult {
  for (const entry of snapshot) {
    try {
      container.setItem(entry.slot, entry.item?.clone());
    } catch (error) {
      return { ok: false, error: `槽位 ${entry.slot} 恢复失败: ${error}` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm run test:safety`

Expected: `safety tests passed`.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: TypeScript and bundle complete successfully.

## Task 2: Encapsulate Double-Chest Probe Safety

**Files:**
- Create: `scripts/warehouse/SafeProbe.ts`
- Modify: `scripts/warehouse/ContainerScanner.ts`

- [ ] **Step 1: Create `SafeProbe`**

Create `scripts/warehouse/SafeProbe.ts`:

```typescript
import { ItemStack, type Block, type Dimension } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { hasInventory } from "./ContainerTypes";

const PROBE_ID = "minecraft:structure_void";
const NEIGHBOR_OFFSETS: BlockLocation[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function tryGetBlock(dimension: Dimension, location: BlockLocation): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

function sameStack(a: import("@minecraft/server").ItemStack | undefined, b: import("@minecraft/server").ItemStack | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.typeId === b.typeId && a.amount === b.amount;
}

/**
 * 使用临时探针安全识别双箱另一半。
 *
 * 探针会优先写入空槽，失败或恢复校验失败时返回 undefined。
 * @param dimension - 目标维度
 * @param location - 当前箱子位置
 * @param block - 当前箱子方块
 * @returns 另一半箱子坐标；无法确认时返回 undefined
 */
export function probeDoubleChestSafely(
  dimension: Dimension,
  location: BlockLocation,
  block: Block
): BlockLocation | undefined {
  const container = block.getComponent("inventory")?.container;
  if (!container) return undefined;

  let probeSlot = container.size - 1;
  for (let slot = 0; slot < container.size; slot++) {
    if (!container.getItem(slot)) {
      probeSlot = slot;
      break;
    }
  }

  const original = container.getItem(probeSlot)?.clone();
  const probe = new ItemStack(PROBE_ID, 1);
  let found: BlockLocation | undefined;

  try {
    container.setItem(probeSlot, probe);
    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborLocation = { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
      const neighbor = tryGetBlock(dimension, neighborLocation);
      if (!neighbor || neighbor.typeId !== block.typeId || !hasInventory(neighbor)) continue;
      const neighborContainer = neighbor.getComponent("inventory")?.container;
      if (neighborContainer?.getItem(probeSlot)?.typeId === PROBE_ID) {
        found = neighborLocation;
        break;
      }
    }
  } catch {
    return undefined;
  } finally {
    try {
      container.setItem(probeSlot, original);
      const restored = container.getItem(probeSlot);
      if (!sameStack(restored, original)) return undefined;
    } catch {
      return undefined;
    }
  }

  return found;
}
```

- [ ] **Step 2: Replace probe logic in `ContainerScanner`**

Modify `scripts/warehouse/ContainerScanner.ts`:

```typescript
import { probeDoubleChestSafely } from "./SafeProbe";
```

Remove the local `PROBE_ID`, `NEIGHBOR_OFFSETS`, and `probeDoubleChest()` implementation. In `getOccupiedLocations()`, replace:

```typescript
const neighbor = this.probeDoubleChest(dimension, location, block);
```

with:

```typescript
const neighbor = probeDoubleChestSafely(dimension, location, block);
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 3: Add MoveJournal and Journal-Aware Transfers

**Files:**
- Create: `scripts/sorting/MoveJournal.ts`
- Modify: `scripts/sorting/ContainerInventory.ts`
- Modify: `tests/run-safety-tests.mjs`
- Create: `tests/safety/MoveJournal.test.ts`

- [ ] **Step 1: Add failing rollback test**

Create `tests/safety/MoveJournal.test.ts`:

```typescript
import { MoveJournal } from "../../scripts/sorting/MoveJournal";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runMoveJournalTests(): void {
  const target = new MockContainer(2, [new MockItemStack("minecraft:stone", 60), undefined]);
  const journal = new MoveJournal();

  journal.snapshotTarget("target-1", target as any);
  target.addItem(new MockItemStack("minecraft:stone", 8));

  const rollback = journal.rollback();

  assert(rollback.ok, `rollback failed: ${rollback.error ?? "unknown"}`);
  assert(target.getItem(0)?.amount === 60, "slot 0 amount should roll back");
  assert(target.getItem(1) === undefined, "slot 1 should roll back to empty");
}
```

Update `tests/run-safety-tests.mjs` to import and run it:

```javascript
const { runMoveJournalTests } = await import("../tmp/safety-tests/tests/safety/MoveJournal.test.js");
runMoveJournalTests();
```

Add `scripts/sorting/MoveJournal.ts` to the `tsc` command.

- [ ] **Step 2: Run the test and verify it fails because `MoveJournal` does not exist**

Run: `npm run test:safety`

Expected: TypeScript reports it cannot find `../../scripts/sorting/MoveJournal`.

- [ ] **Step 3: Implement `MoveJournal`**

Create `scripts/sorting/MoveJournal.ts`:

```typescript
import type { Container } from "@minecraft/server";
import { restoreContainerSnapshot, snapshotContainer, type SlotSnapshot } from "./ContainerSnapshot";

interface TargetSnapshot {
  containerId: string;
  container: Container;
  snapshot: SlotSnapshot[];
}

export interface JournalResult {
  ok: boolean;
  error?: string;
}

/**
 * 记录一次输入槽分拣过程中被写入的目标容器快照。
 *
 * 该事务只在当前 tick 内有效，不跨重启持久化。
 */
export class MoveJournal {
  private readonly targets: TargetSnapshot[] = [];
  private readonly seen = new Set<string>();

  /**
   * 在目标容器首次被写入前记录完整快照。
   * @param containerId - 目标容器 ID
   * @param container - 目标容器运行时引用
   */
  snapshotTarget(containerId: string, container: Container): void {
    if (this.seen.has(containerId)) return;
    this.seen.add(containerId);
    this.targets.push({ containerId, container, snapshot: snapshotContainer(container) });
  }

  /**
   * 将所有已记录目标容器按相反顺序恢复。
   */
  rollback(): JournalResult {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i];
      const result = restoreContainerSnapshot(target.container, target.snapshot);
      if (!result.ok) return { ok: false, error: `${target.containerId}: ${result.error ?? "恢复失败"}` };
    }
    return { ok: true };
  }
}
```

- [ ] **Step 4: Add journal-aware transfer helper**

Modify `scripts/sorting/ContainerInventory.ts`:

```typescript
import type { MoveJournal } from "./MoveJournal";
```

Add:

```typescript
/**
 * 在写入前记录目标容器快照，然后尝试放入物品堆。
 */
export function tryMoveStackIntoContainerWithJournal(
  stack: ItemStack,
  target: Container,
  journal: MoveJournal,
  containerId: string
): ItemStack | undefined {
  journal.snapshotTarget(containerId, target);
  return tryMoveStackIntoContainer(stack, target);
}
```

- [ ] **Step 5: Run safety tests and build**

Run: `npm run test:safety`

Expected: `safety tests passed`.

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 4: Use MoveJournal in SorterEngine

**Files:**
- Modify: `scripts/sorting/SorterEngine.ts`

- [ ] **Step 1: Add journal imports**

Modify imports in `scripts/sorting/SorterEngine.ts`:

```typescript
import { MoveJournal } from "./MoveJournal";
import { tryMoveStackIntoContainerWithJournal } from "./ContainerInventory";
```

- [ ] **Step 2: Create a journal per input slot**

In `processInputContainer()`, before calling `moveStackIntoWarehouse`, add:

```typescript
const journal = new MoveJournal();
const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension, journal);
```

Replace the existing call:

```typescript
const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension);
```

- [ ] **Step 3: Roll back targets when input slot commit fails**

In both `catch (setError)` blocks after `container.setItem(slot)` and `container.setItem(slot, remaining)`, add:

```typescript
const rollback = journal.rollback();
if (!rollback.ok) {
  warehouse.settings.enabled = false;
  this.repository.saveMetaOnly(warehouse);
  log.error(`仓库 ${warehouse.id} 已因分拣回滚失败而停用: ${rollback.error}`);
}
```

- [ ] **Step 4: Thread the journal through transfer helpers**

Update these private method signatures in `SorterEngine.ts` to accept `journal: MoveJournal`:

```typescript
private moveStackIntoWarehouse(
  stack: ItemStack,
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  dimension: Dimension,
  journal: MoveJournal
): ItemStack | undefined

private tryContainers(
  stack: ItemStack | undefined,
  containerIds: ContainerId[],
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  dimension: Dimension,
  typeId: string,
  journal: MoveJournal,
  tag?: string
): ItemStack | undefined

private tryBulkContainers(
  stack: ItemStack | undefined,
  containerIds: ContainerId[],
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  dimension: Dimension,
  typeId: string,
  journal: MoveJournal
): ItemStack | undefined
```

Every call from `moveStackIntoWarehouse()` to `tryContainers()` and `tryBulkContainers()` must pass the same `journal`.

- [ ] **Step 5: Use journal-aware helper for target writes**

Replace in `tryContainers()`:

```typescript
remaining = tryMoveStackIntoContainer(remaining, targetContainer);
```

with:

```typescript
remaining = tryMoveStackIntoContainerWithJournal(remaining, targetContainer, journal, containerId);
```

Replace in `tryBulkContainers()` before `tryFillShulkerBoxes()`:

```typescript
journal.snapshotTarget(containerId, target);
```

Keep `tryFillShulkerBoxes()` and `tryMoveStackIntoContainer()` calls after that snapshot.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 5: Make SlotOrganizer Writes Roll Back on Failure

**Files:**
- Modify: `scripts/sorting/SlotOrganizer.ts`
- Create: `tests/safety/SlotOrganizerRollback.test.ts`
- Modify: `tests/run-safety-tests.mjs`

- [ ] **Step 1: Add focused failing test around snapshot restore**

Create `tests/safety/SlotOrganizerRollback.test.ts`:

```typescript
import { restoreContainerSnapshot, snapshotContainer } from "../../scripts/sorting/ContainerSnapshot";
import { MockContainer, MockItemStack } from "./MockContainer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runSlotOrganizerRollbackTests(): void {
  const container = new MockContainer(2, [new MockItemStack("minecraft:b", 1), new MockItemStack("minecraft:a", 1)]);
  const snapshot = snapshotContainer(container as any);
  container.failSetSlots.add(1);

  try {
    container.setItem(0, new MockItemStack("minecraft:a", 1) as any);
    container.setItem(1, new MockItemStack("minecraft:b", 1) as any);
  } catch {
    container.failSetSlots.clear();
    const restored = restoreContainerSnapshot(container as any, snapshot);
    assert(restored.ok, "restore should succeed after write failure");
  }

  assert(container.getItem(0)?.typeId === "minecraft:b", "slot 0 should be original item");
  assert(container.getItem(1)?.typeId === "minecraft:a", "slot 1 should be original item");
}
```

Update the runner to execute `runSlotOrganizerRollbackTests()`.

- [ ] **Step 2: Modify `SlotOrganizer.apply()` to snapshot before writes**

In `scripts/sorting/SlotOrganizer.ts`, import:

```typescript
import { restoreContainerSnapshot, snapshotContainer } from "./ContainerSnapshot";
```

Before the write phase in `apply()` add:

```typescript
const beforeWrite = snapshotContainer(container, startSlot, endSlot);
```

After write loops, if `writeErrors > 0`, restore and return an error result:

```typescript
if (writeErrors > 0) {
  const restored = restoreContainerSnapshot(container, beforeWrite);
  return this.makeError(
    restored.ok ? `${writeErrors} 个槽位写入失败，已回滚整理` : `${writeErrors} 个槽位写入失败，且回滚失败: ${restored.error}`,
    rawItems,
    sortedItems,
    endSlot - startSlot,
    occupiedSlots.size
  );
}
```

- [ ] **Step 3: Run tests and build**

Run: `npm run test:safety`

Expected: `safety tests passed`.

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 6: Add Rescan Preview/Diff Foundation

**Files:**
- Create: `scripts/warehouse/WarehouseRescanDiff.ts`
- Modify: `scripts/warehouse/WarehouseService.ts`

- [ ] **Step 1: Create diff model**

Create `scripts/warehouse/WarehouseRescanDiff.ts`:

```typescript
import type { ContainerId, StoredContainer } from "../types";

export interface WarehouseRescanDiff {
  added: ContainerId[];
  removed: ContainerId[];
  changed: ContainerId[];
  unchanged: ContainerId[];
}

function sameLocations(a: StoredContainer, b: StoredContainer): boolean {
  if (a.occupiedLocations.length !== b.occupiedLocations.length) return false;
  return a.occupiedLocations.every((loc, index) => {
    const other = b.occupiedLocations[index];
    return loc.x === other.x && loc.y === other.y && loc.z === other.z;
  });
}

/**
 * 比较当前容器记录与重新扫描结果。
 */
export function diffRescanContainers(
  current: Record<ContainerId, StoredContainer>,
  scanned: Record<ContainerId, StoredContainer>
): WarehouseRescanDiff {
  const added: ContainerId[] = [];
  const removed: ContainerId[] = [];
  const changed: ContainerId[] = [];
  const unchanged: ContainerId[] = [];

  for (const id of Object.keys(scanned)) {
    const old = current[id];
    if (!old) {
      added.push(id);
      continue;
    }
    const next = scanned[id];
    if (old.role !== next.role || old.enabled !== next.enabled || !sameLocations(old, next)) changed.push(id);
    else unchanged.push(id);
  }

  for (const id of Object.keys(current)) {
    if (!scanned[id]) removed.push(id);
  }

  return { added, removed, changed, unchanged };
}
```

- [ ] **Step 2: Add preview method to `WarehouseService`**

In `scripts/warehouse/WarehouseService.ts`, import `diffRescanContainers` and add:

```typescript
previewRescanWarehouse(id: WarehouseId): WarehouseRescanDiff {
  const warehouse = this.requireWarehouse(id);
  const dimension = world.getDimension(warehouse.dimensionId);
  const scanned = this.scanner.scan(
    dimension,
    warehouse.area,
    warehouse.settings.defaultNewContainerRole,
    warehouse.settings.defaultNewContainerEnabled,
    warehouse.containers
  );
  return diffRescanContainers(warehouse.containers, scanned);
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 7: Wire Rescan Preview Into Commands or UI

**Files:**
- Modify: `scripts/commands/CommandRouter.ts` or `scripts/ui/WarehouseManageMenu.ts`

- [ ] **Step 1: Inspect existing command/UI rescan entry point**

Use codegraph or file read to locate the existing call to `rescanWarehouse()`.

Expected: Find exactly where player-facing rescan is triggered and how messages are sent.

- [ ] **Step 2: Add a player-visible preview path**

If command registration can add a clean new command, add `sw:rescan_preview` that calls `previewRescanWarehouse(id)` and sends:

```typescript
`§7重扫预览：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`
```

If command registration is already too crowded, add the same preview action to the warehouse manage UI instead.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: TypeScript succeeds.

## Task 8: Final Verification

**Files:**
- No new source changes unless verification exposes errors.

- [ ] **Step 1: Run safety tests**

Run: `npm run test:safety`

Expected: `safety tests passed`.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript and bundle complete successfully.

- [ ] **Step 3: Run lint and record status**

Run: `npm run lint`

Expected: ESLint should complete. Prettier may still report existing formatting warnings unless the implementation also formats the touched files. If Prettier fails, run `npx prettier --write` only on files changed by this plan and rerun `npm run lint`.

- [ ] **Step 4: Manual in-game checks**

Run in a development world with Content Log enabled:

- Place two adjacent chests inside a warehouse and verify one double-container record appears after scan.
- Fill the last slot of a double chest before scanning and verify the item remains after scan.
- Put one stack in an input container and verify it moves once to the target, not duplicated.
- Simulate a full target container and verify the input stack remains unchanged.
- Trigger auto-organize on a mixed container and verify item counts before and after match.

---

## Self-Review Notes

- Spec coverage: covers safe probe, short move transaction, organizer rollback, and rescan preview/repair foundation.
- Scope control: does not replace the sorter, does not remove probe detection, and does not add persistent item transactions.
- Remaining manual risk: true Minecraft `ItemStack` metadata equality is only approximated in unit tests. In-game checks remain required for enchantments, lore, and Bedrock-specific components.
