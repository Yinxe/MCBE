# Tasks

## 1. 颜色兼容 RGB / RGBA

- [x] 1.1 `scripts/DebugColor.ts`：`ColorComponents`（`alpha` 可选）
- [x] 1.2 `toNativeColor()`：总是补出 `alpha`（`RGBA extends RGB`，四分量是两版都接受的超集）
- [x] 1.3 `alpha` 用 `??` 而非 `||`，保住 `alpha=0`（全透明是合法值）
- [x] 1.4 `toNativeColor()` 返回新对象，不污染传入的常量
- [x] 1.5 `alphaOf()` / `hasAlpha()`：读回时缺失与存在可区分，不补默认值（这是判定运行时版本的证据）
- [x] 1.6 `describeColor()`：无 alpha 输出 `rgb(...)`，有 alpha 输出 `rgba(...)`
- [x] 1.7 `DebugShapeBuilder.ts` 全部颜色赋值改经 `toNativeColor()`
- [x] 1.8 `DebugShapeProbe.ts` 全部颜色赋值改经 `toNativeColor()`
- [x] 1.9 `DebugMotionProbe.ts` 全部颜色赋值改经 `toNativeColor()`
- [x] 1.10 `DebugCommand.ts`（`debugshow` 清单）全部颜色赋值改经 `toNativeColor()`
- [x] 1.11 `ColorComponents` 定义从 `DebugShapeBuilder.ts` 移到 `DebugColor.ts`，消除重复

## 2. 颜色探针

- [x] 2.1 `debugshape` 新增「RGB 还是 RGBA」三组并排探针
- [x] 2.2 第一组故意用三分量旧写法（该 bug 的回归测试，引擎若退回 RGB 立刻可见）
- [x] 2.3 第二组四分量 `alpha=1`，第三组四分量 `alpha=0.35`（验证透明度是否真生效）
- [x] 2.4 保留「分量范围是否夹取」探针，改为都补 `alpha`
- [x] 2.5 `DebugProbeShared.formatValue` 颜色格式化支持 alpha，带不带如实输出

## 3. 命令坐标改用 `Location`

- [x] 3.1 `scripts/CommandLocation.ts`：`CommandLocation = Vector3`，注释写清运行时真实形状（无维度、不保证整数）
- [x] 3.2 `toBlockCoordinate()`：统一 `Math.floor`（方块 `n` 占 `[n, n+1)`；负坐标 `trunc` 会错）
- [x] 3.3 `/apitest:container` 改 `<目标>`（原 `<x> <y> <z>`）
- [x] 3.4 `/apitest:box` 改 `<角点1> <角点2>`（原六个整数）
- [x] 3.5 `/apitest:debugbox` 改 `<角点1> <角点2>`（原六个整数）
- [x] 3.6 `runProbe` / `runBoxCommand` / `runDebugBoxCommand` 签名同步改为 `CommandLocation`
- [x] 3.7 `count` / `disable` 保持 `Integer`（数量与开关不是坐标）

## 4. 清除错误结论

- [x] 4.1 `BoxCommand.ts` 顶部注释：改为说明 `Location` 的正确用法与取整约定
- [x] 4.2 `DebugCommand.ts` 顶部注释：同上
- [x] 4.3 `README.md`：删除「`Location` 会导致整条命令不注册」，改为说明运行时形状与取整规则
- [x] 4.4 `README.md` 命令表：三条坐标命令的参数说明同步更新

## 5. 测试

- [x] 5.1 `tests/DebugColor.test.mjs`：三分量补出 `alpha=1`
- [x] 5.2 显式 alpha 原样保留
- [x] 5.3 `alpha=0` 不被当成缺失（钉住 `??` 与 `||` 的区别）
- [x] 5.4 可覆盖默认 alpha
- [x] 5.5 返回新对象不污染源
- [x] 5.6 默认不透明度为 1
- [x] 5.7 读回 alpha：新引擎给出数值
- [x] 5.8 读回 alpha：老引擎缺该字段
- [x] 5.9 读回 alpha：非对象/类型不对时安全返回
- [x] 5.10 颜色文本 `rgb` / `rgba` 格式
- [x] 5.11 `tests/CommandLocation.test.mjs`：整数原样
- [x] 5.12 正小数向下取整
- [x] 5.13 负小数向下而非向零
- [x] 5.14 零值
- [x] 5.15 相对坐标解析后取整
- [x] 5.16 全部 42 项测试通过（7 `BoxGeometry` + 10 `DebugShapeMath` + 10 `DebugProbeShared` + 10 `DebugColor` + 5 `CommandLocation`）

## 6. 验证

- [x] 6.1 `npx tsc --noEmit` 无错
- [x] 6.2 `npm run lint` 通过
- [x] 6.3 `npm test` 42/42 通过
- [x] 6.4 `npm run build` 成功
- [x] 6.5 `npm run pack` 产出 `release/api-probe-v0.3.0.mcaddon`
- [x] 6.6 产物内核对：`toNativeColor` 补 `alpha` 的代码存在
- [x] 6.7 产物内核对：`container` / `box` / `debugbox` 三条命令参数均为 `Location`
- [x] 6.8 产物内核对：`debuglimits` / `debugwatchdog` 仍为 `Integer`

## 7. 实机验证（待办）

- [ ] 7.1 `/apitest:debugbox` 不再报 `alpha` 错误，盒子能画出来
- [ ] 7.2 `/apitest:debugshape` 里「三分量」那组是否真的抛错（确认运行时是 RGBA）
- [ ] 7.3 `alpha=0.35` 的盒子是否明显更淡（确认 alpha 生效）
- [ ] 7.4 三条坐标命令的 `Location` 参数能正常注册（确认此前「不注册」是误判）
- [ ] 7.5 「望准方块」取点与 `~` 相对坐标可用
- [ ] 7.6 小数坐标按 `Math.floor` 落到正确方块
