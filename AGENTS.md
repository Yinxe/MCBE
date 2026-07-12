# @yinxe/mc — MCBE Addon Monorepo

## 项目结构

```
mc/
├── mcaddon/<name>/       # MCBE Addon 项目（TypeScript + 构建脚本）
│   ├── BP/<Project>/     # 行为包（manifest.json）
│   ├── RP/<Project>/     # 资源包（可选）
│   ├── scripts/          # TypeScript 源码
│   ├── just.config.ts    # 构建配置
│   └── package.json      # 独立版本号
├── server-plugin/<name>/ # 服务端插件（纯 JSON / 轻量 BP）
│   ├── BP/<Project>/     # 行为包
│   ├── scripts/          # 打包脚本（可选）
│   └── package.json      # 独立版本号
├── packages/toolkit/     # @yinxe/toolkit — 共享构建工具
└── package.json          # 根 workspace
```

## 构建命令

所有构建通过 `just-scripts`（via pnpm）。各模组独有命令见模组级 AGENTS.md。

```bash
pnpm run build:<mod>   # 编译（TypeScript → esbuild）
pnpm run pack:<mod>    # 打包（BP/RP → .mcpack / .mcaddon）
pnpm run clean         # 全部清理
```

## 命名与版本

- **显示名称**: 中文（`header.name`），如"模拟玩家"、"智能仓库"
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
- **语言**: TypeScript (`target: es6`, `strict: true`)
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

### 通用编码习惯
- `private readonly` 构造参数简写
- Map/Record 显式声明泛型
- 面向玩家的错误消息使用中文；调试日志使用英文
- 日志格式: `[前缀] 消息`，通过 `console.warn` 输出
- 常量就近定义，不集中塞到 constants 文件
