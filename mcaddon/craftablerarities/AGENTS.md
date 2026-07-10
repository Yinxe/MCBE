## 使用此模板

### 初始化新项目

此项目是一个通用模板，在开始编写您的 Add-on 之前，**必须先做以下操作**：

```bash
# 1. 运行初始化脚本（自动完成大部分配置）
node tools/init-project.mjs your-new-addon-name

# 2. 手动完成 manifest.json 中的 UUID 更新
# （UUID 在初始化时已自动生成，但建议用 https://www.uuidgenerator.net/ 验证）
```

初始化脚本会自动执行：
1. ✅ 重命名 `BP/<old_name>/` → `BP/<new_name>/`
2. ✅ 重命名 `RP/<old_name>/` → `RP/<new_name>/`
3. ✅ 更新 `.env` 中的 `PROJECT_NAME`
4. ✅ 更新 `package.json` 的 `name` 字段
5. ✅ 更新 `package.json` 的 `description` 字段
6. ✅ 自动生成 BP/RP manifest.json 中所有 6 个 UUID
7. ✅ 更新 GitHub Actions 中的项目名称引用

> ⚠ **UUID 是每个模组的唯一身份标识**。不同模组、甚至同一模组的不同实例（如测试版与正式版），
> 都必须使用不同的 UUID。Minecraft 使用 UUID 区分不同的 Add-on，重复 UUID 会导致加载冲突。

### 开发工作流

```
克隆/下载模板
     │
     ▼
  npm install              ← 安装依赖
     │
     ▼
  node tools/init-project  ← 重命名项目（仅首次）
     │
     ▼
  编辑 BP/合成配方扩展&隐藏物品/recipes/*.json  ← 添加/修改合成配方
     │
     ▼
  npm run pack               ← 构建（版本同步 → 打包 .mcpack）
```

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
- **UI**: `@minecraft/server-ui` (ActionForm / ModalForm)
- **构建**: `just-scripts` + TypeScript 编译器
- **格式化工具**: Prettier (配置见 `.prettierrc.json`)
- **ESLint**: `eslint-plugin-minecraft-linting`

### 2. 项目结构
```
BP/                   行为包（manifest.json + scripts 编译产物）
  <project_name>/     BP 实际内容（manifest.json, pack_icon.png, /scripts/main.js）
RP/                   资源包
  <project_name>/     RP 实际内容（manifest.json, pack_icon.png, /textures/, /sounds/ 等）
scripts/              TypeScript 源码
  main.ts             入口文件（初始化依赖、注册事件和命令，分 4 个 Phase）
  types.ts            集中式类型定义（接口、类型别名、常量）
  version.ts          自动生成的版本号与构建时间
  commands/           命令路由层（解析输入、校验权限、委托服务层）
  data/               数据文件（物品分类、ID 映射表等）
  interaction/        工具交互（方块事件处理等）
  runtime/            运行时缓存层（内存索引、惰性重建）
  storage/            持久化层（Dynamic Property 读写）
  ui/                 玩家交互界面（ActionForm / ModalForm）
  util/               工具函数（日志、坐标、JSON、权限）
tools/                维护工具（Node.js 脚本）
docs/                 文档
  api/                API 类型定义参考（server.d.ts 等）
```

### 3. 架构分层
```
UI/ToolInteraction/CommandRouter  ← 输入层（事件驱动）
        ↓
   Service/Controller              ← 业务层（核心逻辑）
       ↙        ↘
Repository/Store    Scanner        ← 数据层 + 扫描
       ↓
  DynamicPropertyStore             ← 持久化
       ↓
  Minecraft Dynamic Properties

RuntimeRegistry ← 运行时缓存（内存索引 + 惰性重建）
```

**单向依赖规则**：高层模块依赖低层模块，低层模块不依赖高层。同层模块间通过接口或事件解耦。

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
| 坐标键 | `locationKey()` 工厂 | `"dimensionId|x|y|z"` 格式 |

**特例：**
- `main.ts` — 入口文件，保持小写
- `types.ts` — 集中类型定义，保持小写
- `version.ts` — 自动生成，保持小写

### 5. 导入规范
```typescript
// 1. 外部依赖
import { world, system } from "@minecraft/server";
// 2. 仅类型导入时使用 type 关键字
import type { Vector3 } from "@minecraft/server";
// 3. 内部模块（相对路径）
import { normalizeId } from "../storage/Repository";
import { Logger } from "../util/Logger";
import type { MyService } from "../services/MyService";
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
function getDimensionSafe(dimensionId: DimensionId): Dimension | undefined {
  try { return world.getDimension(dimensionId); } catch { return undefined; }
}

// 模式 4: 安全发送消息（玩家可能已断线）
function trySendMessage(player: Player, message: string): void {
  try { player.sendMessage(message); } catch { /* 静默忽略 */ }
}

// 模式 5: 事件处理器内的 try-catch（防止单个事件崩溃影响全局）
world.afterEvents.playerPlaceBlock.subscribe((event) => {
  try { /* ... */ } catch (e) {
    console.warn("[MyAddon] playerPlaceBlock 事件处理器错误:", e);
  }
});
```

### 9. 依赖注入模式
```typescript
// 类使用构造函数注入，可选依赖用默认参数（方便测试时注入 mock）
export class MyService {
  constructor(
    private readonly repository: MyRepository,
    private readonly defaultConfig = new DefaultConfig(),  // 可注入，默认实现
    private readonly onNotify: (id: string) => void = () => undefined
  ) {}
}

// 构造函数注入 + 可选依赖
export class MyScheduler {
  constructor(
    private readonly repository: MyRepository,
    readonly batchSize: number = 4  // 默认值，调用方按需修改
  ) {}
}
```

### 10. 类型定义模式
```typescript
// 集中式类型定义（types.ts）：所有业务类型放在一个文件中
export type EntityId = string;
export type DimensionId = string;

// Union type（带中文 JSDoc 描述每个分支的用途）
/**
 * 容器角色
 * - normal: 普通仓位，主存储
 * - input: 输入容器，玩家放入待处理物品
 * - bulk: 大宗仓位，单物品专用
 * - misc: 杂项容器，兜底
 */
export type ContainerRole = "normal" | "input" | "bulk" | "misc";

// 带中文字段的 Record 常量（用于 UI 展示）
export const ROLE_LABELS: Record<ContainerRole, string> = {
  normal: "普通",
  input: "输入",
  bulk: "大宗",
  misc: "杂项",
};

// 有限字面量 union
export type ProcessingSpeed = 4 | 8 | 16 | 20;

// 接口继承
export interface EntityData extends EntityMeta {
  items: Record<string, ItemInfo>;
}

// 受歧视联合（discriminated union）用于状态机
export type SelectionSession =
  | { type: "createEntity"; name: string; pointA?: BlockLocation }
  | { type: "resizeEntity"; id: EntityId; pointA?: BlockLocation };

// 返回类型联合（解析结果的 ok/error 模式）
type ParseResult = { ok: true; id: EntityId } | { ok: false; message: string };
```

### 11. 配置文件

**Prettier（.prettierrc.json）**
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

**tsconfig 关键设置**
- `target: "es6"` — 输出 ES6 兼容代码
- `module: "ES2020"` — ES 模块格式
- `moduleResolution: "Node"`
- `strict: true` — 全开严格模式
- `noImplicitAny: true` — 禁止隐式 any
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — 支持装饰器
- `rootDir: "."`, `baseUrl: "BP/"` — 源码根目录和编译基路径
- `outDir: "lib"` — 编译输出
- 只编译 `scripts/**/*`

### 12. Minecraft 特有模式

**事件驱动初始化（main.ts）—— 建议分为 4 个 Phase：**
```typescript
// Phase 1: 无状态基础设施
const configStore = new ConfigStore();
const repository = new Repository();
const runtime = new RuntimeRegistry(repository);

// Phase 2: 有状态业务逻辑
const engine = new MyEngine(repository, runtime);
const scheduler = new MyScheduler(repository, engine);
const service = new MyService(repository, configStore, /* ... */);

// Phase 3: 注册事件和命令
service.registerBlockMaintenance();
registerToolInteraction(service);
commandRouter.register();

// Phase 4: 延迟启动（dynamicProperty 需世界完全加载）
system.run(() => { scheduler.start(); /* ... */ });
```

**命令注册（CommandRouter）：**
```typescript
// 在 system.beforeEvents.startup 中注册自定义命令
system.beforeEvents.startup.subscribe((event) => {
  event.customCommandRegistry.registerCommand(
    regionCommand("prefix:command", "描述"),
    (origin, ...args) => this.handleCommand(...)
  );
});
```

**UI 交互（ActionForm / ModalForm）：**
```typescript
// UI 使用 @minecraft/server-ui 的 ActionFormData / ModalFormData
const form = new ActionFormData()
  .title("标题")
  .body("内容")
  .button("按钮");
const response = await form.show(player);
```

**区块安全访问：**
```typescript
// 任何方块/容器访问都必须用 try-catch 保护
function tryGetBlock(dimension: Dimension, location: BlockLocation): Block | undefined {
  try { return dimension.getBlock(location); } catch { return undefined; }
}
```

### 13. 版本管理

- 版本号统一在 `package.json` 的 `version` 字段维护
- **构建时自动同步**：`just-scripts` 构建时会：
  1. 读取 `package.json` 的版本号
  2. 生成 `scripts/version.ts`（包含 VERSION, BUILD_TIME, PROJECT_URL）
  3. 同步更新 `BP/<project>/manifest.json` 和 `RP/<project>/manifest.json` 的所有版本字段
- **快速修改版本**：
  ```bash
  npm run version:patch   # 0.0.1 → 0.0.2
  npm run version:minor   # 0.0.1 → 0.1.0
  npm run version:major   # 0.0.1 → 1.0.0
  ```
- **发布打包**：`npm run mcaddon` — 构建 + 打包为 `.mcaddon` 文件
- **本地部署**：`npm run local-deploy` — 构建 + 复制到 Minecraft 开发目录
- **CI/CD**：推送 tag (`v*`) 触发 GitHub Actions 自动构建并发布 Release

### 14. 通用编码习惯

- **`private readonly`** 构造参数简写：`constructor(private readonly dep: Type)`
- **Map 类型**显式声明泛型：`new Map<string, ItemId[]>()`
- **Record 类型**用于对象字典：`Record<string, ItemInfo>`
- **`.filter(Boolean)`** 风格使用类型守卫：`.filter((w): w is Type => Boolean(w))`
- **异步 UI**：UI 相关方法用 `async` / `await`（ActionForm.show 返回 Promise）
- **同步业务逻辑**：核心服务方法同步执行（Minecraft Script API 在同一 tick 内同步）
- **幂等方法**：`start()` / `stop()` 等生命周期方法必须是幂等的
- **错误消息语言**：面向玩家的错误消息使用中文；调试日志使用英文
- **日志格式**：`[前缀] 消息`，通过 Logger 类统一输出，底层使用 `console.warn`
- **常量就近定义**：模块级常量定义在使用位置附近（非集中式 constants 文件）

### 15. system.run() 执行上下文（重要！）

Minecraft Script API 中有部分函数**只能在 `system.run()` / `system.runInterval()` 回调或事件处理器中调用**，
在模块顶层作用域直接调用会导致未定义行为或静默失败。

**必须放在 system.run() 或事件处理器中的操作：**
- `world.getDimension()` / `dimension.getBlock()` — 获取维度、方块
- `player.sendMessage()` — 向玩家发送消息
- 所有容器操作（`container.getItem()`, `container.setItem()` 等
- 所有 `DynamicProperty` 的读写操作（`setDynamicProperty`, `getDynamicProperty`）
- `dimension.runCommand()` / `dimension.spawnItem()` — 维度指令和生成物品

**可以在顶层（模块加载时）执行的操作：**
- 导入模块、定义类型和接口
- 实例化无状态对象（配置、工具类等）
- 注册事件监听（`world.afterEvents.xxx.subscribe`）
- 注册命令（`system.beforeEvents.startup` 内）
- 定义常量和函数

**频发错误示例（AI 必读）：**
```typescript
// ❌ 错误模式 1：在顶层直接获取维度
const overworld = world.getDimension("minecraft:overworld");
system.run(() => {
  // 这里的回调虽然是在 system.run 中，但上面的维度获取已经失败了
  const block = overworld.getBlock({ x: 0, y: 0, z: 0 });
});

// ✅ 正确：整个操作链都放在 system.run() 内部
system.run(() => {
  const overworld = world.getDimension("minecraft:overworld");
  const block = overworld.getBlock({ x: 0, y: 0, z: 0 });
});

// ❌ 错误模式 2：在顶层读取 DynamicProperty
const data = player.getDynamicProperty("myKey");   // player 是顶层变量，但 getDynamicProperty 只能在 system.run 中

// ✅ 正确：所有世界状态操作都在 system.run 中
system.run(() => {
  const data = player.getDynamicProperty("myKey");
});

// ❌ 错误模式 3：在事件处理器外直接操作容器
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const container = event.block.getComponent("inventory")?.container;
  // ↑ 顶层事件处理器是安全的，但以下方式不行：
});
// 顶层：
const container = someBlock.getComponent("inventory")?.container;  // ❌

// ✅ 正确：容器操作放在事件处理器或 system.run 中
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  try {
    const container = event.block.getComponent("inventory")?.container;
    if (container) {
      const item = container.getItem(0);
      // ...
    }
  } catch (e) {
    console.warn("[MyAddon] 容器操作失败:", e);
  }
});
```

**经验法则：**
> 任何涉及 Minecraft 世界状态（维度、方块、实体、玩家、容器、物品）的操作，都必须放在 `system.run()` 回调或事件处理器中执行。类型定义、工具函数、无状态对象实例化可以在顶层执行。
