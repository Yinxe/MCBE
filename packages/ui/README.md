# @mc-toolchain/ui

MCBE 行为包的共享界面层：三类表单的封装、安全上下文执行助手、界面消息助手。

模组通过 npm workspace 依赖本包，以 TypeScript 源码直接消费（`main` / `types` 均指向 `src/index.ts`），无需预编译。

## 承载范围

| 导出 | 说明 |
| --- | --- |
| `ModalFormBuilder` | 选项式表单封装，返回「字段名 → 值」，取消返回 `null` |
| `ActionFormBuilder` | 按钮式菜单封装，回调在安全上下文执行 |
| `MessageFormBuilder` | 双按钮对话框封装，`confirm()` 一行完成确认流程 |
| `runSafe(fn)` | 把回调推迟到安全上下文，返回 Promise |
| `runSafeDetached(fn, onError?)` | 同上但不返回 Promise，错误交给 `onError` 或 `console.warn` |
| `createRunSafe(schedule)` | 执行助手的可测核心，调度器由调用方注入 |
| `parseModalValues(fields, values)` | 表单取值解析纯函数，兼容两种 label 排布 |
| `trySendMessage` / `notifySuccess` / `notifyError` | 玩家离线时静默跳过的消息助手 |

### 与 `@mc-toolchain/shared` 的分工

| 关注点 | 归属 |
| --- | --- |
| 文本样式码、HUD 逐玩家优先级仲裁 | `@mc-toolchain/shared` |
| 表单封装、安全上下文执行、界面消息 | 本包 |

两边不互相依赖。HUD 仲裁依赖 `/scriptevent yinxe:hud` 这条对外协议，属于跨包契约；表单封装只与 `@minecraft/server-ui` 的调用形状有关，两者混在一包里会让协议变更牵连界面代码。

### 刻意不包含

- **命令注册封装**：仓库内已有两处手写 `registry.registerCommand` + `system.run` 的实现（`auto-refill`、`spectator-mode`），再抽第三种形态比现状更差。命令注册样板留在各模组内。
- **玩家权限判定**：`canManage` 这类判断是模组级策略，不同模组的管理员定义不同。

## 依赖约束

- **零第三方运行时依赖**：除 `@minecraft/server` 与 `@minecraft/server-ui` 外不引入任何运行时库，避免同一世界内多个行为包各带一份实现。
- 两个官方包只作 `peerDependencies`，由消费方模组提供，保证世界内所有包共用同一份脚本 API。
- 源码需在消费方的保守编译配置下通过：`target: es6`、`module: ES2020`。本包 `tsconfig.json` 即按此自检，因此**不得使用 ES2015 之后的语法**（例如 `.at()`、可选链赋值等）。

## 安全上下文

自定义命令回调与 `beforeEvents` 回调运行在**只读上下文**，在其中调用被标注 `can't be called in read-only mode` 的成员会抛错。判定依据是类型声明上的文档注释，而不是「是不是写操作」——`sendMessage`、`setDynamicProperty` 不受限，`subscribe`、`teleport`、`setGameMode` 受限。

`runSafe` / `runSafeDetached` 是推迟执行的唯一入口。命令回调体内只做参数解包与鉴权，随后把真正的操作交给这两个助手；不要再手工套一层 `system.run`。

完整成员清单与复现方式见 [`docs/research/read-only-context.md`](../../docs/research/read-only-context.md)。

## 测试

```bash
npm test -w @mc-toolchain/ui
```

`tests/tsconfig.json` 只编译 `src/**` 中不依赖 `@minecraft` 的模块（`formValues.ts`、`runSafeCore.ts`）与测试文件，因此测试跑在纯 Node 上，不需要游戏运行时。
