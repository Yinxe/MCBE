# Design

## Context

动机见 `proposal.md`。这里只记录塑造实现方案的现状与约束:

- 仓库模组统一由 `@minecraft/core-build-tasks` + `@mc-toolchain/mod-packaging` 构建打包,清单的 `min_engine_version` 由 `packages/mod-packaging/src/versions.ts:144` 的 `resolveMinimumEngineVersion` 从 `@minecraft/server` 依赖版本推导;模组内不手写打包逻辑。
- 共享包 `packages/mod-common` 已提供 `ActionFormBuilder`(按钮式菜单,回调经 `runSafe` 在安全上下文执行)、`runSafe` / `runSafeDetached`(推迟到 `system.run`)、界面消息助手。`mods/auto-refill/scripts/AdminMenu.ts:125-150` 是「命令回调 → `system.run` → 打开表单」的现成范例。
- 自定义命令的注册入口是 `system.beforeEvents.startup` 的 `event.customCommandRegistry.registerCommand`;参数类型来自 `CustomCommandParamType`(`Float` / `Integer` / `Location` 等),回调签名 `(origin: CustomCommandOrigin, ...args: any[])`。
- `Container`(`@minecraft/server` 2.x)提供 `size`、`emptySlotsCount`、`getItem(slot)`、`isValid`;方块侧经 `Block.getComponent("inventory")` 取 `BlockInventoryComponent.container`。
- 自定义命令回调属于受限上下文,`subscribe`、表单 `show()`、`Container.getItem` 等受限调用不能直接在回调里执行。

## Goals / Non-Goals

**Goals:**

- 一条命令 + 两层表单,覆盖「容器概览 → 单槽位详情」这条核对路径。
- 读取逻辑与渲染逻辑分离,使容器读取可以被单独替换或扩展(后续加实体容器、末影箱等)而不动 UI。
- 复用共享包,使该模组的代码量保持在「脚手架 + 两个模块」的量级。

**Non-Goals:**

- 不做视线射线检测、不做玩家物品栏兜底(用户已明确收敛)。
- 不做维度参数、不做跨维度读取。
- 不做数据导出(写文件、复制到剪贴板)、不做编辑/写入容器。
- 不做单元测试与 gametest:探针的价值在于「装进游戏里看一眼真实返回值」,脱机测试覆盖不到真实 API 返回。

## Decisions

### 坐标参数用三个 `Integer`,而不是一个 `Location`

`CustomCommandParamType.Location` 也能一次拿到 x/y/z,但它允许玩家传相对坐标(`~ ~ ~`)与小数,且不携带维度信息,取整规则也要自己定。用三个 `Integer` 让游戏侧完成「必须给整数」的校验,命令签名 `/apitest:container <x> <y> <z>` 也更贴合「我就想看这个方块」的用法。方块坐标本身是整数,非整数输入本就无意义。副作用是失去 `~` 相对坐标,但对探针场景是可接受的取舍——需要相对坐标时玩家自己按 F3 读坐标。

### 维度取执行者所在维度,不开放维度参数

`CustomCommandParamType` 没有维度类型,要做维度参数就得用 `Enum` 手写三个维度名并自行映射。探针场景下「站在哪就读哪」已经够用,而且省掉一整层参数校验。控制台/命令方块执行者没有维度,因此命令限定为玩家执行(与权限等级 `GameDirectors` 一致)。

### 用 `BlockInventoryComponent.container` 而不是 `EntityInventoryComponent`

`Container` 是两者的公共抽象。命令的目标是方块,所以只走方块分支;读取层仍返回统一的 `Container`,使将来加实体容器时 UI 层零改动。

### 两层表单:概览用 `ActionFormBuilder`,详情用 `MessageFormBuilder`

概览需要「每个非空槽位一个可点按钮」,`ActionFormBuilder.button(text, callback)` 正好把回调绑定在按钮上,调用方不需要自己维护下标映射。详情是纯只读展示,`MessageFormBuilder` 的双按钮语义(返回 boolean)足够。

**备选**:概览用 `ModalFormData` 的 `dropdown` 选槽位。否决原因:下拉框只返回下标,还得二次映射;而且槽位多时滚动体验差于按钮列表。

**备选**:全部用裸 `ActionFormData` / `MessageFormData`。否决原因:会绕过 `runSafe`,表单回调里再开下一个表单时容易踩受限上下文。

### NBT 序列化放在详情页,不在概览页

`ItemStack` 没有公开的 NBT 读取接口,能拿到的最接近「原始数据」的是物品自身的序列化文本。逐槽位序列化在概览页会对每个槽位都算一遍,槽位多时明显卡顿;放进详情页则只在玩家真正想看时才计算。序列化包在 try/catch 里,单个物品失败降级为「无法序列化」,不影响其它槽位。

### 空槽与总槽位取自 `Container`,不硬编码 27/54

`container.size` 与 `container.emptySlotsCount` 是 API 的真实返回值——这正是探针要验证的东西。硬编码常量会让探针在「API 返回了意外值」时反而掩盖问题。

### 复用 `@mc-toolchain/mod-common`,不复制一份表单与 `runSafe`

`mods/auto-refill` 等 5 个模组已这么做,复制会产生第二套受限上下文处理逻辑。代价是该模组多一条 workspace devDependency,以及 `just.config.ts` 的 `external` 要加上共享包所用的官方模块(已由 `@minecraft/server` / `@minecraft/server-ui` 覆盖)。

## Risks / Trade-offs

- **命令名与参数是最易变的部分** → 在 README 里写清签名与示例,参数语义变更时同步改 README;不引入别名。
- **`emptySlotsCount` 在某些容器实现上可能与逐槽位统计不一致** → 概览页同时展示 `emptySlotsCount` 与「按 `getItem` 遍历统计出的非空槽数」,两者不一致本身就是有价值的探针输出。
- **大容器(54 槽)全满时按钮列表很长** → 接受;这是核对数据的代价,必要时后续加「只列非空槽」开关(当前已经只列非空槽)。
- **共享包版本与模组钉的 `@minecraft/server` 版本不一致会出类型错** → 模组钉与 `mods/auto-refill` 相同的 `@minecraft/server` 2.1.0 / `@minecraft/server-ui` 2.0.0,共享包的 `peerDependencies` 是 `>=2.0.0`,兼容。
- **`registerCommand` 只在 `startup` 阶段可用,写错位置会静默无命令** → 实现时照抄 `mods/auto-refill/scripts/AdminMenu.ts` 的 `system.beforeEvents.startup.subscribe` 结构,并在 `main.ts` 顶层立即调用注册函数。
