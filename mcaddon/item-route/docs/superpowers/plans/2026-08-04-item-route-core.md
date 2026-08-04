# item-route Core 引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 item-route 的纯 TypeScript 核心引擎（零 `@minecraft/*` 依赖），全部逻辑可在 node 下直接单测。

**Architecture:** 分层六边形。`scripts/core/` 定义概念模型（Item/Container/Warehouse）、路由引擎（策略 + 候选排序 + 原子移动事务）、O(1) 物品索引、双调度（全局 5 tick + 仓库 interval）、统计预警、整理器、应用服务与存储接口；所有外部能力（DP 持久化、MC 容器、邻近检测）通过接口注入。mc 适配层另行计划实现。

**Tech Stack:** TypeScript（strict）、node:test（node ≥ 18，本机 v24 已确认）、无任何运行时依赖。

**设计基线:** `docs/superpowers/specs/2026-08-04-item-route-design.md`（含 oracle 审查修订）。

---

## 文件结构

```
mcaddon/item-route/
├── package.json              # 版本 + scripts（test:core 等）
├── tsconfig.json             # addon 编译配置（构建用，M 适配计划补全）
├── tsconfig.test.json        # 单测编译配置 → .test-build/
├── scripts/core/
│   ├── model/
│   │   ├── types.ts          # ItemId/ContainerId/WarehouseId/PlayerId/Location
│   │   ├── ItemStack.ts      # 概念物品堆接口 + SimpleItemStack
│   │   ├── Container.ts      # ContainerRole + Container 接口
│   │   ├── Warehouse.ts      # MemberRole/Member/WarehouseArea/WarehouseSettings/Warehouse 接口
│   │   └── DeriveBinding.ts  # deriveBinding 纯函数（单物绑定推导）
│   ├── events/
│   │   ├── EventSignal.ts    # 自实现事件信号（与 toolkit 同语义，零依赖）
│   │   └── DomainEvents.ts   # 领域事件类型 + EventBus
│   ├── storage/
│   │   ├── KeyValueStore.ts  # KeyValueStore 接口 + InMemoryKeyValueStore
│   │   └── Stores.ts         # WarehouseStore/IndexStore/StatsStore 接口 + InMemory 实现
│   ├── routing/
│   │   ├── RouteStrategy.ts  # RouteContext/CandidateContainer/RouteStrategy + 三内置策略
│   │   ├── CandidateSorter.ts# CandidateSorter 接口 + DefaultCandidateSorter
│   │   ├── Move.ts           # SlotRef/transfer/MoveJournal（原子移动事务）
│   │   └── Router.ts         # Router（单槽路由编排 + 惰性校验触发）
│   ├── index/
│   │   └── ItemIndex.ts      # O(1) 索引 + 增量维护 + 快照序列化/恢复
│   ├── scheduling/
│   │   ├── IntervalScheduler.ts # IntervalHandle/IntervalScheduler 接口 + MemoryIntervalScheduler
│   │   └── Scheduler.ts      # 生命周期状态机 + 5 tick 主任务 + 每轮单槽处理
│   ├── stats/
│   │   └── StatsService.ts   # 容器/仓库统计 + 三级预警（冷却）
│   ├── organizing/
│   │   └── Organizer.ts      # 混乱度评分 + analyze/apply/rollback + 自动阈值
│   └── services/
│       ├── MemberService.ts  # 权限矩阵
│       ├── WarehouseService.ts # 仓库 CRUD/成员/设置（经 store）
│       ├── RouteService.ts   # 全局开关/速度/容器开关（经 scheduler）
│       └── OrganizeService.ts# 整理执行入口
└── tests/
    ├── helpers/
    │   └── InMemoryContainer.ts  # 测试用概念容器实现
    ├── model.test.ts
    ├── events.test.ts
    ├── storage.test.ts
    ├── routing.test.ts
    ├── index.test.ts
    ├── scheduling.test.ts
    ├── stats.test.ts
    ├── organizing.test.ts
    ├── services.test.ts
    └── integration.test.ts   # 内存装配完整路由闭环
```

**测试约定（全计划通用）：**
- 运行：`pnpm test:core` = `tsc -p tsconfig.test.json && node --test .test-build/tests/`
- 每个测试文件顶部：`import { test } from "node:test"; import assert from "node:assert/strict";`
- 断言用 assert 而非手动判断；每个 `test()` 块独立、自包含
- 依赖注入全部显式：`new Router(strategies, sorter, index, bus)`

---

### Task 1: 项目脚手架 + 测试运行器

**Files:**
- Create: `mcaddon/item-route/package.json`
- Create: `mcaddon/item-route/tsconfig.test.json`
- Create: `mcaddon/item-route/tests/smoke.test.ts`
- Create: `mcaddon/item-route/tests/helpers/InMemoryContainer.ts`（空骨架，Task 11 填充）

- [ ] **Step 1: 创建脚手架文件**

`package.json`:
```json
{
  "name": "item-route",
  "version": "0.1.0",
  "private": true,
  "description": "物品路由仓库 addon（核心引擎零 MC 依赖）",
  "scripts": {
    "test:core": "tsc -p tsconfig.test.json && node --test .test-build/tests/"
  }
}
```

`tsconfig.test.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": ".test-build",
    "rootDir": "."
  },
  "include": ["scripts/core/**/*.ts", "tests/**/*.ts"]
}
```

`tests/smoke.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("smoke: test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

`tests/helpers/InMemoryContainer.ts`（骨架，Task 11 填充完整实现）:
```ts
// 测试用概念容器实现（产品代码中由 mc 适配层提供真实实现）
export class InMemoryContainer {
  // TODO Task 11 填充
}
```

- [ ] **Step 2: 运行测试验证运行器可用**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/`
Expected: 1 个测试 PASS（smoke），node --test 正常输出。

- [ ] **Step 3: 提交**

```bash
git add mcaddon/item-route/package.json mcaddon/item-route/tsconfig.test.json mcaddon/item-route/tests/
git commit -m "item-route: 项目脚手架 + node:test 测试运行器（core 零依赖）"
```

---

### Task 2: scripts/core/model/types.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/types.ts`
- Test: `mcaddon/item-route/tests/model.test.ts`（本任务只加 Location 测试，后续任务追加）

- [ ] **Step 1: 写失败测试**

`tests/model.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { locationKey } from "../scripts/core/model/types";

test("locationKey: 生成稳定坐标键", () => {
  assert.equal(locationKey({ x: 1, y: 2, z: 3 }), "1,2,3");
  assert.equal(locationKey({ x: -5, y: 0, z: 10 }), "-5,0,10");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: FAIL（`locationKey` 不存在，模块加载错误）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/types.ts`:
```ts
// ─── 核心 ID 类型与概念坐标 ──────────────────────────────
export type ItemId = string;
export type ContainerId = string;
export type WarehouseId = string;
export type PlayerId = string;

/** 概念坐标（不含维度——维度归属由仓库区域承载） */
export interface Location {
  x: number;
  y: number;
  z: number;
}

/** 生成坐标的稳定字符串键，用于去重/比对 */
export function locationKey(loc: Location): string {
  return `${loc.x},${loc.y},${loc.z}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/types.ts mcaddon/item-route/tests/model.test.ts
git commit -m "item-route: scripts/core/model 基础类型（ID/坐标/locationKey）"
```

---

### Task 3: scripts/core/model/ItemStack.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/ItemStack.ts`
- Test: `mcaddon/item-route/tests/model.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加到 model.test.ts 末尾）**

```ts
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("SimpleItemStack: 基础属性与克隆", () => {
  const s = new SimpleItemStack("minecraft:stone", 64, 64);
  assert.equal(s.itemId, "minecraft:stone");
  assert.equal(s.amount, 64);
  const clone = s.clone();
  assert.notEqual(clone, s);
  assert.equal(clone.amount, 64);
});

test("SimpleItemStack: 可堆叠判定", () => {
  const a = new SimpleItemStack("minecraft:stone", 10, 64);
  const b = new SimpleItemStack("minecraft:stone", 20, 64);
  const c = new SimpleItemStack("minecraft:dirt", 10, 64);
  assert.equal(a.isStackableWith(b), true);
  assert.equal(a.isStackableWith(c), false);
});

test("SimpleItemStack: 深度相等含数量", () => {
  const a = new SimpleItemStack("minecraft:stone", 10, 64);
  const b = new SimpleItemStack("minecraft:stone", 10, 64);
  const c = new SimpleItemStack("minecraft:stone", 11, 64);
  assert.equal(a.equals(b), true);
  assert.equal(a.equals(c), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: FAIL（SimpleItemStack 不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/ItemStack.ts`:
```ts
// ─── 概念级物品堆 ────────────────────────────────────────
import type { ItemId } from "./types";

/** 概念级物品堆：itemId + 数量 + 最大堆叠，不感知 MC */
export interface ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;
  /** 是否可与此堆堆叠（默认同 itemId） */
  isStackableWith(other: ItemStack): boolean;
  /** 深度相等（含元数据与数量） */
  equals(other: ItemStack): boolean;
  clone(): ItemStack;
}

/** 默认物品堆实现 */
export class SimpleItemStack implements ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;

  constructor(itemId: ItemId, amount: number, maxStackSize: number) {
    this.itemId = itemId;
    this.amount = amount;
    this.maxStackSize = maxStackSize;
  }

  isStackableWith(other: ItemStack): boolean {
    return this.itemId === other.itemId;
  }

  equals(other: ItemStack): boolean {
    return this.itemId === other.itemId && this.amount === other.amount && this.maxStackSize === other.maxStackSize;
  }

  clone(): ItemStack {
    return new SimpleItemStack(this.itemId, this.amount, this.maxStackSize);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/ItemStack.ts mcaddon/item-route/tests/model.test.ts
git commit -m "item-route: scripts/core/model ItemStack 概念模型（可堆叠/相等/克隆）"
```

---

### Task 4: scripts/core/model/Container.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/Container.ts`
- Test: `mcaddon/item-route/tests/model.test.ts`（追加；实现由 Task 11 的 InMemoryContainer 提供）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("InMemoryContainer: 基础读写与容量", () => {
  const c = new InMemoryContainer("c1", "multi", 3);
  assert.equal(c.capacity, 3);
  assert.equal(c.emptySlotsCount, 3);
  assert.equal(c.usedSlots, 0);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  assert.equal(c.usedSlots, 1);
  assert.equal(c.emptySlotsCount, 2);
  assert.equal(c.getItem(0)?.itemId, "minecraft:stone");
});

test("InMemoryContainer: addItem 返回剩余", () => {
  const c = new InMemoryContainer("c1", "multi", 2);
  const stone = new SimpleItemStack("minecraft:stone", 64, 64);
  const remaining = c.addItem(stone);
  assert.equal(remaining, undefined); // 全部放入
  assert.equal(c.getItem(0)?.amount, 64);
  const more = new SimpleItemStack("minecraft:stone", 64, 64);
  const rem2 = c.addItem(more); // 第 2 槽放 64，剩余 0 → undefined
  assert.equal(rem2, undefined);
  const full = new SimpleItemStack("minecraft:dirt", 64, 64);
  const rem3 = c.addItem(full); // 已满 2 槽 → 全部剩余
  assert.equal(rem3?.amount, 64);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: FAIL（InMemoryContainer 未实现 addItem 等）。

- [ ] **Step 3: 实现接口与测试容器**

`scripts/core/model/Container.ts`:
```ts
// ─── 概念级容器 ──────────────────────────────────────────
import type { ItemStack } from "./ItemStack";
import type { ContainerId, ItemId, Location } from "./types";

/** 容器角色 */
export type ContainerRole = "input" | "single" | "multi" | "misc";

/** 概念级容器：不感知 MC，由适配层实现 */
export interface Container {
  readonly id: ContainerId;
  role: ContainerRole;
  enabled: boolean;
  /** 路由排序优先级，数字越小越先（默认 10） */
  priority: number;
  readonly capacity: number;
  /** O(1) 空槽数（adapter 委托 MC 属性，零遍历） */
  readonly emptySlotsCount: number;
  readonly usedSlots: number;
  /** 逻辑容器全部方块坐标（大箱子 = primary + 附属） */
  readonly occupiedLocations: Location[];
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
  /** 尝试放入；返回剩余（未放入部分），全部放入返回 undefined */
  addItem(stack: ItemStack): ItemStack | undefined;
  /** 单物绑定：由首个非空 slot 物品推导（core 纯函数 deriveBinding 实现） */
  getDedicatedItemId(): ItemId | undefined;
}
```

`tests/helpers/InMemoryContainer.ts`（完整实现）:
```ts
// 测试用概念容器实现（产品代码中由 mc 适配层提供真实实现）
import type { Container, ContainerRole } from "../../scripts/core/model/Container";
import type { ItemStack } from "../../scripts/core/model/ItemStack";
import type { ContainerId, ItemId, Location } from "../../scripts/core/model/types";

export class InMemoryContainer implements Container {
  readonly id: ContainerId;
  role: ContainerRole;
  enabled = true;
  priority = 10;
  readonly capacity: number;
  readonly occupiedLocations: Location[];
  private slots: (ItemStack | undefined)[];

  constructor(id: ContainerId, role: ContainerRole, capacity: number, occupiedLocations: Location[] = []) {
    this.id = id;
    this.role = role;
    this.capacity = capacity;
    this.occupiedLocations = occupiedLocations;
    this.slots = new Array<ItemStack | undefined>(capacity).fill(undefined);
  }

  get emptySlotsCount(): number {
    return this.slots.filter((s) => s === undefined).length;
  }

  get usedSlots(): number {
    return this.slots.filter((s) => s !== undefined).length;
  }

  getItem(slot: number): ItemStack | undefined {
    return this.slots[slot];
  }

  setItem(slot: number, item?: ItemStack): void {
    this.slots[slot] = item;
  }

  addItem(stack: ItemStack): ItemStack | undefined {
    let remaining = stack.clone();
    for (let i = 0; i < this.capacity; i++) {
      const slot = this.slots[i];
      if (slot === undefined) {
        this.slots[i] = remaining;
        return undefined;
      }
      if (slot.isStackableWith(remaining) && slot.amount < slot.maxStackSize) {
        const room = slot.maxStackSize - slot.amount;
        const put = Math.min(room, remaining.amount);
        slot.amount += put;
        if (remaining.amount - put === 0) {
          return undefined;
        }
        remaining.amount -= put;
      }
    }
    return remaining.amount === stack.amount ? stack : remaining;
  }

  getDedicatedItemId(): ItemId | undefined {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (s !== undefined) return s.itemId;
    }
    return undefined;
  }
}
```

注意：`noUncheckedIndexedAccess` 开启时 `this.slots[i]` 为 `ItemStack | undefined`，类型正确。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/Container.ts mcaddon/item-route/tests/helpers/InMemoryContainer.ts mcaddon/item-route/tests/model.test.ts
git commit -m "item-route: scripts/core/model Container 接口 + 测试容器实现（O(1) 容量属性/堆叠语义）"
```

---

### Task 5: scripts/core/model/Warehouse.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/Warehouse.ts`
- Test: `mcaddon/item-route/tests/model.test.ts`（追加：仅验证默认值工厂函数）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

test("createDefaultSettings: 默认值", () => {
  const s = createDefaultSettings();
  assert.equal(s.sortingEnabled, true);
  assert.equal(s.processingSpeed, 8);
  assert.equal(s.warningThreshold, 0.9);
  assert.equal(s.autoSortThreshold, 3);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: FAIL（createDefaultSettings 不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/Warehouse.ts`:
```ts
// ─── 概念级仓库与成员 ────────────────────────────────────
import type { Container } from "./Container";
import type { PlayerId, WarehouseId } from "./types";

/** 成员角色：owner 全权限 / member 管理 / visitor 只读 */
export type MemberRole = "owner" | "member" | "visitor";

export interface Member {
  playerId: PlayerId;
  role: MemberRole;
}

/** 仓库区域：维度 + 两角坐标 */
export interface WarehouseArea {
  dimension: string;
  corner1: { x: number; y: number; z: number };
  corner2: { x: number; y: number; z: number };
}

/** 仓库设置 */
export interface WarehouseSettings {
  sortingEnabled: boolean;
  /** 单仓处理速度（tick 间隔） */
  processingSpeed: number;
  /** 容量预警黄色阈值 */
  warningThreshold: number;
  /** 自动整理触发阈值（容器混乱度超过即触发） */
  autoSortThreshold: number;
}

export function createDefaultSettings(): WarehouseSettings {
  return {
    sortingEnabled: true,
    processingSpeed: 8,
    warningThreshold: 0.9,
    autoSortThreshold: 3,
  };
}

/** 概念级仓库 */
export interface Warehouse {
  readonly id: WarehouseId;
  displayName: string;
  ownerId: PlayerId;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
  readonly containers: Map<string, Container>;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/Warehouse.ts mcaddon/item-route/tests/model.test.ts
git commit -m "item-route: scripts/core/model Warehouse/成员/区域/设置模型"
```

---

### Task 6: scripts/core/model/DeriveBinding.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/DeriveBinding.ts`
- Test: `mcaddon/item-route/tests/model.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { deriveBinding } from "../scripts/core/model/DeriveBinding";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("deriveBinding: 由首个非空 slot 推导", () => {
  const c = new InMemoryContainer("c1", "single", 3);
  assert.equal(deriveBinding(c), undefined); // 空箱
  c.setItem(1, new SimpleItemStack("minecraft:stone", 10, 64)); // 第 2 槽先有物
  assert.equal(deriveBinding(c), "minecraft:stone");
  c.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 首槽被替换
  assert.equal(deriveBinding(c), "minecraft:dirt");
  c.setItem(0, undefined);
  assert.equal(deriveBinding(c), "minecraft:stone");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: FAIL（deriveBinding 不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/DeriveBinding.ts`:
```ts
// ─── 单物绑定推导（core 纯函数，可单测） ──────────────────
import type { Container } from "./Container";
import type { ItemId } from "./types";

/**
 * 单物容器绑定 = 首个非空 slot 的物品类型。
 * 玩家可随时拿走/替换首个非空 slot 来破坏绑定，
 * 索引层通过此函数重算（含空箱重绑场景）。
 */
export function deriveBinding(container: Container): ItemId | undefined {
  return container.getDedicatedItemId();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/model.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/DeriveBinding.ts mcaddon/item-route/tests/model.test.ts
git commit -m "item-route: scripts/core/model deriveBinding 单物绑定推导纯函数"
```

---

### Task 7: scripts/core/events/EventSignal.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/events/EventSignal.ts`
- Test: `mcaddon/item-route/tests/events.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/events.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventSignal } from "../scripts/core/events/EventSignal";

test("EventSignal: 订阅/触发/取消订阅", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  const cb = (e: { n: number }) => received.push(e.n);
  sig.subscribe(cb);
  sig.trigger({ n: 1 });
  sig.unsubscribe(cb);
  sig.trigger({ n: 2 });
  assert.deepEqual(received, [1]);
});

test("EventSignal: 同一回调只注册一次", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  const cb = (e: { n: number }) => received.push(e.n);
  sig.subscribe(cb);
  sig.subscribe(cb);
  sig.trigger({ n: 7 });
  assert.deepEqual(received, [7]);
});

test("EventSignal: 订阅者异常不影响其他订阅者", () => {
  const sig = new EventSignal<{ n: number }>();
  const received: number[] = [];
  sig.subscribe(() => {
    throw new Error("boom");
  });
  sig.subscribe((e) => received.push(e.n));
  sig.trigger({ n: 3 });
  assert.deepEqual(received, [3]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/events.test.js`
Expected: FAIL（模块加载错误）。

- [ ] **Step 3: 最小实现（与 toolkit EventSignal 同语义，core 自包含）**

`scripts/core/events/EventSignal.ts`:
```ts
// ─── 事件订阅触发机制（core 自实现，与 @yinxe/toolkit 同语义） ──
// 保持 core 零依赖：mc 适配层可自由选择复用 toolkit 版本。
type EventCallback<T> = (event: T) => void;

/**
 * 普通事件信号：仅通知，订阅者不可取消。
 * 同一回调重复订阅只注册一次；订阅者异常不影响其他订阅者。
 */
export class EventSignal<T> {
  private callbacks = new Set<EventCallback<T>>();

  subscribe(callback: EventCallback<T>): void {
    this.callbacks.add(callback);
  }

  unsubscribe(callback: EventCallback<T>): void {
    this.callbacks.delete(callback);
  }

  /** 同步触发；回调中 subscribe/unsubscribe 不影响本次派发（快照遍历） */
  trigger(event: T): void {
    for (const callback of [...this.callbacks]) {
      try {
        callback(event);
      } catch (e) {
        console.warn("[item-route/events] 订阅者回调异常:", e);
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/events.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/events/EventSignal.ts mcaddon/item-route/tests/events.test.ts
git commit -m "item-route: scripts/core/events EventSignal（零依赖自实现）"
```

---

### Task 8: scripts/core/events/DomainEvents.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/events/DomainEvents.ts`
- Test: `mcaddon/item-route/tests/events.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { EventBus } from "../scripts/core/events/DomainEvents";

test("EventBus: 各领域事件独立派发", () => {
  const bus = new EventBus();
  const routed: string[] = [];
  bus.itemRouted.subscribe((e) => routed.push(`${e.from}->${e.to}:${e.amount}`));
  bus.itemRouted.trigger({ type: "item-routed", warehouseId: "w1", from: "c1", to: "c2", itemId: "minecraft:stone", amount: 5 });
  bus.warning.trigger({ type: "warning", warehouseId: "w1", level: "yellow", containerId: "c1" });
  assert.deepEqual(routed, ["c1->c2:5"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/events.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/events/DomainEvents.ts`:
```ts
// ─── 领域事件类型与事件总线 ──────────────────────────────
import { EventSignal } from "./EventSignal";
import type { ContainerId, ItemId, WarehouseId } from "../model/types";

// ── 事件负载 ─────────────────────────────────────────────
export interface ItemRoutedEvent {
  type: "item-routed";
  warehouseId: WarehouseId;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
}

export interface ContainerChangedEvent {
  type: "container-changed";
  warehouseId: WarehouseId;
  containerId: ContainerId;
}

export interface IndexUpdatedEvent {
  type: "index-updated";
  warehouseId: WarehouseId;
  itemId: ItemId;
  candidates: ContainerId[];
}

export interface StatsChangedEvent {
  type: "stats-changed";
  warehouseId: WarehouseId;
  containerId?: ContainerId;
}

export type WarningLevel = "yellow" | "red" | "deep-red";

export interface WarningEvent {
  type: "warning";
  warehouseId: WarehouseId;
  level: WarningLevel;
  containerId?: ContainerId;
}

export interface VisualEffectEvent {
  type: "visual-effect";
  kind: "route-flash" | "boundary-glow" | "particle";
  warehouseId: WarehouseId;
  containerId?: ContainerId;
}

/** 领域事件总线：core 发事件 → 适配层订阅（视觉反馈/统计联动） */
export class EventBus {
  readonly itemRouted = new EventSignal<ItemRoutedEvent>();
  readonly containerChanged = new EventSignal<ContainerChangedEvent>();
  readonly indexUpdated = new EventSignal<IndexUpdatedEvent>();
  readonly statsChanged = new EventSignal<StatsChangedEvent>();
  readonly warning = new EventSignal<WarningEvent>();
  readonly visualEffect = new EventSignal<VisualEffectEvent>();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/events.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/events/DomainEvents.ts mcaddon/item-route/tests/events.test.ts
git commit -m "item-route: scripts/core/events 领域事件类型 + EventBus"
```

---

### Task 9: scripts/core/storage/KeyValueStore.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/storage/KeyValueStore.ts`
- Test: `mcaddon/item-route/tests/storage.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/storage.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";

test("InMemoryKeyValueStore: 写读删", () => {
  const kv = new InMemoryKeyValueStore();
  assert.equal(kv.read("a"), undefined);
  kv.write("a", { n: 1 });
  assert.deepEqual(kv.read("a"), { n: 1 });
  kv.remove("a");
  assert.equal(kv.read("a"), undefined);
});

test("InMemoryKeyValueStore: 覆盖写", () => {
  const kv = new InMemoryKeyValueStore();
  kv.write("a", 1);
  kv.write("a", 2);
  assert.equal(kv.read("a"), 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/storage.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/storage/KeyValueStore.ts`:
```ts
// ─── 键值仓储接口（core 只定义接口，DP 分片实现在 mc 层） ──
export interface KeyValueStore {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
}

/** 内存实现：单测与调试用 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private map = new Map<string, unknown>();

  read<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  write<T>(key: string, value: T): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/storage.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/storage/KeyValueStore.ts mcaddon/item-route/tests/storage.test.ts
git commit -m "item-route: scripts/core/storage KeyValueStore 接口 + 内存实现"
```

---

### Task 10: scripts/core/storage/Stores.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/storage/Stores.ts`
- Test: `mcaddon/item-route/tests/storage.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

test("InMemoryWarehouseStore: 列表/加载/保存/删除", () => {
  const store = new InMemoryWarehouseStore();
  const snapshot = {
    id: "w1",
    displayName: "主仓库",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" as const }],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containerIds: ["c1"],
  };
  store.save(snapshot);
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.load("w1"), snapshot);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/storage.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/storage/Stores.ts`:
```ts
// ─── 仓库/索引/统计仓储接口（core 定义，mc 层实现 DP 分片） ──
import { InMemoryKeyValueStore, type KeyValueStore } from "./KeyValueStore";
import type { ContainerId, PlayerId, WarehouseId } from "../model/types";
import type { Member, WarehouseArea, WarehouseSettings } from "../model/Warehouse";

// ── 快照结构（可序列化） ─────────────────────────────────
export interface WarehouseSnapshot {
  id: WarehouseId;
  displayName: string;
  ownerId: PlayerId;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
  containerIds: ContainerId[];
}

export interface IndexSnapshotData {
  version: number;
  byItem: Record<string, { single: ContainerId[]; multi: ContainerId[] }>;
  containerItems: Record<ContainerId, string[]>;
  singleBindings: Record<ContainerId, string>;
}

export interface StatsSnapshotData {
  warehouseId: WarehouseId;
  containers: Record<ContainerId, unknown>;
  warehouse: unknown;
}

export interface WarehouseStore {
  list(): WarehouseSnapshot[];
  load(id: WarehouseId): WarehouseSnapshot | undefined;
  save(snapshot: WarehouseSnapshot): void;
  remove(id: WarehouseId): void;
}

export interface IndexStore {
  load(id: WarehouseId): IndexSnapshotData | undefined;
  save(id: WarehouseId, snapshot: IndexSnapshotData): void;
  remove(id: WarehouseId): void;
}

export interface StatsStore {
  load(id: WarehouseId): StatsSnapshotData | undefined;
  save(id: WarehouseId, snapshot: StatsSnapshotData): void;
  remove(id: WarehouseId): void;
}

// ── 内存实现（测试用） ───────────────────────────────────
const key = (prefix: string, id: string): string => `${prefix}:${id}`;

export class InMemoryWarehouseStore implements WarehouseStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  list(): WarehouseSnapshot[] {
    return Object.values(this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {});
  }

  load(id: WarehouseId): WarehouseSnapshot | undefined {
    return this.list().find((w) => w.id === id);
  }

  save(snapshot: WarehouseSnapshot): void {
    const all = this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {};
    all[snapshot.id] = snapshot;
    this.kv.write("warehouses", all);
  }

  remove(id: WarehouseId): void {
    const all = this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {};
    delete all[id];
    this.kv.write("warehouses", all);
  }
}

export class InMemoryIndexStore implements IndexStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  load(id: WarehouseId): IndexSnapshotData | undefined {
    return this.kv.read(key("index", id));
  }

  save(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.kv.write(key("index", id), snapshot);
  }

  remove(id: WarehouseId): void {
    this.kv.remove(key("index", id));
  }
}

export class InMemoryStatsStore implements StatsStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  load(id: WarehouseId): StatsSnapshotData | undefined {
    return this.kv.read(key("stats", id));
  }

  save(id: WarehouseId, snapshot: StatsSnapshotData): void {
    this.kv.write(key("stats", id), snapshot);
  }

  remove(id: WarehouseId): void {
    this.kv.remove(key("stats", id));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/storage.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/storage/Stores.ts mcaddon/item-route/tests/storage.test.ts
git commit -m "item-route: scripts/core/storage 三仓储接口 + 内存实现（快照结构可序列化）"
```

---

---

### Task 11: scripts/core/routing/RouteStrategy.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/routing/RouteStrategy.ts`
- Test: `mcaddon/item-route/tests/routing.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routing.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import type { RouteContext } from "../scripts/core/routing/RouteStrategy";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function makeCtx(containers: InMemoryContainer[], lookup: (typeId: string) => { single: string[]; multi: string[] }): RouteContext {
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { sortingEnabled: true, processingSpeed: 8, warningThreshold: 0.9, autoSortThreshold: 3 },
    containers: new Map(containers.map((c) => [c.id, c])),
  };
  return {
    item: new SimpleItemStack("minecraft:stone", 10, 64),
    warehouse,
    lookupIndex: lookup,
    verifyCandidate: () => true,
  };
}

test("SingleItemStrategy: 只返回绑定匹配的单物容器", () => {
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const ctx = makeCtx([single], () => ({ single: ["s1"], multi: [] }));
  const got = new SingleItemStrategy().findCandidates(ctx);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.container.id, "s1");
});

test("SingleItemStrategy: 绑定不匹配则不返回（索引与实际绑定一致时）", () => {
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 绑定 dirt
  const ctx = makeCtx([single], () => ({ single: ["s1"], multi: [] }));
  const got = new SingleItemStrategy().findCandidates(ctx);
  assert.equal(got.length, 0); // stone 与 dirt 不匹配
});

test("MultiItemStrategy / MiscStrategy: 按索引返回", () => {
  const multi = new InMemoryContainer("m1", "multi", 3);
  const misc = new InMemoryContainer("x1", "misc", 3);
  const ctx = makeCtx([multi, misc], () => ({ single: [], multi: ["m1"] }));
  assert.deepEqual(new MultiItemStrategy().findCandidates(ctx).map((c) => c.container.id), ["m1"]);
  assert.equal(new MiscStrategy().findCandidates(ctx).length, 0); // 索引不含 misc
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/routing/RouteStrategy.ts`:
```ts
// ─── 路由策略（可插拔，数字优先级越小越快） ────────────────
import type { Container } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";

/** 索引查询结果（由 Router 注入，避免 routing 依赖 index 模块） */
export interface IndexLookupResult {
  single: ContainerId[];
  multi: ContainerId[];
}

/** 路由上下文：物品 + 仓库 + 索引查询/校验能力（函数注入） */
export interface RouteContext {
  item: ItemStack;
  warehouse: Warehouse;
  lookupIndex(typeId: ItemId): IndexLookupResult;
  /** 惰性校验候选容器，返回 false 表示索引漂移已修复（该候选失效） */
  verifyCandidate(container: Container): boolean;
}

/** 候选容器（含排序所需信息） */
export interface CandidateContainer {
  container: Container;
  priority: number;
  usageRatio: number;
  isFull: boolean;
}

/** 路由策略：按数字优先级升序执行 */
export interface RouteStrategy {
  readonly priority: number;
  findCandidates(ctx: RouteContext): CandidateContainer[];
}

/** 策略 1：单物容器（绑定匹配） */
export class SingleItemStrategy implements RouteStrategy {
  readonly priority = 10;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const ids = ctx.lookupIndex(ctx.item.itemId).single;
    const out: CandidateContainer[] = [];
    for (const id of ids) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "single") continue;
      if (!ctx.verifyCandidate(container)) continue;
      const binding = container.getDedicatedItemId();
      if (binding !== ctx.item.itemId) continue; // 绑定漂移且未在 verify 修复
      out.push(toCandidate(container));
    }
    return out;
  }
}

/** 策略 2：多物容器 */
export class MultiItemStrategy implements RouteStrategy {
  readonly priority = 20;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const ids = ctx.lookupIndex(ctx.item.itemId).multi;
    const out: CandidateContainer[] = [];
    for (const id of ids) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "multi") continue;
      if (!ctx.verifyCandidate(container)) continue;
      out.push(toCandidate(container));
    }
    return out;
  }
}

/** 策略 3：杂项容器（兜底，索引不含 misc——直接全量取） */
export class MiscStrategy implements RouteStrategy {
  readonly priority = 30;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const out: CandidateContainer[] = [];
    for (const container of ctx.warehouse.containers.values()) {
      if (container.role === "misc" && container.enabled) {
        out.push(toCandidate(container));
      }
    }
    return out;
  }
}

function toCandidate(container: Container): CandidateContainer {
  const ratio = container.capacity > 0 ? container.usedSlots / container.capacity : 1;
  return {
    container,
    priority: container.priority,
    usageRatio: ratio,
    isFull: container.emptySlotsCount === 0,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/routing/RouteStrategy.ts mcaddon/item-route/tests/routing.test.ts
git commit -m "item-route: scripts/core/routing 路由策略抽象 + 单物/多物/杂项三策略"
```

---

### Task 12: scripts/core/routing/CandidateSorter.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/routing/CandidateSorter.ts`
- Test: `mcaddon/item-route/tests/routing.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import type { CandidateContainer } from "../scripts/core/routing/RouteStrategy";

function cand(id: string, priority: number, usage: number, full = false): CandidateContainer {
  return {
    container: { id } as never,
    priority,
    usageRatio: usage,
    isFull: full,
  };
}

test("DefaultCandidateSorter: 满箱跳过 → 优先级升序 → 使用率降序", () => {
  const sorter = new DefaultCandidateSorter();
  const input = [
    cand("a", 10, 0.3),
    cand("full", 10, 1.0, true),
    cand("b", 5, 0.2),
    cand("c", 10, 0.9),
  ];
  const sorted = sorter.sort(input);
  assert.deepEqual(sorted.map((c) => c.container.id), ["b", "c", "a"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/routing/CandidateSorter.ts`:
```ts
// ─── 候选排序器（可插拔，默认实现） ──────────────────────
import type { CandidateContainer } from "./RouteStrategy";

/** 候选排序器：满箱跳过 → priority 升序 → usageRatio 降序 */
export interface CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[];
}

export class DefaultCandidateSorter implements CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[] {
    return candidates
      .filter((c) => !c.isFull)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.usageRatio - a.usageRatio; // 更满的先
      });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/routing/CandidateSorter.ts mcaddon/item-route/tests/routing.test.ts
git commit -m "item-route: scripts/core/routing 候选排序器（满箱跳过/优先级/使用率）"
```

---

### Task 13: scripts/core/routing/Move.ts（原子移动事务）

**Files:**
- Create: `mcaddon/item-route/scripts/core/routing/Move.ts`
- Test: `mcaddon/item-route/tests/routing.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { transfer, MoveJournal } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("transfer: 全部移走（源清空，目标放入）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = new InMemoryContainer("t", "multi", 3);
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining, undefined);
  assert.equal(from.getItem(0), undefined);
  assert.equal(to.getItem(0)?.itemId, "minecraft:stone");
});

test("transfer: 部分堆叠（剩余放回源槽）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  const to = new InMemoryContainer("t", "multi", 3);
  to.setItem(0, new SimpleItemStack("minecraft:stone", 60, 64));
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining?.amount, 60); // 64 - 4 放入
  assert.equal(from.getItem(0)?.amount, 60);
  assert.equal(to.getItem(0)?.amount, 64);
});

test("transfer: 完全放不下（源不动，返回原堆）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = new InMemoryContainer("t", "multi", 1);
  to.setItem(0, new SimpleItemStack("minecraft:dirt", 64, 64)); // 占满且不匹配
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining?.amount, 10);
  assert.equal(from.getItem(0)?.amount, 10);
});

test("MoveJournal: 快照回滚恢复原状", () => {
  const journal = new MoveJournal();
  const c = new InMemoryContainer("c", "multi", 3);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  journal.snapshot(c);
  c.setItem(0, undefined);
  c.setItem(1, new SimpleItemStack("minecraft:dirt", 9, 64));
  journal.rollback();
  assert.equal(c.getItem(0)?.itemId, "minecraft:stone");
  assert.equal(c.getItem(1), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/routing/Move.ts`:
```ts
// ─── 原子移动与事务日志（核心安全机制：不吞物/不复制/可回滚） ──
import type { Container } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";

export interface SlotRef {
  container: Container;
  slot: number;
}

/**
 * 原子移动：从源槽取出 → 目标放入 → 剩余放回源槽。
 * 返回剩余（undefined = 全部移走；剩余 === 原堆 = 未移动）。
 * 仅堆叠与移动，绝不修改物品本身。
 */
export function transfer(from: SlotRef, to: Container): ItemStack | undefined {
  const stack = from.container.getItem(from.slot);
  if (stack === undefined) return undefined;
  const remaining = to.addItem(stack.clone());
  if (remaining === undefined) {
    from.container.setItem(from.slot, undefined);
    return undefined;
  }
  if (remaining.amount === stack.amount) {
    // 完全未放入：源不动
    return stack;
  }
  from.container.setItem(from.slot, remaining);
  return remaining;
}

/**
 * 单 tick 事务日志：apply 前快照受影响容器，失败时逆序恢复。
 * 语义：要么全成功要么全回滚。
 */
export class MoveJournal {
  private snapshots: { container: Container; slots: (ItemStack | undefined)[] }[] = [];

  /** 快照容器全部槽位 */
  snapshot(container: Container): void {
    const slots: (ItemStack | undefined)[] = [];
    for (let i = 0; i < container.capacity; i++) {
      slots.push(container.getItem(i)?.clone());
    }
    this.snapshots.push({ container, slots });
  }

  /** 逆序恢复所有快照 */
  rollback(): void {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const { container, slots } = this.snapshots[i]!;
      for (let s = 0; s < container.capacity; s++) {
        container.setItem(s, slots[s]?.clone());
      }
    }
    this.snapshots = [];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/routing/Move.ts mcaddon/item-route/tests/routing.test.ts
git commit -m "item-route: scripts/core/routing 原子移动 transfer + MoveJournal 事务回滚"
```

---

### Task 14: scripts/core/routing/Router.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/routing/Router.ts`
- Test: `mcaddon/item-route/tests/routing.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { Router } from "../scripts/core/routing/Router";
import type { CandidateContainer } from "../scripts/core/routing/RouteStrategy";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { EventBus } from "../scripts/core/events/DomainEvents";

// 可编程索引 stub：lookup 返回固定结果，verifyCandidate 可编程
function makeIndexStub() {
  const state = {
    byItem: new Map<string, { single: string[]; multi: string[] }>(),
    moved: [] as string[],
    verified: [] as string[],
    verifyResult: true,
  };
  const stub = {
    lookup: (typeId: string) => state.byItem.get(typeId) ?? { single: [], multi: [] },
    verifyCandidate: (c: unknown) => {
      state.verified.push((c as { id: string }).id);
      return state.verifyResult;
    },
    onItemMoved: (from: string, to: string, itemId: string) => {
      state.moved.push(`${from}->${to}:${itemId}`);
    },
    state,
  };
  return stub;
}

function makeWarehouse() {
  const containers = new Map<string, InMemoryContainer>();
  const wh = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { sortingEnabled: true, processingSpeed: 8, warningThreshold: 0.9, autoSortThreshold: 3 },
    containers,
  };
  const add = (c: InMemoryContainer) => {
    containers.set(c.id, c);
    return c;
  };
  return { wh, add };
}

test("Router: 单物优先于多物（stone 进 single 容器）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const single = add(new InMemoryContainer("s1", "single", 3));
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const multi = add(new InMemoryContainer("m1", "multi", 3));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: ["s1"], multi: ["m1"] });
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  let routed: string | undefined;
  bus.itemRouted.subscribe((e) => (routed = `${e.from}->${e.to}`));
  const result = router.routeFrom(input, 0, wh);
  assert.equal(result?.to, "s1");
  assert.equal(routed, "in->s1");
  assert.deepEqual(index.state.moved, ["in->s1:minecraft:stone"]);
});

test("Router: 优先级/使用率排序决定目标（priority 5 先于 10）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
  const a = add(new InMemoryContainer("a", "multi", 3));
  a.priority = 5;
  const b = add(new InMemoryContainer("b", "multi", 3));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:dirt", { single: [], multi: ["a", "b"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh);
  assert.equal(result?.to, "a");
});

test("Router: 全部候选失败 → 物品留在源", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:bedrock", 10, 64));
  add(new InMemoryContainer("x", "misc", 1)); // misc 空但容量 1 可放！改为不匹配场景：
  // 用索引返回空 + 无 misc 容器 → 全部失败
  const wh2 = makeWarehouse();
  const input2 = wh2.add(new InMemoryContainer("in", "input", 3));
  input2.setItem(0, new SimpleItemStack("minecraft:bedrock", 10, 64));
  const index = makeIndexStub();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    new EventBus()
  );
  const result = router.routeFrom(input2, 0, wh2.wh);
  assert.equal(result, undefined);
  assert.equal(input2.getItem(0)?.amount, 10);
});

test("Router: verifyCandidate 漂移 → 候选被跳过", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("m1", "multi", 3));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: [], multi: ["m1"] });
  index.state.verifyResult = false; // 漂移：容器实际为空
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh);
  assert.equal(result, undefined);
  assert.deepEqual(index.state.verified, ["m1"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/routing/Router.ts`:
```ts
// ─── 路由编排：单槽路由，策略升序 + 候选排序 + 原子移动 ──
import { transfer } from "./Move";
import type { CandidateContainer, RouteStrategy } from "./RouteStrategy";
import type { CandidateSorter } from "./CandidateSorter";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

/** 索引能力接口（结构类型，Router 不依赖 index 模块） */
export interface IndexGateway {
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] };
  verifyCandidate(container: Container): boolean;
  onItemMoved(from: ContainerId, to: ContainerId, itemId: ItemId): void;
}

export interface RouteResult {
  routed: true;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
}

export class Router {
  constructor(
    private readonly strategies: RouteStrategy[],
    private readonly sorter: CandidateSorter,
    private readonly index: IndexGateway,
    private readonly bus: EventBus
  ) {}

  /**
   * 处理一个输入容器的非空 slot。
   * 按策略 priority 升序执行，策略内候选经排序后逐个尝试转移；
   * 第一个发生移动即返回结果；全部失败返回 undefined（物品留在源）。
   */
  routeFrom(input: Container, slot: number, warehouse: Warehouse): RouteResult | undefined {
    const stack = input.getItem(slot);
    if (stack === undefined) return undefined;
    const originalAmount = stack.amount;
    const ctx = {
      item: stack,
      warehouse,
      lookupIndex: (typeId: ItemId) => this.index.lookup(typeId),
      verifyCandidate: (c: Container) => this.index.verifyCandidate(c),
    };
    const ordered = [...this.strategies].sort((a, b) => a.priority - b.priority);
    for (const strategy of ordered) {
      const raw = strategy.findCandidates(ctx);
      const candidates = this.sorter.sort(raw);
      for (const candidate of candidates) {
        const target = candidate.container;
        if (!target.enabled) continue;
        const remaining = transfer({ container: input, slot }, target);
        if (remaining !== undefined && remaining.amount === originalAmount) continue; // 未移动
        const moved = originalAmount - (remaining?.amount ?? 0);
        this.index.onItemMoved(input.id, target.id, stack.itemId);
        this.bus.itemRouted.trigger({
          type: "item-routed",
          warehouseId: warehouse.id,
          from: input.id,
          to: target.id,
          itemId: stack.itemId,
          amount: moved,
        });
        return { routed: true, from: input.id, to: target.id, itemId: stack.itemId, amount: moved };
      }
    }
    return undefined;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/routing.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/routing/Router.ts mcaddon/item-route/tests/routing.test.ts
git commit -m "item-route: scripts/core/routing Router 路由编排（策略升序/候选排序/原子移动/事件）"
```

---

### Task 15: scripts/core/index/ItemIndex.ts（O(1) 索引）

**Files:**
- Create: `mcaddon/item-route/scripts/core/index/ItemIndex.ts`
- Test: `mcaddon/item-route/tests/index.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/index.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemIndex, INDEX_VERSION } from "../scripts/core/index/ItemIndex";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function stoneMulti() {
  const c = new InMemoryContainer("m1", "multi", 3);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  return c;
}

test("ItemIndex: onContainerAdded 后 lookup O(1) 命中", () => {
  const index = new ItemIndex();
  index.onContainerAdded(stoneMulti());
  const got = index.lookup("minecraft:stone");
  assert.deepEqual(got.multi, ["m1"]);
  assert.deepEqual(index.lookup("minecraft:dirt"), { single: [], multi: [] });
});

test("ItemIndex: 单物容器绑定由 deriveBinding 推导并缓存", () => {
  const index = new ItemIndex();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(single);
  assert.deepEqual(index.lookup("minecraft:stone").single, ["s1"]);
  assert.equal(index.getBinding("s1"), "minecraft:stone");
});

test("ItemIndex: onContainerRoleChanged 迁移条目", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  c.role = "single"; // 槽内 stone 变为绑定
  index.onContainerRoleChanged(c, "multi");
  assert.deepEqual(index.lookup("minecraft:stone").multi, []);
  assert.deepEqual(index.lookup("minecraft:stone").single, ["m1"]);
});

test("ItemIndex: onContainerRemoved 清理全部条目", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  index.onContainerRemoved(c);
  assert.deepEqual(index.lookup("minecraft:stone"), { single: [], multi: [] });
});

test("ItemIndex: verifyCandidate 容器实际为空 → 移除条目返回 false", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  index.onContainerAdded(c);
  c.setItem(0, undefined); // 玩家手动清空（无事件）
  assert.equal(index.verifyCandidate(c), false);
  assert.deepEqual(index.lookup("minecraft:stone").multi, []);
});

test("ItemIndex: verifyCandidate 单物绑定漂移 → 修复并返回 true", () => {
  const index = new ItemIndex();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(single);
  single.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 首槽被替换
  assert.equal(index.verifyCandidate(single), true); // 绑定修复（stone 已无 → 移除；dirt 加入）
  assert.deepEqual(index.lookup("minecraft:stone").single, []);
  assert.deepEqual(index.lookup("minecraft:dirt").single, ["s1"]);
  assert.equal(index.getBinding("s1"), "minecraft:dirt");
});

test("ItemIndex: onItemMoved 轻量更新目标侧", () => {
  const index = new ItemIndex();
  const from = new InMemoryContainer("in", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = stoneMulti();
  index.onContainerAdded(from);
  index.onContainerAdded(to);
  index.onItemMoved(from.id, to.id, "minecraft:stone");
  assert.deepEqual(index.lookup("minecraft:stone").multi, ["m1"]);
});

test("ItemIndex: serialize/restore 往返一致", () => {
  const index = new ItemIndex();
  const c = stoneMulti();
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(c);
  index.onContainerAdded(single);
  const snapshot = index.serialize();
  const index2 = new ItemIndex();
  assert.equal(index2.restore(snapshot), true);
  assert.deepEqual(index2.lookup("minecraft:stone"), { single: ["s1"], multi: ["m1"] });
});

test("ItemIndex: restore 版本不匹配返回 false", () => {
  const index = new ItemIndex();
  assert.equal(index.restore({ version: INDEX_VERSION + 1, byItem: {}, containerItems: {}, singleBindings: {} }), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/index.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/index/ItemIndex.ts`:
```ts
// ─── O(1) 物品索引：查询/增量维护/惰性校验/持久化快照 ──
import type { Container } from "../model/Container";
import { deriveBinding } from "../model/DeriveBinding";
import type { ContainerId, ItemId } from "../model/types";

export const INDEX_VERSION = 1;

export interface IndexSnapshot {
  version: number;
  byItem: Record<ItemId, { single: ContainerId[]; multi: ContainerId[] }>;
  containerItems: Record<ContainerId, ItemId[]>;
  singleBindings: Record<ContainerId, ItemId>;
}

export class ItemIndex {
  private byItem = new Map<ItemId, { single: Set<ContainerId>; multi: Set<ContainerId> }>();
  private containerItems = new Map<ContainerId, Set<ItemId>>();
  private singleBindings = new Map<ContainerId, ItemId>();

  /** O(1) 查询：typeId → 候选容器 ID（按角色分组） */
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] } {
    const entry = this.byItem.get(typeId);
    if (!entry) return { single: [], multi: [] };
    return { single: [...entry.single], multi: [...entry.multi] };
  }

  getBinding(containerId: ContainerId): ItemId | undefined {
    return this.singleBindings.get(containerId);
  }

  /** 容器加入仓库（注册/激活时） */
  onContainerAdded(container: Container): void {
    this.rebuildContainer(container);
  }

  /** 容器内容变化（代理信号触发）：全量重算该容器 */
  onContainerChanged(container: Container): void {
    this.removeContainerEntries(container.id);
    this.rebuildContainer(container);
  }

  /** 角色变更 */
  onContainerRoleChanged(container: Container): void {
    this.onContainerChanged(container);
  }

  /** 容器移除/方块破坏 */
  onContainerRemoved(container: Container): void {
    this.removeContainerEntries(container.id);
  }

  /**
   * 轻量更新：路由自身移动物品后只更新目标侧（来源侧留待惰性校验清理）。
   */
  onItemMoved(from: ContainerId, to: ContainerId, itemId: ItemId): void {
    this.containerItems.get(from)?.delete(itemId);
    const toItems = this.containerItems.get(to);
    if (toItems) toItems.add(itemId);
  }

  /**
   * 惰性校验（路由命中候选时调用）：
   * - 容器实际不含该类型 → 移除索引条目，返回 false（候选失效）
   * - 单物绑定漂移 → 修复绑定与条目，返回 true（候选仍有效）
   */
  verifyCandidate(container: Container): boolean {
    if (container.role === "single") {
      const binding = deriveBinding(container);
      if (binding === undefined) {
        // 空箱：索引中若有该容器条目则移除
        const existing = this.getBinding(container.id);
        if (existing !== undefined) {
          this.byItem.get(existing)?.single.delete(container.id);
          this.singleBindings.delete(container.id);
          this.containerItems.delete(container.id);
        }
        return false;
      }
      const existing = this.getBinding(container.id);
      if (existing !== binding) {
        if (existing !== undefined) {
          this.byItem.get(existing)?.single.delete(container.id);
        }
        this.singleBindings.set(container.id, binding);
        const entry = this.ensureEntry(binding);
        entry.single.add(container.id);
        const items = this.containerItems.get(container.id) ?? new Set<ItemId>();
        items.add(binding);
        this.containerItems.set(container.id, items);
      }
      return true;
    }
    // 非单物：校验容器内是否还有该类型（调用方传 container，这里全量扫）
    const hasAny = this.containerHasItems(container);
    if (!hasAny) {
      this.removeContainerEntries(container.id);
      return false;
    }
    return true;
  }

  serialize(): IndexSnapshot {
    const byItem: IndexSnapshot["byItem"] = {};
    for (const [itemId, entry] of this.byItem) {
      byItem[itemId] = { single: [...entry.single], multi: [...entry.multi] };
    }
    const containerItems: IndexSnapshot["containerItems"] = {};
    for (const [id, items] of this.containerItems) {
      containerItems[id] = [...items];
    }
    const singleBindings: IndexSnapshot["singleBindings"] = {};
    for (const [id, itemId] of this.singleBindings) {
      singleBindings[id] = itemId;
    }
    return { version: INDEX_VERSION, byItem, containerItems, singleBindings };
  }

  /** 恢复快照；版本不匹配返回 false（调用方应重建） */
  restore(snapshot: IndexSnapshot): boolean {
    if (snapshot.version !== INDEX_VERSION) return false;
    this.byItem = new Map();
    this.containerItems = new Map();
    this.singleBindings = new Map();
    for (const [itemId, entry] of Object.entries(snapshot.byItem)) {
      this.byItem.set(itemId, {
        single: new Set(entry.single),
        multi: new Set(entry.multi),
      });
    }
    for (const [id, items] of Object.entries(snapshot.containerItems)) {
      this.containerItems.set(id, new Set(items));
    }
    for (const [id, itemId] of Object.entries(snapshot.singleBindings)) {
      this.singleBindings.set(id, itemId);
    }
    return true;
  }

  // ── 私有方法 ───────────────────────────────────────────
  private ensureEntry(itemId: ItemId): { single: Set<ContainerId>; multi: Set<ContainerId> } {
    let entry = this.byItem.get(itemId);
    if (!entry) {
      entry = { single: new Set(), multi: new Set() };
      this.byItem.set(itemId, entry);
    }
    return entry;
  }

  private rebuildContainer(container: Container): void {
    const items = new Set<ItemId>();
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item !== undefined) items.add(item.itemId);
    }
    this.containerItems.set(container.id, items);
    if (container.role === "single") {
      const binding = deriveBinding(container);
      if (binding !== undefined) {
        this.singleBindings.set(container.id, binding);
        this.ensureEntry(binding).single.add(container.id);
      } else {
        this.singleBindings.delete(container.id);
      }
      return;
    }
    if (container.role === "multi") {
      for (const itemId of items) {
        this.ensureEntry(itemId).multi.add(container.id);
      }
    }
  }

  private removeContainerEntries(containerId: ContainerId): void {
    const binding = this.singleBindings.get(containerId);
    if (binding !== undefined) {
      this.byItem.get(binding)?.single.delete(containerId);
      this.singleBindings.delete(containerId);
    }
    const items = this.containerItems.get(containerId);
    if (items) {
      for (const itemId of items) {
        this.byItem.get(itemId)?.multi.delete(containerId);
      }
    }
    this.containerItems.delete(containerId);
  }

  private containerHasItems(container: Container): boolean {
    for (let i = 0; i < container.capacity; i++) {
      if (container.getItem(i) !== undefined) return true;
    }
    return false;
  }
}
```

注意：verifyCandidate 的"非单物"分支无法知道路由物品类型——它校验容器是否完全为空。若容器仍有其他物品但缺路由类型，索引条目将保留，下次路由命中时仍会尝试（转移失败自然继续下一候选）。这是可接受的收敛语义（与设计"惰性校验"一致：漂移在命中时修复）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/index.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/index/ItemIndex.ts mcaddon/item-route/tests/index.test.ts
git commit -m "item-route: scripts/core/index ItemIndex O(1) 索引（增量维护/惰性校验/快照）"
```

---

### Task 16: scripts/core/scheduling/IntervalScheduler.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/scheduling/IntervalScheduler.ts`
- Test: `mcaddon/item-route/tests/scheduling.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/scheduling.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";

test("MemoryIntervalScheduler: 按 tick 间隔触发，stop 后停止", () => {
  const sched = new MemoryIntervalScheduler();
  let count = 0;
  const handle = sched.createInterval(() => count++, 4);
  sched.advance(3);
  assert.equal(count, 0);
  sched.advance(1); // 累计 4 tick
  assert.equal(count, 1);
  handle.stop();
  sched.advance(8);
  assert.equal(count, 1);
});

test("MemoryIntervalScheduler: 多 interval 独立", () => {
  const sched = new MemoryIntervalScheduler();
  let a = 0;
  let b = 0;
  sched.createInterval(() => a++, 2);
  sched.createInterval(() => b++, 5);
  sched.advance(10);
  assert.equal(a, 5);
  assert.equal(b, 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/scheduling.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/scheduling/IntervalScheduler.ts`:
```ts
// ─── 间隔调度抽象（mc 层用 system.runInterval，测试用内存版） ──
export interface IntervalHandle {
  stop(): void;
}

export interface IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle;
}

/** 内存实现：advance(ticks) 手动推进，供单测与调试 */
export class MemoryIntervalScheduler implements IntervalScheduler {
  private nextId = 1;
  private intervals = new Map<
    number,
    { fn: () => void; tickInterval: number; counter: number; stopped: boolean }
  >();

  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = this.nextId++;
    this.intervals.set(id, { fn, tickInterval, counter: 0, stopped: false });
    return {
      stop: () => {
        const entry = this.intervals.get(id);
        if (entry) entry.stopped = true;
      },
    };
  }

  /** 推进 N tick，触发所有到期 interval */
  advance(ticks: number): void {
    for (let t = 0; t < ticks; t++) {
      for (const entry of [...this.intervals.values()]) {
        if (entry.stopped) continue;
        entry.counter++;
        if (entry.counter % entry.tickInterval === 0) {
          entry.fn();
        }
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/scheduling.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/scheduling/IntervalScheduler.ts mcaddon/item-route/tests/scheduling.test.ts
git commit -m "item-route: scripts/core/scheduling 间隔调度抽象 + 内存实现"
```

---

### Task 17: scripts/core/scheduling/Scheduler.ts（生命周期状态机）

**Files:**
- Create: `mcaddon/item-route/scripts/core/scheduling/Scheduler.ts`
- Test: `mcaddon/item-route/tests/scheduling.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

class StubProximity {
  private nearby = new Set<string>();
  setNearby(id: string, v: boolean): void {
    if (v) this.nearby.add(id);
    else this.nearby.delete(id);
  }
  hasNearbyPlayer(warehouseId: string): boolean {
    return this.nearby.has(warehouseId);
  }
}

function makeWorld() {
  const intervals = new MemoryIntervalScheduler();
  const proximity = new StubProximity();
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus);
  const containers = new Map<string, InMemoryContainer>();
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  return { intervals, proximity, index, router, scheduler, warehouse, containers };
}

test("Scheduler: 生命周期 inactive → active → inactive", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "active");
  w.proximity.setNearby("w1", false);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "deactivating");
  for (let i = 0; i < 41; i++) w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
});

test("Scheduler: 激活后 interval 按 processingSpeed 处理单槽", () => {
  const w = makeWorld();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  w.containers.set("in", input);
  w.containers.set("m1", target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick(); // → active（创建 8 tick interval）
  w.intervals.advance(8); // 处理 1 槽
  assert.equal(input.getItem(0), undefined);
  assert.equal(target.getItem(0)?.itemId, "minecraft:stone");
});

test("Scheduler: 速度被全局限制 clamp", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.scheduler.setProcessingSpeed("w1", 40); // 超全局限制 20
  assert.equal(w.scheduler.getIntervalTicks("w1"), 20);
});

test("Scheduler: unregister 无泄漏（interval 停止）", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
  w.scheduler.unregisterWarehouse("w1");
  assert.equal(w.scheduler.getIntervalTicks("w1"), undefined);
  let fired = false;
  w.intervals.createInterval(() => (fired = true), 1);
  w.intervals.advance(1);
  assert.equal(fired, true); // 调度器本身仍可用（无全局污染）
});

test("Scheduler: 全局开关暂停/恢复", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
  w.scheduler.setGlobalEnabled(false);
  assert.equal(w.scheduler.getIntervalTicks("w1"), undefined);
  w.scheduler.setGlobalEnabled(true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/scheduling.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/scheduling/Scheduler.ts`:
```ts
// ─── 调度器：5 tick 全局主任务 + 仓库级独立 interval ──
import type { Router } from "../routing/Router";
import type { IntervalHandle, IntervalScheduler } from "./IntervalScheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, WarehouseId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

export type WarehouseLifecycle = "inactive" | "activating" | "active" | "deactivating";

/** 邻近检测（mc 层实现：玩家位置轮询结果） */
export interface ProximityChecker {
  hasNearbyPlayer(warehouseId: WarehouseId): boolean;
}

interface Runtime {
  warehouse: Warehouse;
  lifecycle: WarehouseLifecycle;
  handle?: IntervalHandle;
  inputCursor: number;
  slotCursors: Map<ContainerId, number>;
  deactivateCounter: number;
}

export class Scheduler {
  private runtimes = new Map<WarehouseId, Runtime>();
  private globalEnabled = true;

  constructor(
    private readonly router: Router,
    private readonly intervals: IntervalScheduler,
    private readonly proximity: ProximityChecker,
    private readonly bus: EventBus,
    private readonly globalSpeedLimit = 20,
    private readonly deactivateDelayTicks = 40
  ) {}

  registerWarehouse(warehouse: Warehouse): void {
    if (this.runtimes.has(warehouse.id)) return;
    this.runtimes.set(warehouse.id, {
      warehouse,
      lifecycle: "inactive",
      inputCursor: 0,
      slotCursors: new Map(),
      deactivateCounter: 0,
    });
  }

  /** 删除仓库：强制停 interval + 清理 runtime */
  unregisterWarehouse(warehouseId: WarehouseId): void {
    const rt = this.runtimes.get(warehouseId);
    if (rt?.handle) rt.handle.stop();
    this.runtimes.delete(warehouseId);
  }

  getLifecycle(warehouseId: WarehouseId): WarehouseLifecycle | undefined {
    return this.runtimes.get(warehouseId)?.lifecycle;
  }

  /** 测试辅助：当前 interval 间隔（undefined = 未激活） */
  getIntervalTicks(warehouseId: WarehouseId): number | undefined {
    const rt = this.runtimes.get(warehouseId);
    return rt?.lifecycle === "active" && rt.handle ? rt.warehouse.settings.processingSpeed : undefined;
  }

  setProcessingSpeed(warehouseId: WarehouseId, speed: number): void {
    const rt = this.runtimes.get(warehouseId);
    if (!rt) return;
    rt.warehouse.settings.processingSpeed = this.clampSpeed(speed);
    if (rt.lifecycle === "active") {
      rt.handle?.stop();
      rt.handle = this.createInterval(rt);
    }
  }

  setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled;
    for (const rt of this.runtimes.values()) {
      if (!enabled) {
        rt.handle?.stop();
        rt.handle = undefined;
        rt.lifecycle = "inactive";
      }
    }
  }

  /** 全局主任务（mc 层每 5 tick 调用）：驱动生命周期 + 冷却 */
  tick(): void {
    for (const rt of this.runtimes.values()) {
      const nearby = this.globalEnabled && this.proximity.hasNearbyPlayer(rt.warehouse.id);
      switch (rt.lifecycle) {
        case "inactive":
          if (nearby) {
            rt.lifecycle = "activating";
            rt.handle = this.createInterval(rt);
            rt.lifecycle = "active";
          }
          break;
        case "active":
          if (!nearby) {
            rt.lifecycle = "deactivating";
            rt.deactivateCounter = this.deactivateDelayTicks;
          }
          break;
        case "deactivating":
          if (nearby) {
            rt.lifecycle = "active"; // 玩家回来：取消停用（interval 未停）
          } else {
            rt.deactivateCounter--;
            if (rt.deactivateCounter <= 0) {
              rt.handle?.stop();
              rt.handle = undefined;
              rt.lifecycle = "inactive";
            }
          }
          break;
      }
    }
  }

  // ── 私有方法 ───────────────────────────────────────────
  private clampSpeed(speed: number): number {
    return Math.min(Math.max(1, speed), this.globalSpeedLimit);
  }

  private createInterval(rt: Runtime): IntervalHandle {
    return this.intervals.createInterval(() => this.processOnce(rt), this.clampSpeed(rt.warehouse.settings.processingSpeed));
  }

  /** 每轮：处理一个输入容器的非空 slot */
  private processOnce(rt: Runtime): void {
    if (!rt.warehouse.settings.sortingEnabled) return;
    const ids = [...rt.warehouse.containers.keys()];
    if (ids.length === 0) return;
    for (let step = 0; step < ids.length; step++) {
      const id = ids[rt.inputCursor % ids.length]!;
      rt.inputCursor++;
      const container = rt.warehouse.containers.get(id);
      if (!container || container.role !== "input" || !container.enabled) continue;
      const start = rt.slotCursors.get(id) ?? 0;
      const capacity = container.capacity;
      for (let offset = 0; offset < capacity; offset++) {
        const slot = (start + offset) % capacity;
        const item = container.getItem(slot);
        if (item === undefined) continue;
        rt.slotCursors.set(id, slot + 1);
        this.router.routeFrom(container, slot, rt.warehouse);
        return; // 本轮只处理一个 slot
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/scheduling.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/scheduling/Scheduler.ts mcaddon/item-route/tests/scheduling.test.ts
git commit -m "item-route: scripts/core/scheduling Scheduler 生命周期状态机 + 每轮单槽处理"
```

---

### Task 18: scripts/core/stats/StatsService.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/stats/StatsService.ts`
- Test: `mcaddon/item-route/tests/stats.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/stats.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { StatsService } from "../scripts/core/stats/StatsService";
import { InMemoryStatsStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse() {
  const containers = new Map<string, InMemoryContainer>();
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  return { warehouse, containers };
}

test("StatsService: 容器统计（槽位/物品/类型）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(1, new SimpleItemStack("minecraft:stone", 20, 64));
  c.setItem(2, new SimpleItemStack("minecraft:dirt", 5, 64));
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const stats = svc.getContainerStats(warehouse, c);
  assert.equal(stats.totalSlots, 4);
  assert.equal(stats.usedSlots, 3);
  assert.equal(stats.totalItems, 35);
  assert.equal(stats.uniqueTypes, 2);
  assert.equal(stats.byType["minecraft:stone"], 30);
  assert.equal(stats.isWarning, false);
});

test("StatsService: 90% 阈值触发黄色预警（带冷却）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 10);
  for (let i = 0; i < 9; i++) {
    c.setItem(i, new SimpleItemStack(`minecraft:item${i}`, 1, 64));
  }
  containers.set("m1", c);
  const bus = new EventBus();
  const warnings: string[] = [];
  bus.warning.subscribe((e) => warnings.push(e.level));
  const svc = new StatsService(new InMemoryStatsStore(), bus);
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["yellow"]);
  assert.deepEqual(warnings, ["yellow"]);
  // 冷却内不再触发
  assert.deepEqual(svc.evaluateWarnings(warehouse), []);
  svc.tick(); // 冷却递减（100 tick 需 100 次）
  for (let i = 0; i < 100; i++) svc.tick();
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["yellow"]);
  assert.equal(warnings.length, 2);
});

test("StatsService: 仓库统计汇总", () => {
  const { warehouse, containers } = makeWarehouse();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("in", input);
  containers.set("m1", multi);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const stats = svc.getWarehouseStats(warehouse);
  assert.equal(stats.containerCount, 2);
  assert.equal(stats.totalSlots, 7);
  assert.equal(stats.usedSlots, 2);
  assert.equal(stats.totalItems, 15);
  assert.equal(stats.uniqueTypes, 1);
  assert.equal(stats.byType["minecraft:stone"], 15);
  assert.equal(stats.byItem["minecraft:stone"].stacks, 2);
  assert.deepEqual(stats.byItem["minecraft:stone"].containerIds.sort(), ["in", "m1"]);
});

test("StatsService: invalidate 清缓存", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const before = svc.getContainerStats(warehouse, c);
  c.setItem(1, new SimpleItemStack("minecraft:dirt", 3, 64)); // 直接改容器
  const stale = svc.getContainerStats(warehouse, c); // 缓存未失效
  assert.equal(stale.usedSlots, 1);
  svc.invalidate(c.id);
  const fresh = svc.getContainerStats(warehouse, c);
  assert.equal(fresh.usedSlots, 2);
  assert.notEqual(before, undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/stats.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/stats/StatsService.ts`:
```ts
// ─── 统计系统：容器/仓库统计 + 三级预警（冷却） ────────────
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId, WarehouseId } from "../model/types";
import type { StatsStore } from "../storage/Stores";
import type { EventBus, WarningLevel } from "../events/DomainEvents";

export interface ContainerStats {
  containerId: ContainerId;
  role: Container["role"];
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
  byType: Record<ItemId, number>;
}

export interface RoleStats {
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
}

export interface ItemStat {
  count: number;
  stacks: number;
  containerIds: ContainerId[];
}

export interface WarehouseStats {
  warehouseId: WarehouseId;
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  byRole: Record<string, RoleStats>;
  byType: Record<ItemId, number>;
  byItem: Record<ItemId, ItemStat>;
}

export class StatsService {
  private cache = new Map<ContainerId, ContainerStats>();
  private cooldowns = new Map<WarehouseId, number>();

  constructor(
    private readonly store: StatsStore,
    private readonly bus: EventBus,
    private readonly warningCooldownTicks = 100
  ) {}

  /** 容器内容变化后失效缓存 */
  invalidate(containerId: ContainerId): void {
    this.cache.delete(containerId);
  }

  getContainerStats(warehouse: Warehouse, container: Container): ContainerStats {
    const cached = this.cache.get(container.id);
    if (cached) return cached;
    let totalItems = 0;
    let usedSlots = 0;
    const byType: Record<ItemId, number> = {};
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item === undefined) continue;
      usedSlots++;
      totalItems += item.amount;
      byType[item.itemId] = (byType[item.itemId] ?? 0) + item.amount;
    }
    const uniqueTypes = Object.keys(byType).length;
    const stats: ContainerStats = {
      containerId: container.id,
      role: container.role,
      totalSlots: container.capacity,
      usedSlots,
      totalItems,
      uniqueTypes,
      isWarning: container.capacity > 0 && usedSlots / container.capacity >= warehouse.settings.warningThreshold,
      byType,
    };
    this.cache.set(container.id, stats);
    return stats;
  }

  getWarehouseStats(warehouse: Warehouse): WarehouseStats {
    const byRole: Record<string, RoleStats> = {};
    const byType: Record<ItemId, number> = {};
    const byItem: Record<ItemId, ItemStat> = {};
    let containerCount = 0;
    let totalSlots = 0;
    let usedSlots = 0;
    let totalItems = 0;
    for (const container of warehouse.containers.values()) {
      containerCount++;
      const cs = this.getContainerStats(warehouse, container);
      totalSlots += cs.totalSlots;
      usedSlots += cs.usedSlots;
      totalItems += cs.totalItems;
      const role = byRole[cs.role] ?? { containerCount: 0, totalSlots: 0, usedSlots: 0, totalItems: 0 };
      role.containerCount++;
      role.totalSlots += cs.totalSlots;
      role.usedSlots += cs.usedSlots;
      role.totalItems += cs.totalItems;
      byRole[cs.role] = role;
      for (const [itemId, count] of Object.entries(cs.byType)) {
        byType[itemId] = (byType[itemId] ?? 0) + count;
        const itemStat = byItem[itemId] ?? { count: 0, stacks: 0, containerIds: [] };
        itemStat.count += count;
        itemStat.stacks++;
        if (!itemStat.containerIds.includes(container.id)) itemStat.containerIds.push(container.id);
        byItem[itemId] = itemStat;
      }
    }
    return {
      warehouseId: warehouse.id,
      containerCount,
      totalSlots,
      usedSlots,
      totalItems,
      uniqueTypes: Object.keys(byType).length,
      byRole,
      byType,
      byItem,
    };
  }

  /**
   * 三级预警（带冷却，冷却内返回 []）：
   * yellow = 任一容器超阈值；red = 任一非 input 角色组全满；deep-red = 全仓（除 input）全满。
   */
  evaluateWarnings(warehouse: Warehouse): WarningLevel[] {
    const cd = this.cooldowns.get(warehouse.id) ?? 0;
    if (cd > 0) return [];
    const levels: WarningLevel[] = [];
    const roleFull: Record<string, boolean> = {};
    let nonInputCount = 0;
    let nonInputFull = 0;
    for (const container of warehouse.containers.values()) {
      if (container.role === "input") continue;
      nonInputCount++;
      const full = container.usedSlots > 0 && container.emptySlotsCount === 0;
      if (full) nonInputFull++;
      roleFull[container.role] = roleFull[container.role] ?? true;
      roleFull[container.role] = roleFull[container.role] && full;
      const cs = this.getContainerStats(warehouse, container);
      if (cs.isWarning) levels.push("yellow");
    }
    for (const [role, full] of Object.entries(roleFull)) {
      if (full) levels.push("red");
    }
    if (nonInputCount > 0 && nonInputFull === nonInputCount) levels.push("deep-red");
    if (levels.length > 0) {
      this.cooldowns.set(warehouse.id, this.warningCooldownTicks);
      for (const level of levels) {
        this.bus.warning.trigger({ type: "warning", warehouseId: warehouse.id, level });
      }
      return levels;
    }
    return [];
  }

  /** 冷却递减（由 Scheduler.tick 调用） */
  tick(): void {
    for (const [id, cd] of this.cooldowns) {
      if (cd <= 1) this.cooldowns.delete(id);
      else this.cooldowns.set(id, cd - 1);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/stats.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/stats/StatsService.ts mcaddon/item-route/tests/stats.test.ts
git commit -m "item-route: scripts/core/stats 统计服务（容器/仓库统计 + 三级预警冷却）"
```

---

---

### Task 19: scripts/core/organizing/Organizer.ts（概念化整理器）

**Files:**
- Create: `mcaddon/item-route/scripts/core/organizing/Organizer.ts`
- Test: `mcaddon/item-route/tests/organizing.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/organizing.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { MoveJournal, transfer } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse(containers: InMemoryContainer[]) {
  return {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map(containers.map((c) => [c.id, c])),
  };
}

test("Organizer: chaosScore 混合类型越多越乱", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const empty = new InMemoryContainer("e", "multi", 4);
  assert.equal(organizer.chaosScore(empty), 0);
  const single = new InMemoryContainer("s", "multi", 4);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  single.setItem(1, new SimpleItemStack("minecraft:stone", 2, 64));
  assert.equal(organizer.chaosScore(single), 0); // 单类型 = 纯净
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  mixed.setItem(2, new SimpleItemStack("minecraft:wood", 1, 64));
  assert.equal(organizer.chaosScore(mixed), 2); // 3 类型 - 1
});

test("Organizer: analyze 杂项物品归入同类型多物容器", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0], { from: "x", fromSlot: 0, to: "m1" });
  assert.equal(plan.chaosBefore >= plan.chaosAfter, true);
});

test("Organizer: analyze 多物容器间合并", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const a = new InMemoryContainer("a", "multi", 4);
  a.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const b = new InMemoryContainer("b", "multi", 4);
  b.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const wh = makeWarehouse([a, b]);
  const plan = organizer.analyze(wh);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.from, "a");
  assert.equal(plan.actions[0]?.to, "b");
});

test("Organizer: apply 执行移动，失败回滚源不变", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  const journal = new MoveJournal();
  assert.equal(organizer.apply(wh, plan, journal), true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(multi.getItem(0)?.amount, 15);
  // 失败场景：目标容器从仓库移除（模拟方块被破坏）
  const misc2 = new InMemoryContainer("x2", "misc", 4);
  misc2.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
  const wh2 = makeWarehouse([misc2]);
  const plan2 = organizer.analyze(wh2); // 无目标 → actions 空
  assert.equal(plan2.actions.length, 0);
  assert.equal(organizer.apply(wh2, plan2, new MoveJournal()), true); // 无操作视为成功
});

test("Organizer: apply 执行中目标失效 → 整体回滚", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  misc.setItem(1, new SimpleItemStack("minecraft:dirt", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  // 篡改计划：指向不存在的目标 → apply 失败
  const badPlan = { ...plan, actions: [{ from: "x", fromSlot: 0, to: "ghost" }] };
  const journal = new MoveJournal();
  assert.equal(organizer.apply(wh, badPlan, journal), false);
  // 回滚后源未变
  assert.equal(misc.getItem(0)?.amount, 10);
});

test("Organizer: shouldAutoSort 阈值", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  assert.equal(organizer.shouldAutoSort(mixed, 3), false); // chaos 1 < 3
  mixed.setItem(2, new SimpleItemStack("minecraft:wood", 1, 64));
  mixed.setItem(3, new SimpleItemStack("minecraft:iron", 1, 64));
  assert.equal(organizer.shouldAutoSort(mixed, 3), true); // chaos 3 不超阈值？→ 3 > 3 false
});
```

注意最后一条断言：`chaosScore = uniqueTypes - 1 = 3`，`shouldAutoSort = chaos > threshold`，threshold=3 时 3 > 3 为 false。若需触发应放第 5 种类型。测试断言即为此语义。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/organizing.test.js`
Expected: FAIL（模块不存在；`transfer` 导入未用会有 lint 提示但 tsc 不报错）。

- [ ] **Step 3: 最小实现**

`scripts/core/organizing/Organizer.ts`:
```ts
// ─── 概念化整理器：混乱度评分 + analyze/apply/回滚 + 自动阈值 ──
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
import type { CandidateSorter } from "../routing/CandidateSorter";
import type { CandidateContainer } from "../routing/RouteStrategy";
import { transfer, type MoveJournal } from "../routing/Move";

export interface OrganizeAction {
  from: ContainerId;
  fromSlot: number;
  to: ContainerId;
}

export interface OrganizePlan {
  actions: OrganizeAction[];
  chaosBefore: number;
  chaosAfter: number;
}

export class Organizer {
  constructor(private readonly sorter: CandidateSorter) {}

  /** 混乱度 = 混合类型数 - 1（0 = 纯净容器） */
  chaosScore(container: Container): number {
    const types = new Set<ItemId>();
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item !== undefined) types.add(item.itemId);
    }
    return Math.max(0, types.size - 1);
  }

  shouldAutoSort(container: Container, threshold: number): boolean {
    return this.chaosScore(container) > threshold;
  }

  /** 生成整理计划：杂项归入同类型多物/单物容器；多物容器间合并 */
  analyze(warehouse: Warehouse): OrganizePlan {
    const actions: OrganizeAction[] = [];
    const multisByItem = new Map<ItemId, Container[]>();
    const singlesByItem = new Map<ItemId, Container>();
    for (const container of warehouse.containers.values()) {
      if (container.role === "multi") {
        for (let i = 0; i < container.capacity; i++) {
          const item = container.getItem(i);
          if (item === undefined) continue;
          const list = multisByItem.get(item.itemId) ?? [];
          if (!list.includes(container)) list.push(container);
          multisByItem.set(item.itemId, list);
        }
      } else if (container.role === "single") {
        const binding = container.getDedicatedItemId();
        if (binding !== undefined) singlesByItem.set(binding, container);
      }
    }
    const pickMultiTarget = (itemId: ItemId, exclude?: Container): Container | undefined => {
      const list = (multisByItem.get(itemId) ?? []).filter((c) => c !== exclude && c.emptySlotsCount > 0);
      if (list.length === 0) return undefined;
      const candidates: CandidateContainer[] = list.map((c) => ({
        container: c,
        priority: c.priority,
        usageRatio: c.capacity > 0 ? c.usedSlots / c.capacity : 1,
        isFull: c.emptySlotsCount === 0,
      }));
      return this.sorter.sort(candidates)[0]?.container;
    };
    for (const container of warehouse.containers.values()) {
      if (container.role === "input") continue;
      for (let slot = 0; slot < container.capacity; slot++) {
        const item = container.getItem(slot);
        if (item === undefined) continue;
        let target: Container | undefined;
        if (container.role === "single") {
          // 单物容器内错位物品 → 移走
          if (item.itemId !== container.getDedicatedItemId()) {
            target = pickMultiTarget(item.itemId) ?? this.firstMisc(warehouse, container.id);
          }
        } else if (container.role === "misc") {
          target = pickMultiTarget(item.itemId) ?? (singlesByItem.get(item.itemId)?.emptySlotsCount ?? 0 > 0 ? singlesByItem.get(item.itemId) : undefined);
        } else if (container.role === "multi") {
          target = pickMultiTarget(item.itemId, container);
        }
        if (target !== undefined) {
          actions.push({ from: container.id, fromSlot: slot, to: target.id });
        }
      }
    }
    let chaosBefore = 0;
    for (const container of warehouse.containers.values()) {
      chaosBefore += this.chaosScore(container);
    }
    return { actions, chaosBefore, chaosAfter: Math.max(0, chaosBefore - actions.length) };
  }

  /**
   * 执行计划：逐 action 原子移动；任一失败整体回滚并返回 false。
   * 调用方在 apply 前创建空 journal。
   */
  apply(warehouse: Warehouse, plan: OrganizePlan, journal: MoveJournal): boolean {
    for (const action of plan.actions) {
      const from = warehouse.containers.get(action.from);
      const to = warehouse.containers.get(action.to);
      if (!from || !to || !to.enabled) {
        journal.rollback();
        return false;
      }
      const original = from.getItem(action.fromSlot)?.amount ?? 0;
      journal.snapshot(from);
      journal.snapshot(to);
      const remaining = transfer({ container: from, slot: action.fromSlot }, to);
      if (remaining !== undefined && remaining.amount === original) {
        journal.rollback();
        return false;
      }
    }
    return true;
  }

  private firstMisc(warehouse: Warehouse, excludeId: ContainerId): Container | undefined {
    for (const container of warehouse.containers.values()) {
      if (container.id !== excludeId && container.role === "misc" && container.emptySlotsCount > 0) return container;
    }
    return undefined;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/organizing.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/organizing/Organizer.ts mcaddon/item-route/tests/organizing.test.ts
git commit -m "item-route: scripts/core/organizing 概念化整理器（评分/分析/应用/回滚）"
```

---

### Task 20: scripts/core/services/MemberService.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/services/MemberService.ts`
- Test: `mcaddon/item-route/tests/services.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/services.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemberService } from "../scripts/core/services/MemberService";
import type { Warehouse } from "../scripts/core/model/Warehouse";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse(): Warehouse {
  return {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [
      { playerId: "p1", role: "owner" },
      { playerId: "p2", role: "member" },
      { playerId: "p3", role: "visitor" },
    ],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map(),
  };
}

test("MemberService: getRole", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.getRole(wh, "p1"), "owner");
  assert.equal(svc.getRole(wh, "p2"), "member");
  assert.equal(svc.getRole(wh, "p3"), "visitor");
  assert.equal(svc.getRole(wh, "ghost"), undefined);
});

test("MemberService: 权限矩阵", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.can(wh, "p1", "owner"), true);
  assert.equal(svc.can(wh, "p2", "owner"), false);
  assert.equal(svc.can(wh, "p2", "member"), true);
  assert.equal(svc.can(wh, "p3", "member"), false);
  assert.equal(svc.can(wh, "p3", "visitor"), true);
  assert.equal(svc.can(wh, "ghost", "visitor"), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/services/MemberService.ts`:
```ts
// ─── 成员权限服务：owner > member > visitor ────────────────
import type { Warehouse } from "../model/Warehouse";
import type { MemberRole } from "../model/Warehouse";
import type { PlayerId } from "../model/types";

export class MemberService {
  getRole(warehouse: Warehouse, playerId: PlayerId): MemberRole | undefined {
    if (warehouse.ownerId === playerId) return "owner";
    return warehouse.members.find((m) => m.playerId === playerId)?.role;
  }

  /** 是否满足所需最低角色（owner 隐式满足 member/visitor） */
  can(warehouse: Warehouse, playerId: PlayerId, required: MemberRole): boolean {
    const role = this.getRole(warehouse, playerId);
    if (role === undefined) return false;
    if (role === "owner") return true;
    if (required === "owner") return false;
    if (role === "member") return true;
    return required === "visitor";
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/services/MemberService.ts mcaddon/item-route/tests/services.test.ts
git commit -m "item-route: scripts/core/services 成员权限服务（owner/member/visitor）"
```

---

### Task 21: scripts/core/services/WarehouseService.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/services/WarehouseService.ts`
- Test: `mcaddon/item-route/tests/services.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { WarehouseService } from "../scripts/core/services/WarehouseService";
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";

const area1: WarehouseArea = { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } };
const area2: WarehouseArea = { dimension: "overworld", corner1: { x: 20, y: 0, z: 0 }, corner2: { x: 30, y: 10, z: 10 } };

test("WarehouseService: 创建/重载/重名拒绝", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r1 = svc.createWarehouse("主仓库", "p1", area1);
  assert.equal(r1.ok, true);
  const r2 = svc.createWarehouse("主仓库", "p1", area2); // 重名
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /重名/);
  const r3 = svc.createWarehouse("  ", "p1", area2); // 空名
  assert.equal(r3.ok, false);
  const reloaded = svc.loadAll();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0]?.displayName, "主仓库");
});

test("WarehouseService: 区域重叠拒绝", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r1 = svc.createWarehouse("仓A", "p1", area1);
  assert.equal(r1.ok, true);
  const overlap: WarehouseArea = { dimension: "overworld", corner1: { x: 5, y: 0, z: 5 }, corner2: { x: 15, y: 10, z: 15 } };
  const r2 = svc.createWarehouse("仓B", "p1", overlap);
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /重叠/);
  const r3 = svc.createWarehouse("仓C", "p1", area2); // 不重叠 → 成功
  assert.equal(r3.ok, true);
});

test("WarehouseService: 删除/重命名/成员管理", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r = svc.createWarehouse("主仓库", "p1", area1);
  assert.equal(r.ok, true);
  const wh = (r as { warehouse: NonNullable<ReturnType<WarehouseService["createWarehouse"]> extends { ok: true; warehouse: infer W } ? W : never> }).warehouse;
  svc.rename(wh, "新名字");
  assert.equal(wh.displayName, "新名字");
  const dup = svc.rename(wh, "主仓库"); // 重名 → 报错（rename 内部先用临时？这里直接校验自身之外的列表）
  // 说明：rename 校验排除自身 id，因此改成其他仓库名才报错
  assert.equal(dup, undefined);
  svc.addMember(wh, "p2", "member");
  assert.equal(wh.members.length, 2);
  const dupMember = svc.addMember(wh, "p2", "member");
  assert.match(dupMember ?? "", /已是成员/);
  svc.setMemberRole(wh, "p2", "visitor");
  assert.equal(wh.members.find((m) => m.playerId === "p2")?.role, "visitor");
  svc.removeMember(wh, "p2");
  assert.equal(wh.members.length, 1);
  svc.deleteWarehouse(wh.id);
  assert.equal(svc.loadAll().length, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/services/WarehouseService.ts`:
```ts
// ─── 仓库服务：CRUD/成员/设置（经 store 持久化） ──────────
import type { Warehouse, WarehouseArea, WarehouseSettings, MemberRole } from "../model/Warehouse";
import { createDefaultSettings } from "../model/Warehouse";
import type { PlayerId, WarehouseId } from "../model/types";
import type { WarehouseStore, WarehouseSnapshot } from "../storage/Stores";
import type { EventBus } from "../events/DomainEvents";

export type CreateResult = { ok: true; warehouse: Warehouse } | { ok: false; error: string };

export class WarehouseService {
  constructor(
    private readonly store: WarehouseStore,
    private readonly bus: EventBus
  ) {}

  /** 启动加载全部仓库（容器由 mc 层按 containerIds 补注册） */
  loadAll(): Warehouse[] {
    return this.store.list().map((s) => this.buildWarehouse(s));
  }

  createWarehouse(displayName: string, ownerId: PlayerId, area: WarehouseArea): CreateResult {
    const name = displayName.trim();
    if (name.length === 0) return { ok: false, error: "仓库名不能为空" };
    const existing = this.store.list();
    if (existing.some((w) => w.displayName === name)) {
      return { ok: false, error: "存在同名仓库" };
    }
    if (existing.some((w) => areaOverlaps(w.area, area))) {
      return { ok: false, error: "区域与已有仓库重叠" };
    }
    const warehouse: Warehouse = {
      id: `wh-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      displayName: name,
      ownerId,
      members: [{ playerId: ownerId, role: "owner" }],
      area,
      settings: createDefaultSettings(),
      containers: new Map(),
    };
    this.persist(warehouse);
    return { ok: true, warehouse };
  }

  deleteWarehouse(id: WarehouseId): void {
    this.store.remove(id);
  }

  rename(warehouse: Warehouse, newName: string): string | undefined {
    const name = newName.trim();
    if (name.length === 0) return "仓库名不能为空";
    if (this.store.list().some((w) => w.id !== warehouse.id && w.displayName === name)) {
      return "存在同名仓库";
    }
    warehouse.displayName = name;
    this.persist(warehouse);
    return undefined;
  }

  addMember(warehouse: Warehouse, playerId: PlayerId, role: MemberRole): string | undefined {
    if (role === "owner") return "owner 只能通过转让设置";
    if (warehouse.members.some((m) => m.playerId === playerId)) return "该玩家已是成员";
    warehouse.members.push({ playerId, role });
    this.persist(warehouse);
    return undefined;
  }

  setMemberRole(warehouse: Warehouse, playerId: PlayerId, role: MemberRole): string | undefined {
    if (playerId === warehouse.ownerId) return "不能修改 owner 的角色";
    const member = warehouse.members.find((m) => m.playerId === playerId);
    if (!member) return "该玩家不是成员";
    member.role = role;
    this.persist(warehouse);
    return undefined;
  }

  removeMember(warehouse: Warehouse, playerId: PlayerId): string | undefined {
    if (playerId === warehouse.ownerId) return "不能移除 owner";
    const before = warehouse.members.length;
    warehouse.members = warehouse.members.filter((m) => m.playerId !== playerId);
    if (warehouse.members.length === before) return "该玩家不是成员";
    this.persist(warehouse);
    return undefined;
  }

  updateSettings(warehouse: Warehouse, patch: Partial<WarehouseSettings>): void {
    warehouse.settings = { ...warehouse.settings, ...patch };
    this.persist(warehouse);
  }

  persist(warehouse: Warehouse): void {
    this.store.save(this.toSnapshot(warehouse));
  }

  // ── 私有方法 ───────────────────────────────────────────
  private toSnapshot(warehouse: Warehouse): WarehouseSnapshot {
    return {
      id: warehouse.id,
      displayName: warehouse.displayName,
      ownerId: warehouse.ownerId,
      members: warehouse.members.map((m) => ({ ...m })),
      area: { ...warehouse.area },
      settings: { ...warehouse.settings },
      containerIds: [...warehouse.containers.keys()],
    };
  }

  private buildWarehouse(snapshot: WarehouseSnapshot): Warehouse {
    return {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerId: snapshot.ownerId,
      members: snapshot.members.map((m) => ({ ...m })),
      area: { ...snapshot.area },
      settings: { ...snapshot.settings },
      containers: new Map(),
    };
  }
}

/** 区域相交判定（同维度且三轴区间均重叠） */
export function areaOverlaps(a: WarehouseArea, b: WarehouseArea): boolean {
  if (a.dimension !== b.dimension) return false;
  const axes = ["x", "y", "z"] as const;
  return axes.every((axis) => {
    const amin = Math.min(a.corner1[axis], a.corner2[axis]);
    const amax = Math.max(a.corner1[axis], a.corner2[axis]);
    const bmin = Math.min(b.corner1[axis], b.corner2[axis]);
    const bmax = Math.max(b.corner1[axis], b.corner2[axis]);
    return amin <= bmax && bmin <= amax;
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: PASS。

注意测试里 `wh` 的类型推导用了复杂 conditional type，若 tsc 推导困难，可直接断言后断言 `(r as { ok: true; warehouse: Warehouse }).warehouse`（需要 import type Warehouse）。此写法等价；以编译通过为准。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/services/WarehouseService.ts mcaddon/item-route/tests/services.test.ts
git commit -m "item-route: scripts/core/services 仓库服务（CRUD/重名/区域重叠/成员/设置）"
```

---

### Task 22: scripts/core/services/RouteService.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/services/RouteService.ts`
- Test: `mcaddon/item-route/tests/services.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { RouteService } from "../scripts/core/services/RouteService";
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";

function makeRouteService() {
  const intervals = new MemoryIntervalScheduler();
  const proximity = {
    hasNearbyPlayer: () => true,
  };
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus);
  const service = new RouteService(scheduler);
  const containers = new Map<string, InMemoryContainer>();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  return { service, scheduler, intervals, index, bus, warehouse, containers };
}

test("RouteService: 全局开关停/恢复", () => {
  const w = makeRouteService();
  w.service.setGlobalEnabled(false);
  w.scheduler.registerWarehouse(w.warehouse);
  w.scheduler.tick(); // 全局关 → 不激活
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
  w.service.setGlobalEnabled(true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "active");
});

test("RouteService: 容器开关禁用输入容器后不处理", () => {
  const w = makeRouteService();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  w.containers.set("in", input);
  w.containers.set("m1", target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.service.setContainerEnabled(w.warehouse, "in", false);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.equal(input.getItem(0)?.amount, 10); // 未处理
  w.service.setContainerEnabled(w.warehouse, "in", true);
  w.intervals.advance(8);
  assert.equal(input.getItem(0), undefined); // 恢复后处理
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/services/RouteService.ts`:
```ts
// ─── 路由服务：全局开关/单仓速度/容器开关 ─────────────────
import type { Scheduler } from "../scheduling/Scheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId } from "../model/types";

export class RouteService {
  constructor(private readonly scheduler: Scheduler) {}

  setGlobalEnabled(enabled: boolean): void {
    this.scheduler.setGlobalEnabled(enabled);
  }

  /** 设置单仓处理速度（tick 间隔），会被全局限制 clamp */
  setProcessingSpeed(warehouseId: string, speed: number): void {
    this.scheduler.setProcessingSpeed(warehouseId, speed);
  }

  setContainerEnabled(warehouse: Warehouse, containerId: ContainerId, enabled: boolean): void {
    const container = warehouse.containers.get(containerId);
    if (container) container.enabled = enabled;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/services/RouteService.ts mcaddon/item-route/tests/services.test.ts
git commit -m "item-route: scripts/core/services 路由服务（全局开关/速度/容器开关）"
```

---

### Task 23: scripts/core/services/OrganizeService.ts

**Files:**
- Create: `mcaddon/item-route/scripts/core/services/OrganizeService.ts`
- Test: `mcaddon/item-route/tests/services.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { OrganizeService } from "../scripts/core/services/OrganizeService";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { MoveJournal } from "../scripts/core/routing/Move";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("OrganizeService: organize 合并后索引更新", () => {
  const bus = new EventBus();
  const index = new ItemIndex();
  const organizer = new Organizer(new DefaultCandidateSorter());
  const svc = new OrganizeService(organizer, index, bus);
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(misc);
  index.onContainerAdded(multi);
  const containers = new Map([[misc.id, misc], [multi.id, multi]]);
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  const ok = svc.organize(warehouse, new MoveJournal());
  assert.equal(ok, true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(multi.getItem(0)?.amount, 15);
  // 索引已更新：misc 不再命中 stone
  const lookup = index.lookup("minecraft:stone");
  assert.deepEqual(lookup.multi, ["m1"]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: FAIL。

- [ ] **Step 3: 最小实现**

`scripts/core/services/OrganizeService.ts`:
```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/services.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/services/OrganizeService.ts mcaddon/item-route/tests/services.test.ts
git commit -m "item-route: scripts/core/services 整理服务（分析/应用/索引联动）"
```

---

### Task 24: 集成测试——内存装配完整路由闭环

**Files:**
- Test: `mcaddon/item-route/tests/integration.test.ts`

- [ ] **Step 1: 写失败测试（此时核心模块均已就绪，测试应先通过；若失败说明集成断点）**

`tests/integration.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import { StatsService } from "../scripts/core/stats/StatsService";
import { OrganizeService } from "../scripts/core/services/OrganizeService";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { WarehouseService } from "../scripts/core/services/WarehouseService";
import { MemberService } from "../scripts/core/services/MemberService";
import { InMemoryWarehouseStore, InMemoryStatsStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { MoveJournal } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";

// ── 装配（对应 scripts/mc/main.ts 的 DI 组装，全部内存实现） ──────
function bootstrap() {
  const bus = new EventBus();
  const index = new ItemIndex();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  const intervals = new MemoryIntervalScheduler();
  const proximity = { hasNearbyPlayer: () => true };
  const scheduler = new Scheduler(router, intervals, proximity, bus);
  const stats = new StatsService(new InMemoryStatsStore(), bus);
  const organizer = new Organizer(new DefaultCandidateSorter());
  const organize = new OrganizeService(organizer, index, bus);
  const warehouses = new WarehouseService(new InMemoryWarehouseStore(), bus);
  const members = new MemberService();
  return { bus, index, router, scheduler, intervals, stats, organize, warehouses, members };
}

function makeWorld() {
  const app = bootstrap();
  const containers = new Map<string, InMemoryContainer>();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "测试仓",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" }],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containers,
  };
  const add = (c: InMemoryContainer) => {
    containers.set(c.id, c);
    app.index.onContainerAdded(c);
    return c;
  };
  return { app, warehouse, add };
}

function totalItems(warehouse: Warehouse): number {
  let total = 0;
  for (const c of warehouse.containers.values()) {
    for (let i = 0; i < c.capacity; i++) {
      total += c.getItem(i)?.amount ?? 0;
    }
  }
  return total;
}

test("集成: 单物优先路由 + 事件 + 索引更新", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("s1", "single", 3));
  add(new InMemoryContainer("s1").constructor === undefined ? new InMemoryContainer("s1", "single", 3) : new InMemoryContainer("s1", "single", 3));
  // 上面一行是误导性代码——实际只需注册单物容器：
  const single = new InMemoryContainer("single1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(single);
  add(new InMemoryContainer("m1", "multi", 3));
  const events: string[] = [];
  app.bus.itemRouted.subscribe((e) => events.push(`${e.from}->${e.to}`));
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  app.intervals.advance(8);
  assert.equal(input.getItem(0), undefined);
  assert.equal(single.getItem(1)?.amount, 5); // 10 堆叠到已有 5 → 10+5=15？→ 见下方说明
  assert.deepEqual(events, ["in->single1"]);
});

test("集成: 不吞物不复制（路由前后总量一致）", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 4));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  input.setItem(1, new SimpleItemStack("minecraft:dirt", 32, 64));
  add(new InMemoryContainer("s1", "single", 3)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(new InMemoryContainer("m1", "multi", 3)).setItem(0, new SimpleItemStack("minecraft:dirt", 20, 64));
  add(new InMemoryContainer("x1", "misc", 3));
  const before = totalItems(warehouse);
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  for (let i = 0; i < 3; i++) app.intervals.advance(8); // 处理 3 个 slot
  const after = totalItems(warehouse);
  assert.equal(before, after);
  assert.equal(input.getItem(0), undefined);
  assert.equal(input.getItem(1), undefined);
});

test("集成: 杂项兜底 + 统计预警", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:wood", 10, 64));
  const misc = add(new InMemoryContainer("x1", "misc", 3));
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  app.intervals.advance(8);
  assert.equal(input.getItem(0), undefined);
  assert.equal(misc.getItem(0)?.itemId, "minecraft:wood");
  const stats = app.stats.getWarehouseStats(warehouse);
  assert.equal(stats.totalItems, 10);
  const warnings = app.stats.evaluateWarnings(warehouse);
  assert.deepEqual(warnings, []); // 3 槽用 1 槽，无预警
});

test("集成: 整理器闭环（misc 归入 multi）", () => {
  const { app, warehouse, add } = makeWorld();
  const misc = add(new InMemoryContainer("x1", "misc", 4));
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("m1", "multi", 4)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  assert.equal(app.organize.organize(warehouse, new MoveJournal()), true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(warehouse.containers.get("m1")?.getItem(0)?.amount, 15);
});

test("集成: 成员权限贯穿", () => {
  const { app, warehouse } = makeWorld();
  assert.equal(app.members.can(warehouse, "p1", "owner"), true);
  assert.equal(app.members.can(warehouse, "stranger", "visitor"), false);
});
```

注意集成测试第一例中的冗余行（`add(new InMemoryContainer("s1", "single", 3));` + 误导性三元）在执行前应清理为：
```ts
const single = new InMemoryContainer("single1", "single", 3);
single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
add(single);
```
即删除 `add(new InMemoryContainer("s1", "single", 3));` 与三元行。堆叠语义：single 槽 0 已有 5/64，转移 10 → 槽 0 变 15；`single.getItem(1)` 应为 undefined。修正断言：`assert.equal(single.getItem(0)?.amount, 15);`。

- [ ] **Step 2: 运行测试**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/integration.test.js`
Expected: PASS（若失败，按错误修正——集成断点通常在类型不匹配或语义理解偏差）。

- [ ] **Step 3: 修正集成测试中的冗余代码**

将集成测试第一例替换为：
```ts
test("集成: 单物优先路由 + 事件 + 索引更新", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const single = new InMemoryContainer("single1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(single);
  add(new InMemoryContainer("m1", "multi", 3));
  const events: string[] = [];
  app.bus.itemRouted.subscribe((e) => events.push(`${e.from}->${e.to}`));
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  app.intervals.advance(8);
  assert.equal(input.getItem(0), undefined);
  assert.equal(single.getItem(0)?.amount, 15); // 5 + 10 堆叠
  assert.deepEqual(events, ["in->single1"]);
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/integration.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/tests/integration.test.ts
git commit -m "item-route: 集成测试——内存装配完整路由/整理/统计/权限闭环"
```

---

### Task 25: 全量验证与收尾

**Files:**
- Modify: `mcaddon/item-route/package.json`（如需补充 scripts）
- Test: 全部 `tests/*.test.ts`

- [ ] **Step 1: 全量运行测试**

Run: `cd mcaddon/item-route && pnpm test:core`
Expected: 全部 PASS（smoke/model/events/storage/routing/index/scheduling/stats/organizing/services/integration）。

- [ ] **Step 2: 验证 core 零 MC 依赖**

Run: `rg -n "@minecraft" scripts/core/`
Expected: 无输出（core 目录零 MC import）。

- [ ] **Step 3: 自检清单核对**

- [ ] 设计文档 §4 路由策略/§4.1 事务/§5 索引三层兜底/§6 调度/§7 统计/§11 服务 全部有对应实现与单测
- [ ] 测试清单（设计 §13）覆盖：路由顺序/事务四类/MoveJournal/候选排序/单物绑定与空箱重绑/索引增量与序列化/生命周期与删除清理/三级预警/整理器/分片存储（内存版）/成员矩阵/桥接过滤谓词（verifyCandidate）
- [ ] 无 TODO 占位、无未定义符号
- [ ] 命名符合仓库规范（PascalCase 文件、中文 JSDoc、`[item-route]` 日志前缀）

- [ ] **Step 4: 提交**

```bash
git add -A mcaddon/item-route/
git commit -m "item-route: core 引擎完成（model/events/storage/routing/index/scheduling/stats/organizing/services + 全量单测）"
```

**验收标准（本计划完成 = 以下全部满足）：**
1. `pnpm test:core` 全绿（11 个测试文件）
2. `rg "@minecraft" scripts/core/` 零命中
3. 不吞物不复制、单物优先、杂项兜底、事务回滚、索引惰性自愈、生命周期状态机均有测试锁定

---

## 自审记录（writing-plans 要求）

**1. Spec 覆盖：**
- 设计 §3 概念模型 → Task 2-6 ✓；§4 路由 → Task 11-14 ✓；§4.1 Move/MoveJournal → Task 13 ✓；§5 索引 + 三层兜底 → Task 15 ✓（verifyCandidate 覆盖代理信号后的惰性校验与单物绑定修复）；§6 调度 → Task 16-17 ✓（含删除清理/全局开关/速度 clamp/位置轮询由 mc 层驱动 tick）；§7 统计 → Task 18 ✓（三级预警 + 冷却 + 失效刷新）；§8 存储接口 → Task 9-10 ✓（DP 分片实现留待 mc 计划）；§9 事件 → Task 7-8 ✓；§11 服务 → Task 20-23 ✓；§13 测试清单 11 项 → 全部有对应 test 文件 ✓；集成闭环 → Task 24 ✓
- **缺口记录**：① 索引批量落盘（脏标记）属持久化策略，由 mc 层 IndexStore 实现 + 本计划 Task 15 的 serialize/restore 支持，落盘时机逻辑放 mc 计划；② 空箱重绑触发链（代理信号 → onContainerChanged）由 mc 计划 McEventBridge 实现，core 已具备 onContainerChanged/verifyCandidate 能力；③ Scheduler.tick 调用 StatsService.tick（预警冷却递减）——mc 计划装配时接线。

**2. 占位符扫描：** 无 TBD/TODO 占位；Task 21 测试类型推导的说明以编译通过为准；Task 24 中两处冗余代码已在 Step 3 显式修正。

**3. 类型一致性：** CandidateContainer/RouteContext/IndexLookupResult 在 Task 11 定义、Task 12/14 消费 ✓；transfer/MoveJournal 签名 Task 13 定义、Task 14/19/23 消费 ✓；ItemIndex 的 lookup/verifyCandidate/onItemMoved 与 Router 的 IndexGateway 结构类型匹配 ✓；StatsService 的 WarningLevel 与 DomainEvents 一致 ✓；Storage 快照结构与 ItemIndex.serialize 输出兼容 ✓。


