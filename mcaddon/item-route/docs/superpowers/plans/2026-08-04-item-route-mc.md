# item-route MC 适配层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 item-route 的 MC 适配层：DP 分片存储（安全线/hash 写后验/世代号/孤儿清理/1MB 降级）、三仓储 DP 实现、容器/物品/事件/邻近/间隔适配器，以及 main.ts 四阶段 DI 装配，使 core 引擎在真实 MC 世界中运行。

**Architecture:** 分层六边形。`scripts/mc/storage/` 实现 core 定义的存储接口（`KeyValueStore`/`WarehouseStore`/`IndexStore`/`StatsStore`），纯逻辑（分片/hash/世代/降级）与 `@minecraft/server` 解耦、可在 node 下用 `InMemoryKeyValueStore` 单测；`scripts/mc/adapters/` 实现 `Container`/`ProximityChecker`/`IntervalScheduler` 接口与事件桥接（薄，游戏内验证）；`scripts/mc/main.ts` 按 4 Phase 装配 DI。core 追加三个零 MC 依赖纯函数（容器类型判定/区域包含与邻近判定/双箱合并判定）供适配层使用。

**Tech Stack:** TypeScript（strict）、`@minecraft/server` 2.6.0（类型 + 运行时）、node:test（node ≥ 18，本机 v24 已确认）、`@minecraft/core-build-tasks` + `@yinxe/toolkit-build`（构建）。

**设计基线:** `docs/superpowers/specs/2026-08-04-item-route-design.md`（§8 存储 / §10 适配层 / §6 调度 / §9 事件 / §14 技术债规避）。
**前置:** 计划 1（core 引擎）已执行完毕，`scripts/core/` 全部模块与 `tests/` 就绪。

---

## 文件结构

```
mcaddon/item-route/
├── package.json              # 追加 devDependencies + 构建 scripts + mcbe 元数据
├── tsconfig.json             # addon 编译配置（构建用，include scripts/scripts/core/mc）
├── tsconfig.test.json        # 追加 include "scripts/mc/storage/**/*.ts"
├── just.config.ts            # 构建任务（bundle/mcaddon/clean，参照 v1）
├── scripts/
│   └── main.ts               # addon 入口（Task 2 空骨架 → Task 15 接线 scripts/mc/main）
├── BP/ItemRoute/
│   └── manifest.json         # 行为包清单（Task 2）
├── RP/ItemRoute/
│   └── manifest.json         # 资源包清单（最小，Task 2）
├── scripts/core/                     # 追加（零 MC 依赖，可单测）
│   ├── model/
│   │   ├── ContainerTypes.ts # 容器类型判定纯函数（chest/hopper/shulker/barrel）
│   │   ├── Area.ts           # containsLocation + isPlayerNearby 纯函数
│   │   └── ChestMerge.ts     # 双箱合并判定纯函数（SafeProbe 提纯）
├── scripts/mc/
│   ├── storage/
│   │   ├── ShardStore.ts     # 分片键值仓储（安全线/hash 写后验/1MB 降级）——纯 TS 可单测
│   │   ├── DynamicPropertyStore.ts # DP 后端（KeyValueStore 实现，薄）
│   │   ├── McWarehouseStore.ts     # 仓库仓储（世代分片 + 完整性校验）——纯 TS 可单测
│   │   ├── McIndexStore.ts         # 索引仓储（脏标记批量落盘 + 降级）——纯 TS 可单测
│   │   ├── McStatsStore.ts         # 统计仓储（写穿透）——纯 TS 可单测
│   │   └── McModConfig.ts          # 模组配置（globalSpeedLimit/全局开关）——纯 TS 可单测
│   ├── adapters/
│   │   ├── McItemAdapter.ts        # mc.ItemStack ↔ 概念 ItemStack
│   │   ├── McContainerAdapter.ts   # 概念 Container 实现（委托 mc.Container + 安全访问）
│   │   ├── McContainerFactory.ts   # Block → McContainerAdapter（双箱探测/漏斗约束）
│   │   ├── McProximityChecker.ts   # ProximityChecker 实现（玩家位置轮询）
│   │   ├── McIntervalScheduler.ts  # IntervalScheduler 实现（system.runInterval）
│   │   └── McEventBridge.ts        # 世界事件 → 领域事件（代理信号/过滤谓词）
│   └── main.ts                     # 4 Phase 启动装配（DI）
└── tests/
    ├── container-types.test.ts
    ├── area.test.ts
    ├── chest-merge.test.ts
    ├── shard-store.test.ts
    ├── mc-warehouse-store.test.ts
    ├── mc-index-store.test.ts
    ├── mc-stats-store.test.ts
    ├── mc-mod-config.test.ts
    └── area.test.ts          # 追加 findWarehouseAt / findContainerAt 用例
```

**测试约定（全计划通用）：**
- 运行：`pnpm test:core` = `tsc -p tsconfig.test.json && node --test .test-build/tests/`
- 每个测试文件顶部：`import { test } from "node:test"; import assert from "node:assert/strict";`
- scripts/mc/storage 纯逻辑文件**不 import `@minecraft/server`**（后端注入），因此可在 node 下用 `InMemoryKeyValueStore` 单测；`DynamicPropertyStore.ts` 与 `scripts/mc/adapters/*` 依赖 `@minecraft/server`，仅编译检查 + 游戏内验证（无 node 测试）
- 依赖注入全部显式：`new ShardStore(backend)` / `new McWarehouseStore(backend)`

---

### Task 1: 依赖与测试配置扩展

**Files:**
- Modify: `mcaddon/item-route/package.json`
- Modify: `mcaddon/item-route/tsconfig.test.json`

- [ ] **Step 1: package.json 追加 @minecraft/server 类型依赖**

`mcaddon/item-route/package.json`（在现有基础上追加 devDependencies）:
```json
{
  "name": "item-route",
  "version": "0.1.0",
  "private": true,
  "description": "物品路由仓库 addon（核心引擎零 MC 依赖）",
  "scripts": {
    "test:core": "tsc -p tsconfig.test.json && node --test .test-build/tests/"
  },
  "devDependencies": {
    "@minecraft/server": "^2.6.0"
  }
}
```

- [ ] **Step 2: tsconfig.test.json 追加 scripts/mc/storage include**

`mcaddon/item-route/tsconfig.test.json`（include 追加 `"scripts/mc/storage/**/*.ts"`）:
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
  "include": ["scripts/core/**/*.ts", "scripts/mc/storage/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: 安装依赖并验证编译**

Run: `cd mcaddon/item-route && pnpm install && pnpm test:core`
Expected: smoke 测试 PASS；tsc 编译通过（scripts/mc/storage 目录尚空，不影响）。

- [ ] **Step 4: 提交**

```bash
git add mcaddon/item-route/package.json mcaddon/item-route/tsconfig.test.json mcaddon/item-route/pnpm-lock.yaml
git commit -m "item-route: 追加 @minecraft/server 类型依赖 + 测试配置扩展 scripts/mc/storage"
```

---

### Task 2: addon 构建骨架

**Files:**
- Create: `mcaddon/item-route/tsconfig.json`
- Create: `mcaddon/item-route/just.config.ts`
- Create: `mcaddon/item-route/scripts/main.ts`
- Create: `mcaddon/item-route/BP/ItemRoute/manifest.json`
- Create: `mcaddon/item-route/RP/ItemRoute/manifest.json`
- Modify: `mcaddon/item-route/package.json`

- [ ] **Step 1: 创建 addon 编译配置**

`mcaddon/item-route/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es6",
    "lib": ["es2017"],
    "moduleResolution": "bundler",
    "module": "ES2020",
    "declaration": false,
    "noLib": false,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "sourceMap": true,
    "pretty": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "allowUnreachableCode": true,
    "allowUnusedLabels": true,
    "noImplicitAny": true,
    "noImplicitReturns": false,
    "noImplicitUseStrict": false,
    "outDir": "lib",
    "rootDir": ".",
    "baseUrl": "BP/",
    "listFiles": false,
    "noEmitHelpers": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true
  },
  "include": ["scripts/**/*", "scripts/core/**/*", "scripts/mc/**/*"],
  "exclude": ["lib", "dist", "node_modules", ".test-build"],
  "compileOnSave": false
}
```

- [ ] **Step 2: 创建构建任务配置**

`mcaddon/item-route/just.config.ts`（参照 v1 smartwarehouse，改项目名）:
```ts
import { argv, task, tscTask } from "just-scripts";
import { readFileSync, writeFileSync } from "fs";
import {
  bundleTask,
  cleanTask,
  copyTask,
  mcaddonTask,
  STANDARD_CLEAN_PATHS,
} from "@minecraft/core-build-tasks";
import path from "path";
import { bundleOptions, copyOptions, syncManifestVersion } from "@yinxe/toolkit-build";

// ── Project metadata ────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const CHINESE_NAME = pkg.mcbe.packName;
const PACKAGE_NAME = pkg.name;
const PROJECT_NAME = path.basename(pkg.mcbe.bp);
const pkgVersion = pkg.version;

// ── Bundle ──────────────────────────────────────────────────────
const bundleTaskOptions = bundleOptions(__dirname, "./scripts/main.ts", [
  "@minecraft/server", "@minecraft/server-ui",
]);
const copyTaskOptions = copyOptions(__dirname, PROJECT_NAME);
const mcaddonTaskOptions = {
  ...copyTaskOptions,
  outputFile: `./dist/packages/${PACKAGE_NAME}-v${pkgVersion}.mcaddon`,
};

// ── Tasks ───────────────────────────────────────────────────────
task("typescript", tscTask());
task("bundle", bundleTask(bundleTaskOptions));
task("copy", copyTask(copyTaskOptions));
task("mcaddon", mcaddonTask(mcaddonTaskOptions));
task("clean", cleanTask(STANDARD_CLEAN_PATHS));

/** 从 package.json 生成 scripts/version.ts */
task("generate-version", () => {
  const buildTime = new Date().toISOString();
  const content = [
    "// 此文件由 just.config.ts 在构建时自动生成\n",
    `export const VERSION = "${pkgVersion}";`,
    `export const BUILD_TIME = "${buildTime}";`,
    `export const PROJECT_URL = "https://github.com/YinxSmartHouse/item-route";`,
  ].join("\n");
  writeFileSync(path.resolve(__dirname, "scripts/version.ts"), content + "\n");
  console.log(`  ✓ scripts/version.ts → v${pkgVersion} (${buildTime})`);
});

task("update-version", () => {
  console.log(`Syncing manifest versions to ${pkgVersion} …`);
  syncManifestVersion(__dirname, {
    formatName: (_, v) => `${CHINESE_NAME} v${v}`,
    onManifest: (m) => {
      m.header.description = `物品路由仓库 - 自动分拣、容器整理、仓库统计、容量预警 v${pkgVersion}`;
    },
  });
  console.log("Done.");
});

task("build", ["generate-version", "update-version", "typescript", "bundle", "copy"]);
```

- [ ] **Step 3: 创建 addon 入口与清单**

`mcaddon/item-route/scripts/main.ts`（空骨架，Task 15 接线）:
```ts
// ─── addon 入口（Task 15 接线 scripts/mc/main） ─────────────────────
console.warn("[item-route] 启动中…");
```

`mcaddon/item-route/BP/ItemRoute/manifest.json`:
```json
{
  "format_version": 2,
  "header": {
    "name": "物品路由 v0.1.0",
    "description": "物品路由仓库 - 自动分拣、容器整理、仓库统计、容量预警 v0.1.0",
    "uuid": "a1b2c3d4-0000-4000-8000-000000000001",
    "version": [0, 1, 0],
    "min_engine_version": [1, 21, 90]
  },
  "modules": [
    {
      "description": "Behavior",
      "version": [0, 1, 0],
      "uuid": "a1b2c3d4-0000-4000-8000-000000000002",
      "type": "data"
    },
    {
      "description": "Script resources",
      "language": "javascript",
      "type": "script",
      "uuid": "a1b2c3d4-0000-4000-8000-000000000003",
      "version": [0, 1, 0],
      "entry": "scripts/main.js"
    }
  ],
  "dependencies": [
    {
      "uuid": "a1b2c3d4-0000-4000-8000-000000000004",
      "version": [0, 1, 0]
    }
  ]
}
```

`mcaddon/item-route/RP/ItemRoute/manifest.json`:
```json
{
  "format_version": 2,
  "header": {
    "name": "物品路由资源包",
    "description": "物品路由仓库资源包",
    "uuid": "a1b2c3d4-0000-4000-8000-000000000005",
    "version": [0, 1, 0],
    "min_engine_version": [1, 21, 90]
  },
  "modules": [
    {
      "description": "Resources",
      "version": [0, 1, 0],
      "uuid": "a1b2c3d4-0000-4000-8000-000000000006",
      "type": "resources"
    }
  ]
}
```

- [ ] **Step 4: package.json 追加构建依赖与 scripts**

`mcaddon/item-route/package.json`（在 Task 1 基础上追加）:
```json
{
  "name": "item-route",
  "version": "0.1.0",
  "private": true,
  "description": "物品路由仓库 addon（核心引擎零 MC 依赖）",
  "scripts": {
    "test:core": "tsc -p tsconfig.test.json && node --test .test-build/tests/",
    "build": "just-scripts build",
    "clean": "just-scripts clean",
    "pack": "just-scripts mcaddon"
  },
  "devDependencies": {
    "@minecraft/core-build-tasks": "5.5.0",
    "@minecraft/server": "^2.6.0",
    "@minecraft/server-ui": "^2.0.0",
    "@types/node": "^26.1.1",
    "@yinxe/toolkit": "workspace:*",
    "@yinxe/toolkit-build": "workspace:*",
    "just-scripts": "^2.6.2",
    "source-map": "0.7.4",
    "ts-node": "10.9.1",
    "typescript": "5.0.2"
  },
  "mcbe": {
    "packName": "物品路由",
    "bp": "BP/ItemRoute",
    "rp": "RP/ItemRoute"
  }
}
```

- [ ] **Step 5: 安装并验证构建**

Run: `cd mcaddon/item-route && pnpm install && pnpm run build`
Expected: 构建成功，`dist/packages/item-route-v0.1.0.mcaddon` 生成（或至少 bundle/copy 无报错）。

- [ ] **Step 6: 提交**

```bash
git add mcaddon/item-route/tsconfig.json mcaddon/item-route/just.config.ts mcaddon/item-route/scripts/main.ts mcaddon/item-route/BP mcaddon/item-route/RP mcaddon/item-route/package.json mcaddon/item-route/pnpm-lock.yaml
git commit -m "item-route: addon 构建骨架（tsconfig/just.config/manifest/入口）"
```

---

### Task 3: scripts/core/model/ContainerTypes.ts（容器类型判定纯函数）

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/ContainerTypes.ts`
- Test: `mcaddon/item-route/tests/container-types.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/container-types.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChestType, isHopperType, isSupportedContainerType, SHULKER_BOX_IDS } from "../scripts/core/model/ContainerTypes";

test("ContainerTypes: 箱子/陷阱箱判定", () => {
  assert.equal(isChestType("minecraft:chest"), true);
  assert.equal(isChestType("minecraft:trapped_chest"), true);
  assert.equal(isChestType("minecraft:barrel"), false);
  assert.equal(isChestType("minecraft:hopper"), false);
});

test("ContainerTypes: 漏斗判定", () => {
  assert.equal(isHopperType("minecraft:hopper"), true);
  assert.equal(isHopperType("minecraft:chest"), false);
});

test("ContainerTypes: 支持类型全集", () => {
  assert.equal(isSupportedContainerType("minecraft:chest"), true);
  assert.equal(isSupportedContainerType("minecraft:trapped_chest"), true);
  assert.equal(isSupportedContainerType("minecraft:barrel"), true);
  assert.equal(isSupportedContainerType("minecraft:hopper"), true);
  assert.equal(isSupportedContainerType("minecraft:undyed_shulker_box"), true);
  assert.equal(isSupportedContainerType("minecraft:red_shulker_box"), true);
  assert.equal(isSupportedContainerType("minecraft:stone"), false);
  assert.equal(isSupportedContainerType("minecraft:air"), false);
});

test("ContainerTypes: 潜影盒全集含 17 种", () => {
  assert.equal(SHULKER_BOX_IDS.size, 17);
  assert.equal(SHULKER_BOX_IDS.has("minecraft:undyed_shulker_box"), true);
  assert.equal(SHULKER_BOX_IDS.has("minecraft:black_shulker_box"), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/container-types.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/ContainerTypes.ts`:
```ts
// ─── 容器类型判定（纯数据，零 MC 依赖，可单测） ──────────────
/** 全部 17 种潜影盒类型 ID（16 染色 + 1 未染色） */
export const SHULKER_BOX_IDS = new Set([
  "minecraft:undyed_shulker_box",
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

/** 箱子/陷阱箱：可双箱合并的类型 */
export function isChestType(typeId: string): boolean {
  return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest";
}

/** 漏斗：只能作为输入容器（input），默认禁用 */
export function isHopperType(typeId: string): boolean {
  return typeId === "minecraft:hopper";
}

/** 是否为本 addon 支持的容器类型 */
export function isSupportedContainerType(typeId: string): boolean {
  return isChestType(typeId) || isHopperType(typeId) || typeId === "minecraft:barrel" || SHULKER_BOX_IDS.has(typeId);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/container-types.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/ContainerTypes.ts mcaddon/item-route/tests/container-types.test.ts
git commit -m "item-route: scripts/core/model 容器类型判定纯函数（chest/hopper/shulker/barrel）"
```

---

### Task 4: scripts/core/model/Area.ts（区域包含 + 邻近判定纯函数）

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/Area.ts`
- Test: `mcaddon/item-route/tests/area.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/area.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { containsLocation, isPlayerNearby } from "../scripts/core/model/Area";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";

const area: WarehouseArea = {
  dimension: "overworld",
  corner1: { x: 0, y: 0, z: 0 },
  corner2: { x: 10, y: 10, z: 10 },
};

test("containsLocation: 区域内/外/边界", () => {
  assert.equal(containsLocation(area, "overworld", { x: 5, y: 5, z: 5 }), true);
  assert.equal(containsLocation(area, "overworld", { x: 0, y: 0, z: 0 }), true); // 边界含
  assert.equal(containsLocation(area, "overworld", { x: 11, y: 5, z: 5 }), false);
  assert.equal(containsLocation(area, "overworld", { x: 5, y: 11, z: 5 }), false);
});

test("containsLocation: 维度不匹配返回 false", () => {
  assert.equal(containsLocation(area, "nether", { x: 5, y: 5, z: 5 }), false);
});

test("containsLocation: 角点乱序仍正确", () => {
  const flipped: WarehouseArea = { dimension: "overworld", corner1: { x: 10, y: 10, z: 10 }, corner2: { x: 0, y: 0, z: 0 } };
  assert.equal(containsLocation(flipped, "overworld", { x: 5, y: 5, z: 5 }), true);
});

test("isPlayerNearby: XZ 距离判定 + 维度过滤", () => {
  const players = [
    { dimension: "overworld", x: 5, z: 5 },   // 中心附近
    { dimension: "nether", x: 5, z: 5 },      // 维度不符
    { dimension: "overworld", x: 100, z: 100 }, // 太远
  ];
  assert.equal(isPlayerNearby(area, players, 16), true);
  assert.equal(isPlayerNearby(area, [players[1]!, players[2]!], 16), false);
  assert.equal(isPlayerNearby(area, [players[2]!], 16), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/area.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/Area.ts`:
```ts
// ─── 区域包含与邻近判定（纯函数，零 MC 依赖，可单测） ──────
import type { WarehouseArea } from "./Warehouse";
import type { Location } from "./types";

/** 位置是否位于仓库区域内（维度匹配 + 三轴区间内，边界含） */
export function containsLocation(area: WarehouseArea, dimension: string, loc: Location): boolean {
  if (area.dimension !== dimension) return false;
  const minX = Math.min(area.corner1.x, area.corner2.x);
  const maxX = Math.max(area.corner1.x, area.corner2.x);
  const minY = Math.min(area.corner1.y, area.corner2.y);
  const maxY = Math.max(area.corner1.y, area.corner2.y);
  const minZ = Math.min(area.corner1.z, area.corner2.z);
  const maxZ = Math.max(area.corner1.z, area.corner2.z);
  return loc.x >= minX && loc.x <= maxX && loc.y >= minY && loc.y <= maxY && loc.z >= minZ && loc.z <= maxZ;
}

/** 玩家位置（维度 + XZ 坐标） */
export interface PlayerPosition {
  dimension: string;
  x: number;
  z: number;
}

/** 是否有玩家在仓库区域中心 XZ 距离 range 内（按维度过滤） */
export function isPlayerNearby(area: WarehouseArea, players: PlayerPosition[], range: number): boolean {
  const cx = (Math.min(area.corner1.x, area.corner2.x) + Math.max(area.corner1.x, area.corner2.x)) / 2;
  const cz = (Math.min(area.corner1.z, area.corner2.z) + Math.max(area.corner1.z, area.corner2.z)) / 2;
  return players.some(
    (p) => p.dimension === area.dimension && Math.hypot(p.x - cx, p.z - cz) <= range
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/area.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/Area.ts mcaddon/item-route/tests/area.test.ts
git commit -m "item-route: scripts/core/model 区域包含 + 邻近判定纯函数（桥接过滤谓词）"
```

---

### Task 5: scripts/core/model/ChestMerge.ts（双箱合并判定纯函数）

**Files:**
- Create: `mcaddon/item-route/scripts/core/model/ChestMerge.ts`
- Test: `mcaddon/item-route/tests/chest-merge.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/chest-merge.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findChestPartner, type BlockInfo } from "../scripts/core/model/ChestMerge";

const primary: BlockInfo = { typeId: "minecraft:chest", x: 10, y: 64, z: 10 };

test("findChestPartner: 相邻同类型箱子 → 找到伙伴", () => {
  const partner: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 10 };
  assert.deepEqual(findChestPartner(primary, [partner]), partner);
});

test("findChestPartner: 非箱子类型 → undefined", () => {
  const barrel: BlockInfo = { typeId: "minecraft:barrel", x: 11, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [barrel]), undefined);
});

test("findChestPartner: 不同类型箱子不合并（chest vs trapped_chest）", () => {
  const trapped: BlockInfo = { typeId: "minecraft:trapped_chest", x: 11, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [trapped]), undefined);
});

test("findChestPartner: 不相邻（对角/隔一格）→ undefined", () => {
  const diagonal: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 11 };
  const far: BlockInfo = { typeId: "minecraft:chest", x: 12, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [diagonal]), undefined);
  assert.equal(findChestPartner(primary, [far]), undefined);
});

test("findChestPartner: 上下相邻不合并（双箱仅水平）", () => {
  const above: BlockInfo = { typeId: "minecraft:chest", x: 10, y: 65, z: 10 };
  assert.equal(findChestPartner(primary, [above]), undefined);
});

test("findChestPartner: 多邻居中取第一个匹配", () => {
  const a: BlockInfo = { typeId: "minecraft:barrel", x: 9, y: 64, z: 10 };
  const b: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 10 };
  assert.deepEqual(findChestPartner(primary, [a, b]), b);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/chest-merge.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/core/model/ChestMerge.ts`:
```ts
// ─── 双箱合并判定（SafeProbe 提纯：纯几何规则，零 MC 依赖） ──
import { isChestType } from "./ContainerTypes";

/** 方块信息（typeId + 坐标），供双箱判定 */
export interface BlockInfo {
  typeId: string;
  x: number;
  y: number;
  z: number;
}

/** 两方块是否水平相邻（XZ 平面曼哈顿距离 1，Y 相同） */
function isHorizontallyAdjacent(a: BlockInfo, b: BlockInfo): boolean {
  if (a.y !== b.y) return false;
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return (dx === 1 && dz === 0) || (dx === 0 && dz === 1);
}

/**
 * 双箱合并判定：主箱 + 邻居列表 → 找到可合并的伙伴。
 * 规则：双方均为箱子/陷阱箱、typeId 相同、水平相邻。
 * 返回第一个匹配伙伴；无则 undefined。
 */
export function findChestPartner(primary: BlockInfo, neighbors: BlockInfo[]): BlockInfo | undefined {
  if (!isChestType(primary.typeId)) return undefined;
  return neighbors.find(
    (n) => isChestType(n.typeId) && n.typeId === primary.typeId && isHorizontallyAdjacent(primary, n)
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/chest-merge.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/core/model/ChestMerge.ts mcaddon/item-route/tests/chest-merge.test.ts
git commit -m "item-route: scripts/core/model 双箱合并判定纯函数（SafeProbe 提纯）"
```

---

### Task 6: scripts/mc/storage/ShardStore.ts（分片键值仓储：安全线/hash 写后验/世代/孤儿清理/1MB 降级）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/storage/ShardStore.ts`
- Test: `mcaddon/item-route/tests/shard-store.test.ts`

**设计（对应设计 §8）:**
- 单键信封 ≤ **26KB 安全线**（UTF-16 长度，v1 24KB 同款口径 + 余量）
- **overwrite 模式**（索引/统计/配置）：固定键区覆盖写 + 每片内容 hash 校验；写后验读回，失败重写一次（DP 单键写是原子的，无需世代）
- **generation 模式**（元数据/容器注册表全量重写）：写新世代分片 → 更新 hdr → **删除旧世代键（孤儿清理时机 = 写新世代时）**
- **1MB 降级**：写入前估算 `totalBytes() + payload`，超 `MAX_TOTAL_BYTES` 拒绝写并返回 false（调用方保留脏标记稍后重试，总量回落后自动恢复）

- [ ] **Step 1: 写失败测试**

`tests/shard-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore, MAX_TOTAL_BYTES, SAFE_ENVELOPE_LENGTH, fnv1a } from "../scripts/mc/storage/ShardStore";
import type { KeyValueStore } from "../scripts/core/storage/KeyValueStore";

/** 可枚举键的测试 KV（验证孤儿清理/覆盖写收缩） */
class TestKV implements KeyValueStore {
  private map = new Map<string, unknown>();
  read<T>(key: string): T | undefined { return this.map.get(key) as T | undefined; }
  write<T>(key: string, value: T): void { this.map.set(key, value); }
  remove(key: string): void { this.map.delete(key); }
  keys(): string[] { return [...this.map.keys()]; }
}

function makeStore(kv = new TestKV(), totalBytes = () => 0, safeLength = SAFE_ENVELOPE_LENGTH) {
  return { kv, store: new ShardStore(kv, totalBytes, safeLength) };
}

test("ShardStore: overwrite 小 payload 往返 + 覆盖写", () => {
  const { kv, store } = makeStore();
  store.write("a", { n: 1 }, "overwrite");
  assert.deepEqual(store.read("a"), { n: 1 });
  store.write("a", { n: 2 }, "overwrite");
  assert.deepEqual(store.read("a"), { n: 2 });
});

test("ShardStore: overwrite 超大 payload 自动分包 + 收缩清理", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000); // 小安全线强制分包
  const big = { items: Array.from({ length: 200 }, (_, i) => `item-${i}-${"x".repeat(40)}`) };
  assert.equal(store.write("idx", big, "overwrite"), true);
  assert.deepEqual(store.read("idx"), big);
  // 收缩后多余分片被清理
  store.write("idx", { items: ["small"] }, "overwrite");
  assert.deepEqual(store.read("idx"), { items: ["small"] });
  const leftover = kv.keys().filter((k) => k.startsWith("idx:data:"));
  assert.ok(leftover.length <= 1, `多余分片未清理: ${leftover}`);
});

test("ShardStore: 损坏检测（篡改内容 → undefined）", () => {
  const { kv, store } = makeStore();
  store.write("a", { n: 1 }, "overwrite");
  const key = kv.keys().find((k) => k.startsWith("a:")) as string;
  kv.write(key, JSON.stringify({ h: "deadbeef", v: "tampered" }));
  assert.equal(store.read("a"), undefined);
});

test("ShardStore: generation 世代切换 + 孤儿键清理", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000);
  const big = { items: Array.from({ length: 100 }, (_, i) => `c${i}`) };
  store.write("meta", big, "generation");
  const gen1 = kv.keys().filter((k) => k.startsWith("meta:"));
  assert.ok(gen1.length > 2, "应分包为多键");
  store.write("meta", { items: ["new"] }, "generation");
  const gen2 = kv.keys().filter((k) => k.startsWith("meta:"));
  assert.deepEqual(store.read("meta"), { items: ["new"] });
  const oldKeys = gen2.filter((k) => k.includes(":1:"));
  assert.equal(oldKeys.length, 0, `旧世代键未清理: ${oldKeys}`); // 新世代 gen=1 后无残留
});

test("ShardStore: 1MB 预算拒绝写返回 false", () => {
  const { store } = makeStore(new TestKV(), () => MAX_TOTAL_BYTES);
  assert.equal(store.write("a", { n: 1 }, "overwrite"), false);
  assert.equal(store.read("a"), undefined);
});

test("ShardStore: remove 清理全部键", () => {
  const { kv, store } = makeStore(new TestKV(), () => 0, 1000);
  store.write("a", { items: Array.from({ length: 50 }, (_, i) => `c${i}`) }, "generation");
  store.remove("a");
  assert.equal(store.read("a"), undefined);
  assert.equal(kv.keys().filter((k) => k.startsWith("a:")).length, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/shard-store.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/mc/storage/ShardStore.ts`:
```ts
// ─── 分片键值仓储：DP 单键 26KB 安全线 → 多分片 + hash 写后验 ──
import type { KeyValueStore } from "../../scripts/core/storage/KeyValueStore";

/** 单键信封安全线（UTF-16 长度，v1 24KB 同款口径留余量） */
export const SAFE_ENVELOPE_LENGTH = 26_000;
/** DP 总配额 1MB 的保守预算（预留余量，判定用） */
export const MAX_TOTAL_BYTES = 900_000;
/** 信封 JSON 开销（{h,v} 结构 + 引号转义预留） */
const ENVELOPE_OVERHEAD = 64;

/** FNV-1a 32 位哈希（内容完整性校验，非加密用途） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 分片信封：h = fnv1a(v)，读回时校验 */
interface Envelope { h: string; v: string; }
/** 头部：记录模式/世代/分片数（写后验 + 孤儿清理依据） */
interface Header { mode: "overwrite" | "generation"; gen: number; count: number; }

const hdrKey = (key: string): string => `${key}:hdr`;
const dataKey = (key: string, gen: number, i: number): string => `${key}:data:${gen}:${i}`;

export class ShardStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly totalBytes: () => number = () => 0,
    private readonly safeLength: number = SAFE_ENVELOPE_LENGTH
  ) {}

  /**
   * 写分片集。
   * - overwrite：固定 gen=0 覆盖写（索引/统计/配置），写后验读回 hash，失败重写一次
   * - generation：写新世代 → 更 hdr → 删旧世代（孤儿清理时机）
   * - 1MB 降级：估算超预算返回 false（调用方保留脏标记稍后重试）
   */
  write<T>(key: string, payload: T, mode: "overwrite" | "generation" = "overwrite"): boolean {
    const json = JSON.stringify(payload);
    const chunks = this.chunk(json);
    if (this.totalBytes() + json.length > MAX_TOTAL_BYTES) {
      console.warn(`[ItemRoute] DP 总量预算不足，拒绝写入 ${key}（+${json.length}B）`);
      return false;
    }
    const old = this.kv.read<Header>(hdrKey(key));
    const gen = mode === "generation" ? (old?.gen ?? 0) + 1 : 0;
    for (let i = 0; i < chunks.length; i++) {
      this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
    }
    this.kv.write(hdrKey(key), { mode, gen, count: chunks.length } satisfies Header);
    // 写后验：读回校验 hash，失败重写一次
    if (!this.verify(key, gen, chunks.length)) {
      for (let i = 0; i < chunks.length; i++) {
        this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
      }
      if (!this.verify(key, gen, chunks.length)) {
        console.warn(`[ItemRoute] 分片写后验失败：${key}`);
        return false;
      }
    }
    // 孤儿清理：generation 删旧世代；overwrite 收缩时删多余分片
    if (old) {
      if (mode === "generation" && old.gen !== gen) {
        for (let i = 0; i < old.count; i++) this.kv.remove(dataKey(key, old.gen as number, i));
      } else if (old.count > chunks.length) {
        for (let i = chunks.length; i < old.count; i++) this.kv.remove(dataKey(key, old.gen as number, i));
      }
    }
    return true;
  }

  read<T>(key: string): T | undefined {
    const header = this.kv.read<Header>(hdrKey(key));
    if (!header) return undefined;
    let json = "";
    for (let i = 0; i < header.count; i++) {
      const raw = this.kv.read<string>(dataKey(key, header.gen as number, i));
      if (typeof raw !== "string") return undefined;
      try {
        const env = JSON.parse(raw) as Envelope;
        if (env.h !== fnv1a(env.v)) return undefined;
        json += env.v;
      } catch {
        return undefined;
      }
    }
    try {
      return JSON.parse(json) as T;
    } catch {
      return undefined;
    }
  }

  remove(key: string): void {
    const header = this.kv.read<Header>(hdrKey(key));
    if (header) {
      for (let i = 0; i < header.count; i++) this.kv.remove(dataKey(key, header.gen as number, i));
    }
    this.kv.remove(hdrKey(key));
  }

  /** payload JSON 分包，每片保证信封 ≤ 安全线 */
  private chunk(json: string): string[] {
    const max = this.safeLength - ENVELOPE_OVERHEAD;
    if (json.length <= max) return [json];
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += max) {
      chunks.push(json.slice(i, i + max));
    }
    return chunks;
  }

  private envelope(v: string): string {
    return JSON.stringify({ h: fnv1a(v), v });
  }

  private verify(key: string, gen: number, count: number): boolean {
    for (let i = 0; i < count; i++) {
      const raw = this.kv.read<string>(dataKey(key, gen, i));
      if (typeof raw !== "string") return false;
      try {
        const env = JSON.parse(raw) as Envelope;
        if (env.h !== fnv1a(env.v)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/shard-store.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/mc/storage/ShardStore.ts mcaddon/item-route/tests/shard-store.test.ts
git commit -m "item-route: scripts/mc/storage 分片键值仓储（26KB 安全线/hash 写后验/世代孤儿清理/1MB 降级）"
```

---

### Task 7: scripts/mc/storage/DynamicPropertyStore.ts（DP 后端，薄）+ tsconfig.test.json 排除

**Files:**
- Create: `mcaddon/item-route/scripts/mc/storage/DynamicPropertyStore.ts`
- Modify: `mcaddon/item-route/tsconfig.test.json`

**说明:** 唯一 import `@minecraft/server` 的 storage 文件——薄包装 `world.getDynamicProperty`，无业务逻辑，不进 node 测试构建。

- [ ] **Step 1: tsconfig.test.json 追加 exclude**

`mcaddon/item-route/tsconfig.test.json`（在 include 基础上追加）:
```json
{
  "exclude": ["node_modules", ".test-build", "scripts/mc/storage/DynamicPropertyStore.ts"]
}
```

- [ ] **Step 2: 实现**

`scripts/mc/storage/DynamicPropertyStore.ts`:
```ts
// ─── DP 后端：KeyValueStore 的 world 实现（薄，无业务逻辑） ──
import { world } from "@minecraft/server";
import type { KeyValueStore } from "../../scripts/core/storage/KeyValueStore";

const PREFIX = "ir2:";

/** DP 当字符串键值存储；分片/校验由 ShardStore 负责 */
export class DynamicPropertyStore implements KeyValueStore {
  read<T>(key: string): T | undefined {
    const raw = world.getDynamicProperty(PREFIX + key);
    if (typeof raw !== "string") return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  write<T>(key: string, value: T): void {
    world.setDynamicProperty(PREFIX + key, JSON.stringify(value));
  }

  remove(key: string): void {
    world.setDynamicProperty(PREFIX + key, undefined);
  }

  /** 当前 DP 总用量（1MB 预算判定） */
  totalBytes(): number {
    return world.getDynamicPropertyTotalByteCount();
  }
}
```

- [ ] **Step 3: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS（无类型错误）。

- [ ] **Step 4: 提交**

```bash
git add mcaddon/item-route/scripts/mc/storage/DynamicPropertyStore.ts mcaddon/item-route/tsconfig.test.json
git commit -m "item-route: scripts/mc/storage DP 后端（world 包装，薄）+ 测试构建排除"
```

---

### Task 8: scripts/mc/storage/McWarehouseStore.ts（注册表 + 世代分片元数据 + 容器注册表）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/storage/McWarehouseStore.ts`
- Test: `mcaddon/item-route/tests/mc-warehouse-store.test.ts`

**职责:** 三个数据面，全部经 ShardStore：
- 注册表键 `ir2:registry`（overwrite 单键）：`{ warehouses: WarehouseId[] }`
- 元数据键 `ir2:wh:${id}:meta`（generation）：`WarehouseSnapshot`
- **容器注册表键 `ir2:wh:${id}:containers`（generation，全量重写场景）**：`ContainerEntry[]`——补 core 快照缺的容器几何信息（id/role/locations/enabled/priority），重启时重建适配器

- [ ] **Step 1: 写失败测试**

`tests/mc-warehouse-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McWarehouseStore } from "../scripts/mc/storage/McWarehouseStore";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { WarehouseSnapshot } from "../scripts/core/storage/Stores";

const snapshot = (id: string): WarehouseSnapshot => ({
  id,
  displayName: `仓库${id}`,
  ownerId: "p1",
  members: [{ playerId: "p1", role: "owner" as const }],
  area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
  settings: createDefaultSettings(),
  containerIds: ["c1", "c2"],
});

function makeStore() {
  const kv = new InMemoryKeyValueStore();
  return { kv, store: new McWarehouseStore(new ShardStore(kv)) };
}

test("McWarehouseStore: 注册/列表/加载/删除", () => {
  const { store } = makeStore();
  assert.deepEqual(store.list(), []);
  store.save(snapshot("w1"));
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.load("w1")?.displayName, "仓库w1");
  store.save(snapshot("w2"));
  assert.equal(store.list().length, 2);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
  assert.equal(store.list().length, 1);
});

test("McWarehouseStore: 覆盖更新不产生重复注册", () => {
  const { store } = makeStore();
  store.save(snapshot("w1"));
  store.save({ ...snapshot("w1"), displayName: "改名" });
  assert.equal(store.list().length, 1);
  assert.equal(store.load("w1")?.displayName, "改名");
});

test("McWarehouseStore: 容器注册表全量重写", () => {
  const { store } = makeStore();
  const entries = [
    { id: "c1", role: "input" as const, locations: [{ x: 1, y: 2, z: 3 }], enabled: true, priority: 10 },
    { id: "c2", role: "single" as const, locations: [{ x: 4, y: 2, z: 5 }], enabled: true, priority: 10 },
  ];
  store.saveContainers("w1", entries);
  assert.deepEqual(store.loadContainers("w1"), entries);
  // 全量重写：删掉 c2
  store.saveContainers("w1", [entries[0] as (typeof entries)[number]]);
  assert.deepEqual(store.loadContainers("w1")?.map((c) => c.id), ["c1"]);
  store.remove("w1");
  assert.equal(store.loadContainers("w1"), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-warehouse-store.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/mc/storage/McWarehouseStore.ts`:
```ts
// ─── 仓库仓储：注册表 + 世代分片元数据 + 容器注册表（全量重写） ──
import type { ShardStore } from "./ShardStore";
import type { ContainerId, Location, PlayerId, WarehouseId } from "../../scripts/core/model/types";
import type { ContainerRole } from "../../scripts/core/model/Container";
import type { WarehouseSnapshot } from "../../scripts/core/storage/Stores";

// ── 键规划 ─────────────────────────────────────────────
const REGISTRY_KEY = "ir2:registry";
const metaKey = (id: WarehouseId): string => `ir2:wh:${id}:meta`;
const containersKey = (id: WarehouseId): string => `ir2:wh:${id}:containers`;

interface Registry { warehouses: WarehouseId[]; }

/** 持久化容器条目：重启重建适配器的几何信息 */
export interface ContainerEntry {
  id: ContainerId;
  role: ContainerRole;
  locations: Location[];
  enabled: boolean;
  priority: number;
}

export class McWarehouseStore {
  constructor(private readonly shards: ShardStore) {}

  list(): WarehouseSnapshot[] {
    const reg = this.shards.read<Registry>(REGISTRY_KEY);
    const out: WarehouseSnapshot[] = [];
    for (const id of reg?.warehouses ?? []) {
      const w = this.load(id);
      if (w) out.push(w);
    }
    return out;
  }

  load(id: WarehouseId): WarehouseSnapshot | undefined {
    return this.shards.read<WarehouseSnapshot>(metaKey(id));
  }

  save(snapshot: WarehouseSnapshot): void {
    this.shards.write(metaKey(snapshot.id), snapshot, "generation");
    const reg = this.shards.read<Registry>(REGISTRY_KEY) ?? { warehouses: [] };
    if (!reg.warehouses.includes(snapshot.id)) {
      reg.warehouses.push(snapshot.id);
      this.shards.write(REGISTRY_KEY, reg, "overwrite");
    }
  }

  remove(id: WarehouseId): void {
    this.shards.remove(metaKey(id));
    this.shards.remove(containersKey(id));
    const reg = this.shards.read<Registry>(REGISTRY_KEY);
    if (reg) {
      reg.warehouses = reg.warehouses.filter((w) => w !== id);
      this.shards.write(REGISTRY_KEY, reg, "overwrite");
    }
  }

  /** 容器注册表：全量重写（generation，孤儿清理由 ShardStore 完成） */
  saveContainers(id: WarehouseId, entries: ContainerEntry[]): void {
    this.shards.write(containersKey(id), entries, "generation");
  }

  loadContainers(id: WarehouseId): ContainerEntry[] | undefined {
    return this.shards.read<ContainerEntry[]>(containersKey(id));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-warehouse-store.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/mc/storage/McWarehouseStore.ts mcaddon/item-route/tests/mc-warehouse-store.test.ts
git commit -m "item-route: scripts/mc/storage 仓库仓储（注册表/世代元数据/容器注册表全量重写）"
```

---

### Task 9: scripts/mc/storage/McIndexStore.ts（脏标记批量落盘 + 1MB 降级）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/storage/McIndexStore.ts`
- Test: `mcaddon/item-route/tests/mc-index-store.test.ts`

**设计:** 实现 core `IndexStore` 接口 + mc 专属脏标记：
- 键 `ir2:idx:${id}`（overwrite 单键 + hash 写后验）
- `markDirty(id, snapshot)` 仅内存缓存（路由热路径零 DP 写）
- `flush()` 批量落盘全部脏项；1MB 超限项保留脏标记，总量回落后自动恢复
- 落盘时机（main.ts/bridge 接线）：100 tick 间隔 + playerLeave + 删除仓库

- [ ] **Step 1: 写失败测试**

`tests/mc-index-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore, MAX_TOTAL_BYTES } from "../scripts/mc/storage/ShardStore";
import { McIndexStore } from "../scripts/mc/storage/McIndexStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { IndexSnapshotData } from "../scripts/core/storage/Stores";

const snap = (n: number): IndexSnapshotData => ({
  version: 1,
  byItem: { [`minecraft:stone:${n}`]: { single: ["s1"], multi: [] } },
  containerItems: { s1: [`minecraft:stone:${n}`] },
  singleBindings: { s1: `minecraft:stone:${n}` },
});

test("McIndexStore: markDirty + flush 批量落盘 + 读取", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.markDirty("w1", snap(1));
  store.markDirty("w2", snap(2));
  assert.equal(store.hasDirty(), true);
  store.flush();
  assert.equal(store.hasDirty(), false);
  assert.equal(store.load("w1")?.byItem["minecraft:stone:1"].single[0], "s1");
  assert.equal(store.load("w2")?.byItem["minecraft:stone:2"].single[0], "s1");
});

test("McIndexStore: 1MB 超限 flush 保留脏标记（降级）", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore(), () => MAX_TOTAL_BYTES));
  store.markDirty("w1", snap(1));
  const failed = store.flush();
  assert.equal(failed, 1);
  assert.equal(store.hasDirty(), true);
  assert.equal(store.load("w1"), undefined);
});

test("McIndexStore: remove 清键 + 清脏", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.markDirty("w1", snap(1));
  store.flush();
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
  assert.equal(store.hasDirty(), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-index-store.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/mc/storage/McIndexStore.ts`:
```ts
// ─── 索引仓储：脏标记批量落盘 + 1MB 降级（overwrite + hash 写后验） ──
import type { ShardStore } from "./ShardStore";
import type { IndexSnapshotData, IndexStore, WarehouseId } from "../../scripts/core/storage/Stores";

const indexKey = (id: WarehouseId): string => `ir2:idx:${id}`;

export class McIndexStore implements IndexStore {
  private dirty = new Map<WarehouseId, IndexSnapshotData>();

  constructor(private readonly shards: ShardStore) {}

  load(id: WarehouseId): IndexSnapshotData | undefined {
    return this.shards.read<IndexSnapshotData>(indexKey(id));
  }

  save(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.shards.write(indexKey(id), snapshot, "overwrite");
  }

  remove(id: WarehouseId): void {
    this.dirty.delete(id);
    this.shards.remove(indexKey(id));
  }

  /** 标记脏：路由热路径零 DP 写，仅内存 */
  markDirty(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.dirty.set(id, snapshot);
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** 批量落盘全部脏项；返回失败数（1MB 超限项保留脏标记，自动恢复） */
  flush(): number {
    let failed = 0;
    for (const [id, snapshot] of this.dirty) {
      if (this.shards.write(indexKey(id), snapshot, "overwrite")) {
        this.dirty.delete(id);
      } else {
        failed++;
      }
    }
    return failed;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-index-store.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/mc/storage/McIndexStore.ts mcaddon/item-route/tests/mc-index-store.test.ts
git commit -m "item-route: scripts/mc/storage 索引仓储（脏标记批量落盘 + 1MB 降级）"
```

---

### Task 10: scripts/mc/storage/McStatsStore.ts（写穿透）+ McModConfig.ts（全局配置）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/storage/McStatsStore.ts`
- Create: `mcaddon/item-route/scripts/mc/storage/McModConfig.ts`
- Test: `mcaddon/item-route/tests/mc-stats-store.test.ts`
- Test: `mcaddon/item-route/tests/mc-mod-config.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/mc-stats-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McStatsStore } from "../scripts/mc/storage/McStatsStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { StatsSnapshotData } from "../scripts/core/storage/Stores";

test("McStatsStore: 写穿透 save/load/remove", () => {
  const store = new McStatsStore(new ShardStore(new InMemoryKeyValueStore()));
  const snap: StatsSnapshotData = { warehouseId: "w1", containers: { c1: { usedSlots: 2 } }, warehouse: { totalItems: 5 } };
  store.save("w1", snap);
  assert.deepEqual(store.load("w1"), snap);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
});
```

`tests/mc-mod-config.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McModConfig } from "../scripts/mc/storage/McModConfig";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";

test("McModConfig: 缺失 → 默认值", () => {
  const cfg = McModConfig.load(new ShardStore(new InMemoryKeyValueStore()));
  assert.equal(cfg.globalEnabled, true);
  assert.equal(cfg.globalSpeedLimit, 20);
});

test("McModConfig: 设置持久化 + clamp", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  cfg.setGlobalEnabled(false);
  cfg.setGlobalSpeedLimit(999); // clamp 到 40
  const reloaded = McModConfig.load(new ShardStore(kv));
  assert.equal(reloaded.globalEnabled, false);
  assert.equal(reloaded.globalSpeedLimit, 40);
  reloaded.setGlobalSpeedLimit(0); // clamp 到 1
  assert.equal(McModConfig.load(new ShardStore(kv)).globalSpeedLimit, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-stats-store.test.js .test-build/tests/mc-mod-config.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`scripts/mc/storage/McStatsStore.ts`:
```ts
// ─── 统计仓储：写穿透（overwrite + hash） ──
import type { ShardStore } from "./ShardStore";
import type { StatsSnapshotData, StatsStore, WarehouseId } from "../../scripts/core/storage/Stores";

const statsKey = (id: WarehouseId): string => `ir2:st:${id}`;

export class McStatsStore implements StatsStore {
  constructor(private readonly shards: ShardStore) {}

  load(id: WarehouseId): StatsSnapshotData | undefined {
    return this.shards.read<StatsSnapshotData>(statsKey(id));
  }

  save(id: WarehouseId, snapshot: StatsSnapshotData): void {
    this.shards.write(statsKey(id), snapshot, "overwrite");
  }

  remove(id: WarehouseId): void {
    this.shards.remove(statsKey(id));
  }
}
```

`scripts/mc/storage/McModConfig.ts`:
```ts
// ─── 模组全局配置：globalSpeedLimit + 全局分拣开关（overwrite + hash） ──
import type { ShardStore } from "./ShardStore";

const CONFIG_KEY = "ir2:modcfg";
const SPEED_MIN = 1;
const SPEED_MAX = 40; // 与 core Scheduler clamp 一致

export interface ModConfigData {
  globalEnabled: boolean;
  globalSpeedLimit: number;
}

export const DEFAULT_MOD_CONFIG: ModConfigData = { globalEnabled: true, globalSpeedLimit: 20 };

export class McModConfig {
  private data: ModConfigData;

  private constructor(
    private readonly shards: ShardStore,
    data: ModConfigData
  ) {
    this.data = data;
  }

  static load(shards: ShardStore): McModConfig {
    const data = shards.read<ModConfigData>(CONFIG_KEY);
    return new McModConfig(shards, {
      globalEnabled: data?.globalEnabled ?? DEFAULT_MOD_CONFIG.globalEnabled,
      globalSpeedLimit: McModConfig.clamp(data?.globalSpeedLimit ?? DEFAULT_MOD_CONFIG.globalSpeedLimit),
    });
  }

  get globalEnabled(): boolean { return this.data.globalEnabled; }
  get globalSpeedLimit(): number { return this.data.globalSpeedLimit; }

  setGlobalEnabled(enabled: boolean): void {
    this.data.globalEnabled = enabled;
    this.save();
  }

  setGlobalSpeedLimit(speed: number): void {
    this.data.globalSpeedLimit = McModConfig.clamp(speed);
    this.save();
  }

  private static clamp(speed: number): number {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed)));
  }

  private save(): void {
    this.shards.write(CONFIG_KEY, this.data, "overwrite");
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/mc-stats-store.test.js .test-build/tests/mc-mod-config.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add mcaddon/item-route/scripts/mc/storage/McStatsStore.ts mcaddon/item-route/scripts/mc/storage/McModConfig.ts mcaddon/item-route/tests/mc-stats-store.test.ts mcaddon/item-route/tests/mc-mod-config.test.ts
git commit -m "item-route: scripts/mc/storage 统计仓储（写穿透）+ 全局配置（速度上限/开关）"
```

---

### Task 11: scripts/mc/adapters/McItemAdapter.ts + McContainerAdapter.ts（概念容器实现）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/adapters/McItemAdapter.ts`
- Create: `mcaddon/item-route/scripts/mc/adapters/McContainerAdapter.ts`

**职责:** 实现 core `Container` 接口；委托 `mc.Container` + 区块安全访问（全部 try-catch，失败静默/返回 undefined）；容量动态读 `mc.size`。

- [ ] **Step 1: 实现物品适配器**

`scripts/mc/adapters/McItemAdapter.ts`:
```ts
// ─── 物品适配器：mc.ItemStack ↔ 概念 ItemStack ──
import { ItemStack as McItemStack } from "@minecraft/server";
import type { ItemStack } from "../../scripts/core/model/ItemStack";

export class McItemAdapter {
  toDomain(stack: McItemStack | undefined): ItemStack | undefined {
    if (stack === undefined) return undefined;
    return { itemId: stack.typeId, amount: stack.amount, maxStackSize: stack.maxAmount };
  }

  toMc(stack: ItemStack): McItemStack {
    return new McItemStack(stack.itemId, stack.amount);
  }
}
```

- [ ] **Step 2: 实现容器适配器**

`scripts/mc/adapters/McContainerAdapter.ts`:
```ts
// ─── 容器适配器：概念 Container ← mc.Container（委托 + 安全访问） ──
import type { Container as McContainer } from "@minecraft/server";
import type { Container, ContainerRole } from "../../scripts/core/model/Container";
import type { ItemStack } from "../../scripts/core/model/ItemStack";
import type { ContainerId, Location } from "../../scripts/core/model/types";
import { deriveBinding } from "../../scripts/core/model/DeriveBinding";
import type { McItemAdapter } from "./McItemAdapter";

export class McContainerAdapter implements Container {
  readonly id: ContainerId;
  role: ContainerRole;
  enabled = true;
  priority = 10;
  readonly occupiedLocations: Location[];

  constructor(
    id: ContainerId,
    role: ContainerRole,
    private readonly mc: McContainer,
    private readonly item: McItemAdapter,
    occupiedLocations: Location[]
  ) {
    this.id = id;
    this.role = role;
    this.occupiedLocations = occupiedLocations;
  }

  get capacity(): number { return this.mc.size; }
  get emptySlotsCount(): number { return this.mc.emptySlotsCount; }
  get usedSlots(): number { return this.capacity - this.emptySlotsCount; }

  getItem(slot: number): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.getSlot(slot).getItem());
    } catch {
      return undefined;
    }
  }

  setItem(slot: number, item?: ItemStack): void {
    try {
      this.mc.getSlot(slot).setItem(item === undefined ? undefined : this.item.toMc(item));
    } catch {
      // 区块未加载/容器失效：静默
    }
  }

  addItem(stack: ItemStack): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.addItem(this.item.toMc(stack)));
    } catch {
      return stack; // 失败视为全部剩余
    }
  }

  getDedicatedItemId(): string | undefined {
    return deriveBinding(this);
  }
}
```

- [ ] **Step 3: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS（两个适配器无类型错误）。

- [ ] **Step 4: 提交**

```bash
git add mcaddon/item-route/scripts/mc/adapters/McItemAdapter.ts mcaddon/item-route/scripts/mc/adapters/McContainerAdapter.ts
git commit -m "item-route: scripts/mc/adapters 物品/容器适配器（委托 mc.Container + 区块安全访问）"
```

---

### Task 12: scripts/mc/adapters/McContainerFactory.ts（Block → 容器适配器：双箱探测/漏斗约束）

**Files:**
- Create: `mcaddon/item-route/scripts/mc/adapters/McContainerFactory.ts`

**职责:** 方块 → `McContainerAdapter`；双箱合并用 `findChestPartner`（core 纯函数，Task 5）+ 实例同一性判定（mc API 2.x 双箱共享同一 Container 实例，替代 v1 探针法）；漏斗强制 input；一切失败返回 undefined。

- [ ] **Step 1: 实现**

`scripts/mc/adapters/McContainerFactory.ts`:
```ts
// ─── 容器工厂：Block → McContainerAdapter（双箱合并/漏斗约束/安全访问） ──
import type { Block } from "@minecraft/server";
import { isChestType, isHopperType, isSupportedContainerType } from "../../scripts/core/model/ContainerTypes";
import { findChestPartner, type BlockInfo } from "../../scripts/core/model/ChestMerge";
import type { ContainerRole } from "../../scripts/core/model/Container";
import type { Location } from "../../scripts/core/model/types";
import { McContainerAdapter } from "./McContainerAdapter";
import type { McItemAdapter } from "./McItemAdapter";

const INVENTORY_COMPONENT = "minecraft:inventory";

export class McContainerFactory {
  constructor(private readonly item: McItemAdapter) {}

  /**
   * 方块 → 概念容器适配器。
   * - 双箱：水平相邻同类型箱子共享同一 mc.Container 实例 → occupiedLocations 含两半
   * - 漏斗：角色强制 input
   * - 返回 undefined：类型不支持/无 inventory 组件/访问失败
   */
  create(block: Block, role: ContainerRole): McContainerAdapter | undefined {
    try {
      const typeId = block.typeId;
      if (!isSupportedContainerType(typeId)) return undefined;
      const inv = block.getComponent(INVENTORY_COMPONENT)?.container;
      if (inv === undefined) return undefined;

      const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
      const occupied: Location[] = [loc];

      if (isChestType(typeId)) {
        const partner = this.findPartner(block);
        if (partner) {
          const partnerInv = this.safeContainer(partner);
          if (partnerInv !== undefined && partnerInv === inv) {
            occupied.push({ x: partner.x, y: partner.y, z: partner.z });
          }
        }
      }

      const finalRole: ContainerRole = isHopperType(typeId) ? "input" : role;
      const id = `c@${loc.x},${loc.y},${loc.z}`;
      return new McContainerAdapter(id, finalRole, inv, this.item, occupied);
    } catch {
      return undefined;
    }
  }

  /** 水平 4 邻居中找双箱伙伴（几何判定，core 纯函数） */
  private findPartner(block: Block): BlockInfo | undefined {
    const primary: BlockInfo = { typeId: block.typeId, x: block.location.x, y: block.location.y, z: block.location.z };
    const neighbors: BlockInfo[] = [
      { typeId: this.typeAt(block, 1, 0), x: primary.x + 1, y: primary.y, z: primary.z },
      { typeId: this.typeAt(block, -1, 0), x: primary.x - 1, y: primary.y, z: primary.z },
      { typeId: this.typeAt(block, 0, 1), x: primary.x, y: primary.y, z: primary.z + 1 },
      { typeId: this.typeAt(block, 0, -1), x: primary.x, y: primary.y, z: primary.z - 1 },
    ];
    return findChestPartner(primary, neighbors);
  }

  private typeAt(block: Block, dx: number, dz: number): string {
    try {
      return block.dimension.getBlock({ x: block.location.x + dx, y: block.location.y, z: block.location.z + dz })?.typeId ?? "";
    } catch {
      return "";
    }
  }

  private safeContainer(partner: BlockInfo): ReturnType<Block["getComponent"]> extends infer _C ? any : never {
    // 见下方 safeContainerImpl
    return this.safeContainerImpl(partner);
  }

  private safeContainerImpl(partner: BlockInfo) {
    try {
      const b = partner
        ? { dimension: undefined as unknown as Block["dimension"] } // 占位——需真实 block
        : undefined;
      void b;
      return undefined;
    } catch {
      return undefined;
    }
  }
}
```

**修正说明（Step 1 完成后按此替换 findPartner/safeContainer 实现）:** 上面的 `safeContainer` 是占位骨架——`BlockInfo` 只有坐标，取伙伴容器的正确写法是用坐标重建 Block：

```ts
// findPartner 改为返回带 dimension 的邻居（或直接传 Block 列表）
private findPartner(block: Block): Block | undefined {
  const dim = block.dimension;
  const candidates = [1, -1, 0, 0].map((dx, i) => ({
    dx,
    dz: [0, 0, 1, -1][i] as number,
  }));
  for (const { dx, dz } of candidates) {
    try {
      const n = dim.getBlock({ x: block.location.x + dx, y: block.location.y, z: block.location.z + dz });
      if (n === undefined || n.isAir || n.typeId !== block.typeId) continue;
      const primary: BlockInfo = { typeId: block.typeId, x: block.location.x, y: block.location.y, z: block.location.z };
      const neighbor: BlockInfo = { typeId: n.typeId, x: n.location.x, y: n.location.y, z: n.location.z };
      if (findChestPartner(primary, [neighbor]) !== undefined) return n;
    } catch {
      continue;
    }
  }
  return undefined;
}
```

即 `create()` 中：
```ts
if (isChestType(typeId)) {
  const partner = this.findPartner(block);
  if (partner !== undefined) {
    const partnerInv = partner.getComponent(INVENTORY_COMPONENT)?.container;
    if (partnerInv !== undefined && partnerInv === inv) {
      occupied.push({ x: partner.location.x, y: partner.location.y, z: partner.location.z });
    }
  }
}
```

- [ ] **Step 2: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS（用修正后的 findPartner/Block 版本，删除占位骨架）。

- [ ] **Step 3: 提交**

```bash
git add mcaddon/item-route/scripts/mc/adapters/McContainerFactory.ts
git commit -m "item-route: scripts/mc/adapters 容器工厂（双箱实例同一性合并/漏斗强制 input/安全访问）"
```

---

### Task 13: scripts/mc/adapters/McProximityChecker.ts + McIntervalScheduler.ts

**Files:**
- Create: `mcaddon/item-route/scripts/mc/adapters/McProximityChecker.ts`
- Create: `mcaddon/item-route/scripts/mc/adapters/McIntervalScheduler.ts`

- [ ] **Step 1: 实现邻近检查器**

`scripts/mc/adapters/McProximityChecker.ts`:
```ts
// ─── 邻近检查器：ProximityChecker 实现（玩家位置轮询，按维度过滤） ──
import { world, type Player } from "@minecraft/server";
import type { ProximityChecker } from "../../scripts/core/scheduling/Scheduler";
import type { WarehouseId } from "../../scripts/core/model/types";
import { isPlayerNearby, type PlayerPosition } from "../../scripts/core/model/Area";

export interface WarehouseAreaRef {
  dimension: string;
  corner1: { x: number; y: number; z: number };
  corner2: { x: number; y: number; z: number };
}

export class McProximityChecker implements ProximityChecker {
  constructor(
    private readonly findWarehouse: (id: WarehouseId) => { area: WarehouseAreaRef } | undefined,
    private readonly players: () => Player[] = () => world.getAllPlayers()
  ) {}

  hasNearbyPlayer(warehouseId: WarehouseId): boolean {
    const warehouse = this.findWarehouse(warehouseId);
    if (warehouse === undefined) return false;
    const { area } = warehouse;
    for (const p of this.players()) {
      if (p.dimension.id !== area.dimension) continue;
      const pos: PlayerPosition = { dimension: area.dimension, x: p.location.x, z: p.location.z };
      if (isPlayerNearby(area, pos)) return true;
    }
    return false;
  }
}
```

- [ ] **Step 2: 实现间隔调度器**

`scripts/mc/adapters/McIntervalScheduler.ts`:
```ts
// ─── 间隔调度器：IntervalScheduler 实现（system.runInterval） ──
import { system } from "@minecraft/server";
import type { IntervalHandle, IntervalScheduler } from "../../scripts/core/scheduling/IntervalScheduler";

export class McIntervalScheduler implements IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = system.runInterval(fn, tickInterval);
    return {
      stop: () => system.clearRun(id),
    };
  }
}
```

- [ ] **Step 3: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add mcaddon/item-route/scripts/mc/adapters/McProximityChecker.ts mcaddon/item-route/scripts/mc/adapters/McIntervalScheduler.ts
git commit -m "item-route: scripts/mc/adapters 邻近检查器 + 间隔调度器"
```

---

### Task 14: scripts/core/model/Area.ts 追加 findWarehouseAt/findContainerAt + McEventBridge.ts

**Files:**
- Modify: `mcaddon/item-route/scripts/core/model/Area.ts`
- Modify: `mcaddon/item-route/tests/area.test.ts`（追加）
- Create: `mcaddon/item-route/scripts/mc/adapters/McEventBridge.ts`

**职责:** "是否属于本仓库容器" 判定为 core 纯函数（设计 §10）；桥接 MC 世界事件 → 领域事件 + 索引增量维护 + 落盘时机。

- [ ] **Step 1: 写失败测试（追加 area.test.ts）**

`tests/area.test.ts` 追加:
```ts
import { findWarehouseAt, findContainerAt } from "../scripts/core/model/Area";
import type { Warehouse } from "../scripts/core/model/Warehouse";
import type { Container } from "../scripts/core/model/Container";

const area = { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } };

function makeWarehouse(containers: Container[]): Warehouse {
  return {
    id: "w1",
    displayName: "测试仓",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" as const }],
    area,
    settings: createDefaultSettings(),
    containers: new Map(containers.map((c) => [c.id, c])),
  };
}

const chest: Container = {
  id: "c1", role: "single", enabled: true, priority: 10,
  capacity: 27, emptySlotsCount: 27, usedSlots: 0,
  occupiedLocations: [{ x: 5, y: 5, z: 5 }],
  getItem: () => undefined, setItem: () => undefined, addItem: (s) => s, getDedicatedItemId: () => undefined,
};

test("findWarehouseAt: 区域内命中 / 区域外 undefined / 维度不匹配 undefined", () => {
  const ws = [makeWarehouse([chest])];
  assert.equal(findWarehouseAt(ws, "overworld", { x: 5, y: 5, z: 5 })?.id, "w1");
  assert.equal(findWarehouseAt(ws, "overworld", { x: 99, y: 5, z: 5 }), undefined);
  assert.equal(findWarehouseAt(ws, "nether", { x: 5, y: 5, z: 5 }), undefined);
});

test("findContainerAt: 容器坐标命中 / 未注册坐标 undefined", () => {
  const ws = [makeWarehouse([chest])];
  assert.equal(findContainerAt(ws, "overworld", { x: 5, y: 5, z: 5 })?.container.id, "c1");
  assert.equal(findContainerAt(ws, "overworld", { x: 6, y: 5, z: 5 }), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/area.test.js`
Expected: FAIL（findWarehouseAt/findContainerAt 不存在）。

- [ ] **Step 3: 实现纯函数（Area.ts 追加）**

`scripts/core/model/Area.ts` 追加:
```ts
// ─── 仓库/容器定位（事件桥接过滤谓词，零 MC 依赖） ─────────
import type { Warehouse } from "./Warehouse";
import type { Container } from "./Container";
import type { Location } from "./types";

/** 维度 + 坐标 → 所属仓库（仅区域判定，容器未注册也能命中） */
export function findWarehouseAt(
  warehouses: Warehouse[],
  dimension: string,
  loc: Location
): Warehouse | undefined {
  return warehouses.find(
    (w) => w.area.dimension === dimension && containsLocation(w.area, loc)
  );
}

/** 维度 + 坐标 → 仓库 + 逻辑容器（occupiedLocations 匹配，含双箱任一半） */
export function findContainerAt(
  warehouses: Warehouse[],
  dimension: string,
  loc: Location
): { warehouse: Warehouse; container: Container } | undefined {
  for (const w of warehouses) {
    if (w.area.dimension !== dimension || !containsLocation(w.area, loc)) continue;
    for (const c of w.containers.values()) {
      if (c.occupiedLocations.some((l) => locationKey(l) === locationKey(loc))) {
        return { warehouse: w, container: c };
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.test.json && node --test .test-build/tests/area.test.js`
Expected: PASS。

- [ ] **Step 5: 提交 core 纯函数**

```bash
git add mcaddon/item-route/scripts/core/model/Area.ts mcaddon/item-route/tests/area.test.ts
git commit -m "item-route: scripts/core/model 仓库/容器定位纯函数（事件桥接过滤谓词）"
```

- [ ] **Step 6: 实现事件桥接**

`scripts/mc/adapters/McEventBridge.ts`:
```ts
// ─── 事件桥接：MC 世界事件 → 领域事件 + 索引增量维护 + 落盘时机 ──
import { world, system, type Block } from "@minecraft/server";
import type { EventBus } from "../../scripts/core/events/DomainEvents";
import type { ItemIndex } from "../../scripts/core/index/ItemIndex";
import type { StatsService } from "../../scripts/core/stats/StatsService";
import type { Scheduler } from "../../scripts/core/scheduling/Scheduler";
import type { Warehouse } from "../../scripts/core/model/Warehouse";
import type { Container } from "../../scripts/core/model/Container";
import { findContainerAt, findWarehouseAt } from "../../scripts/core/model/Area";
import { locationKey, type Location } from "../../scripts/core/model/types";
import type { McIndexStore } from "../storage/McIndexStore";
import type { McContainerFactory } from "./McContainerFactory";

export interface EventBridgeDeps {
  bus: EventBus;
  index: ItemIndex;
  stats: StatsService;
  scheduler: Scheduler;
  indexStore: McIndexStore;
  factory: McContainerFactory;
  /** 当前已加载仓库（Phase 4 填充） */
  warehouses: () => Warehouse[];
  /** 容器注册/注销后的持久化钩子（main.ts 接线：更新容器注册表） */
  onContainerRegistered?: (warehouse: Warehouse, container: Container) => void;
  onContainerUnregistered?: (warehouse: Warehouse, container: Container) => void;
}

const MAIN_TICK_INTERVAL = 5;   // 全局主任务：调度轮询
const FLUSH_INTERVAL = 100;     // 批量落盘间隔

export class McEventBridge {
  constructor(private readonly deps: EventBridgeDeps) {}

  start(): void {
    const { bus, index, stats, scheduler, indexStore, factory } = this.deps;

    // 代理信号：玩家交互带容器方块 → 三层兜底第二层（verifyCandidate 惰性校验）
    world.afterEvents.playerInteractWithBlock.subscribe((e) => {
      try {
        if (!e.isFirstEvent) return;
        const hit = this.locate(e.block);
        if (!hit) return;
        index.verifyCandidate(hit.container);
        stats.invalidate(hit.container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: hit.warehouse.id, containerId: hit.container.id });
        indexStore.markDirty(hit.warehouse.id, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] interact 事件处理失败: ${err}`);
      }
    });

    // 放置容器方块 → 注册（默认 single，漏斗强制 input 由工厂处理）
    world.afterEvents.playerPlaceBlock.subscribe((e) => {
      try {
        const dim = e.block.dimension.id;
        const loc = e.block.location;
        const warehouse = findWarehouseAt(this.deps.warehouses(), dim, { x: loc.x, y: loc.y, z: loc.z });
        if (warehouse === undefined) return;
        const container = factory.create(e.block, "single");
        if (container === undefined) return;
        warehouse.containers.set(container.id, container);
        index.onContainerAdded(container);
        stats.invalidate(container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        indexStore.markDirty(warehouse.id, index.serialize());
        this.deps.onContainerRegistered?.(warehouse, container);
      } catch (err) {
        console.warn(`[ItemRoute] place 事件处理失败: ${err}`);
      }
    });

    // 破坏/爆炸移除容器方块 → 注销（双箱半拆：occupiedLocations 过滤）
    const unregister = (block: Block): void => {
      try {
        const hit = this.locate(block);
        if (!hit) return;
        const { warehouse, container } = hit;
        const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
        const idx = container.occupiedLocations.findIndex((l) => locationKey(l) === locationKey(loc));
        if (idx >= 0) container.occupiedLocations.splice(idx, 1);
        if (container.occupiedLocations.length === 0) {
          warehouse.containers.delete(container.id);
          index.onContainerRemoved(container);
          stats.invalidate(container.id);
          this.deps.onContainerUnregistered?.(warehouse, container);
        }
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        indexStore.markDirty(warehouse.id, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] 移除事件处理失败: ${err}`);
      }
    };
    world.afterEvents.playerBreakBlock.subscribe((e) => unregister(e.block));
    world.afterEvents.blockExplode.subscribe((e) => unregister(e.block));

    // 玩家离开：立即批量落盘（防丢数据）
    world.afterEvents.playerLeave.subscribe(() => {
      try {
        indexStore.flush();
      } catch (err) {
        console.warn(`[ItemRoute] flush 失败: ${err}`);
      }
    });

    // 主任务：5 tick 调度 + 100 tick 批量落盘
    system.runInterval(() => {
      try {
        scheduler.tick();
      } catch (err) {
        console.warn(`[ItemRoute] 主任务异常: ${err}`);
      }
    }, MAIN_TICK_INTERVAL);
    system.runInterval(() => {
      try {
        indexStore.flush();
      } catch (err) {
        console.warn(`[ItemRoute] flush 失败: ${err}`);
      }
    }, FLUSH_INTERVAL);
  }

  private locate(block: Block): { warehouse: Warehouse; container: Container } | undefined {
    const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
    return findContainerAt(this.deps.warehouses(), block.dimension.id, loc);
  }
}
```

- [ ] **Step 7: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add mcaddon/item-route/scripts/mc/adapters/McEventBridge.ts
git commit -m "item-route: scripts/mc/adapters 事件桥接（代理信号/注册注销/落盘时机）"
```

---

### Task 15: scripts/mc/main.ts（4 Phase 启动装配）+ scripts/main.ts 接线

**Files:**
- Create: `mcaddon/item-route/scripts/mc/main.ts`
- Modify: `mcaddon/item-route/scripts/main.ts`

**装配蓝图 = core 计划 Task 24 bootstrap + mc 适配层 DI**（Phase 1 无状态 → Phase 2 有状态 → Phase 3 事件 → Phase 4 延迟启动）。

- [ ] **Step 1: 实现 4 Phase 装配**

`scripts/mc/main.ts`:
```ts
// ─── item-route 入口：4 Phase 启动装配（DI） ──
import { world, system } from "@minecraft/server";

// ── core ──
import { EventBus } from "./scripts/core/events/DomainEvents";
import { ItemIndex } from "./scripts/core/index/ItemIndex";
import { Router } from "./scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "./scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "./scripts/core/routing/CandidateSorter";
import { Scheduler } from "./scripts/core/scheduling/Scheduler";
import { StatsService } from "./scripts/core/stats/StatsService";
import { Organizer } from "./scripts/core/organizing/Organizer";
import { OrganizeService } from "./scripts/core/services/OrganizeService";
import { WarehouseService } from "./scripts/core/services/WarehouseService";
import { MemberService } from "./scripts/core/services/MemberService";
import { RouteService } from "./scripts/core/services/RouteService";
import type { Warehouse } from "./scripts/core/model/Warehouse";
import type { Container } from "./scripts/core/model/Container";

// ── mc ──
import { DynamicPropertyStore } from "./storage/DynamicPropertyStore";
import { ShardStore } from "./storage/ShardStore";
import { McWarehouseStore, type ContainerEntry } from "./storage/McWarehouseStore";
import { McIndexStore } from "./storage/McIndexStore";
import { McStatsStore } from "./storage/McStatsStore";
import { McModConfig } from "./storage/McModConfig";
import { McItemAdapter } from "./adapters/McItemAdapter";
import { McContainerFactory } from "./adapters/McContainerFactory";
import { McProximityChecker } from "./adapters/McProximityChecker";
import { McIntervalScheduler } from "./adapters/McIntervalScheduler";
import { McEventBridge } from "./adapters/McEventBridge";

// Phase 1: 无状态基础设施
const dp = new DynamicPropertyStore();
const shards = new ShardStore(dp, () => dp.totalBytes());
const item = new McItemAdapter();
const factory = new McContainerFactory(item);
const intervals = new McIntervalScheduler();

// Phase 2: 有状态业务逻辑
const bus = new EventBus();
const index = new ItemIndex();
const router = new Router(
  [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
  new DefaultCandidateSorter(),
  index,
  bus
);
const warehouseStore = new McWarehouseStore(shards);
const indexStore = new McIndexStore(shards);
const warehouses = new WarehouseService(warehouseStore, bus);
const members = new MemberService();
const config = McModConfig.load(shards);
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const scheduler = new Scheduler(router, intervals, proximity, bus, config.globalSpeedLimit);
const stats = new StatsService(new McStatsStore(shards), bus);
const organizer = new Organizer(new DefaultCandidateSorter());
const organize = new OrganizeService(organizer, index, bus);
const route = new RouteService(scheduler);
route.setGlobalEnabled(config.globalEnabled);

// 容器注册表持久化钩子（事件桥接 → DP）
const persistContainers = (warehouse: Warehouse): void => {
  const entries: ContainerEntry[] = [...warehouse.containers.values()].map((c) => ({
    id: c.id,
    role: c.role,
    locations: c.occupiedLocations,
    enabled: c.enabled,
    priority: c.priority,
  }));
  warehouseStore.saveContainers(warehouse.id, entries);
};

// Phase 3: 注册事件
const bridge = new McEventBridge({
  bus,
  index,
  stats,
  scheduler,
  indexStore,
  factory,
  warehouses: () => loaded,
  onContainerRegistered: persistContainers,
  onContainerUnregistered: persistContainers,
});
bridge.start();

// Phase 4: 延迟启动（世界完全加载）
system.run(() => {
  for (const snapshot of warehouseStore.list()) {
    // 重建仓库（core 快照不含容器适配器）
    const warehouse: Warehouse = {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerId: snapshot.ownerId,
      members: snapshot.members,
      area: snapshot.area,
      settings: snapshot.settings,
      containers: new Map<string, Container>(),
    };
    loaded.push(warehouse);

    // 容器重建：区块加载的按注册表恢复，未加载的由事件/惰性校验补注册
    for (const entry of warehouseStore.loadContainers(snapshot.id) ?? []) {
      try {
        const block = world.getDimension(snapshot.area.dimension).getBlock(entry.locations[0] ?? { x: 0, y: 0, z: 0 });
        if (block === undefined || block.isAir) continue;
        const container = factory.create(block, entry.role);
        if (container === undefined) continue;
        // 以持久化几何为准（双箱合并状态可能已变化）
        container.occupiedLocations.splice(0, container.occupiedLocations.length, ...entry.locations);
        container.enabled = entry.enabled;
        container.priority = entry.priority;
        warehouse.containers.set(container.id, container);
      } catch {
        // 区块未加载等：跳过，事件补注册
      }
    }

    // 索引恢复：版本不符/缺失 → 全量重建（verifyCandidate 兜底路径）
    const snap = indexStore.load(snapshot.id);
    if (snap !== undefined && index.restore(snap)) {
      console.warn(`[ItemRoute] 索引恢复 ${snapshot.id}`);
    } else {
      for (const c of warehouse.containers.values()) index.onContainerAdded(c);
      console.warn(`[ItemRoute] 索引重建 ${snapshot.id}`);
    }

    scheduler.registerWarehouse(warehouse);
    warehouses.loadAll(); // 触发 core 侧缓存（如有）
  }
  console.warn(`[ItemRoute] 启动完成：${loaded.length} 仓库`);
});
```

`scripts/main.ts`（Task 2 空骨架 → 接线）:
```ts
// addon 入口：委托 scripts/mc/main.ts 4 Phase 装配
import "../scripts/mc/main";
```

- [ ] **Step 2: 编译检查**

Run: `cd mcaddon/item-route && npx tsc -p tsconfig.json --noEmit`
Expected: PASS（core + mc 全量类型检查）。

- [ ] **Step 3: 提交**

```bash
git add mcaddon/item-route/scripts/mc/main.ts mcaddon/item-route/scripts/main.ts
git commit -m "item-route: scripts/mc/main 4 Phase 启动装配（DI）+ scripts 入口接线"
```

---

### Task 16: 全量验证与收尾

- [ ] **Step 1: 全量单测**

Run: `cd mcaddon/item-route && pnpm test:core`
Expected: 全部 PASS（core 25 项 + mc storage 全部用例）。

- [ ] **Step 2: 构建**

Run: `cd mcaddon/item-route && pnpm run build`
Expected: 成功，`dist/packages/物品路由-v0.1.0.mcaddon` 生成（含 BP/RP）。

- [ ] **Step 3: 打包验证**

Run: `cd mcaddon/item-route && pnpm run pack`
Expected: `.mcpack`/`.mcaddon` 产物生成。

- [ ] **Step 4: 游戏内冒烟清单（手动，记录结果）**

| # | 验证项 | 方法 | 预期 |
|---|--------|------|------|
| 1 | 启动无报错 | 加载世界 | 日志 `[ItemRoute] 启动完成：0 仓库` |
| 2 | 建仓 | 命令（计划 3 后）或临时调试钩子 | 注册表写入，重进世界仍在 |
| 3 | 容器注册 | 区域内放箱子 | `playerPlaceBlock` 触发注册 + 容器注册表落盘 |
| 4 | 双箱合并 | 放两个相邻箱子 | occupiedLocations 含两半坐标 |
| 5 | 漏斗 input | 放漏斗 | role = input |
| 6 | 重启恢复 | 退出重进 | 仓库/容器/索引恢复日志正常 |
| 7 | 索引落盘 | 玩家离开世界 | playerLeave flush 无报错 |

（注：命令/UI 属计划 3，冒烟 2 项可等计划 3 完成后一并验证。）

- [ ] **Step 5: 收尾提交**

```bash
git add -A mcaddon/item-route
git commit -m "item-route: mc 适配层完成（存储/适配器/装配全量验证）"
```

---

## 自审记录（writing-plans 要求）

- [ ] **核心风险与兜底**
  - 双箱合并依赖 mc API 2.x 双箱共享同一 Container 实例——如游戏内验证不成立，回退 v1 探针法（SafeProbe 模式），占位点已标在 Task 12
  - 1MB 降级路径（Task 9 flush 保留脏标记）保证超限不丢数据、总量回落后自动恢复
  - 容器注册表 generation 重写解决"容器全量重写 + 孤儿清理"（设计 §8），重启重建失败项由事件/verifyCandidate 惰性补注册
- [ ] **与前计划的衔接**
  - 装配（Task 15）完整对照 core 计划 Task 24 bootstrap：Router/策略/Sorter/EventBus/IntervalScheduler/ProximityChecker/Scheduler/StatsService/Organizer/OrganizeService/WarehouseService/MemberService 全部接线
  - 存储层实现 core Task 10 三个接口（WarehouseStore/IndexStore/StatsStore）+ KeyValueStore
  - 依赖核心计划已定接口：Container（occupiedLocations/role/capacity）、ItemIndex（verifyCandidate/restore/serialize）、Scheduler（setGlobalEnabled/registerWarehouse）、EventBus（containerChanged/itemRouted 等 6 信号）、IntervalHandle.stop、deriveBinding
- [ ] **留给计划 3 的边界**
  - UI 12 模块 / 9 命令 / 信物交互全部在计划 3；本计划仅 bridge.start() 与 4 Phase 装配
  - 放置容器默认 role=single，UI 层可改
  - name-maps 中文名数据层（计划 3，材料已由 exp-2 读过）