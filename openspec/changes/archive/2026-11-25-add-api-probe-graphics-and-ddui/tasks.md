# Tasks

## 1. 依赖与版本

- [x] 1.1 `@minecraft/server` 2.1.0 → 2.4.0
- [x] 1.2 `@minecraft/server-ui` 2.0.0 → 2.1.0（DDUI 起点）
- [x] 1.3 `@minecraft/debug-utilities` → `1.0.0-beta.1.21.130-stable`
- [x] 1.4 新增 `@minecraft/server-graphics` 1.0.0
- [x] 1.5 `min_engine_version` `[1,21,100]` → `[1,21,130]`
- [x] 1.6 版本号 `0.3.1` → `0.3.2`（`package.json` + 两个 manifest）
- [x] 1.7 `just.config.ts` 的 `external` 加 `@minecraft/server-graphics`
- [x] 1.8 `tsconfig.json` 的 `paths` 加 `@minecraft/server-graphics`

## 2. 修升级带来的破坏性变更

- [x] 2.1 发现 `DebugShape.location` 在 1.21.130 起变为 readonly
- [x] 2.2 `DebugMotionProbe.ts` 的 `box.location = moved` → `box.setLocation(moved)`
- [x] 2.3 注释记下「1.21.100 可写、1.21.130 只读」这一版本差异

## 3. GraphicsProbeMath（纯函数层）

- [x] 3.1 `TIME_OF_DAY`：正午 0.0/1.0、日落 0.25、午夜 0.5、日出 0.75
- [x] 3.2 `SKY_KEYFRAME_COLORS`：4 个时间点的对比色
- [x] 3.3 `sortedKeyframes()`：显式按数值排序（非整数键在 JS 里按插入序枚举）
- [x] 3.4 `describeTimeOfDay()`：四个标准点各有名字，其它返回「自定义(值)」
- [x] 3.5 `isKeyframeTable()`：判据是「所有键能解析成有限数字」
- [x] 3.6 `describeSetterArgument()`：区分关键帧表 / 单色 / 单值
- [x] 3.7 `vibrantVisualsVerdict()`：`Deferred` 可下结论、其它模式不可、`undefined` 如实说无法读取
- [x] 3.8 `describeSetReset()`：set/reset 四种组合各有结论

## 4. GraphicsProbe（探针主体）

- [x] 4.1 第 0 组：渲染前提 —— 报告 `Player.graphicsMode`，判定读数可信度
- [x] 4.2 第 1 组：4 个 `getBiome*` 入口是否可调用
- [x] 4.3 第 2 组：4 个 `getPlayer*` 入口是否可调用
- [x] 4.4 第 3 组：天空色单色 vs 关键帧表 vs reset 三种写法
- [x] 4.5 第 4 组：4 个类各取一个代表方法测 set/reset 配对
- [x] 4.6 第 5 组：参数越界（0.5 / 5 / -5）是夹取还是抛错
- [x] 4.7 第 6 组：逐玩家覆盖，回执写明「该看到什么」
- [x] 4.8 `resetGraphicsProbe()`：复位全部改过的参数
- [x] 4.9 `runGraphicsProbeCommand()` / `runGraphicsResetCommand()`

## 5. ProbePanel（DDUI 面板）

- [x] 5.1 `openForms` 登记表（`Map<playerId, CustomForm>`）
- [x] 5.2 `closePanel()`：`close()` 前先判 `isShowing()`（否则抛 `FormVisibilityError`）
- [x] 5.3 `showProbePanel()`：`CustomForm` + `ObservableString` 状态行
- [x] 5.4 每个探针一个 `button(label, onClick, {tooltip})`
- [x] 5.5 按钮回调里不 `show()` 新表单 —— 从根上避开 `UserBusy`
- [x] 5.6 探针执行再套 `system.run()`（按钮回调权限语义未明确）
- [x] 5.7 `show()` 的 resolve 值检查 `UserBusy` 并明确提示
- [x] 5.8 `describePanelCapability()` 面板自检
- [x] 5.9 `debugcontext` 故意不在面板里（实验本体须在受限上下文同步执行）

## 6. 命令注册

- [x] 6.1 `/apitest:graphics [reset]`（`reset=1` 只做复位）
- [x] 6.2 `/apitest:panel`
- [x] 6.3 `buildPanelActions()`：8 个动作，按「从基础到进阶」排序
- [x] 6.4 两条命令均走 `deferToSafeTick`（graphics 全部方法都是 `no-restricted-execution`）

## 7. 测试

- [x] 7.1 关键帧按时间升序排列
- [x] 7.2 标准四个时间点齐全且有序
- [x] 7.3 时间点翻译成时段名
- [x] 7.4 非标准时间点如实说自定义
- [x] 7.5 识别关键帧表
- [x] 7.6 单色不被误判为关键帧表
- [x] 7.7 空对象与非对象都不是关键帧表
- [x] 7.8 描述关键帧表参数形态
- [x] 7.9 描述单色与单值参数形态
- [x] 7.10 `Deferred` 判定为可下结论
- [x] 7.11 非 `Deferred`（`Fancy`/`Simple`/`RayTraced`）判定为不可下结论
- [x] 7.12 读不到图形模式时如实说不知道
- [x] 7.13 set/reset 四种组合各有结论
- [x] 7.14 全部 55 项测试通过

## 8. 文档

- [x] 8.1 README 更新版本与依赖清单
- [x] 8.2 README 新增「最低引擎版本 1.21.130」警告
- [x] 8.3 README 新增「Vibrant Visuals 前提」警告
- [x] 8.4 README 命令表新增 `graphics` 与 `panel` 两行
- [x] 8.5 README beta 警告覆盖范围补上 `panel`

## 9. 验证

- [x] 9.1 `npx tsc --noEmit` 无错
- [x] 9.2 `npm run lint` 通过
- [x] 9.3 `npm test` 55/55 通过
- [x] 9.4 `npm run build` 成功
- [x] 9.5 `npm run pack` 产出 `release/api-probe-v0.3.2.mcaddon`
- [x] 9.6 产物核对：manifest 版本 `[0,3,2]`、`min_engine_version [1,21,130]`
- [x] 9.7 产物核对：5 条依赖齐全（含 `server-graphics`）
- [x] 9.8 产物核对：14 条命令全部注册
- [x] 9.9 产物核对：`@minecraft/server-graphics` 被 external、`CustomForm` 在用、`setLocation` 在用

## 10. 实机验证（待办）

- [ ] 10.1 `/apitest:graphics` 第 0 组报告出正确的图形模式
- [ ] 10.2 非 Deferred 时明确看到「读数不证明渲染生效」警告
- [ ] 10.3 4 个 `getBiome*` / 4 个 `getPlayer*` 入口全部可调用
- [ ] 10.4 天空色单色生效（天空变成品红）
- [ ] 10.5 关键帧表被接受，且天空色随时间变化
- [ ] 10.6 `resetSkyHorizonColor` 后天空恢复
- [ ] 10.7 参数越界是夹取还是抛错（观察结论）
- [ ] 10.8 逐玩家覆盖只影响自己（需第二个玩家配合验证）
- [ ] 10.9 `/apitest:graphics 1` 复位全部参数
- [ ] 10.10 `/apitest:panel` 面板正常打开
- [ ] 10.11 面板里连续点多个探针，表单不关闭
- [ ] 10.12 状态行（`ObservableString`）实时刷新
- [ ] 10.13 已有面板时再执行 `/apitest:panel` 不出现 `UserBusy`
- [ ] 10.14 「关闭面板」按钮能正常关闭
- [ ] 10.15 `debugmotion` 的 `setLocation` 能让盒子真的移动
