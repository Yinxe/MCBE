# @mc-toolchain/mod-common

MCBE 行为包的通用共享层：文本样式码与跨包 HUD 逐玩家优先级仲裁，以及三类表单封装、安全上下文执行助手、界面消息助手。

模组通过 npm workspace 依赖本包，以 TypeScript 源码直接消费（`main` / `types` 均指向 `src/index.ts`），无需预编译。

```ts
import {
  color,
  style,
  HudManager,
  HUD_SLOTS,
  ModalFormBuilder,
  ActionFormBuilder,
  MessageFormBuilder,
  runSafe,
  runSafeDetached,
  notifySuccess,
  notifyError,
} from "@mc-toolchain/mod-common";
```

## 承载范围

| 导出 | 说明 |
| --- | --- |
| `color` | `§` 颜色码与格式码常量，含语义别名（`success` / `warn` / `error` / `muted` 等） |
| `style(text, ...styles)` | 给文本加颜色/格式码，**不自动追加 `§r`** |
| `HudManager` | 跨包 HUD 管理器，逐玩家优先级仲裁（actionbar / title / sidebar） |
| `HUD_SLOTS` | 槽位常量 |
| `pickWinner` / `isStale` | 仲裁纯函数（同优先级按 `modId` 字典序决胜、心跳过期判定） |
| `ModalFormBuilder` | 多字段输入表单 → `FormValues \| null` |
| `ActionFormBuilder` | 按钮列表 → `boolean`（是否点了按钮） |
| `MessageFormBuilder` | 确认 / 取消对话框 → `boolean`（是否确认） |
| `runSafe` / `runSafeDetached` | 安全上下文执行助手，把回调推迟到安全 tick |
| `createRunSafe` / `parseModalValues` | 可注入调度的纯函数，供单测使用 |
| `isValueField` | 判定某字段是否为四类取值控件（`parseModalValues` 的判据） |
| `ModalFormData*Options` | 各输入控件的选项类型（`TextField` / `Dropdown` / `Toggle` / `Slider`） |
| `trySendMessage` / `notifySuccess` / `notifyError` | 界面消息助手 |

---

## 三类表单怎么选

| 想要的效果 | 用哪个 | `show()` 返回 |
| --- | --- | --- |
| 收集多个输入（文本/下拉/开关/滑条） | `ModalFormBuilder` | `FormValues \| null`（字段名 → 值） |
| 让玩家从一组操作里选一个 | `ActionFormBuilder` | `boolean`（是否点了按钮） |
| 只问「确认 / 取消」 | `MessageFormBuilder` | `boolean`（是否确认） |

三条共同约定：

- **取消不抛异常**。关闭表单只是一个返回值，不是错误。
- **点击回调在 `show()` 返回之前跑完**。`await` 到结果时，动作已经执行。
- **回调已在安全上下文**。回调里可以直接传送、写存档、开下一个表单。

---

## `ModalFormBuilder`

收集输入，按字段名取回结果。调用方只给名字，不需要自己数下标。

```ts
const values = await new ModalFormBuilder()
  .title("传送设置")
  .header("单人限制")
  .label("info", "§7修改后立即生效")
  .divider()
  .textFieldWithPlaceholder("name", "传送点名称", "留空则不修改")
  .dropdown("category", "分类", ["家", "资源点", "遗迹"], { defaultValueIndex: 0 })
  .toggle("isPublic", "公开传送点", { defaultValue: false })
  .slider("limit", "单人上限", 10, 100, { defaultValue: 30, valueStep: 5 })
  .submitButton("§a保存")
  .show(player);

if (values === null) return;               // 玩家取消
applySettings(values.name, values.category, values.isPublic, values.limit);
```

版式（从上到下）：

```text
┌──────────────────────────────────────────────┐
│                     设置                     │  title()
├──────────────────────────────────────────────┤
│                   传送设置                   │  header()
│ 只读说明文字                                 │  label("info", …)
│ ──────────────────────────────────────────── │  divider()
│ 玩家名称  [ ________________ ]               │  textField() → string
│ 分类      [ 家            ▾ ]                │  dropdown()  → number(下标)
│ 公开      [ ●]                               │  toggle()    → boolean
│ 上限      [ ────●────── ] 30                 │  slider()    → number
│                                              │
│                  [  提交  ]                  │  submitButton()
└──────────────────────────────────────────────┘
```

### 方法

| 方法 | 取值类型 | 说明 |
| --- | --- | --- |
| `title(text)` | — | 表单标题 |
| `header(text)` | — | 居中大号文字，纯装饰 |
| `label(name, text)` | — | 只读文本，`name` 仅占位不参与取值 |
| `divider()` | — | 分隔线，纯装饰 |
| `textField(name, label, opts?)` | `string` | `opts`: `defaultValue` / `tooltip` |
| `textFieldWithPlaceholder(name, label, placeholder, opts?)` | `string` | 带灰色占位符；`opts` 同上但不含 `placeholder` |
| `dropdown(name, label, items, opts?)` | `number` | 返回**下标**；`opts.defaultValueIndex` |
| `toggle(name, label, opts?)` | `boolean` | `opts.defaultValue` |
| `slider(name, label, min, max, opts?)` | `number` | 两端含；`opts.defaultValue` / `valueStep` |
| `submitButton(text)` | — | 提交按钮文案，默认「提交」 |
| `show(player)` | `FormValues \| null` | 展示并等待 |
| `ModalFormBuilder.showQuick(player, title, build)` | `FormValues \| null` | 一行完成构建 + 展示 |

### 返回值

| 情况 | 返回 |
| --- | --- |
| 玩家提交 | `{ 字段名: 值, … }` |
| 玩家取消 / 关闭 | `null` |
| 显示失败（如玩家正在看别的界面） | `null`，并 `console.warn` |
| 提交但表单没有任何字段 | `{}` |

**必须判 `null`**：`values.name` 在 `null` 上会抛错。

### 陷阱：下拉框返回下标，不是文本

```ts
const CATEGORIES = ["家", "资源点", "遗迹"];

const values = await new ModalFormBuilder()
  .dropdown("category", "分类", CATEGORIES)
  .show(player);
if (!values) return;

const index = values.category as number;      // 0 / 1 / 2
const text = CATEGORIES[index];               // "家" / "资源点" / "遗迹"
```

### 陷阱：装饰行与下标偏移

`header` / `label` / `divider` 在部分游戏版本占用 `formValues` 下标、在另一些版本不占用。本包用「取值个数是否等于字段总数」判断排布，两种都兼容，调用方无需关心。

但这也意味着**不要手工解析 `formValues`**。需要原始数组时用 `parseModalValues(fields, values)`，并沿用同一判据。

---

## `ActionFormBuilder`

一组按钮，点击后执行回调。菜单、列表、分页都用它。

```ts
await new ActionFormBuilder()
  .title("传送")
  .body(`§7当前世界: §f${worldName}`)
  .divider()
  .button("§b前往传送点", () => showWarpSelector(player))
  .button("§e管理传送点", () => showWarpManagement(player))
  .buttonWithIcon("§c公共传送点", "textures/ui/icon_recipe_item", () => showPublicWarpsList(player))
  .divider()
  .button("§7关闭")
  .show(player);
```

版式（从上到下）：

```text
┌──────────────────────────────────────────────┐
│                     菜单                     │  title()
├──────────────────────────────────────────────┤
│ 请选择操作                                   │  body() / header() / label()
│ ──────────────────────────────────────────── │  divider()
│   传送                                       │  button() → selection 0
│ ──────────────────────────────────────────── │  divider()
│   管理传送点                                 │  button() → selection 1
│ ──────────────────────────────────────────── │  divider()
│   新建传送点                                 │  button() → selection 2
└──────────────────────────────────────────────┘
```

### 方法

| 方法 | 说明 |
| --- | --- |
| `title(text)` | 菜单标题 |
| `body(text)` | 正文 |
| `header(text)` / `label(text)` / `divider()` | 装饰行，不产生可点击项 |
| `button(text, callback?)` | 添加按钮，按添加顺序编号 |
| `buttonWithIcon(text, iconPath, callback?)` | 带图标按钮，`iconPath` 为资源包纹理路径 |
| `show(player)` | `Promise<boolean>`：`true` = 点了按钮 |
| `ActionFormBuilder.showQuick(player, title, build)` | 一行完成构建 + 展示 |

### 为什么 `show()` 不返回下标

`show()` 返回 `boolean` 而不是 `selection`，因为动作写在回调里。这样调用方不需要维护「下标 → 分支」的映射：

```ts
// 推荐：动作在回调里
await new ActionFormBuilder()
  .button("删除", () => deleteWaypoint(player, id))
  .button("重命名", () => renameWaypoint(player, id))
  .show(player);
```

确实需要拿到「点了第几个」时，本包不提供该值；直接 `new ActionFormData()` 并自己对照 `response.selection`。

### 陷阱：装饰行与按钮下标

`show()` 内部把 `response.selection` 当作**按钮序号**去索引回调数组。`header` / `divider` / `label` 不进入这个数组。

在大量混用装饰行的菜单里，如果实测出现「点了 A 触发了 B」，说明该版本把装饰行也计入了 `selection`。此时直接用 `ActionFormData` 自行维护映射，不要在本包上打补丁。

### 分页与列表

列表页用闭包携带页码，不要用可变的外部状态：

```ts
function showList(player: Player, page: number): void {
  const start = page * PAGE_SIZE;
  const items = all.slice(start, start + PAGE_SIZE);

  const form = new ActionFormBuilder().title(`第 ${page + 1} 页`);
  items.forEach((item) => form.button(item.name, () => onPick(item)));
  if (page > 0) form.button("§7上一页", () => showList(player, page - 1));
  if (start + PAGE_SIZE < all.length) form.button("§7下一页", () => showList(player, page + 1));

  form.show(player);   // 不 await：避免递归等待自己
}
```

---

## `MessageFormBuilder`

只问「确认 / 取消」。

```ts
const confirmed = await MessageFormBuilder.confirm(
  player,
  "§c删除传送点",
  `确定删除「${name}」?此操作不可恢复。`,
);
if (confirmed) deleteWaypoint(player, id);
```

需要自定义按钮文案时用链式写法：

```ts
const confirmed = await new MessageFormBuilder()
  .title("§c⚠ 危险区域")
  .body("前方是虚空,继续前进会掉落。")
  .confirmButton("§a继续前进")
  .cancelButton("§c返回")
  .show(player);
```

版式（从上到下）：

```text
┌──────────────────────────────────────────────┐
│                   确认删除                   │  title()
├──────────────────────────────────────────────┤
│ 删除后不可恢复。                             │  body()
│ 传送点: 家                                   │
│                                              │
│           [ ✓ 确认 ]    [ ✗ 取消 ]           │  button1 / button2
└──────────────────────────────────────────────┘
```

### 方法

| 方法 | 说明 |
| --- | --- |
| `title(text)` | 标题 |
| `body(text)` | 正文，支持 `\n` 换行与 `§` 样式码 |
| `confirmButton(label, callback?)` | 对应 `button1`，`selection 0` |
| `cancelButton(label, callback?)` | 对应 `button2`，`selection 1` |
| `show(player)` | `Promise<boolean>`：`true` = 确认 |
| `MessageFormBuilder.confirm(player, title, body, onConfirm?)` | 一行确认，按钮文案固定为 `§a✓ 确认` / `§c✗ 取消` |

### 陷阱：不要依赖按钮的左右位置

官方文档只说 `button1` 是「第一个按钮」，没有规定它显示在左侧还是右侧，实际摆放由游戏版本与界面语言决定。

- 不要写「点击右侧按钮」这类文案。
- 不要假设 `button1` 在左边。
- 需要确定的排列顺序时，改用 `ActionFormBuilder` 自己摆按钮。

---

## 执行助手

自定义命令回调、`beforeEvents` 回调运行在**受限上下文（read-only mode）**。在其中调用被标注 `can't be called in read-only mode` 的成员会抛错，`teleport`、`setGameMode`、`subscribe`、`show` 都属于此类。

判定依据是类型声明上的文档注释，**不是「是不是写操作」**：`sendMessage`、`setDynamicProperty`、`onScreenDisplay` 都不受限。

### `runSafe(fn)` — 能 await 的地方用

返回 `Promise`，回调成功 resolve，同步抛错或返回的 Promise 被拒绝则 reject。

```ts
// 表单按钮回调里（本身已在安全上下文，但需要顺序执行时仍可用）
await runSafe(() => {
  player.teleport(location, { dimension });
});
```

**必须处理返回的 Promise**（`await` + `try/catch` 或 `.catch`），否则失败会变成 unhandled rejection。

### `runSafeDetached(fn, onError?)` — 无法 await 的地方用

不返回 Promise，错误交给 `onError`，未提供时写入 `console.warn`。用于命令注册回调这类同步返回的位置：

```ts
registry.registerCommand(spec, (origin) => {
  const player = resolvePlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure };

  // 命令回调必须同步返回,不能 await
  runSafeDetached(() => openMenu(player));
  return { status: CustomCommandStatus.Success };
});
```

### 什么时候用哪个

| 位置 | 能否 await | 用哪个 |
| --- | --- | --- |
| `registry.registerCommand` 回调 | 否（必须同步返回结果） | `runSafeDetached` |
| `beforeEvents.*.subscribe` 回调 | 否 | `runSafeDetached` |
| 表单按钮回调 | 是 | `runSafe` |
| 已在安全上下文的 `async` 函数内 | 是 | `runSafe` |

### 不要双层包裹

`runSafe` 内部已经调用 `system.run`。模组里再套一层 `system.run` 只会推迟两 tick，并让错误路径分叉。

```ts
// 错
runSafe(() => system.run(() => player.teleport(loc)));

// 对
runSafe(() => player.teleport(loc));
```

### `createRunSafe(schedule)` 与 `parseModalValues`

两个纯函数用于单测：`createRunSafe` 允许注入假调度器，`parseModalValues` 可在没有游戏的情况下验证下标解析。生产代码直接用 `runSafe` / `runSafeDetached` 即可。

---

## 消息助手

面向界面反馈的三件套。玩家已离线时静默跳过，不打断后续流程。

```ts
import { notifySuccess, notifyError, trySendMessage } from "@mc-toolchain/mod-common";

notifySuccess(player, "传送点已创建");      // §a 绿色
notifyError(player, "名称已存在");          // §c 红色
trySendMessage(player, "§7任意样式文本");   // 原样发送
```

| 函数 | 行为 |
| --- | --- |
| `trySendMessage(player, msg)` | 原样发送；玩家离线时静默忽略 |
| `notifySuccess(player, msg)` | 加 `§a` 前缀后发送 |
| `notifyError(player, msg)` | 加 `§c` 前缀后发送 |

三者都不受限，可在命令回调里直接调用。

---

## 文本样式码与 HUD 仲裁

`color` / `style` 提供 `§` 文本样式码；`HudManager` 在多个行为包之间按玩家逐槽位仲裁 HUD 显示。

```ts
import { color, style, HudManager } from "@mc-toolchain/mod-common";

const text = style("已自动替换", color.success);   // 不自动追加 §r，需要复位时自行拼接 color.reset

const hud = new HudManager({ modId: "auto-refill", intervalTicks: 2, expiryTicks: 40 });

// 注册一个显示源：返回 undefined 表示「该玩家无内容」，不参与该玩家的仲裁
const unregister = hud.register({
  id: "hint",
  slot: "actionbar",
  priority: 60,
  render: (player) => (shouldShow(player) ? "已自动替换" : undefined),
});

hud.start();           // 在安全上下文调用
hud.setEnabled(false); // 暂停并释放全部声明，其它包可接管
unregister();          // 停止单个源
hud.stop();            // 全量销毁
```

`modId` 必须在同一世界的所有行为包之间唯一：它既用于总线去重，也用于同优先级决胜。

### `HudManager` 的跨包协议不可改

`HudManager` 通过 `/scriptevent yinxe:hud` 与同一世界内的其它行为包交换槽位声明。这条协议是**运行时协定**，不是本包私有实现：

- 脚本事件标识 `yinxe:hud`、命名空间 `yinxe` 不可修改，否则会与已安装的其它包失去互认。
- 广播载荷结构（`{"m":modId,"c":{<slot>:{"p":priority,"n":names}}}`）不可修改。
- 同优先级按 `modId` 字典序小者胜的决胜规则不可修改——这是跨包避免互相压倒的唯一确定性依据。

修改上述任一项都会让同一世界中不同版本的行为包互相看不见，表现为「HUD 突然消失」。需要演进协议时，必须同步所有消费方并保留旧标识一段时间。

同一槽位上，返回 `undefined` 的源视为「不参与仲裁」；全部源都不参与时槽位应恢复空白，不残留上一帧内容。

## 刻意不包含

- **命令注册封装**：仓库内已有手写 `registry.registerCommand` + `system.run` 的实现（`auto-refill`、`spectator-mode` 等），再抽第三种形态比现状更差。命令注册样板留在各模组内。
- **玩家权限判定**：`canManage` 这类判断是模组级策略，不同模组的管理员定义不同。
- **`defineCommand` 等价物**：同上，不抽。

这些要么与具体模组的交互设计强耦合，要么尚未被第二个模组使用；等出现第二个消费方再抽，避免过早固化接口。

## 依赖约束

- **零第三方运行时依赖**：除 `@minecraft/server` 与 `@minecraft/server-ui` 外不引入任何运行时库，避免同一世界内多个行为包各带一份实现。
- 两个官方包只作 `peerDependencies`，由消费方模组提供，保证世界内所有包共用同一份脚本 API。
- 源码需在消费方的保守编译配置下通过：`target: es6`、`module: ES2020`。本包 `tsconfig.json` 即按此自检，因此**不得使用 ES2015 之后的语法**（例如 `.at()`、可选链赋值等）。

完整受限成员清单与复现方式见 [`docs/research/read-only-context.md`](../../docs/research/read-only-context.md)。

## 测试

```bash
npm test -w @mc-toolchain/mod-common
```

`tests/tsconfig.json` 编译 `src/**` 中不依赖 `@minecraft` 的模块与测试文件，因此测试跑在纯 Node 上，不需要游戏运行时。`HudManager` 依赖游戏运行时，不做单测，仅做编译期类型检查。

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/arbiter.test.ts` | 仲裁纯函数：优先级、过期判定、放弃槽位、同优先级按 `modId` 字典序决胜、空候选 |
| `tests/run-safe.test.ts` | 调度前不执行、正常 resolve、同步抛错 reject、Promise 拒绝 reject、`runSafeDetached` 的错误路由 |
| `tests/modal-values.test.ts` | 两种下标排布、纯输入一一对应、装饰行占/不占下标、值缺失 |
| `tests/action-buttons.test.ts` | 装饰行不进入按钮下标映射、按钮顺序决定 `selection`、无回调按钮占位不报错 |
