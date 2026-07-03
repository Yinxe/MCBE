## 参考文档

### 官方 API 文档（微软）
https://learn.microsoft.com/zh-cn/minecraft/creator/?view=minecraft-bedrock-stable
重点章节：
- Script API（@minecraft/server）

### 社区 WIKI 教程
https://wiki.bedrock.dev/
涵盖：自定义物品、方块、实体、Molang、动画控制器、UI、粒子等。

### 全wiki中文翻译表
https://raw.githubusercontent.com/SkyEye-FAST/mcbe-chinese-patch/main/extracted/release/vanilla/zh_CN.json

---

## 代码风格与约定

### 1. 技术栈
- **语言**: TypeScript (ES6 target, strict 模式)
- **运行时**: Minecraft Bedrock Script API (`@minecraft/server` ^2.6.0)
- **构建**: `just-scripts` + TypeScript 编译器
- **格式化工**具: Prettier (配置见 `.prettierrc.json`)
- **ESLint**: `eslint-plugin-minecraft-linting`

### 2. 项目结构
```
BP/                   行为包（manifest.json + scripts 编译产物）
RP/                   资源包
scripts/              TypeScript 源码
  main.ts             入口文件（初始化依赖、注册事件和命令）
  types.ts            集中式类型定义（接口、类型别名、常量）
  commands/           命令路由层（解析输入、校验权限、委托服务层）
  data/               数据文件（物品家族分类、中文名映射）
    ItemFamilies.ts   按 51 个家族分类的 1431 个物品（自动生成，勿手动修改）
    name-maps/        物品/实体/效果/附魔中文名映射表
  interaction/        工具交互（木锄右键/方块事件处理）
  runtime/            运行时缓存层（内存索引、脏标记、惰性重建）
  sorting/            分拣引擎和调度器
  storage/            持久化层（Minecraft Dynamic Property 读写）
  ui/                 玩家交互界面（ActionForm / ModalForm）
  util/               工具函数（日志、坐标、JSON、权限）
  warehouse/          核心业务逻辑（仓库 CRUD、容器扫描）
tools/                维护工具
  generateItemFamilies.mjs  物品家族生成器（修改分类后需运行）
  annotateFamilies.mjs      中文注释注入器（运行注入中文名）
```

### 3. 架构分层
```
UI/ToolInteraction/CommandRouter  ← 输入层（事件驱动）
        ↓
  WarehouseService                 ← 业务层（核心逻辑）
       ↙        ↘
WarehouseRepository   ContainerScanner  ← 数据层 + 扫描
       ↓
  DynamicPropertyStore              ← 持久化
       ↓
  Minecraft Dynamic Properties

WarehouseRuntimeRegistry ← 运行时缓存（内存索引 + 惰性重建）
SortingScheduler → SorterEngine ← 分拣子系统
```

### 4. 命名规范

| 类别 | 风格 | 示例 |
|------|------|------|
| 类 | PascalCase | `WarehouseService`, `CommandRouter`, `SorterEngine` |
| 接口 | PascalCase | `WarehouseData`, `StoredContainer`, `WarehouseMeta` |
| 类型别名 | PascalCase | `WarehouseId`, `ContainerRole`, `BlockLocation` |
| 文件 | PascalCase | `WarehouseService.ts`, `ContainerScanner.ts`, `Logger.ts` |
| 导出函数 | camelCase | `createWarehouse()`, `isInsideArea()`, `locationKey()` |
| 私有方法 | camelCase | `handleCreate()`, `assertScanVolume()`, `checkAreaLoaded()` |
| 常量（模块级） | UPPER_SNAKE_CASE | `MAX_SCAN_VOLUME`, `CONTAINERS_PER_SHARD`, `DEBOUNCE_MS` |
| 固定值常量 | PascalCase | `ROLE_LABELS`, `ROLE_ORDER`, `SPEED_LABELS` |
| 类型化 ID | `XxxId` 后缀 | `WarehouseId`, `ContainerId`, `DimensionId` |
| 坐标键 | `locationKey()` 工厂 | `"dimensionId\|x\|y\|z"` 格式 |

**特例：**
- `main.ts` — 入口文件，保持小写
- `types.ts` — 集中类型定义，保持小写

### 5. 导入规范
```typescript
// 1. 外部依赖
import { world, system } from "@minecraft/server";
// 2. 仅类型导入时使用 type 关键字
import type { Vector3 } from "@minecraft/server";
// 3. 内部模块（相对路径）
import { normalizeWarehouseId } from "../storage/WarehouseRepository";
import { Logger } from "../util/Logger";
import type { WarehouseService } from "../warehouse/WarehouseService";
// 4. 同类导入可混合
import { system, type Dimension } from "@minecraft/server";
import { world, type Player, type CustomCommand } from "@minecraft/server";
```

### 6. 代码文档规范
- **JSDoc 使用中文**描述，遵循 `/** */` 格式
- **每个导出函数/类**必须有 JSDoc
- JSDoc 结构：
  ```
  /**
   * 简短的一句话描述。
   *
   * 详细说明（多段时用空行分隔）。
   *
   * @param paramName - 参数描述（使用 - 分隔）
   * @returns 返回值描述
   * @throws 异常条件描述（仅在会抛异常时写）
   */
  ```
- **复杂算法**：使用 JSDoc 的多段落 + 列表/表格描述设计思路
- **模块头注释**（可选）：用于大文件的总结性模块说明
  ```
  /**
   * ============================================================================
   * ClassName —— 简短职责说明
   * ============================================================================
   *
   * 职责概述：
   * 1. 职责一
   * 2. 职责二
   * ============================================================================
   */
  ```

### 7. 代码分段注释
使用 `// ──` 系列进行视觉分段，形成清晰的层次结构：
```
// ── 生命周期管理 ───────────────────────────────────────────────
// ─── 公开入口 ───────────────────────────────────────────────────
// ─── 私有方法 ──────────────────────────────────────────────────
// ─── 工具方法 ──────────────────────────────────────────────────
```
ASCII 分隔线长度一致，末尾对齐到列 120（与 prettier printWidth 一致）。

### 8. 错误处理模式
```typescript
// 模式 1: 返回错误消息（轻量校验，如命令解析）
function parseCommandPlayer(origin): Player | string {
  if (!(entity instanceof Player)) return "该命令只能由玩家执行";
  return entity;
}

// 模式 2: 抛出异常（业务逻辑层）
function createWarehouse(...): WarehouseData {
  if (this.repository.exists(id)) throw new Error(`仓库 ${id} 已存在`);
}

// 模式 3: 安全执行 + 返回 undefined（可能失败的 IO 操作）
function getDimensionSafe(dimensionId): Dimension | undefined {
  try { return world.getDimension(dimensionId); } catch { return undefined; }
}

// 模式 4: 安全发送消息（玩家可能已断线）
function trySendMessage(player: Player, message: string): void {
  try { player.sendMessage(message); } catch { /* 静默忽略 */ }
}

// 模式 5: 事件处理器内的 try-catch（防止单个事件崩溃影响全局）
world.afterEvents.playerPlaceBlock.subscribe((event) => {
  try { /* ... */ } catch (e) {
    console.warn("[SmartWarehouse] playerPlaceBlock 事件处理器错误:", e);
  }
});
```

### 9. 依赖注入模式
```typescript
// 类使用构造函数注入，可选依赖用默认参数（方便测试时注入 mock）
export class WarehouseService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly scanner = new ContainerScanner(),     // 可注入，默认实现
    private readonly markRuntimeDirty: (id: WarehouseId) => void = () => undefined
  ) {}
}

export class SortingScheduler {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine,
    readonly maxWarehousesPerRun: number = 4  // 默认值，调用方按需修改
  ) {}
}
```

### 10. 类型定义模式
```typescript
// 集中式类型定义（types.ts）：所有业务类型放在一个文件中
export type WarehouseId = string;
export type ContainerId = string;
export type DimensionId = string;

// Union type（带中文 JSDoc 描述每个分支的用途）
export type ContainerRole = "normal" | "misc" | "bulk" | "input";

// 带中文字段的 Record 常量（用于 UI 展示）
export const ROLE_LABELS: Record<ContainerRole, string> = {
  normal: "普通",
  misc: "杂项",
  bulk: "批量",
  input: "输入",
};

// 有限字面量 union
export type ProcessingSpeed = 4 | 8 | 16 | 20;

// 接口继承
export interface WarehouseData extends WarehouseMeta {
  containers: Record<ContainerId, StoredContainer>;
}

// 受歧视联合（discriminated union）用于状态机
export type SelectionSession =
  | { type: "createWarehouse"; warehouseName: string; pointA?: BlockLocation }
  | { type: "resizeWarehouse"; warehouseId: WarehouseId; pointA?: BlockLocation };

// 返回类型联合（解析结果的 ok/error 模式）
type ParseResult = { ok: true; id: WarehouseId } | { ok: false; message: string };
```

### 11. Prettier 配置（.prettierrc.json）
```json
{
  "trailingComma": "es5",
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "printWidth": 120,
  "endOfLine": "auto"
}
```

### 12. tsconfig 关键设置
- `target: "es6"` — 输出 ES6 兼容代码
- `module: "ES2020"` — ES 模块格式
- `moduleResolution: "Node"`
- `strict: true` — 全开严格模式
- `noImplicitAny: true` — 禁止隐式 any
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — 支持装饰器
- `rootDir: "."`, `baseUrl: "BP/"` — 源码根目录和编译基路径
- `outDir: "lib"` — 编译输出
- 只编译 `scripts/**/*`

### 13. Minecraft 特有模式

**事件驱动初始化**（main.ts）：
```typescript
// 每次脚本重载时执行一次，一次性初始化所有子系统
const repository = new WarehouseRepository();
const runtime = new WarehouseRuntimeRegistry(repository);
const service = new WarehouseService(repository, undefined, (id) => runtime.markDirty(id));
service.registerBlockMaintenance();
registerToolInteraction(service);
commandRouter.register();
scheduler.start();
```

**命令注册**（CommandRouter）：
```typescript
// 在 system.beforeEvents.startup 中注册自定义命令
system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    regionCommand("sw:create", "描述"),
    (origin, name, x1, y1, z1, x2, y2, z2) => this.handleCreate(...)
  );
});
```

**UI 交互**（ActionForm / ModalForm）：
```typescript
// UI 使用 @minecraft/server-ui 的 ActionFormData / ModalFormData
const form = new ActionFormData()
  .title("标题")
  .body("内容")
  .button("按钮");
const response = await form.show(player);
```

**区块安全访问**：
```typescript
// 任何方块/容器访问都必须用 try-catch 保护
function tryGetBlock(dimension: Dimension, location: BlockLocation): Block | undefined {
  try { return dimension.getBlock(location); } catch { return undefined; }
}
```

### 14. 通用编码习惯

- **`private readonly`** 构造参数简写：`constructor(private readonly dep: Type)`
- **Map 类型**显式声明泛型：`new Map<string, ContainerId[]>()`
- **Record 类型**用于对象字典：`Record<ContainerId, StoredContainer>`
- **`.filter(Boolean)`** 风格使用类型守卫：`.filter((w): w is WarehouseData => Boolean(w))`
- **异步 UI**：UI 相关方法用 `async` / `await`（ActionForm.show 返回 Promise）
- **同步业务逻辑**：WarehouseService 的方法同步执行（Minecraft Script API 在同一 tick 内同步）
- **幂等方法**：`start()` / `stop()` 等生命周期方法必须是幂等的
- **错误消息语言**：面向玩家的错误消息使用中文；调试日志使用英文
- **日志格式**：`[前缀] 消息`，通过 `Logger` 类统一输出，底层使用 `console.warn`
- **常量就近定义**：模块级常量定义在使用位置附近（非集中式 constants 文件）
