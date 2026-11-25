# Tasks

## 1. 共享设施

- [x] 1.1 `scripts/DebugProbeShared.ts`：`formatValue`（整数原样、小数三位、向量 `(x, y, z)`、颜色 `rgb(...)`）
- [x] 1.2 `kv` / `heading` / `verdict` / `warning` 报告格式函数
- [x] 1.3 `report()`：同一行既进聊天栏又进内容日志，日志带 `[api-probe][report]` 前缀与玩家名
- [x] 1.4 `attempt<T>()`：把抛错转成 `{ ok: false, error }`，不让一条探针失败拖垮整条命令
- [x] 1.5 `readShapeState` / `stateLines`：逐项独立读取形状状态
- [x] 1.6 `rowPositions`：在玩家面前排等间距站位，整排以视线正前方为中心，俯仰不影响水平距离

## 2. 静态探针 `debugshape`

- [x] 2.1 `DebugLine`：`location` / `endLocation` 读回；写 `endLocation` 是否跟着变；写 `scale` 是否无效
- [x] 2.2 `DebugArrow`：`headLength` / `headRadius` / `headSegments` 的默认值与写入读回
- [x] 2.3 `DebugBox.bound` 口径：四个 `bound` 不同的盒子并排，判定全宽还是半宽
- [x] 2.4 `DebugBox.scale` 作用：三个 `bound` 相同、`scale` 不同的盒子并排，判定乘算还是替换
- [x] 2.5 `DebugSphere` / `DebugCircle`：无半径属性，只能 `scale`；并排比对判定是半径倍数还是直径倍数
- [x] 2.6 `DebugText`：短文本 / 64 字符 / 含换行三种，看朝向、长度上限、换行是否生效
- [x] 2.7 `rotation` 三分量：扁长条分别只转一个分量 45°，确认各分量对应哪个轴
- [x] 2.8 `hasDuration` / `totalTimeLeft` 语义：不设 `timeLeft` 与设 30 秒两种对比
- [x] 2.9 `color` 分量范围：正常 / 超出 1 / 负值三组，看 setter 是否夹取
- [x] 2.10 `remove()` 后能否重新 `addShape`

## 3. 动态探针 `debugmotion`

- [x] 3.1 观察对象：`timeLeft = 20` 秒的 1×1×1 橙色盒子
- [x] 3.2 采样：`system.runInterval` 每 20 tick 一次，共 4 步
- [x] 3.3 第 1 步：`timeLeft` 是实时倒数还是写入值快照
- [x] 3.4 第 2 步：改 `location` 后形状是否移动
- [x] 3.5 第 3 步：改 `bound`/`scale`/`color` 后是否重新渲染
- [x] 3.6 第 4 步：末次读数 + 手动 `remove()` 收尾
- [x] 3.7 采样窗口严格短于 `timeLeft`，避开「到期后碰句柄」崩溃
- [x] 3.8 每步回执写明「该看到什么」

## 4. 规模上限 `debuglimits`

- [x] 4.1 一次画 N 个（默认 200，上限 2000），铺成 20×20 方格阵避免重叠
- [x] 4.2 首次 `addShape` 抛错即 `break` 并记录索引
- [x] 4.3 回执：请求数量、成功数量、耗时、首次失败位置、失败原因

## 5. 受限上下文 `debugcontext`

- [x] 5.1 `attemptRestrictedAdd`：MUST 由命令回调同步调用，只构造并尝试加入形状
- [x] 5.2 `reportContextProbe`：在安全 tick 里回执结论
- [x] 5.3 抛错 / 不抛错两种结论分别给出后续动作
- [x] 5.4 明确写出「不抛错 ≠ 渲染生效，仍需看画面」

## 6. 统计类探针

- [x] 6.1 `debugstats`：`collectRuntimeStats()` 关键项在前、其余折叠在后，字节数换人类可读形式
- [x] 6.2 `debugstats`：`collectPluginStats()` 逐插件列出 `packId` / `scriptModuleUUID` / 句柄计数
- [x] 6.3 `debugwatchdog`：默认保持告警开启，需显式传 `1` 才关，回执用 `§c` 提醒恢复
- [x] 6.4 `debugall`：能力总览 + 本版形状类清单 + 版本门槛说明

## 7. 命令注册

- [x] 7.1 `scripts/DebugProbeCommands.ts` 注册 7 条命令
- [x] 7.2 全部 `GameDirectors` + `cheatsRequired: false`
- [x] 7.3 只用 `Integer` / `Float` 参数（`Location` 在 2.1.0 上会导致命令不注册）
- [x] 7.4 `deferToSafeTick`：推迟到安全 tick，执行前重判 `player.isValid`，统一兜错
- [x] 7.5 `debugcontext` 例外：实验本体在回调内同步执行，回执推迟
- [x] 7.6 `main.ts` 挂上 `registerDebugProbeCommands()`

## 8. 测试

- [x] 8.1 `tests/DebugProbeShared.test.mjs`：整数原样、小数三位
- [x] 8.2 布尔与空值有可读形式
- [x] 8.3 向量格式化成 `(x, y, z)`、颜色格式化成 `rgb(...)`
- [x] 8.4 `kv` 行同时含标签与值
- [x] 8.5 站位整排以正前方为中心，间距准确
- [x] 8.6 单个元素落在正中，不受间距影响
- [x] 8.7 视线俯仰不影响水平前进距离
- [x] 8.8 视线朝任意方向时右手方向正确
- [x] 8.9 全部 27 项测试通过（7 `BoxGeometry` + 10 `DebugShapeMath` + 10 `DebugProbeShared`）

## 9. 文档与规范

- [x] 9.1 README 新增「测量命令」表（7 条）
- [x] 9.2 README 新增「两类探针的区别」对照表，写死「属性写入成功 ≠ 渲染生效」
- [x] 9.3 README 首屏 beta 警告改为覆盖全部 10 条依赖 beta 的命令
- [x] 9.4 OpenSpec 变更 `add-api-probe-capability-probes`：proposal / design / tasks / spec delta
- [x] 9.5 合并 spec delta 到 `openspec/specs/api-probe/spec.md`

## 10. 验证

- [x] 10.1 `npx tsc --noEmit` 无错
- [x] 10.2 `npm run lint` 通过
- [x] 10.3 `npm test` 27/27 通过
- [x] 10.4 `npm run build` 成功
- [x] 10.5 `npm run pack` 产出 `release/api-probe-v0.3.0.mcaddon`
- [x] 10.6 打包产物中 12 条命令名齐全

## 11. 实机验证（待办）

- [ ] 11.1 开启 Beta APIs 后 `/apitest:debugshape` 全部 10 组探针执行不崩
- [ ] 11.2 记录 `DebugBox.bound` 实测口径（全宽还是半宽）
- [ ] 11.3 记录 `scale` 是乘算还是替换
- [ ] 11.4 记录 `rotation` 三分量各对应哪个轴
- [ ] 11.5 记录 `color` 超出 0~1 时是否被夹取
- [ ] 11.6 `/apitest:debugmotion` 四步回执齐全，并记录「改属性是否真的动」
- [ ] 11.7 `/apitest:debuglimits 500` 记录实际成功数量与耗时
- [ ] 11.8 `/apitest:debugcontext` 记录受限上下文是否抛错
- [ ] 11.9 `/apitest:debugstats` 两项统计都能读出
- [ ] 11.10 `/apitest:debugwatchdog 1` 后卡顿告警消失，`0` 后恢复
- [ ] 11.11 `/apitest:debugall` 能力总览输出正确
