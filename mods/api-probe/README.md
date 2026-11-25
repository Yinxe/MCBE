# API 探针（api-probe）

**开发期 API 探针，不要用于正式世界。**

本模组不提供任何玩法功能，它只做一件事：把某个坐标处方块的容器，按 Script API 真实返回的数据原样摊开给人看。用途是在开发其它模组时核对「API 说容器里是什么」与「游戏里实际是什么」，尤其是容器自报统计与逐槽遍历结果不一致、或者某些槽位读取出错的时候。

- 包名：`@mc-toolchain/api-probe`
- 版本：`0.3.2`
- 最低引擎版本：`1.21.130`
- 脚本 API 依赖：`@minecraft/server 2.4.0`、`@minecraft/server-ui 2.1.0`、`@minecraft/debug-utilities 1.0.0-beta.1.21.130-stable`、`@minecraft/server-graphics 1.0.0`

> ⚠️ `@minecraft/debug-utilities` 是 **beta 模块**，凡是用到它的命令（`debugbox` / `debugshow` / `debugclear` / `debugshape` / `debugmotion` / `debuglimits` / `debugcontext` / `debugstats` / `debugwatchdog` / `debugall` / `panel`）都必须在世界设置里开启 **Beta APIs** 实验开关。未开启时整条脚本模块都会加载失败（内容日志会写 `requesting dependency on beta APIs ... but the Beta APIs experiment is not enabled`）。其余命令（`container` / `box` / `graphics`）不依赖 beta 模块，但同一个包里只要声明了 beta 依赖就同样受这个开关约束。

> ⚠️ **最低引擎版本是 1.21.130**，因为 `@minecraft/server-graphics` 最早出现在这个版本。若你的客户端低于 1.21.130，请使用 `v0.3.1`。
>
> ⚠️ `@minecraft/server-graphics` 改的是**延迟渲染管线参数**，要求客户端图形模式为 **Deferred（鲜艳视觉）**。非 Deferred 时 setter 往往不报错、读回值也正确，但画面完全不变。`/apitest:graphics` 的第一节会报告当前图形模式。

## 命令

| 命令 | 说明 | 参数 |
| --- | --- | --- |
| `/apitest:container <目标>` | 读取指定坐标方块的容器，用表单展示槽位与物品详情 | 必填：`目标`（Location） |
| `/apitest:box <角点1> <角点2> [秒数] [尺寸系数]` | 两个方块角点之间画 3D 框选线框（**粒子版**） | 必填：两个 `Location` 角点；可选：存活秒数（默认 10，上限 120）、尺寸系数（默认 1） |
| `/apitest:debugbox <角点1> <角点2> [秒数] [尺寸系数]` | 同上，但用 `@minecraft/debug-utilities` 的**线框版** | 同上 |
| `/apitest:debugshow [秒数]` | 在玩家面前把 debug-utilities 支持的全部形状各画一份 | 可选：存活秒数（默认 10，上限 120） |
| `/apitest:debugclear` | 清除本模组用 debug-utilities 画的全部形状 | 无 |

### 测量命令（探 API 能力）

前面几条是“画东西”，下面这几条是“测东西”——它们把 `@minecraft/debug-utilities` 的每个导出、每个参数逐项探一遍，并把“写入值 / 读回值 / 该看到什么”全部回执。

| 命令 | 探什么 | 参数 |
| --- | --- | --- |
| `/apitest:debugshape [秒数]` | **逐形状逐参数**：`DebugLine` 的 `endLocation`、`DebugArrow` 的三个头部参数、`DebugBox` 的 `bound` 口径与 `scale`、Sphere/Circle 的 scale、`DebugText` 的朝向与长度、`rotation` 三个分量含义、`hasDuration`/`totalTimeLeft` 语义、`color` 是否夹取、`remove()` 后能否重加 | 可选：存活秒数 |
| `/apitest:debugmotion` | **动态探针**：改 `location` / `bound` / `scale` / `color` 之后，已在世界上的形状会重新渲染吗？`timeLeft` 是实时倒数还是快照？ | 无 |
| `/apitest:debuglimits [数量]` | **规模上限**：一次画 N 个（默认 200，上限 2000），看加到第几个失败、耗时多少 | 可选：数量 |
| `/apitest:debugcontext` | **受限上下文**：在命令回调里**直接**调 `addShape` 会不会抛错 | 无 |
| `/apitest:debugstats` | **运行时统计**：`collectRuntimeStats()` 的内存/对象数、`collectPluginStats()` 的各插件句柄计数 | 无 |
| `/apitest:debugwatchdog <0\|1>` | **看门狗告警**：`1` 关闭（压测用），`0` 恢复 | 可选：`0` 或 `1` |
| `/apitest:debugall` | **能力总览**：哪些导出可用、本版有哪些形状类 | 无 |
| `/apitest:graphics [reset]` | **`server-graphics` 探针**：先报告图形模式，再测 4 个 `getBiome*` / 4 个 `getPlayer*` 入口、天空色单色 vs 关键帧、set/reset 配对、参数越界行为、逐玩家覆盖 | 可选：`reset=1` 只做复位 |
| `/apitest:panel` | **DDUI 面板**：把全部探针做成按钮，点按钮后表单不关闭，可连续执行 | 无 |

#### 两类探针的区别（很重要）

| | 静态探针（`debugshape`） | 动态探针（`debugmotion`） |
| --- | --- | --- |
| 能证明 | JS 侧 setter **存下了值** | 渲染器**真的读了这个值** |
| 读回一致 | ✅ | ✅ |
| 画面变化 | ❓ 不知道 | ✅ 直接看到 |

**属性写入成功 ≠ 渲染生效。** 读回一致只能说明 setter 存下了值，不说明渲染器读了它。所以两条命令都要跑：`debugshape` 看读数，`debugmotion` 看画面。

坐标参数统一用 `Location`，不是三个 `Integer`。好处是玩家既能直接敲坐标，也能「望准方块」取点，还能用 `~` 相对坐标；命令签名也从 8 个参数降到 4 个。

运行时回调收到的是 `{ x, y, z }` 形状的对象——**不带维度**（维度跟随执行者），**也不保证是整数**（可以写 `100.7 64.2 -20.9`），所以取整要自己做，统一用 `Math.floor`（方块 5 占 `[5, 6)` 区间；负坐标下 `floor` 也正确，`trunc` 会错）。详见 `scripts/CommandLocation.ts`。

要点：

- **维度跟随执行者**：命令没有维度参数，读的就是执行者当前所在维度的那个坐标。下界与主世界同名坐标是两处方块，分别读各自维度里的那一个。
- **只能由玩家执行**：控制台与命令方块执行会返回失败「该命令只能由玩家执行」——因为没有执行者就没有「跟随的维度」，也没有接收表单的人。
- **不需要开启作弊**：权限等级为游戏导演（操作员），`cheatsRequired` 为 `false`。为看一眼容器而被迫开作弊、进而丢成就是不必要的代价。
- **只读不写**：整个模组不调用任何 `setItem`、不修改方块、不写动态属性。看多少次都不会改变容器内容。

示例：

```text
/apitest:container 120 64 -35
```

## 两层表单

### 第一层：概览

列出坐标、方块标识，以及三处统计：

- `总槽位`：容器的 `size`
- `空槽(API emptySlotsCount)`：容器自报的空槽数量
- `非空槽(遍历统计)`：逐槽调用 `getItem` 数出来的非空槽数量

**两个空槽数字并列展示是本模组存在的理由。** 正常情况下「总槽位 − 非空槽」应当等于 `emptySlotsCount`；一旦不等，概览页会多出一行黄色提示把差异直接写出来。这不是显示 bug，而是探针要暴露的 API 行为差异。同理，任何单个槽位读取抛错都会被计入并在概览页列出槽位号，而不是让整个命令失败。

每个非空槽位对应一个按钮，标题形如 `槽位 3 · minecraft:diamond · ×12`。点进去看该槽位的详情。

### 第二层：槽位详情

逐字段列出该槽位物品可观测到的全部状态：标识、数量、自定义名、附魔、耐久、锁模式、死亡保留、最大堆叠、标签、Lore、可破坏方块、可放置于、动态属性、组件列表。

每个字段独立读取、独立降级：某一项读失败只把那一项标成「读取失败(原因)」，其余字段照常展示，末尾再汇总一行「无法序列化:…」。这样即使遇到有问题的物品，也能看到它坏在哪一项。

点击时**重新读一次目标容器**，而不是复用概览页的快照——从概览页到点击之间容器可能已经变了。如果重新读取失败（容器被破坏、区块卸载、槽位已被清空），详情页会用概览页记录的标识与数量兜底展示，并明确说明实时读取失败，不假装数据是最新的。

详情页是只读的，`返回` 与 `关闭` 都只是关掉它，不会打开第三层。

## 3D 框选线框

`/apitest:box` 用**纯粒子**在指定区域上画出半透明盒子 + 12 条棱线 + 最小角 XYZ 三色轴，不放置方块、不写世界、不需要还原。

```text
/apitest:box 100 64 -20 109 71 -11          ← 两个角点
/apitest:box 100 64 -20 109 71 -11 30       ← 再加存活 30 秒
```

坐标是整数方块坐标，负坐标按 `floor` 归到所在方块（`-20.9` 属于 `-21` 号方块）。


### 尺寸系数（`scale` 参数）

`particle_appearance_billboard.size` 到底是**半径**还是**全宽**，官方文档没有写清，不同来源的说法互相矛盾。本模组按「半径」实现（`size` 传半尺寸），但留了一个现场可调的系数：

```text
/apitest:box 100 64 -20 109 71 -11 10 0.5    ← 框大了一倍时
/apitest:box 100 64 -20 109 71 -11 10 2      ← 框小了一半时
```

系数只乘在**尺寸**（面片宽高、棱线长度）上，位置始终落在盒子边界，所以调它不会让框跑偏，只会让面片/棱线在边界内伸缩。试出正确值后，把它写成 `BoxRenderer.ts` 里的默认值即可。

`tools/verify-box-geometry.mjs` 可以在不启动游戏的情况下校验跨度，配合 `SIZE_SCALE` 环境变量验证任意系数：

```bash
node tools/verify-box-geometry.mjs            # 按 k=1 校验
SIZE_SCALE=0.5 node tools/verify-box-geometry.mjs
```

### 实现要点（改粒子时必读）

资源包里有三个粒子文件，职责分离：

| 文件 | 标识 | 作用 |
| --- | --- | --- |
| `box.particle.json` | `apitest:box` | **驱动粒子**：自身不渲染，只在第 0 帧把 18 个子发射器全部发出 |
| `box_face.particle.json` | `apitest:box_face` | 一个半透明面片 |
| `box_edge.particle.json` | `apitest:box_edge` | 一条棱线（绕轴转向相机的柱面 billboard） |

三个必须注意的坑：

1. **`t.*` 不支持 struct。** 驱动粒子要在 `pre_effect_expression` 里读父级变量（`v.size_x` 等）再转发给子发射器，中间的暂存只能用 `t.*`，而 `t.*` 不能带 `.x`。因此**全部变量都必须是独立标量**，不能用 `setVector3` / `setColorRGB` 生成 `v.size.x` 这类 struct —— 那样在暂存环节会断掉。
2. **`pre_effect_expression` 里的 `v.*` 写的是子发射器的变量**，不是父级的。读父级必须走 `t.*`（`t` 在同一次 `sequence` 内共享）。
3. **面片要画两遍。** 材质 `apitest_blend_cull` 从 `particles_blend` 里**去掉**了 `DisableCulling`，于是背面剔除生效：朝外那遍只在盒外可见，朝内那遍只在盒内可见，同一面片得到内外两层不同浓度。这是省 draw call 的手段，不是冗余。

变量名在 `scripts/BoxRenderer.ts#buildBoxMolang` 与粒子的 `emitter_initialization` 里各写一遍，**改一处必须同时改另一处**。

## 调试线框（`@minecraft/debug-utilities`）

`/apitest:debugbox` 画**同一个盒子**，但走的是完全不同的渲染路径：`@minecraft/debug-utilities` 的 `debugDrawer` 直接把形状塞给客户端渲染，不用粒子、不用资源包、也不用连接 VS Code 调试器。

```text
/apitest:debugbox 100 64 -20 109 71 -11        ← 盒体 + 三色轴 + 尺寸文字
/apitest:debugbox 100 64 -20 109 71 -11 30     ← 存活 30 秒
/apitest:debugshow 20                          ← 面前摆一份全部形状
/apitest:debugclear                            ← 立即清掉
```

一次 `debugbox` 会画出 5 个形状：

| 形状 | 内容 |
| --- | --- |
| `DebugBox` | 盒体线框（`bound` = 真实边长，`scale` = 尺寸系数） |
| `DebugLine` × 3 | 最小角的三色坐标轴：X 红、Y 绿、Z 蓝，长度取 `min(4, 该轴边长)` |
| `DebugText` | 盒子上方一格的尺寸文字，如 `10×8×10`，始终朝向屏幕 |

`/apitest:debugshow` 是**版本探针**：它把当前 `@minecraft/debug-utilities` 类型定义里有的形状（`DebugLine`、`DebugArrow`、`DebugBox`、`DebugSphere`、`DebugCircle`、`DebugText`）各画一份。少一个就说明装的模块版本与代码不匹配，比翻 `.d.ts` 快。

### 与粒子版的区别

| | `/apitest:box`（粒子） | `/apitest:debugbox`（线框） |
| --- | --- | --- |
| 依赖 | 资源包 + 3 个粒子文件 | beta 模块，需开 Beta APIs |
| 半透明填充面 | 有 | 无，纯线框 |
| 可见范围 | 所有玩家 | 所有玩家（1.21.100 无 `dimension`/`visibleTo` 参数） |
| 文字 | 无 | 有 |
| 正式发布可用 | 是 | **不建议**，beta 会 breaking |

两条命令画的盒子位置、尺寸、三色轴完全一致，适合横向对比两种渲染路径的效果与开销。

### 尺寸系数同样适用

`DebugBox.bound` 官方只写了「最终盒子 = bound × scale」，没说 `bound` 本身是全宽还是半宽。所以 `bound` 一律填真实边长，口径问题同样交给第二个可选参数：实测框大一倍就传 `0.5`，小一半就传 `2`。**与粒子版的 `尺寸系数` 是同一套约定**，现场一次就能标定。

### 版本限制（`1.0.0-beta.1.21.100-stable`）

本模组钉在 `1.21.100` 版的模块上，以匹配 `min_engine_version [1,21,100]`。这一版比后来的版本少不少东西：

| 能力 | 1.21.100 | 首次出现 |
| --- | --- | --- |
| `color` 带 alpha（半透明） | ✗ 只有 `RGB` | 1.26.60 |
| `addShape(shape, dimension)` 指定维度 | ✗ 全部维度可见 | 1.21.130 |
| `visibleTo` / `hiddenFrom` 限定可见玩家 | ✗ | 1.26.0 / 1.26.60 |
| `DebugCone` / `DebugCylinder` / `DebugEllipsoid` / `DebugPyramid` | ✗ | 1.26.60 |
| `diagnosticsManager` | ✗ | 1.26.60 |

要这些能力就得同时抬高 `min_engine_version`，那会让模组在旧版游戏上直接不可用。开发期调试模组不值得为半透明付这个代价，所以本版保持 `1.21.100`。

### 三个引擎缺陷与对应写法

`DebugRenderer.ts` 里的所有防御性写法都不是防御性编程习惯，而是踩过的坑。**这些是原生层崩溃，不是 JS 异常——`try/catch` 抓不到，游戏直接退出。** 所以写法只能是「不去触发」，不能靠兜底：

1. **同一 shape 实例重复 `addShape` → 崩溃。** 所以重复执行命令时先 `remove()` 旧形状再 `addShape` 新的，而不是直接再画一个。
2. **形状列表为空时调 `removeAll()` → 崩溃。** 所以只用逐个 `remove()`，不用 `removeAll()`。顺带避免了误清其它插件画的形状。
3. **对已到期的形状再 `remove()` → 有崩溃风险。** 形状带 `timeLeft`，到期后引擎已自行移除句柄；此时再碰它就是操作已失效的原生句柄。所以 `activeShapes` 记的是 `{ shape, expiresAt }`，`removeShapes` 先比时间戳，**过期的不碰，只从账上划掉**。
4. **绘制代码被注释掉后热重载 → 崩溃。** 所以每个形状都设了 `timeLeft`，脚本即使被热重载掉也会自行到期。

另外，在 `worldLoad` / `world.afterEvents` 里**立即**绘制会出现「服务端有数据、客户端不显示」，所以本模组的绘制全部推迟到安全 tick（`runSafeDetached`）。

### 能否在受限上下文调用

**类型定义里查不到答案。** `@minecraft/server` 2.1.0 用散文标注受限成员（335 处 `can't be called in read-only mode`），但 `@minecraft/debug-utilities` **从 1.21.100 到 1.26.60 一个这样的标注都没有**——新版也只有 `diagnosticsManager` 的一条 `@privilege`，`debugDrawer` 相关成员完全没标。

没标注有两种可能：真不受限，或只是没标。因此本模组不赌：**所有 `addShape` / `remove()` 调用都在 `runSafeDetached` 推迟后的安全 tick 里**，不在命令回调或 `beforeEvents` 里直接碰。代价是零，换掉一个未验证的前提。

### 不持久

线框只存在于客户端渲染层：不写方块、不写动态属性、不进存档。世界重载、切换维度或脚本热重载后一律消失。

## 已知边界

- **没有 NBT 文本**：`@minecraft/server 2.1.0` 没有公开的 NBT 读写接口（`getNbt` / `saveToNbt` 在后续版本才出现，本模组刻意不追 beta）。详情页展示的是由公开只读接口拼出的结构化快照，覆盖玩家实际能观测到的状态，但不是原始 NBT。
- **只读单个方块**：不做视线射线检测，也不扫描附近容器。要看哪个容器就传哪个坐标。
- **区块必须已加载**：坐标处区块未加载时方块读不到，命令会提示「没有方块（超出世界边界，或区块未加载）」。框选绘制同样受此限制，未加载区块处 `spawnParticle` 会失败并给出提示。
- **框选不持久**：粒子到时间自然消失，重登或重进维度不会恢复。需要长看就传一个更长的秒数。
- **调试线框同样不持久**：`debugDrawer` 的形状在世界重载、切维度、脚本热重载后全部消失，需要重画。
- **调试线框只在 1.21.100 的能力范围内**：无色透明度、无维度限定、无按玩家可见性，详见上文版本限制表。

## 开发

```bash
npm run build  -w @mc-toolchain/api-probe   # 编译并打包到 dist/
npm run lint   -w @mc-toolchain/api-probe   # eslint + prettier
npm run pack   -w @mc-toolchain/api-probe   # 产出 release/api-probe-v<版本>.mcaddon
npm run test   -w @mc-toolchain/api-probe   # BoxGeometry + DebugShapeMath 单测(需先 build)

# 不启动游戏校验框选几何跨度(配合 SIZE_SCALE 可验证任意尺寸系数)
node mods/api-probe/tools/verify-box-geometry.mjs
```

产物有三个外部依赖：`@minecraft/server`、`@minecraft/server-ui`、`@minecraft/debug-utilities`。`mod-common` 等共享包会被打进同一个 bundle。
