# @yinxe/mc — MCBE Addon Monorepo

MCBE（Minecraft Bedrock）Addon 单体仓库：TypeScript Script API 模组 + 服务端插件 + 共享构建工具。

## 仓库清单

**Addon（`mcaddon/<name>/`，TypeScript + just-scripts 构建）**

| 包名 | 显示名 | 说明 |
|------|--------|------|
| `mock-player` | 模拟玩家 | GameTest 假人管理（核心交互示例） |
| `smartwarehouse` | 智能仓库 | v1 仓库管理（item-route 的前身/参考） |
| `item-route` | 物品路由 | **参考架构**：自动分拣/容器整理/统计/预警（core/mc 六边形） |
| `keepinventory` | 死亡不掉落 | 死亡保护 |
| `auto-refill` | 自动替换 | 物品自动补充 |
| `craftablerarities` | 合成配方扩展 | 配方/品质扩展 |
| `teleporter` | 传送 | 传送功能 |

**服务端插件（`server-plugin/<name>/`，纯 JSON / 轻量 BP）**

- `antibundledup`（去堆叠重复）

**共享包（`packages/`）**

- `toolkit`（`@yinxe/toolkit`）— 共享运行时模块（color / ui / command / player）
- `toolkit-build`（`@yinxe/toolkit-build`）— 构建工具（版本同步等）
- `item-matrix` — 容器簇物品存储（物理木桶矩阵，完整 NBT 保留）

## 项目结构

```
mc/
├── mcaddon/<name>/       # MCBE Addon 项目（TypeScript + 构建脚本）
│   ├── BP/<Project>/     # 行为包（manifest.json）
│   ├── RP/<Project>/     # 资源包（可选）
│   ├── scripts/          # TypeScript 源码
│   ├── just.config.ts    # 构建配置
│   ├── tsconfig.json     # 编译器配置（item-route 另有 tsconfig.test.json）
│   └── package.json      # 独立版本号（mcbe.packName = 中文显示名）
├── server-plugin/<name>/ # 服务端插件（纯 JSON / 轻量 BP）
│   ├── BP/<Project>/     # 行为包
│   ├── scripts/          # 打包脚本（可选）
│   └── package.json      # 独立版本号
├── packages/<pkg>/       # 共享包（toolkit / toolkit-build / item-matrix）
└── package.json          # 根 workspace
```

## 构建命令

所有构建通过 `just-scripts`（via pnpm）。各模组独有命令见模组级 AGENTS.md。

```bash
pnpm run build:<mod>   # 编译（TypeScript → esbuild）；如 build:item-route
pnpm run pack:<mod>    # 打包（BP/RP → .mcpack / .mcaddon）；如 pack:item-route
pnpm run build         # 全仓构建（pnpm -r）
pnpm run clean         # 全部清理
pnpm run format        # prettier 全仓格式化
pnpm run lint          # eslint（全仓；item-route 个别 addon 有环境性解析器问题，非本次改动引入）
```

**版本同步**：构建时 `just-scripts` 会把 `package.json` 的版本同步到 `BP/manifest.json`（`version.ts` 亦自动生成）。`version.ts` / `manifest.json` / `package.json` 的版本改动是 **release-only**，日常提交源码时不纳入 commit。

## 测试（item-route 参考）

```bash
cd mcaddon/item-route && pnpm run test:core   # tsc -p tsconfig.test.json + node --test
```

- core 层**零 `@minecraft` 依赖**（纯 TS），可被 `tsconfig.test.json` 单独编译进 node 测试；mc 层不进 node 测试构建。
- 测试文件在 `tests/`（`*.test.ts`），用 `node:test` + `node:assert/strict` + `InMemory*` 替身（InMemoryContainer / InMemoryKeyValueStore / MemoryIntervalScheduler / StubProximity）。
- 核心纯逻辑（routing/index/scheduler/stats/organize/services/ContainerId/几何）必须有单测覆盖；mc 适配/UI/交互层改动靠游戏内冒烟。

## 开发流程

### 日常迭代

```
修改代码 → pnpm run build → pnpm run pack → 部署 .mcpack → 进游戏测试
```

### 版本迭代

```
bump version (+0.01) → build → pack → commit → tag → push
```

- 版本在 `mcaddon/<name>/package.json` 中维护
- commit message 格式：`<包名>@<新版本>: <中文描述>`（如 `mock-player@1.1.25: 回收详情表单 + 精确瞄准`）
- tag 格式：`<包名>@<版本>`（如 `mock-player@1.1.25`）
- 发布时同时 push commit + tag
- 源码提交时**排除** `version.ts` / `manifest.json` / `package.json`（release-only）；仅提交 `scripts/` 源码与 `tests/`

### 分支管理

- `main`：稳定分支，发布产物
- `feat/<name>`：新 addon 开发分支（如 `feat/auto-refill`）
- 新 addon 完成构建验证后，切出 feature branch 提交，main 保持干净

### 新建 Addon

1. 复制现有项目结构（`just.config.ts` / `tsconfig.json` / `package.json` / `BP/<Project>/manifest.json`）
2. `pnpm install` 安装依赖
3. 按依赖版本匹配 `@minecraft/server` 版本
4. 确保构建通过后切 feature branch 提交
5. 新 addon 需在根 `package.json` 的 `build:` / `pack:` 脚本补一条快捷命令（`pnpm --filter <pkg> run ...`）
6. 写一份该 addon 的 `AGENTS.md`（架构/命令/约定）

## item-route 参考架构（新 TS addon 可借鉴）

`mcaddon/item-route` 是六边形/分层架构的参考实现，业务逻辑与 MC 运行时解耦：

```
scripts/
├── main.ts          # 唯一 bundle 入口 + 4 Phase DI 组合根（只装配，不含业务）
├── core/            # 纯领域逻辑（零 @minecraft 依赖，可 node 单测）
│   ├── model/       # Container/Warehouse/ItemStack/ContainerId/Area/ContainerScan
│   ├── routing/     # Router + RouteStrategy + CandidateSorter + Move（原子移动）
│   ├── index/       # ItemIndex（O(1) 物品索引 + 三层兜底惰性校验）
│   ├── scheduling/  # Scheduler（生命周期状态机 + 每仓索引隔离）
│   ├── stats/       # StatsService（统计 + 两级容量预警）
│   ├── organizing/  # Organizer（混乱度模型）
│   ├── services/    # WarehouseService/RouteService/MemberService/OrganizeService
│   ├── events/      # EventBus + 领域事件（core 触发，mc 订阅副作用）
│   └── storage/     # 仓储接口 + InMemory 测试替身
└── mc/              # MC 适配层（只做副作用/IO）
    ├── adapters/    # 容器/物品/邻近/间隔调度/事件桥接/SafeProbe/背包容器
    ├── bootstrap/   # 持久边界/背包整理/效果注册（业务抽离）
    ├── commands/    # ir:* 命令（权限经 MemberService 矩阵）
    ├── effects/     # 视觉/播报/HUD/边界/通知
    ├── events/      # 中央订阅注册（Subscriptions.ts 单点收编领域事件）
    ├── interaction/ # 信物交互 + 选区会话
    ├── persistence/ # 索引生命周期 + 容器逐容器持久化
    ├── storage/     # DP 直存实现（每容器一条键）
    └── ui/          # ActionForm/ModalForm 菜单（中文）
```

**关键设计约定（新代码遵循）：**
- **core 无副作用**：core 只发领域事件（EventBus），mc 层订阅做持久化/视觉/通知副作用。事件负载只用可序列化 string/number。
- **按需加载 + 统一生命周期**：启动只载仓库 meta；容器在激活/菜单/命令访问时 `ensureContainersLoaded`，闲置卸载。配置注册表/统计/索引生命周期一致。
- **持久化最小单位**：容器级数据每容器一条 DP 键（`ir2:c:{cid}` / `ir2:idx:{cid}` / `ir2:cst:{cid}`），事件驱动写穿，无定时 flush；meta 单键（`ir2:wh:{id}:meta`）+ cids 索引。
- **维度短名**：ID 内维度用短名（`minecraft:overworld` → `overworld`），容器短名 `(x,y,z)@overworld`。
- **不吞/不覆盖/不刷物**：概念 ItemStack 是缩减视图，写回用 `McItemAdapter` 携带源 mc.ItemStack（`clone()` 保留 NBT）；堆叠判定委托 `mc.addItem` 权威。
- **区块安全**：所有方块/容器访问 try-catch；`beforeEvents` 回调受限上下文内不触世界操作（延迟到 `system.run`）。

## 调试技巧

- 日志通过 `console.warn` 输出，格式 `[前缀] 消息`
- 面向玩家的错误消息使用中文；调试日志使用英文
- GameTest 生成的假人触发 `playerJoin` 事件恢复背包，使用 `isBotRestored` 防护空背包覆写
- `disconnect()` 后至少等待 20 tick 才能重新 `spawnSimulatedPlayer`，否则出现 "(2)" 重复名导致数据丢失
- 常加载模式（chunkload）假人不可扭头/瞄准，需切普通模式才能使用物品

## 命名与版本

- **显示名称**: 中文（`header.name` 与 `package.json#mcbe.packName`），如"模拟玩家"、"智能仓库"、"物品路由"
- **打包产物**: `{中文名}-v{version}.{mcaddon,mcpack}`
- **标签**: `<包名>@<版本>`，如 `mock-player@1.0.0`
- 版本号在 `package.json` 中维护，构建时自动同步到 manifest.json

## 参考文档

| 资源 | 链接 |
|------|------|
| 官方 Script API 文档 | https://learn.microsoft.com/zh-cn/minecraft/creator/?view=minecraft-bedrock-stable |
| 社区 WIKI（自定义物品/方块/实体/UI/粒子） | https://wiki.bedrock.dev/ |
| 全物品中文翻译表 | https://raw.githubusercontent.com/SkyEye-FAST/mcbe-chinese-patch/main/extracted/release/vanilla/zh_CN.json |

---

## 通用代码规范

### 技术栈
- **语言**: TypeScript (`target: es6`, `strict: true`, `noUncheckedIndexedAccess` 可选)
- **运行时**: Minecraft Bedrock Script API (`@minecraft/server`)
- **构建**: `just-scripts` + TypeScript 编译器 + esbuild
- **格式化**: Prettier (printWidth: 120, tabWidth: 2, semi, singleQuote: false)
- **UI**: `@minecraft/server-ui` (ActionForm / ModalForm)

### 命名规范

| 类别 | 风格 | 示例 |
|------|------|------|
| 类 | PascalCase | `WarehouseService`, `SorterEngine` |
| 接口 | PascalCase | `BotRecord`, `WarehouseData` |
| 类型别名 | PascalCase | `WarehouseId`, `ContainerRole` |
| 文件 | PascalCase | `WarehouseService.ts`, `Logger.ts` |
| 导出函数 | camelCase | `createWarehouse()`, `locationKey()` |
| 私有方法 | camelCase | `handleCreate()`, `checkAreaLoaded()` |
| 模块级常量 | UPPER_SNAKE_CASE | `MAX_SCAN_VOLUME`, `DEBOUNCE_MS` |
| `main.ts` / `types.ts` | 小写（约定入口和类型文件） | |

### 导入顺序
```typescript
// 1. 外部依赖
import { world, system } from "@minecraft/server";
// 2. 仅类型导入
import type { Vector3 } from "@minecraft/server";
// 3. 内部模块
import { normalizeId } from "../storage/Repository";
// 4. 混合导入
import { world, type Player } from "@minecraft/server";
```

### JSDoc
- 使用中文描述
- 每个导出函数必须有 JSDoc
- 格式: 简短描述 + 详细说明（可选）+ `@param` + `@returns` + `@throws`

### 代码分段
```
// ── 生命周期管理 ──────────────────────────────────────────
// ─── 公开入口 ──────────────────────────────────────────────
// ─── 私有方法 ─────────────────────────────────────────────
```

### 错误处理

| 模式 | 场景 | 做法 |
|------|------|------|
| 返回错误消息 | 轻量校验（命令解析） | `return "该命令只能由玩家执行"` |
| 抛出异常 | 业务逻辑层 | `throw new Error(...)` |
| 安全执行 | 可能失败的 IO | try-catch 返回 undefined |
| 事件内捕获 | 防止单事件崩溃 | try-catch 包住整个事件回调 |

### 依赖注入
```typescript
// 构造函数注入，可选依赖用默认参数
export class MyService {
  constructor(
    private readonly repository: Repository,
    private readonly scanner = new ContainerScanner(),
    private readonly onNotify: (id: string) => void = () => undefined
  ) {}
}
```

### Minecraft 特有模式

**system.run() 执行上下文（重要！）:**
- 所有世界状态操作（维度、方块、容器、dynamic property）必须在 `system.run()` 回调或事件处理器中执行
- 类型定义、工具函数、无状态对象实例化可以在顶层执行
- **早执行安全**：`world.getDynamicProperty` 等在世界完全加载前（早执行）调用会抛错；DP 读取放 Phase 4 `system.run()` 内

**4 Phase 启动时序:**
```typescript
// Phase 1: 无状态基础设施
// Phase 2: 有状态业务逻辑
// Phase 3: 注册事件和命令
// Phase 4: 延迟启动（dynamicProperty 需世界完全加载）
system.run(() => { scheduler.start(); });
```

**命令注册:**
```typescript
system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    regionCommand("prefix:command", "描述"),
    (origin, ...args) => handler(...)
  );
});
```

**区块安全访问:**
- 任何方块/容器访问都必须用 try-catch 保护
- 容器操作需在事件处理器或 `system.run()` 内执行
- 事件订阅回调内部 try-catch 隔离（单事件崩溃不影响其他订阅者）

### 通用编码习惯
- `private readonly` 构造参数简写
- Map/Record 显式声明泛型
- 面向玩家的错误消息使用中文；调试日志使用英文
- 日志格式: `[前缀] 消息`，通过 `console.warn` 输出
- 常量就近定义，不集中塞到 constants 文件
- 模块级 AGENTS.md 约定：每个 addon 一份，记录该模组独有命令/架构/约定（如 `mcaddon/smartwarehouse/AGENTS.md`）
