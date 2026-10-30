# ScriptAPI 约束与测试配方

配合 `../SKILL.md` 使用，覆盖跨模块通用的运行时规则、命令模板、测试桩与构建配置。

## 运行时上下文

- **启动顺序**：`system.beforeEvents.startup` 内只做无世界依赖的注册（自定义命令、枚举、测试维度声明）；`world.afterEvents.worldLoad` 后 `system.run` 执行有状态装配；脚本热加载到已运行世界时用 `system.runTimeout` 兜底（mockplayer3 取 200t），`booted` 防重入。
- **beforeEvents 不触世界**：`playerSpawn`、`entityDie`、`itemUse` 等 before 回调只收集信息/取消事件，真正的世界写操作 `system.run` 延后。
- **DP 读取**：`world.getDynamicProperty` / `getDynamicPropertyIds` 只能在 Phase ④ 之后或事件回调内。
- **世界写操作**：维度、方块、容器、实体、DP 的写都在 `system.run` 或事件回调内；`tick` 回调本身已在合法上下文，但不要在其中 `await`。
- **计时**：统一用模块 `Clock`（`onTick` / `runTimeout`）或 `system.runTimeout`；不要 `setInterval`、`while` 等待、递归 `runTimeout` 自旋。
- **异常**：事件回调整体 `try-catch`；区块/容器访问逐次 `try-catch`；记录 `[前缀]` 后降级，别让异常穿透主循环。
- **日志**：`console.warn("[前缀] 消息")`；错误对象取 `e?.message ?? e`；玩家文案中文，内部日志英文。

## 自定义命令模板

```ts
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import type { CustomCommandRegistry } from "@minecraft/server";

interface CommandSpec {
  name: string;
  description: string;
  args?: { name: string; type: CustomCommandParamType; optional?: boolean }[];
  permission?: "any" | "admin";
  execute(ctx: CommandCtx, args: Record<string, unknown>): void | Promise<void>;
}

export function registerCommands(registry: CustomCommandRegistry, specs: readonly CommandSpec[]): void {
  for (const spec of specs) {
    const mandatory = (spec.args ?? []).filter((a) => !a.optional);
    const optional = (spec.args ?? []).filter((a) => a.optional);
    registry.registerCommand(
      {
        name: spec.name,
        description: spec.description,
        permissionLevel:
          spec.permission === "admin" ? CommandPermissionLevel.GameDirectors : CommandPermissionLevel.Any,
        mandatoryParameters: mandatory.map((a) => ({ name: a.name, type: a.type })),
        optionalParameters: optional.map((a) => ({ name: a.name, type: a.type })),
      },
      (origin, ...values) => {
        // 只做参数解析、权限/上下文校验、转交 application；异常在此回显
      }
    );
  }
}
```

- 枚举参数先用 `registry.registerEnum("namespace:enum", values)`，再在参数里引用；枚举名必须带命名空间，注册失败整条命令失败。
- 命令目录即注册表即帮助文本，不要另写命令手册。
- 处理函数零业务规则、零持久化写；需要长操作时 `system.run` 或交给 application。

## 持久化规则

- 键名带模块前缀与实体 id（如 `mp:bot:<botId>`）；单键体积小，写入前做上限校验。
- 读入必须归一化：缺字段补默认值，坏类型丢弃，不能让坏档中断启动。
- 迁移可重入：检测旧键 → 写新键 → 写成功才删旧键；失败保留旧数据并记录。
- 模块命名空间由 manifest `module_name` 决定；DP 键实际为 `<module_name>:<key>`。改 `module_name` 会读不到旧键。
- 写入频率与脏字段解耦：内存改记录 + `mark` 脏字段，由保存闸/周期统一冲刷。

## 测试配置

`tsconfig.test.json` 与构建配置分离：

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
    "types": ["node"],
    "outDir": ".test-build",
    "rootDir": "."
  },
  "include": ["scripts/domain/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", ".test-build", "lib", "dist"]
}
```

- `module: commonjs` 让 `node --test` 能直接 require；构建仍用 `ES2020` + bundler。
- `noUncheckedIndexedAccess` 会暴露数组/字典越界，写测试时按真实可能为 `undefined` 处理。

## @minecraft 桩

`@minecraft/*` 只发类型声明，运行时 require 会 `MODULE_NOT_FOUND`。mockplayer3 的 `tests/stubs/MinecraftRuntime.ts` 用 `Module._resolveFilename` + require cache 注入 Proxy 自动桩：

- 任意属性/调用/构造返回自身，便于引擎层冒烟。
- `then` 返回 `undefined`，防止 `await` 挂死。
- `Symbol.hasInstance` 返回 `undefined`，避免 `e instanceof 桩类` 恒真、把不同错误类型抹平。
- 需要真实观测时由测试注入 `WorldProbe`，不要给判定逻辑打桩。
- 该文件必须在测试入口最早 require，再加载业务模块。

## 测试命名与分层

| 文件模式                      | 覆盖                                        |
| ----------------------------- | ------------------------------------------- |
| `tests/domain.*.test.ts`      | 纯规则、解析、状态机、归一化                |
| `tests/engine.*Sim.test.ts`   | 引擎原子在桩/仿真世界下的行为               |
| `tests/sim.*.test.ts`         | 跨层流程模拟、迁移                          |
| `tests/*.test.ts`（其他模块） | 按功能命名，如 `instantbreak`、`toolscorer` |

- 断言统一 `node:assert/strict`；替身用 `InMemory*` 或最小对象，不引入测试框架。
- 每个测试聚焦一个行为；名称写中文行为描述，不写实现细节。
- 不能离线覆盖的世界行为，在模块文档标注“仅实机验证”。

## 构建配置

- `just.config.ts` 典型任务链：`build = series("update-version", "typescript", "bundle")`；`pack = series("clean-local", "build", "createMcaddonFile")`。
- `bundleOptions()` 来自 `@yinxe/toolkit-build`，external 列出 `@minecraft/server`、`@minecraft/server-ui`（以及用到的 gametest/math）。
- `copyOptions()` 负责 BP/RP 复制；RP 存在时 BP manifest 需依赖 RP UUID。
- `update-version` 用 `syncManifestVersion()` 同步 `package.json#version` 并注入 RP 依赖；这是 release-only 副作用。
- 日常类型检查用 `npx tsc --noEmit -p tsconfig.json`；不要为验证跑 `build`/`pack`。

## 新增模块脚手架

```bash
mkdir -p mcaddon/<name>/scripts mcaddon/<name>/BP/<Project>
# 复制同仓模块的 just.config.ts / tsconfig.json / package.json / BP/manifest.json
# 修改 package.json: name、mcbe.packName/bp/rp、scripts
pnpm install
pnpm --filter <name> run build
```

检查：

- `manifest.json` 的 `header.uuid` / `modules[].uuid` 唯一；`module_name` 与 DP 命名空间一致。
- `min_engine_version` 与所用 API 最低版本匹配（tickingAreaManager 需 1.21.130）。
- 根 `package.json` 补 `build:<mod>` / `pack:<mod>`；需要离线测试则补 `test:<mod>`。
- 模块 `AGENTS.md` 写清：分层、命令、DP 键、测试入口、引擎事实与发版纪律。
