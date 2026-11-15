# Tasks

## 1. 模组脚手架

- [x] 1.1 以 `mods/keepinventory` 为模板创建 `mods/api-probe/`:`package.json`(`@mc-toolchain/api-probe`、`version` `0.0.1`、`productName`「API 探针」、`packing: { mode: "auto", output: "../../release/" }`)、`tsconfig.json`、`eslint.config.mjs`、`.prettierrc.json`、`.env`(`PROJECT_NAME="api-probe"`)、`.vscode/`、`just.config.ts`;验证:在仓库根 `npm install` 后 `npm run build -w @mc-toolchain/api-probe` 能启动并报「找不到 scripts/main.ts」以外的错误
- [x] 1.2 创建行为包目录 `mods/api-probe/behavior_packs/api-probe/`:手写 `manifest.json`(script 模块 entry `scripts/main.js`、`dependencies` 声明 `@minecraft/server` 与 `@minecraft/server-ui`、`metadata.product_type: "addon"`)与 `pack_icon.png`;验证:`synchronizePackVersions` 能读通清单,`min_engine_version` 由 `@minecraft/server` 依赖版本推导而非手写
- [x] 1.3 在 `package.json` 里钉运行时依赖 `@minecraft/server` 2.1.0 与 `@minecraft/server-ui` 2.0.0,devDependency 加 `@mc-toolchain/mod-packaging`、`@mc-toolchain/mod-common`、`@minecraft/core-build-tasks`;在 `just.config.ts` 的 `bundleTaskOptions.external` 中列出 `@minecraft/server` 与 `@minecraft/server-ui`;验证:`npm run build -w @mc-toolchain/api-probe` 通过,产物 `dist/scripts/main.js` 中不出现除这两个官方模块外的外部导入
- [x] 1.4 创建 `scripts/main.ts` 骨架(仅一行启动日志),验证:`npm run pack -w @mc-toolchain/api-probe` 产出 `release/api-probe-v0.0.1_bp.mcpack`,解包后 `scripts/main.js` 与清单都在位

## 2. 容器读取

- [x] 2.1 实现 `scripts/ContainerReader.ts`:导出「读取结果」类型(`{ ok: true, container } | { ok: false, reason }`)与一个按「维度 + 整数坐标」读取容器的函数——取 `dimension.getBlock({x,y,z})`,方块缺失或 `getComponent("inventory")` 缺失时返回失败原因,成功时返回 `container`;验证:对石头坐标、空气坐标各调一次得到对应失败原因,对箱子坐标得到 `container`(在游戏内手工验证)
- [x] 2.2 在读取函数里用 `container.isValid` 做二次校验,并把 `container.size` 与 `container.emptySlotsCount` 一并快照返回;验证:破坏方块后再读得到失败原因而不是抛错
- [x] 2.3 实现 `scripts/ContainerSnapshot.ts`:把 `container` 遍历成快照 `{ size, emptySlotsCount, nonEmptySlots: { slot, typeId, amount }[], countedNonEmpty: number }`,单槽 `getItem` 抛错时跳过该槽并记录;验证:`countedNonEmpty` 与 `emptySlotsCount` 都能独立算出,全空容器得到空数组

## 3. 命令注册

- [x] 3.1 实现 `scripts/ProbeCommand.ts`:在 `system.beforeEvents.startup` 里用 `event.customCommandRegistry.registerCommand` 注册 `apitest:container`,`mandatoryParameters` 为三个 `CustomCommandParamType.Integer`(x/y/z),`permissionLevel: CommandPermissionLevel.GameDirectors`,`cheatsRequired: false`;验证:游戏内 `/apitest:container` 出现在命令补全里,且非操作员执行被拒
- [x] 3.2 在命令回调里取执行者玩家(非玩家则返回 `{ status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" }`),把「读取 + 打开表单」经 `runSafeDetached` 推迟到安全上下文;验证:游戏内执行命令后表单确实弹出,而不是命令返回成功却无界面
- [x] 3.3 把三个整数参数按方块坐标使用(不做取整换算,`Integer` 已保证整数),维度取 `player.dimension`;验证:在下界与主世界对同一组坐标执行,分别读到各自维度的方块
- [x] 3.4 在 `main.ts` 顶层调用注册函数,并在回调里接入 `ContainerReader` 的失败分支,把失败原因作为提示发给执行者;验证:对石头坐标执行得到「该方块没有容器」类提示,对空气坐标得到可读失败提示

## 4. 表单 UI

- [x] 4.1 实现 `scripts/ContainerForm.ts` 的概览表单:用 `ActionFormBuilder`,标题含目标坐标,正文展示 `size`、`emptySlotsCount`、`countedNonEmpty`,全空时明确写「没有非空槽位」;验证:27 槽 5 非空得到 27 / 22 / 5,全空容器得到 27 / 27 / 0 且显示空槽说明
- [x] 4.2 概览表单为每个非空槽位加一个按钮,文本形如 `槽位 13 · minecraft:diamond · ×5`,回调打开该槽位的详情表单;验证:0 槽与 13 槽各放一组物品时两条按钮分别标 0 与 13,点击进入对应详情
- [x] 4.3 实现详情表单:用 `MessageFormBuilder`,展示槽位下标、`typeId`、`amount` 与 NBT 序列化文本;序列化包 try/catch,失败显示「无法序列化」,无额外数据时显示「无额外数据」;验证:对附魔物品、普通石头各看一次,前者有序列化文本,后者显示「无额外数据」
- [x] 4.4 确认概览与详情两层表单的取消/关闭都不产生未捕获异常,且关闭后容器内容不变;验证:分别用 ESC 关闭两层表单,再核对箱子内物品种类、数量与槽位分布未变

## 5. 文档与登记

- [x] 5.1 写 `mods/api-probe/README.md`:首段声明「开发期 API 探针,不要用于正式世界」,随后给出命令签名 `/apitest:container <x> <y> <z>`、参数含义(方块坐标、维度跟随执行者)、两层表单各展示什么、以及「只读不写」的边界;验证:仅读 README 能写出正确的调用示例
- [x] 5.2 在 `mods/README.md` 与根 `README.md` 的模组表各加一行 `api-probe`;验证:对比 `mods/` 实际目录与两张表,条目一一对应

## 6. 集成验证

- [ ] 6.1 打包并导入游戏,依次验证:箱子(27 槽)、大型箱子(54 槽)、熔炉、漏斗、末影箱、全空容器、石头坐标、空气坐标、非操作员执行、下界与主世界同名坐标;验证:每种情形都符合 `specs/api-probe/spec.md` 对应场景的期望,且无未捕获异常
- [x] 6.2 确认 `min_engine_version` 由依赖推导而非手写,且清单的显示名/描述/版本与 `package.json` 一致;验证:`npm run pack` 日志打印「最低游戏版本 …(由 @minecraft/server 依赖版本 … 推导)」,`release/` 产物解包后清单字段与 `package.json` 对应

## Workflow follow-up

- 实现完成后按项目评审要求审查,再走 `openspec archive` 归档本变更。
