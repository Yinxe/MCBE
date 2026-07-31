# @yinxe/toolkit

MCBE addon monorepo 的**共享运行时库**，提供 color（着色）、ui（表单封装）、command（命令注册）、player（玩家工具）四个子模块。

直接以 TypeScript 源码作为入口（`main: src/index.ts`），随使用方一起编译，**不做独立构建**。

## 定位

- **运行时公共模块**：非构建工具，不参与打包流程，由各 addon 直接引用源码
- **零构建成本**：无独立的 build/pack 步骤，编译时随使用方项目一并完成
- **依赖共享**：声明为 `peerDependencies`，由使用方提供运行时依赖，避免多版本冲突

## 安装与依赖

| 项 | 值 |
|---|---|
| 版本 | 0.1.0（`private: true`） |
| 入口 | `src/index.ts`（`main` / `types` 均指向源码） |
| peerDependencies | `@minecraft/server` >= 2.0.0 |
| | `@minecraft/server-ui` >= 2.0.0 |

## 公共 API

### `src/color.ts` — 颜色 / 格式码

- **`color` 常量对象**：MCBE § 颜色码与格式码全集
  - 16 标准色：`black` / `darkBlue` / `darkGreen` / `darkAqua` / `darkRed` / `darkPurple` / `gold` / `gray` / `darkGray` / `blue` / `green` / `aqua` / `red` / `lightPurple` / `yellow` / `white`
  - `§g` 特殊色：`minecoinGold`
  - 格式码：`bold` / `italic` / `underline` / `strikethrough` / `obfuscated` / `reset`
  - 语义别名：`success` / `warn` / `error` / `accent` / `highlight` / `muted` / `info` / `playerName`
  - 每个颜色注释均包含在 ActionForm 背景（`#D0D1D4`）下的 WCAG 对比度说明
- **`actionFormFg` 数组**：ActionForm 按钮上推荐的 6 个前景色（`black` / `darkBlue` / `darkRed` / `darkGray` / `darkPurple` / `blue`），含对比度与 WCAG 等级（AAA / AA / AA-large）
- **`style(text, ...styles)` 函数**：给文本拼上颜色/格式码，不追加 `§r`（便于后续拼接）

### `src/player.ts` — 玩家工具

- **`canManage(player)`**：判断玩家是否为 OP（`playerPermissionLevel >= Operator`）

### `src/command/index.ts` — 自定义命令封装

- **`defineCommand(registry, config, handler)`**：`customCommandRegistry.registerCommand()` 的轻量封装
  - **自动校验执行者**：非玩家执行时直接返回 `"该命令只能由玩家执行"`
  - **回调安全执行**：handler 在 `system.run()` 中执行
  - **参数解构**：args 按 `mandatoryParameters` + `optionalParameters` 的 `name` 解构为 `params`
  - `config` 参数与原生 `CustomCommand` 接口完全一致，不做任何包装
- **`CommandContext<T>` 类型**：解构后的回调上下文 `{ origin, player, params }`

### `src/ui/` — server-ui 全功能封装（v2.0.0）

- **`ActionFormBuilder` 类**：`ActionFormData` 回调式封装
  - 布局：`.title` / `.body` / `.header` / `.divider`
  - 按钮：`.button` / `.buttonWithIcon`（回调自动在 `system.run()` 中执行）
  - 支持 RawMessage 本地化
  - 静态 `showQuick` 一行构建
  - 取消返回 `false`
- **`MessageFormBuilder` 类**：双按钮对话框封装
  - `.confirmButton`（右侧）/ `.cancelButton`（左侧）+ 回调
  - 静态 `confirm()` 快速确认框（✓/✗ 按钮）
  - 取消返回 `false`
- **`ModalFormBuilder` 类**：`ModalFormData` 命名访问封装
  - 字段：`.textField` / `.textFieldWithPlaceholder` / `.dropdown` / `.toggle` / `.slider`（全部支持 tooltip 悬浮提示）+ `.label` / `.header` / `.divider` / `.submitButton`
  - `show()` 返回 **字段名 → 值字典**（`ModalFormValues`），自动屏蔽 label 跨版本索引差异
  - 取消返回 `null`
- **`runSafeAsync(fn)`**：在 `system.run()` 中安全执行回调，支持 async，返回 Promise
- **`trySendMessage(player, msg)`**：安全发送消息，玩家断线时静默忽略
- **`notifySuccess(player, msg)`** / **`notifyError(player, msg)`**：标题栏反馈，绿色 `§a` 成功 / 红色 `§c` 失败
- **类型**：`ModalFormValues` 命名结果字典 + 字段选项类型（`ModalFormDataDropdownOptions` / `ModalFormDataSliderOptions` / `ModalFormDataTextFieldOptions` / `ModalFormDataToggleOptions`）

## 使用示例

```typescript
import { defineCommand } from "@yinxe/toolkit";
import { system } from "@minecraft/server";

system.beforeEvents.startup.subscribe((event) => {
  defineCommand(
    event.customCommandRegistry,
    {
      name: "mp:create",
      description: "创建一个模拟玩家",
      cheatsRequired: false,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      player.sendMessage(`创建假人 ${params.name}`);
    }
  );
});
```

```typescript
import { ModalFormBuilder, notifySuccess } from "@yinxe/toolkit";

const values = await new ModalFormBuilder("仓库配置")
  .textField("名称", "仓库名称", { placeholder: "请输入仓库名" })
  .toggle("公共", "允许其他玩家访问", { defaultValue: false, tooltip: "开启后其他玩家也可使用" })
  .show(player);

if (values) {
  notifySuccess(player, `仓库 ${values["名称"]} 已创建`);
}
```
