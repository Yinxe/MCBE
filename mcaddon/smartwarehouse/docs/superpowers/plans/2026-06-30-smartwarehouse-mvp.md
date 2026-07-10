# SmartWarehouse MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits unless the user explicitly asks; checkpoint with `git diff` instead.

**Goal:** Build the SmartWarehouse MVP: region-based warehouse registration, container role management, dynamic-property storage, runtime models, and input-chest item sorting for loaded chunks.

**Architecture:** Keep persistent warehouse data in world dynamic properties using meta + container shards. Build per-warehouse runtime models lazily for fast role lookup, occupied-location lookup, and sorting indexes. Keep storage, warehouse scanning, UI/interaction, and sorting separate so later sign monitoring and bulk rules can be added without rewriting the MVP.

**Tech Stack:** Minecraft Bedrock Script API `@minecraft/server`, `@minecraft/server-ui`, TypeScript, existing `just-scripts` build pipeline.

---

## Source Design

Implement against:

```text
docs/superpowers/specs/2026-06-30-smartwarehouse-mvp-design.md
```

Current relevant files:

```text
scripts/main.ts
package.json
BP/SmartWarehouse/manifest.json
tsconfig.json
```

Primary verification commands:

```bash
npm run build
npm run lint
```

If `npm run lint` reports Minecraft API lint limitations unrelated to the changed files, record the exact output and still require `npm run build` to pass.

---

## File Structure

Create these files:

```text
scripts/types.ts

scripts/util/Json.ts
scripts/util/Logger.ts
scripts/util/PlayerAuth.ts
scripts/util/Vector.ts

scripts/storage/DynamicPropertyStore.ts
scripts/storage/WarehouseRepository.ts

scripts/warehouse/ContainerId.ts
scripts/warehouse/ContainerTypes.ts
scripts/warehouse/ContainerScanner.ts
scripts/warehouse/WarehouseService.ts

scripts/runtime/WarehouseRuntimeModel.ts
scripts/runtime/WarehouseRuntimeRegistry.ts

scripts/sorting/ContainerInventory.ts
scripts/sorting/SorterEngine.ts
scripts/sorting/SortingScheduler.ts

scripts/interaction/SelectionSessionStore.ts
scripts/interaction/ToolInteractionController.ts

scripts/ui/MainMenu.ts
scripts/ui/WarehouseCreateFlow.ts
scripts/ui/ContainerRoleMenu.ts

scripts/commands/CommandRouter.ts
```

Modify:

```text
scripts/main.ts
```

Do not modify manifest files unless build/runtime verification shows the Script API dependency version must be corrected.

---

## Task 1: Core Types and Utilities

**Files:**
- Create: `scripts/types.ts`
- Create: `scripts/util/Json.ts`
- Create: `scripts/util/Logger.ts`
- Create: `scripts/util/PlayerAuth.ts`
- Create: `scripts/util/Vector.ts`

- [ ] **Step 1: Create shared domain types in `scripts/types.ts`**

Define all public MVP data shapes exactly once:

```ts
import type { Vector3 } from "@minecraft/server";

export type DimensionId = string;
export type WarehouseId = string;
export type ContainerId = string;

export interface BlockLocation {
  x: number;
  y: number;
  z: number;
}

export interface WarehouseArea {
  min: BlockLocation;
  max: BlockLocation;
}

export type ContainerRole = "disabled" | "normal" | "misc" | "bulk" | "input";

export interface WarehouseSettings {
  defaultNewContainerRole: ContainerRole;
  autoCreateCategories: boolean;
  enabled: boolean;
  debug: boolean;
}

export interface WarehouseIndex {
  version: 1;
  warehouses: WarehouseId[];
}

export interface WarehouseMeta {
  version: 1;
  id: WarehouseId;
  displayName: string;
  dimensionId: DimensionId;
  area: WarehouseArea;
  settings: WarehouseSettings;
  containerShardCount: number;
}

export interface StoredContainer {
  id: ContainerId;
  dimensionId: DimensionId;
  primaryLocation: BlockLocation;
  occupiedLocations: BlockLocation[];
  role: ContainerRole;
  discoveredAt: number;
  updatedAt: number;
}

export interface WarehouseContainerShard {
  version: 1;
  warehouseId: WarehouseId;
  shardIndex: number;
  containers: Record<ContainerId, StoredContainer>;
}

export interface WarehouseData extends WarehouseMeta {
  containers: Record<ContainerId, StoredContainer>;
}

export interface RuntimeContainer extends StoredContainer {
  lastAccessFailedAt?: number;
}

export interface WarehouseRuntimeModel {
  warehouseId: WarehouseId;
  containersById: Map<ContainerId, RuntimeContainer>;
  occupiedLocationIndex: Map<string, ContainerId>;
  inputContainerIds: ContainerId[];
  normalContainerIds: ContainerId[];
  miscContainerIds: ContainerId[];
  bulkContainerIds: ContainerId[];
  disabledContainerIds: ContainerId[];
  itemTypeIndex: Map<string, ContainerId[]>;
  inputCursor: number;
  lastBuiltAt: number;
  dirty: boolean;
}

export type SelectionSession =
  | {
      type: "createWarehouse";
      warehouseName: string;
      defaultNewContainerRole: ContainerRole;
      pointA?: BlockLocation;
    }
  | {
      type: "resizeWarehouse";
      warehouseId: WarehouseId;
      pointA?: BlockLocation;
    };

export function toBlockLocation(vector: Vector3): BlockLocation {
  return { x: Math.floor(vector.x), y: Math.floor(vector.y), z: Math.floor(vector.z) };
}
```

- [ ] **Step 2: Create JSON helpers in `scripts/util/Json.ts`**

```ts
export function parseJsonObject<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function getUtf16Length(value: string): number {
  return value.length;
}
```

- [ ] **Step 3: Create logger in `scripts/util/Logger.ts`**

```ts
import { world } from "@minecraft/server";

export class Logger {
  constructor(private readonly prefix = "SmartWarehouse") {}

  info(message: string): void {
    console.warn(`[${this.prefix}] ${message}`);
  }

  error(message: string): void {
    console.error(`[${this.prefix}] ${message}`);
  }

  tellAdmins(message: string): void {
    for (const player of world.getPlayers()) {
      if (player.isOp()) player.sendMessage(`§e[${this.prefix}]§r ${message}`);
    }
  }
}
```

- [ ] **Step 4: Create auth and vector helpers**

`scripts/util/PlayerAuth.ts`:

```ts
import type { Player } from "@minecraft/server";

export function canManageWarehouse(player: Player): boolean {
  return player.isOp();
}
```

`scripts/util/Vector.ts`:

```ts
import type { BlockLocation, WarehouseArea } from "../types";

export function locationKey(dimensionId: string, location: BlockLocation): string {
  return `${dimensionId}|${location.x}|${location.y}|${location.z}`;
}

export function normalizeArea(a: BlockLocation, b: BlockLocation): WarehouseArea {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

export function areaVolume(area: WarehouseArea): number {
  return (area.max.x - area.min.x + 1) * (area.max.y - area.min.y + 1) * (area.max.z - area.min.z + 1);
}

export function isInsideArea(location: BlockLocation, area: WarehouseArea): boolean {
  return location.x >= area.min.x && location.x <= area.max.x &&
    location.y >= area.min.y && location.y <= area.max.y &&
    location.z >= area.min.z && location.z <= area.max.z;
}

export function compareLocationForPrimary(a: BlockLocation, b: BlockLocation): number {
  if (a.x !== b.x) return a.x - b.x;
  if (a.z !== b.z) return a.z - b.z;
  return a.y - b.y;
}
```

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: TypeScript compiles successfully or reports only errors from later uncreated imports if `main.ts` was already modified by another task. If this task is executed first, it should pass.

---

## Task 2: Dynamic Property Repository

**Files:**
- Create: `scripts/storage/DynamicPropertyStore.ts`
- Create: `scripts/storage/WarehouseRepository.ts`

- [ ] **Step 1: Create `DynamicPropertyStore`**

```ts
import { world } from "@minecraft/server";
import { getUtf16Length, parseJsonObject, stringifyJson } from "../util/Json";

export const DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH = 24_000;

export class DynamicPropertyStore {
  constructor(private readonly maxStringLength = DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH) {}

  getJson<T>(key: string, fallback: T): T {
    const value = world.getDynamicProperty(key);
    return parseJsonObject(typeof value === "string" ? value : undefined, fallback);
  }

  setJson(key: string, value: unknown): void {
    const raw = stringifyJson(value);
    if (getUtf16Length(raw) > this.maxStringLength) {
      throw new Error(`Dynamic property ${key} is too large: ${getUtf16Length(raw)} > ${this.maxStringLength}`);
    }
    world.setDynamicProperty(key, raw);
  }

  delete(key: string): void {
    world.setDynamicProperty(key, undefined);
  }
}
```

- [ ] **Step 2: Create repository constants and ID normalization**

In `scripts/storage/WarehouseRepository.ts`, start with:

```ts
import type { ContainerId, StoredContainer, WarehouseContainerShard, WarehouseData, WarehouseId, WarehouseIndex, WarehouseMeta, WarehouseSettings } from "../types";
import { DynamicPropertyStore } from "./DynamicPropertyStore";

const INDEX_KEY = "sw:index";
const CONTAINERS_PER_SHARD = 128;

export const DEFAULT_WAREHOUSE_SETTINGS: WarehouseSettings = {
  defaultNewContainerRole: "disabled",
  autoCreateCategories: false,
  enabled: true,
  debug: false,
};

export function normalizeWarehouseId(input: string): WarehouseId {
  const id = input.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
    throw new Error("仓库 ID 只能包含英文小写、数字、下划线、短横线，长度 1-32");
  }
  return id;
}

function metaKey(id: WarehouseId): string {
  return `sw:warehouse:${id}:meta`;
}

function shardKey(id: WarehouseId, shardIndex: number): string {
  return `sw:warehouse:${id}:containers:${shardIndex}`;
}
```

- [ ] **Step 3: Implement repository methods**

Append:

```ts
export class WarehouseRepository {
  constructor(private readonly store = new DynamicPropertyStore()) {}

  getIndex(): WarehouseIndex {
    return this.store.getJson<WarehouseIndex>(INDEX_KEY, { version: 1, warehouses: [] });
  }

  saveIndex(index: WarehouseIndex): void {
    this.store.setJson(INDEX_KEY, index);
  }

  exists(id: WarehouseId): boolean {
    return this.getIndex().warehouses.includes(id);
  }

  load(id: WarehouseId): WarehouseData | undefined {
    const meta = this.store.getJson<WarehouseMeta | undefined>(metaKey(id), undefined);
    if (!meta) return undefined;

    const containers: Record<ContainerId, StoredContainer> = {};
    for (let shardIndex = 0; shardIndex < meta.containerShardCount; shardIndex++) {
      const shard = this.store.getJson<WarehouseContainerShard>(shardKey(id, shardIndex), {
        version: 1,
        warehouseId: id,
        shardIndex,
        containers: {},
      });
      Object.assign(containers, shard.containers);
    }

    return { ...meta, containers };
  }

  save(data: WarehouseData): void {
    const entries = Object.entries(data.containers);
    const shardCount = Math.max(1, Math.ceil(entries.length / CONTAINERS_PER_SHARD));
    const meta: WarehouseMeta = {
      version: 1,
      id: data.id,
      displayName: data.displayName,
      dimensionId: data.dimensionId,
      area: data.area,
      settings: data.settings,
      containerShardCount: shardCount,
    };

    this.store.setJson(metaKey(data.id), meta);

    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      const slice = entries.slice(shardIndex * CONTAINERS_PER_SHARD, (shardIndex + 1) * CONTAINERS_PER_SHARD);
      const shard: WarehouseContainerShard = {
        version: 1,
        warehouseId: data.id,
        shardIndex,
        containers: Object.fromEntries(slice),
      };
      this.store.setJson(shardKey(data.id, shardIndex), shard);
    }
  }

  create(data: WarehouseData): void {
    const index = this.getIndex();
    if (index.warehouses.includes(data.id)) throw new Error(`仓库 ${data.id} 已存在`);
    this.save(data);
    this.saveIndex({ version: 1, warehouses: [...index.warehouses, data.id] });
  }

  delete(id: WarehouseId): void {
    const existing = this.load(id);
    if (existing) {
      this.store.delete(metaKey(id));
      for (let i = 0; i < existing.containerShardCount; i++) this.store.delete(shardKey(id, i));
    }
    const index = this.getIndex();
    this.saveIndex({ version: 1, warehouses: index.warehouses.filter((warehouseId) => warehouseId !== id) });
  }

  loadAll(): WarehouseData[] {
    return this.getIndex().warehouses
      .map((id) => this.load(id))
      .filter((warehouse): warehouse is WarehouseData => Boolean(warehouse));
  }
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

---

## Task 3: Container IDs, Type Detection, and Scanning

**Files:**
- Create: `scripts/warehouse/ContainerId.ts`
- Create: `scripts/warehouse/ContainerTypes.ts`
- Create: `scripts/warehouse/ContainerScanner.ts`

- [ ] **Step 1: Create container ID helpers**

`scripts/warehouse/ContainerId.ts`:

```ts
import type { BlockLocation, ContainerId, DimensionId } from "../types";
import { locationKey } from "../util/Vector";

export function makeContainerId(dimensionId: DimensionId, primaryLocation: BlockLocation): ContainerId {
  return locationKey(dimensionId, primaryLocation);
}

export function makeOccupiedLocationKey(dimensionId: DimensionId, location: BlockLocation): string {
  return locationKey(dimensionId, location);
}
```

- [ ] **Step 2: Create container type detection**

`scripts/warehouse/ContainerTypes.ts`:

```ts
import type { Block } from "@minecraft/server";

const SHULKER_BOX_IDS = new Set([
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",
  "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box",
  "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",
  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",
  "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box",
  "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",
  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",
  "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",
  "minecraft:black_shulker_box",
]);

export function isChestType(typeId: string): boolean {
  return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest";
}

export function isSupportedContainerType(typeId: string): boolean {
  return isChestType(typeId) || typeId === "minecraft:barrel" || SHULKER_BOX_IDS.has(typeId);
}

export function hasInventory(block: Block): boolean {
  return Boolean(block.getComponent("inventory"));
}
```

- [ ] **Step 3: Create scanner with big-chest occupied locations**

`scripts/warehouse/ContainerScanner.ts`:

```ts
import type { Dimension } from "@minecraft/server";
import type { BlockLocation, ContainerRole, StoredContainer, WarehouseArea } from "../types";
import { compareLocationForPrimary } from "../util/Vector";
import { makeContainerId } from "./ContainerId";
import { hasInventory, isChestType, isSupportedContainerType } from "./ContainerTypes";

const NEIGHBOR_OFFSETS: BlockLocation[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export class ContainerScanner {
  scan(dimension: Dimension, area: WarehouseArea, defaultRole: ContainerRole, existing: Record<string, StoredContainer> = {}): Record<string, StoredContainer> {
    const dimensionId = dimension.id;
    const found: Record<string, StoredContainer> = {};
    const now = Date.now();

    for (let x = area.min.x; x <= area.max.x; x++) {
      for (let y = area.min.y; y <= area.max.y; y++) {
        for (let z = area.min.z; z <= area.max.z; z++) {
          const block = dimension.getBlock({ x, y, z });
          if (!block || !isSupportedContainerType(block.typeId) || !hasInventory(block)) continue;

          const occupied = this.getOccupiedLocations(dimension, { x, y, z }, block.typeId);
          const primary = [...occupied].sort(compareLocationForPrimary)[0];
          const id = makeContainerId(dimensionId, primary);
          if (found[id]) continue;

          const previous = existing[id];
          found[id] = {
            id,
            dimensionId,
            primaryLocation: primary,
            occupiedLocations: occupied.sort(compareLocationForPrimary),
            role: previous?.role ?? defaultRole,
            discoveredAt: previous?.discoveredAt ?? now,
            updatedAt: now,
          };
        }
      }
    }

    return found;
  }

  private getOccupiedLocations(dimension: Dimension, location: BlockLocation, typeId: string): BlockLocation[] {
    if (!isChestType(typeId)) return [location];

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborLocation = { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
      const neighbor = dimension.getBlock(neighborLocation);
      if (neighbor?.typeId === typeId && hasInventory(neighbor)) {
        return [location, neighborLocation];
      }
    }

    return [location];
  }
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

---

## Task 4: Warehouse Service and Runtime Model

**Files:**
- Create: `scripts/warehouse/WarehouseService.ts`
- Create: `scripts/runtime/WarehouseRuntimeModel.ts`
- Create: `scripts/runtime/WarehouseRuntimeRegistry.ts`

- [ ] **Step 1: Create runtime model builder**

`scripts/runtime/WarehouseRuntimeModel.ts`:

```ts
import type { ContainerId, WarehouseData, WarehouseRuntimeModel } from "../types";
import { makeOccupiedLocationKey } from "../warehouse/ContainerId";

export function buildWarehouseRuntimeModel(warehouse: WarehouseData): WarehouseRuntimeModel {
  const model: WarehouseRuntimeModel = {
    warehouseId: warehouse.id,
    containersById: new Map(),
    occupiedLocationIndex: new Map(),
    inputContainerIds: [],
    normalContainerIds: [],
    miscContainerIds: [],
    bulkContainerIds: [],
    disabledContainerIds: [],
    itemTypeIndex: new Map<string, ContainerId[]>(),
    inputCursor: 0,
    lastBuiltAt: Date.now(),
    dirty: false,
  };

  for (const container of Object.values(warehouse.containers)) {
    model.containersById.set(container.id, { ...container });
    for (const location of container.occupiedLocations) {
      model.occupiedLocationIndex.set(makeOccupiedLocationKey(container.dimensionId, location), container.id);
    }
    if (container.role === "input") model.inputContainerIds.push(container.id);
    else if (container.role === "normal") model.normalContainerIds.push(container.id);
    else if (container.role === "misc") model.miscContainerIds.push(container.id);
    else if (container.role === "bulk") model.bulkContainerIds.push(container.id);
    else model.disabledContainerIds.push(container.id);
  }

  return model;
}
```

- [ ] **Step 2: Create runtime registry**

`scripts/runtime/WarehouseRuntimeRegistry.ts`:

```ts
import type { WarehouseId, WarehouseRuntimeModel } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { buildWarehouseRuntimeModel } from "./WarehouseRuntimeModel";

export class WarehouseRuntimeRegistry {
  private readonly models = new Map<WarehouseId, WarehouseRuntimeModel>();

  constructor(private readonly repository: WarehouseRepository) {}

  getOrBuild(id: WarehouseId): WarehouseRuntimeModel | undefined {
    const existing = this.models.get(id);
    if (existing && !existing.dirty) return existing;

    const warehouse = this.repository.load(id);
    if (!warehouse) return undefined;

    const model = buildWarehouseRuntimeModel(warehouse);
    const oldCursor = existing?.inputCursor ?? 0;
    model.inputCursor = model.inputContainerIds.length > 0 ? oldCursor % model.inputContainerIds.length : 0;
    this.models.set(id, model);
    return model;
  }

  markDirty(id: WarehouseId): void {
    const model = this.models.get(id);
    if (model) model.dirty = true;
  }

  delete(id: WarehouseId): void {
    this.models.delete(id);
  }
}
```

- [ ] **Step 3: Create warehouse service**

`scripts/warehouse/WarehouseService.ts`:

```ts
import { world } from "@minecraft/server";
import type { BlockLocation, ContainerRole, WarehouseArea, WarehouseData, WarehouseId } from "../types";
import { DEFAULT_WAREHOUSE_SETTINGS, normalizeWarehouseId, WarehouseRepository } from "../storage/WarehouseRepository";
import { areaVolume, isInsideArea, normalizeArea } from "../util/Vector";
import { ContainerScanner } from "./ContainerScanner";

const MAX_SCAN_VOLUME = 65_536;
const MAX_CONTAINERS = 512;

export class WarehouseService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly scanner = new ContainerScanner(),
  ) {}

  createWarehouse(name: string, dimensionId: string, pointA: BlockLocation, pointB: BlockLocation, defaultRole: ContainerRole): WarehouseData {
    const id = normalizeWarehouseId(name);
    if (this.repository.exists(id)) throw new Error(`仓库 ${id} 已存在`);
    const area = normalizeArea(pointA, pointB);
    this.assertScanVolume(area);
    const dimension = world.getDimension(dimensionId);
    const containers = this.scanner.scan(dimension, area, defaultRole);
    this.assertContainerCount(containers);

    const data: WarehouseData = {
      version: 1,
      id,
      displayName: name.trim(),
      dimensionId,
      area,
      settings: { ...DEFAULT_WAREHOUSE_SETTINGS, defaultNewContainerRole: defaultRole },
      containerShardCount: 0,
      containers,
    };
    this.repository.create(data);
    return data;
  }

  rescanWarehouse(id: WarehouseId): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const dimension = world.getDimension(warehouse.dimensionId);
    const containers = this.scanner.scan(dimension, warehouse.area, warehouse.settings.defaultNewContainerRole, warehouse.containers);
    this.assertContainerCount(containers);
    const updated = { ...warehouse, containers };
    this.repository.save(updated);
    return updated;
  }

  resizeWarehouse(id: WarehouseId, pointA: BlockLocation, pointB: BlockLocation): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const area = normalizeArea(pointA, pointB);
    this.assertScanVolume(area);
    const dimension = world.getDimension(warehouse.dimensionId);
    const scanned = this.scanner.scan(dimension, area, warehouse.settings.defaultNewContainerRole, warehouse.containers);
    const containers = Object.fromEntries(Object.entries(scanned).filter(([, container]) => isInsideArea(container.primaryLocation, area)));
    this.assertContainerCount(containers);
    const updated = { ...warehouse, area, containers };
    this.repository.save(updated);
    return updated;
  }

  deleteWarehouse(id: WarehouseId): void {
    this.repository.delete(id);
  }

  setContainerRole(id: WarehouseId, containerId: string, role: ContainerRole): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const container = warehouse.containers[containerId];
    if (!container) throw new Error(`容器 ${containerId} 不属于仓库 ${id}`);
    const updated: WarehouseData = {
      ...warehouse,
      containers: {
        ...warehouse.containers,
        [containerId]: { ...container, role, updatedAt: Date.now() },
      },
    };
    this.repository.save(updated);
    return updated;
  }

  findWarehouseAt(dimensionId: string, location: BlockLocation): WarehouseData | undefined {
    return this.repository.loadAll().find((warehouse) => warehouse.dimensionId === dimensionId && isInsideArea(location, warehouse.area));
  }

  requireWarehouse(id: WarehouseId): WarehouseData {
    const warehouse = this.repository.load(id);
    if (!warehouse) throw new Error(`仓库 ${id} 不存在`);
    return warehouse;
  }

  private assertScanVolume(area: WarehouseArea): void {
    const volume = areaVolume(area);
    if (volume > MAX_SCAN_VOLUME) throw new Error(`仓库区域过大：${volume} > ${MAX_SCAN_VOLUME}`);
  }

  private assertContainerCount(containers: Record<string, unknown>): void {
    const count = Object.keys(containers).length;
    if (count > MAX_CONTAINERS) throw new Error(`仓库容器过多：${count} > ${MAX_CONTAINERS}`);
  }
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

---

## Task 5: UI and Tool Interaction

**Files:**
- Create: `scripts/interaction/SelectionSessionStore.ts`
- Create: `scripts/ui/MainMenu.ts`
- Create: `scripts/ui/WarehouseCreateFlow.ts`
- Create: `scripts/ui/ContainerRoleMenu.ts`
- Create: `scripts/interaction/ToolInteractionController.ts`

- [ ] **Step 1: Create selection sessions**

`scripts/interaction/SelectionSessionStore.ts`:

```ts
import type { Player } from "@minecraft/server";
import type { SelectionSession } from "../types";

export class SelectionSessionStore {
  private readonly sessions = new Map<string, SelectionSession>();

  get(player: Player): SelectionSession | undefined {
    return this.sessions.get(player.id);
  }

  set(player: Player, session: SelectionSession): void {
    this.sessions.set(player.id, session);
  }

  clear(player: Player): void {
    this.sessions.delete(player.id);
  }
}
```

- [ ] **Step 2: Create main menu and create flow**

`scripts/ui/WarehouseCreateFlow.ts`:

```ts
import { ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import type { ContainerRole } from "../types";
import { SelectionSessionStore } from "../interaction/SelectionSessionStore";

const ROLE_OPTIONS: ContainerRole[] = ["disabled", "normal", "misc", "bulk", "input"];

export async function openWarehouseCreateFlow(player: Player, sessions: SelectionSessionStore): Promise<void> {
  const form = new ModalFormData()
    .title("创建 SmartWarehouse")
    .textField("仓库 ID / 名称（英文、数字、_、-）", "main")
    .dropdown("新容器默认角色", ["未启用", "普通仓位", "杂物箱", "大宗仓位", "入口箱"], 0);

  const result = await form.show(player);
  if (result.canceled) return;

  const name = String(result.formValues?.[0] ?? "").trim();
  const role = ROLE_OPTIONS[Number(result.formValues?.[1] ?? 0)] ?? "disabled";
  if (!name) {
    player.sendMessage("§c仓库名不能为空。");
    return;
  }

  sessions.set(player, { type: "createWarehouse", warehouseName: name, defaultNewContainerRole: role });
  player.sendMessage("§a创建流程已开始。请用木锄点击第一个非容器方块作为选区点 A。");
}
```

`scripts/ui/MainMenu.ts`:

```ts
import { ActionFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { SelectionSessionStore } from "../interaction/SelectionSessionStore";
import { openWarehouseCreateFlow } from "./WarehouseCreateFlow";

export async function openMainMenu(player: Player, sessions: SelectionSessionStore): Promise<void> {
  const result = await new ActionFormData()
    .title("SmartWarehouse")
    .body("选择操作")
    .button("创建仓库")
    .button("管理仓库（后续扩展）")
    .show(player);

  if (result.canceled) return;
  if (result.selection === 0) await openWarehouseCreateFlow(player, sessions);
}
```

- [ ] **Step 3: Create container role menu**

`scripts/ui/ContainerRoleMenu.ts`:

```ts
import { ActionFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import type { ContainerId, ContainerRole, WarehouseData } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";
import { WarehouseService } from "../warehouse/WarehouseService";

const ROLE_LABELS: Array<[ContainerRole, string]> = [
  ["disabled", "未启用"],
  ["normal", "普通仓位"],
  ["misc", "杂物箱"],
  ["bulk", "大宗仓位"],
  ["input", "入口箱"],
];

export async function openContainerRoleMenu(player: Player, service: WarehouseService, warehouse: WarehouseData, containerId: ContainerId): Promise<void> {
  const container = warehouse.containers[containerId];
  if (!container) {
    player.sendMessage("§c这个容器不属于当前仓库。");
    return;
  }

  if (!canManageWarehouse(player)) {
    player.sendMessage(`§e所属仓库：${warehouse.displayName}，当前角色：${container.role}。你没有修改权限。`);
    return;
  }

  const form = new ActionFormData()
    .title("容器设置")
    .body(`仓库：${warehouse.displayName}\n当前角色：${container.role}`);
  for (const [, label] of ROLE_LABELS) form.button(label);

  const result = await form.show(player);
  if (result.canceled || result.selection === undefined) return;

  const role = ROLE_LABELS[result.selection]?.[0];
  if (!role) return;
  service.setContainerRole(warehouse.id, containerId, role);
  player.sendMessage(`§a容器角色已更新为：${role}`);
}
```

- [ ] **Step 4: Create tool interaction controller**

`scripts/interaction/ToolInteractionController.ts`:

```ts
import { world } from "@minecraft/server";
import type { Block, Player } from "@minecraft/server";
import { SelectionSessionStore } from "./SelectionSessionStore";
import { openMainMenu } from "../ui/MainMenu";
import { openContainerRoleMenu } from "../ui/ContainerRoleMenu";
import { toBlockLocation } from "../types";
import { WarehouseService } from "../warehouse/WarehouseService";
import { makeOccupiedLocationKey } from "../warehouse/ContainerId";
import { isSupportedContainerType } from "../warehouse/ContainerTypes";

const TOOL_ID = "minecraft:wooden_hoe";

export class ToolInteractionController {
  private readonly recentUseOn = new Map<string, number>();

  constructor(
    private readonly service: WarehouseService,
    private readonly sessions: SelectionSessionStore,
  ) {}

  register(): void {
    world.afterEvents.itemUse.subscribe((event) => {
      if (event.itemStack.typeId !== TOOL_ID) return;
      const lastUseOn = this.recentUseOn.get(event.source.id) ?? 0;
      if (Date.now() - lastUseOn < 250) return;
      void openMainMenu(event.source, this.sessions);
    });

    world.beforeEvents.itemUseOn.subscribe((event) => {
      if (event.itemStack?.typeId !== TOOL_ID) return;
      const player = event.source as Player;
      this.recentUseOn.set(player.id, Date.now());
      event.cancel = true;
      const block = event.block;
      if (isSupportedContainerType(block.typeId)) {
        void this.handleContainerClick(player, block);
      } else {
        this.handleNonContainerClick(player, block);
      }
    });
  }

  private async handleContainerClick(player: Player, block: Block): Promise<void> {
    const location = toBlockLocation(block.location);
    const warehouse = this.service.findWarehouseAt(block.dimension.id, location);
    if (!warehouse) {
      player.sendMessage("§e这个容器不属于任何 SmartWarehouse 仓库。");
      return;
    }
    const key = makeOccupiedLocationKey(block.dimension.id, location);
    const containerId = Object.values(warehouse.containers)
      .find((container) => container.occupiedLocations.some((occupied) => makeOccupiedLocationKey(container.dimensionId, occupied) === key))?.id;
    if (!containerId) {
      player.sendMessage("§e这个容器在仓库范围内，但还没有登记。请重新扫描仓库。");
      return;
    }
    await openContainerRoleMenu(player, this.service, warehouse, containerId);
  }

  private handleNonContainerClick(player: Player, block: Block): void {
    const session = this.sessions.get(player);
    if (!session) {
      player.sendMessage("§e请先用木锄对空使用打开菜单，选择创建或调整仓库。");
      return;
    }
    const point = toBlockLocation(block.location);
    if (!session.pointA) {
      this.sessions.set(player, { ...session, pointA: point });
      player.sendMessage(`§a已选择点 A：${point.x}, ${point.y}, ${point.z}。请点击第二个非容器方块。`);
      return;
    }
    if (session.type === "createWarehouse") {
      const warehouse = this.service.createWarehouse(session.warehouseName, block.dimension.id, session.pointA, point, session.defaultNewContainerRole);
      player.sendMessage(`§a已创建仓库 ${warehouse.displayName}，扫描到 ${Object.keys(warehouse.containers).length} 个容器。`);
    } else {
      const warehouse = this.service.resizeWarehouse(session.warehouseId, session.pointA, point);
      player.sendMessage(`§a已调整仓库 ${warehouse.displayName}，当前 ${Object.keys(warehouse.containers).length} 个容器。`);
    }
    this.sessions.clear(player);
  }
}
```

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: PASS or API type errors that identify exact event field names to correct in this task before moving on.

---

## Task 6: Sorting Engine and Scheduler

**Files:**
- Create: `scripts/sorting/ContainerInventory.ts`
- Create: `scripts/sorting/SorterEngine.ts`
- Create: `scripts/sorting/SortingScheduler.ts`

- [ ] **Step 1: Create inventory adapter**

`scripts/sorting/ContainerInventory.ts`:

```ts
import type { Block, Container, Dimension, ItemStack } from "@minecraft/server";
import type { StoredContainer } from "../types";

export function getContainerFromStored(dimension: Dimension, stored: StoredContainer): Container | undefined {
  try {
    const block = dimension.getBlock(stored.primaryLocation) as Block | undefined;
    const component = block?.getComponent("inventory");
    return component?.container;
  } catch {
    return undefined;
  }
}

export function findFirstNonEmptySlot(container: Container): number | undefined {
  for (let i = 0; i < container.size; i++) {
    if (container.getItem(i)) return i;
  }
  return undefined;
}

export function containerHasType(container: Container, typeId: string): boolean {
  for (let i = 0; i < container.size; i++) {
    if (container.getItem(i)?.typeId === typeId) return true;
  }
  return false;
}

export function isContainerEmpty(container: Container): boolean {
  for (let i = 0; i < container.size; i++) {
    if (container.getItem(i)) return false;
  }
  return true;
}

export function tryMoveStackIntoContainer(stack: ItemStack, target: Container): ItemStack | undefined {
  const remaining = stack.clone();
  const leftover = target.addItem(remaining);
  return leftover;
}
```

- [ ] **Step 2: Create sorter engine**

`scripts/sorting/SorterEngine.ts`:

```ts
import { world } from "@minecraft/server";
import type { ContainerId, WarehouseData, WarehouseRuntimeModel } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "../runtime/WarehouseRuntimeRegistry";
import { containerHasType, findFirstNonEmptySlot, getContainerFromStored, isContainerEmpty, tryMoveStackIntoContainer } from "./ContainerInventory";

export class SorterEngine {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly runtime: WarehouseRuntimeRegistry,
  ) {}

  processWarehouse(warehouseId: string): void {
    const warehouse = this.repository.load(warehouseId);
    if (!warehouse || !warehouse.settings.enabled) return;
    const model = this.runtime.getOrBuild(warehouseId);
    if (!model || model.inputContainerIds.length === 0) return;

    const inputId = model.inputContainerIds[model.inputCursor % model.inputContainerIds.length];
    model.inputCursor = (model.inputCursor + 1) % model.inputContainerIds.length;
    this.processInputContainer(warehouse, model, inputId);
  }

  private processInputContainer(warehouse: WarehouseData, model: WarehouseRuntimeModel, inputId: ContainerId): void {
    const inputStored = warehouse.containers[inputId];
    if (!inputStored) return;
    const dimension = world.getDimension(inputStored.dimensionId);
    const inputContainer = getContainerFromStored(dimension, inputStored);
    if (!inputContainer) return;

    const sourceSlot = findFirstNonEmptySlot(inputContainer);
    if (sourceSlot === undefined) return;
    const sourceStack = inputContainer.getItem(sourceSlot);
    if (!sourceStack) return;

    const remaining = this.moveStackIntoWarehouse(warehouse, model, sourceStack);
    if (!remaining || remaining.amount <= 0) inputContainer.setItem(sourceSlot, undefined);
    else inputContainer.setItem(sourceSlot, remaining);
  }

  private moveStackIntoWarehouse(warehouse: WarehouseData, model: WarehouseRuntimeModel, stack: import("@minecraft/server").ItemStack): import("@minecraft/server").ItemStack | undefined {
    let remaining: import("@minecraft/server").ItemStack | undefined = stack.clone();

    for (const id of this.findExistingTypeContainers(warehouse, model, stack.typeId)) {
      if (!remaining) return undefined;
      remaining = this.tryMoveToStoredContainer(warehouse, id, remaining);
    }

    if (remaining && warehouse.settings.autoCreateCategories) {
      for (const id of model.normalContainerIds) {
        const stored = warehouse.containers[id];
        if (!stored) continue;
        const container = getContainerFromStored(world.getDimension(stored.dimensionId), stored);
        if (container && isContainerEmpty(container)) remaining = tryMoveStackIntoContainer(remaining, container);
        if (!remaining) return undefined;
      }
    }

    if (remaining) {
      for (const id of model.miscContainerIds) {
        remaining = this.tryMoveToStoredContainer(warehouse, id, remaining);
        if (!remaining) return undefined;
      }
    }

    return remaining;
  }

  private findExistingTypeContainers(warehouse: WarehouseData, model: WarehouseRuntimeModel, typeId: string): ContainerId[] {
    const candidates = model.itemTypeIndex.get(typeId) ?? model.normalContainerIds;
    const confirmed: ContainerId[] = [];
    for (const id of candidates) {
      const stored = warehouse.containers[id];
      if (!stored || stored.role !== "normal") continue;
      const container = getContainerFromStored(world.getDimension(stored.dimensionId), stored);
      if (!container) continue;
      if (containerHasType(container, typeId)) confirmed.push(id);
    }
    model.itemTypeIndex.set(typeId, confirmed);
    return confirmed;
  }

  private tryMoveToStoredContainer(warehouse: WarehouseData, id: ContainerId, stack: import("@minecraft/server").ItemStack): import("@minecraft/server").ItemStack | undefined {
    const stored = warehouse.containers[id];
    if (!stored) return stack;
    const container = getContainerFromStored(world.getDimension(stored.dimensionId), stored);
    if (!container) return stack;
    return tryMoveStackIntoContainer(stack, container);
  }
}
```

- [ ] **Step 3: Create scheduler**

`scripts/sorting/SortingScheduler.ts`:

```ts
import { system } from "@minecraft/server";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { SorterEngine } from "./SorterEngine";

export class SortingScheduler {
  private cursor = 0;
  private runId: number | undefined;

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine,
    private readonly maxWarehousesPerRun = 4,
  ) {}

  start(): void {
    if (this.runId !== undefined) return;
    this.runId = system.runInterval(() => this.tick(), 8);
  }

  private tick(): void {
    const ids = this.repository.getIndex().warehouses;
    if (ids.length === 0) return;
    for (let processed = 0; processed < Math.min(this.maxWarehousesPerRun, ids.length); processed++) {
      const id = ids[this.cursor % ids.length];
      this.cursor = (this.cursor + 1) % ids.length;
      this.engine.processWarehouse(id);
    }
  }
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS. If `Container.addItem` type differs in `@minecraft/server 2.0.0`, correct `tryMoveStackIntoContainer` to match the actual API before continuing.

---

## Task 7: Commands and Main Integration

**Files:**
- Create: `scripts/commands/CommandRouter.ts`
- Modify: `scripts/main.ts`

- [ ] **Step 1: Create chat command router**

Use chat commands as the MVP-compatible command path. Create `scripts/commands/CommandRouter.ts`:

```ts
import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { canManageWarehouse } from "../util/PlayerAuth";
import { WarehouseService } from "../warehouse/WarehouseService";

export class CommandRouter {
  constructor(private readonly service: WarehouseService) {}

  register(): void {
    world.beforeEvents.chatSend.subscribe((event) => {
      if (!event.message.startsWith("!sw ")) return;
      event.cancel = true;
      this.handle(event.sender, event.message.slice(4).trim().split(/\s+/));
    });
  }

  private handle(player: Player, args: string[]): void {
    if (!canManageWarehouse(player)) {
      player.sendMessage("§c你没有管理 SmartWarehouse 的权限。");
      return;
    }

    const [command, name, ...rest] = args;
    try {
      if (command === "delete" && name) {
        this.service.deleteWarehouse(name);
        player.sendMessage(`§a已删除仓库 ${name}。`);
        return;
      }
      if (command === "rescan" && name) {
        const warehouse = this.service.rescanWarehouse(name);
        player.sendMessage(`§a已重新扫描仓库 ${warehouse.displayName}，容器数 ${Object.keys(warehouse.containers).length}。`);
        return;
      }
      if ((command === "create" || command === "resize") && name && rest.length === 6) {
        const nums = rest.map(Number);
        if (nums.some((n) => !Number.isFinite(n))) throw new Error("坐标必须是数字");
        const a = { x: nums[0], y: nums[1], z: nums[2] };
        const b = { x: nums[3], y: nums[4], z: nums[5] };
        if (command === "create") {
          const warehouse = this.service.createWarehouse(name, player.dimension.id, a, b, "disabled");
          player.sendMessage(`§a已创建仓库 ${warehouse.displayName}，容器数 ${Object.keys(warehouse.containers).length}。`);
        } else {
          const warehouse = this.service.resizeWarehouse(name, a, b);
          player.sendMessage(`§a已调整仓库 ${warehouse.displayName}，容器数 ${Object.keys(warehouse.containers).length}。`);
        }
        return;
      }
      player.sendMessage("§e用法：!sw create|resize <name> x1 y1 z1 x2 y2 z2，!sw rescan <name>，!sw delete <name>");
    } catch (error) {
      player.sendMessage(`§c${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

- [ ] **Step 2: Replace `scripts/main.ts` with integration wiring**

```ts
import { WarehouseRepository } from "./storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "./runtime/WarehouseRuntimeRegistry";
import { WarehouseService } from "./warehouse/WarehouseService";
import { SelectionSessionStore } from "./interaction/SelectionSessionStore";
import { ToolInteractionController } from "./interaction/ToolInteractionController";
import { SorterEngine } from "./sorting/SorterEngine";
import { SortingScheduler } from "./sorting/SortingScheduler";
import { CommandRouter } from "./commands/CommandRouter";

const repository = new WarehouseRepository();
const runtime = new WarehouseRuntimeRegistry(repository);
const service = new WarehouseService(repository);
const sessions = new SelectionSessionStore();

new ToolInteractionController(service, sessions).register();
new CommandRouter(service).register();
new SortingScheduler(repository, new SorterEngine(repository, runtime)).start();

console.warn("[SmartWarehouse] loaded");
```

- [ ] **Step 3: Run build and lint**

Run:

```bash
npm run build
npm run lint
```

Expected: PASS. If lint flags API-specific patterns, fix changed files until lint passes or record a precise blocker.

---

## Task 8: Block Place/Break Maintenance and Runtime Dirtying

**Files:**
- Modify: `scripts/warehouse/WarehouseService.ts`
- Modify: `scripts/interaction/ToolInteractionController.ts`
- Modify: `scripts/main.ts`

- [ ] **Step 1: Add runtime dirtying dependency**

Update `WarehouseService` constructor to accept an optional dirty callback:

```ts
constructor(
  private readonly repository: WarehouseRepository,
  private readonly scanner = new ContainerScanner(),
  private readonly markRuntimeDirty: (warehouseId: WarehouseId) => void = () => undefined,
) {}
```

Call `this.markRuntimeDirty(id)` after `rescanWarehouse`, `resizeWarehouse`, and `setContainerRole`. Call it after creation with `this.markRuntimeDirty(data.id)`.

- [ ] **Step 2: Register block maintenance**

Add a `registerBlockMaintenance()` method to `WarehouseService`:

```ts
registerBlockMaintenance(): void {
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const block = event.block;
    const warehouse = this.findWarehouseAt(block.dimension.id, block.location);
    if (!warehouse) return;
    this.rescanWarehouse(warehouse.id);
  });

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    const dimensionId = event.dimension.id;
    const warehouse = this.findWarehouseAt(dimensionId, event.block.location);
    if (!warehouse) return;
    this.rescanWarehouse(warehouse.id);
  });
}
```

If `playerPlaceBlock` / `playerBreakBlock` names differ in the installed API, use the exact event names available in `@minecraft/server 2.0.0` and update this plan section in the implementation notes.

- [ ] **Step 3: Wire runtime dirtying in `main.ts`**

Change service construction:

```ts
const service = new WarehouseService(repository, undefined, (warehouseId) => runtime.markDirty(warehouseId));
service.registerBlockMaintenance();
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS after correcting event names if needed.

---

## Task 9: API Verification Checklist and In-Game Smoke Test Notes

**Files:**
- Create: `docs/superpowers/plans/2026-06-30-smartwarehouse-mvp-api-verification.md`

- [ ] **Step 1: Create API verification note**

Write this exact checklist into the file:

```markdown
# SmartWarehouse MVP API Verification

Run these checks in a development world with Content Log enabled.

- [ ] Dynamic property single-key safe length: verify that a JSON string near `DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH` writes successfully.
- [ ] Dynamic property overflow: verify oversized writes throw and are caught without corrupting existing warehouse data.
- [ ] Wooden hoe `itemUse`: verify using hoe on air opens the SmartWarehouse menu once.
- [ ] Wooden hoe `itemUseOn`: verify clicking a block does not also open the main menu because of the 250ms de-dupe window.
- [ ] Container menu: verify clicking a chest in a warehouse opens role menu for OP and read-only message for non-OP.
- [ ] Selection: verify clicking non-container block after create flow records point A and point B.
- [ ] Double chest: verify scanning one double chest creates one `StoredContainer` with two `occupiedLocations`.
- [ ] Inventory access: verify chest, trapped chest, barrel, and shulker box expose an inventory component.
- [ ] Unloaded chunk behavior: verify inaccessible containers are skipped without deleting warehouse records.
- [ ] Sorting: verify input chest moves one non-empty slot per scheduler pass into existing same-`typeId` normal container.
- [ ] Misc fallback: verify unclassified items move to misc if no existing same-`typeId` normal container exists and auto-create is disabled.
- [ ] Full misc failure: verify input item remains in input container when no target has space.
```

- [ ] **Step 2: Run final build and lint**

Run:

```bash
npm run build
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Capture final diff**

Run:

```bash
git status --short
git diff -- docs/superpowers/plans scripts
```

Expected: only intended SmartWarehouse MVP files changed.

---

## Self-Review Checklist

- Spec §3 storage is covered by Task 2.
- Spec §4 runtime model is covered by Task 4.
- Spec §5 interaction is covered by Task 5 and Task 7.
- Spec §6 scanner and big chest `occupiedLocations` are covered by Task 3 and Task 8.
- Spec §7 sorting is covered by Task 6.
- Spec §8 safety/API verification is covered by Tasks 1, 2, 7, 8, and 9.
- Spec §9 verification is covered by Task 9.

Remaining implementation risks are intentionally captured as API verification items, not hidden assumptions.
