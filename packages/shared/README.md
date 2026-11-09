# @mc-toolchain/shared

MCBE 行为包的共享运行时能力：文本样式码、跨包 HUD 逐玩家优先级仲裁。

模组通过 npm workspace 依赖本包，以 TypeScript 源码直接消费（`main` / `types` 均指向 `src/index.ts`），无需预编译。

## 承载范围

| 导出 | 说明 |
| --- | --- |
| `color` | `§` 颜色码与格式码常量，含语义别名（`success` / `warn` / `error` / `muted` 等） |
| `style(text, ...styles)` | 给文本加颜色/格式码，**不自动追加 `§r`** |
| `HudManager` | 跨包 HUD 管理器，逐玩家优先级仲裁（actionbar / title / sidebar） |
| `HUD_SLOTS` | 槽位常量 |
| `pickWinner` / `isStale` | 仲裁纯函数（同优先级按 `modId` 字典序决胜、心跳过期判定） |

### 刻意不包含

- 表单构建器（`ModalFormBuilder` / `ActionFormBuilder` / `MessageFormBuilder`）
- 命令注册封装（`defineCommand`）
- 玩家权限判定（`canManage`）

这些要么与具体模组的交互设计强耦合，要么尚未被第二个模组使用；等出现第二个消费方再抽，避免过早固化接口。

## 依赖约束

- **零第三方运行时依赖**：除 `@minecraft/server` 外不引入任何运行时库，避免同一世界内多个行为包各带一份实现。
- `@minecraft/server` 只作 `peerDependencies`，由消费方模组提供，保证世界内所有包共用同一份脚本 API。
- 源码需在消费方的保守编译配置下通过：`target: es6`、`module: ES2020`。本包 `tsconfig.json` 即按此自检，因此**不得使用 ES2015 之后的语法**（例如 `.at()`、可选链赋值等）。

## `HudManager` 的跨包协议不可改

`HudManager` 通过 `/scriptevent yinxe:hud` 与同一世界内的其它行为包交换槽位声明。这条协议是**运行时协定**，不是本包私有实现：

- 脚本事件标识 `yinxe:hud`、命名空间 `yinxe` 不可修改，否则会与已安装的其它包失去互认。
- 广播载荷结构（`{"m":modId,"c":{<slot>:{"p":priority,"n":names}}}`）不可修改。
- 同优先级按 `modId` 字典序小者胜的决胜规则不可修改——这是跨包避免互相压倒的唯一确定性依据。

修改上述任一项都会让同一世界中不同版本的行为包互相看不见，表现为「HUD 突然消失」。需要演进协议时，必须同步所有消费方并保留旧标识一段时间。

### 用法

```ts
import { HudManager } from "@mc-toolchain/shared";

const hud = new HudManager({ modId: "auto-refill", intervalTicks: 2, expiryTicks: 40 });

// 注册一个显示源：返回 undefined 表示「该玩家无内容」，不参与该玩家的仲裁
const unregister = hud.register({
  id: "hint",
  slot: "actionbar",
  priority: 60,
  render: (player) => (shouldShow(player) ? "已自动替换" : undefined),
});

hud.start();      // 在安全上下文调用
hud.setEnabled(false); // 暂停并释放全部声明，其它包可接管
unregister();     // 停止单个源
hud.stop();       // 全量销毁
```

`modId` 必须在同一世界的所有行为包之间唯一：它既用于总线去重，也用于同优先级决胜。

## 开发

```bash
npm run typecheck   # 类型检查（target: es6 / module: ES2020 自检）
npm test            # 编译并运行仲裁纯逻辑单测
```

`HudManager` 依赖游戏运行时，不做单测，仅做编译期类型检查；可脱离游戏环境的仲裁逻辑由 `tests/arbiter.test.ts` 覆盖。
