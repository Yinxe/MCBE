# Proposal

## Why

仓库里的每个模组都只用到 Script API 的很小一部分,想验证某个 API 在当前游戏版本上到底返回什么(容器槽位数量、物品堆叠细节、空槽、NBT 序列化文本)时,没有可以随手装上去探针的地方:要么临时往业务模组里塞 `console.warn`,污染业务代码且难以撤回;要么开 Beta APIs 实验、搭 gametest,成本远高于「看一眼数据」。

因此需要一个**开发阶段专用**的探针模组:一条带坐标参数的命令,读取该坐标方块的容器真实数据,再用 UI 把数据原样铺开显示。不追求玩法、不做持久化、不追求版本兼容矩阵。

## What Changes

- 新增模组 `mods/api-probe`(`@mc-toolchain/api-probe`),一个独立 workspace 包,按仓库现有脚手架约定构建与打包。
- 新增自定义命令 `/apitest:container <x> <y> <z>`,读取**指定坐标方块**上的容器;维度取执行者所在维度。
- 新增容器信息 UI:用 `@minecraft/server-ui` 的按钮式表单展示容器总槽位数、空槽数量,以及每个非空槽位一行(槽位下标 + 物品标识 + 数量);点击某槽位再展示该物品的详细数据(标识、数量、NBT 序列化文本)。
- 模组自带一份最小 `README.md`,写明「这是开发期探针,不要用于正式世界」以及命令用法。
- 在 `mods/README.md` 与根 `README.md` 的模组表中登记该模组。

**已按用户反馈收敛的范围**:不做视线射线检测、不做玩家物品栏兜底,只按传入坐标读取。

## Capabilities

### New Capabilities

- `api-probe`: 开发期 API 探针模组的行为契约——一条按坐标读取容器的命令、把容器数据原样呈现的 UI、以及「探针模组不得影响正常玩法」的边界约束。

### Modified Capabilities

<!-- 无。本变更不改动任何既有能力的 spec 级行为;mod-workspace 已有的「新增模组须登记进清单」要求由本变更的实现满足,而非修改。 -->

## Impact

- **新增代码**:`mods/api-probe/` 全新目录(脚手架、`scripts/main.ts`、命令注册、容器读取、表单渲染)。
- **依赖**:运行时只用 `@minecraft/server` 与 `@minecraft/server-ui`;devDependency 复用 `@mc-toolchain/mod-packaging`、`@mc-toolchain/mod-common` 与 `@minecraft/core-build-tasks`。
- **文档**:`mods/README.md`、根 `README.md` 的模组表各加一行;新增 `mods/api-probe/README.md`。
- **不影响**:既有模组、共享包与打包流水线;`release/` 产物目录只是多出一个 `api-probe-v<version>_bp.mcpack`。
- **版本门槛**:无特殊门槛。走仓库默认推导(`@minecraft/server` 依赖版本 → `min_engine_version`),不开启实验性开关。
