# 任务：api-probe 调试线框绘制

## 1. 依赖与构建配置

- [x] 1.1 `npm install --save-exact -w @mc-toolchain/api-probe @minecraft/debug-utilities@1.0.0-beta.1.21.100-stable`
- [x] 1.2 `just.config.ts` 的 `external` 加入 `@minecraft/debug-utilities`
- [x] 1.3 `tsconfig.json` 的 `paths` 把该模块钉到 mod 本地 `node_modules`
- [x] 1.4 `behavior_packs/api-probe/manifest.json` 增加 `{ "module_name": "@minecraft/debug-utilities", "version": "1.0.0-beta" }`

## 2. 纯函数层

- [x] 2.1 `DebugShapeMath.ts`：`axisSegments` 生成三条轴段，长度 `min(AXIS_MAX_LENGTH, 该轴边长)`
- [x] 2.2 `DebugShapeMath.ts`：`labelPosition` 取盒子上方一格的水平中心
- [x] 2.3 `DebugShapeMath.ts`：`describeSize` 输出 `10×8×10` 形式
- [x] 2.4 `DebugShapeMath.ts`：`clampNumber` 夹取
- [x] 2.5 `tests/DebugShapeMath.test.mjs`：10 项断言覆盖轴方向、轴长封顶、单格不越界、文字位置

## 3. 形状构造层

- [x] 3.1 `DebugShapeBuilder.ts`：`buildDebugShapes` 返回 `DebugBox` + 3 × `DebugLine` + `DebugText`
- [x] 3.2 `DebugShapeBuilder.ts`：每个形状都设 `color` 与 `timeLeft`
- [x] 3.3 `DebugShapeBuilder.ts`：`withAxes` / `withLabel` 开关，便于单独画盒体
- [x] 3.4 `DebugShapeBuilder.ts`：`durationSeconds` 与 `sizeScale` 都夹到合法区间

## 4. 绘制层

- [x] 4.1 `DebugRenderer.ts`：`playerShapes` 按玩家 id 记账，重复执行先清旧形状（避开重复 `addShape` 崩溃）
- [x] 4.2 `DebugRenderer.ts`：`removeShapes` 逐个 `remove()`，不用 `removeAll()`（避开空列表崩溃与误清他人形状）
- [x] 4.3 `DebugRenderer.ts`：`drawDebugBox` 部分失败时回滚已加入的形状
- [x] 4.4 `DebugRenderer.ts`：`clearAllShapes` / `clearPlayerShapes`

## 5. 命令层

- [x] 5.1 `DebugCommand.ts`：`/apitest:debugbox` 六必填整数 + 秒数 + 尺寸系数，超边长上限拒绝绘制
- [x] 5.2 `DebugCommand.ts`：`/apitest:debugshow` 在玩家面前摆开 6 种形状，逐个独立成败
- [x] 5.3 `DebugCommand.ts`：`/apitest:debugclear` 清空本模组形状
- [x] 5.4 三条命令都用 `CommandPermissionLevel.GameDirectors` + `cheatsRequired: false`
- [x] 5.5 三条命令都经 `runSafeDetached` 推迟到安全 tick，回调内重判 `player.isValid`
- [x] 5.6 `main.ts` 挂上 `registerDebugCommands()`

## 6. 文档

- [x] 6.1 `README.md` 首屏标注 beta 模块与 Beta APIs 实验开关要求
- [x] 6.2 `README.md` 命令表补三条新命令
- [x] 6.3 `README.md` 新增「调试线框」章节：5 个形状的构成、与粒子版的对比表、尺寸系数、版本限制表、三个引擎缺陷
- [x] 6.4 `README.md` 已知边界补「不持久」与「1.21.100 能力上限」

## 7. 验证

- [x] 7.1 `npm run lint` 通过（eslint + prettier）
- [x] 7.2 `npm test` 通过（17 项：7 项 BoxGeometry + 10 项 DebugShapeMath）
- [x] 7.3 `npm run build` 通过，产物里保留 `@minecraft/debug-utilities` 为外部导入
- [x] 7.4 `npm run pack` 产出 `release/api-probe-v0.3.0.mcaddon`，解包确认行为包清单含 `@minecraft/debug-utilities` 依赖
- [x] 7.5 确认打包后 `min_engine_version` 仍为 `[1,21,100]`，未被抬高

## 8. 游戏内验证（需实机）

- [ ] 8.1 开启 Beta APIs 实验后，`/apitest:debugbox 100 64 -20 109 71 -11` 能看到盒体线框
- [ ] 8.2 确认 `DebugBox.bound` 是全宽还是半宽；若框大一倍，用 `尺寸系数 0.5` 验证标定有效
- [ ] 8.3 确认三色轴为红 X / 绿 Y / 蓝 Z，且从最小角出发
- [ ] 8.4 确认尺寸文字在盒子上方可见、始终朝向屏幕
- [ ] 8.5 `/apitest:debugshow` 六种形状全部出现
- [ ] 8.6 `/apitest:debugclear` 能立即清掉全部形状且不崩溃
- [ ] 8.7 连续执行两次 `debugbox` 不崩溃（验证"先 remove 再 add"）
- [ ] 8.8 秒数到期后形状自动消失，无残留
- [ ] 8.9 未开启 Beta APIs 时确认整包不加载，且内容日志报 beta 依赖错误

## 9. 收尾

- [ ] 9.1 实机通过后按需修正 8.2 的结论并同步 `README.md`
- [ ] 9.2 归档本 change，同步 `openspec/specs/api-probe/spec.md`
