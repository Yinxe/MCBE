# Design

## Context

### 当前打包配置的形态

`tools/packaging.ts`(392 行)已实现:`resolvePackingConfiguration()` 读取 `package.json#packing`、`resolvePackDirectories()` 按 `manifest.json` 探测包类型、`parseVersion()`、`synchronizePackVersions()` 写回 `header.version` / `modules[].version` / 资源包依赖版本、`createPackagesByMode()` 产出三类产物、`runZipTask()` 包装 `zipTask`。

`just.config.ts` 的 `pack` 流程为:

```text
clean-build → build → synchronizePackVersions → createPackagesByMode
```

`min_engine_version` 目前**不在**这条链路里——它只存在于 `BP/keepinventory/manifest.json` 的手写值 `[1, 21, 90]`。

### 关键约束:没有官方的「API 版本 → 游戏版本」机器可读映射

调研确认(`docs/research/minecraft-server-api-versions.md`):

- `@minecraft/server` 的 `package.json` 只有自身版本,不含对应游戏版本
- `@minecraft/server` 的 `index.d.ts` 与 README 只写模块自身版本,无游戏版本
- `mct` 的数据目录(`data/` 下 `libs.json`、`mci`/`mch`、`typedefs.stable*.json`)不含该映射
- `bedrock-samples/version.json` 只有游戏版本与发布日期,**没有** API 版本字段
- 二者只能靠「同一天发布」间接对应:实测 `1.11.0→1.21.0`、`1.18.0→1.21.70`、`2.0.0→1.21.90` 等逐条吻合,但 `1.13.0` 与 `1.12.0` 同日发布,说明该规律并非严格双射

**因此推导必须依赖一张代码内静态维护的映射表**,不存在可计算或可自动获取的来源。这直接决定了 D2 与 D4 的形态。

### 现有 spec 的约束

`openspec/specs/addon-packaging/spec.md` 的「打包配置来自 `package.json` 且全部可选」要求:可选字段缺失时回落到默认值。新增字段必须遵守同一形态。

## Goals / Non-Goals

**Goals:**

- 让 `min_engine_version` 与 `@minecraft/server` 依赖版本同源,消除「声明支持低版本但用了高版本 API」的隐患
- 保持零配置可用:不写任何配置也能得到正确的 `min_engine_version`
- 保留手工覆盖能力:允许声明比 API 下限更早的版本
- 把「无法确定」显式暴露为打包错误,而不是静默写入可疑值
- 为模组图标建立可校验的约定,并用一个与功能相关的像素图标替换占位图

**Non-Goals:**

- 不引入「按 API 版本自动校验源码实际使用了哪些 API」——那是类型检查与人工评审的职责,本次只保证声明与依赖版本一致
- 不自动从网络拉取或更新映射表;映射表随代码维护,不联网
- 不改动 `packing.mode` / `output` / 包目录探测等既有行为
- 不为资源包单独提供最低版本配置(两个包共用同一值)
- 不引入图像生成依赖或构建期图像处理;图标作为静态资源提交

## Decisions

### D1:字段名 `minimum_engine_version`,值为三段数字数组

配置放在 `package.json#packing.minimum_engine_version`,类型 `[number, number, number]`。

选数组而非字符串,是为了与 Bedrock `manifest.json` 的 `header.min_engine_version` 保持完全一致的结构,避免打包时再做字符串解析,也避免 `"1.21.90"` 与 `[1,21,90]` 两种写法并存造成歧义。

命名沿用项目约定的全词风格(见 `openspec/config.yaml` 的 `context`):`minimum_engine_version` 而非 `min_engine` / `mev`。注意这里与上游字段名 `min_engine_version` 有意不同——上游是既有生态约定不可改,而这是本项目自己的配置键,按约定用全词。

**考虑的替代方案**:直接复用上游名 `min_engine_version` → 与 `manifest.json` 同名易混淆「这是配置还是清单」,且违反本项目全词约定,故弃用。

### D2:显式优先、缺省按依赖推导、无法推导则报错

解析顺序:

1. `packing.minimum_engine_version` 存在 → 校验为三段数字数组 → 直接采用
2. 否则读 `package.json#dependencies["@minecraft/server"]` → 规范化版本 → 查映射表
3. 查到 → 采用并在日志中说明推导来源
4. 查不到 / 无该依赖 / 版本号无法规范化 → **报错中止**,提示显式配置

选「报错」而非「回落到某个默认值」:最低游戏版本写错的后果是行为包在低版本客户端加载后才暴露问题,属于用户侧故障;而打包期报错能立刻定位。同理不选「回落到 `[1, 21, 90]`」——那会让任何新依赖版本都静默得到旧值,产生难以察觉的错误声明。

**考虑的替代方案**:
- 纯显式配置(不给默认值)→ 每个新模组都要手写,且仍可能写错;与「零配置可用」冲突
- 纯推导(不提供配置项)→ 无法表达「声明比 API 下限更早的版本」这种合理诉求
- 静默回落到固定值 → 掩盖错误,弃用

### D3:映射表以静态数据维护,按「API 版本 → 游戏版本」降序查找

在 `tools/packaging.ts` 内以常量数组维护,形如 `{ apiVersion: "2.0.0", minimumEngineVersion: [1, 21, 90] }`,按 API 版本降序排列。查找语义为「取不超过给定依赖版本的最大 API 版本对应的游戏版本」,使补丁位差异(如依赖写 `2.0.1`)也能落到正确档位。

映射表内容以 `docs/research/minecraft-server-api-versions.md` 记录的实测数据为准,首版覆盖 `1.11.0`(1.21.0)至 `2.11.0`(1.26.60)。

**取舍**:该表是手工维护的静态数据,`@minecraft/server` 发新版本后需要更新。这是没有官方映射数据下的必然代价;通过「查不到就报错」把维护疏漏变成显式失败,而不是错误声明。

**考虑的替代方案**:
- 从 `bedrock-samples` 或网络动态获取 → 构建期引入网络依赖,离线/CI 不稳定,且数据源本身不含 API 版本
- 用发布日期近似计算 → `1.12.0` 与 `1.13.0` 同日发布证明不成立

### D4:映射表查找按语义化版本比较,不做字符串相等

依赖版本可能带范围前缀(`^2.0.0`)或预发布后缀。规范化规则:去掉 `^`/`~`/`>=` 等前缀,取三段数字;带后缀时取前三段并告警(与既有 `parseVersion()` 的策略一致)。

比较时逐段比较数值,不比较字符串,避免 `"2.10.0" < "2.9.0"` 这类字典序错误。

### D5:写入点并入既有 `synchronizePackVersions`,不新增任务

`synchronizePackVersions()` 已经在写 `header.version` 与 `modules[].version`,最低游戏版本是同一类「把 `package.json` 的声明同步进清单」的工作。把 `header.min_engine_version` 的写入放进同一函数,而不是新增一个 `synchronizeMinimumEngineVersion` 任务,理由:

- 两者都在压缩之前、都需要读同一份配置与同一批包目录,拆开会产生重复的解析与探测
- `just.config.ts` 的 `pack` 链路已包含该步骤,无需改流程
- 保持「一次解析、一次写回」,避免两个任务对同一批 `manifest.json` 分别读改写

函数职责相应扩展为「同步 `package.json` 派生到清单的声明字段」,命名仍然贴切。

**考虑的替代方案**:新增独立任务 → 需在 `just.config.ts` 再加一步,且重复探测包目录,弃用。

### D6:未知 `packing` 字段报错,而非静默忽略

`resolvePackingConfiguration()` 校验 `packing` 的键集合,出现未知键时报错并列出该键。

理由:`minimum_engine_verison` 这类拼写错误如果被静默忽略,会落到「按依赖推导」分支并得到看似正常的结果,错误被掩盖。显式报错让配置拼写问题立刻暴露。这与 spec 中新增的「未知配置项不被静默忽略」场景对应。

### D7:图标作为静态 PNG 提交,不引入构建期生成

图标直接提交为 `BP/keepinventory/pack_icon.png`(128×128 RGBA PNG),由构建流程原样打包(现有 `createBehaviorPackArchive()` 会把包目录整体加入压缩包,图标自然包含)。

不引入图像生成库或构建期渲染:图标是低频变更的静态资源,构建期生成会增加依赖与不确定性,且像素画需要人工审美判断,不适合脚本化。

**验证方式**:用文件头解析确认格式与尺寸,不依赖额外图像库(`mct validate` 的 `CPACKICON001` 也会检查)。

### D8:图标语义设计——「死亡 + 物品保留」

按用户要求,画面表达「玩家死后背包物品仍存在」。构图取三个必要元素:

1. **墓碑/死亡标识**:像素墓碑轮廓,置于画面一侧,传达「玩家已死亡」
2. **背包/物品**:像素背包或掉落物形态的物品组,置于另一侧,且**保持完整、未散落**
3. **保留的视觉暗示**:物品组与墓碑之间用「仍在容器内」的闭合轮廓或向上的托举感表达,而非散落在地的形态

避免的构图:物品散落一地(会读成「掉落」,与本模组相反)、单纯一个爱心(无法表达死亡)、单纯文字「不掉落」(小尺寸不可辨)。

配色沿用 Minecraft 风格:石灰色墓碑、棕褐色背包、少量高饱和点缀(如绿色/金色)突出保留的物品。色板控制在 8–12 色,硬边像素块,无渐变。

## Risks / Trade-offs

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 映射表随 `@minecraft/server` 发版而过期 | 新版本依赖无法推导,`pack` 报错 | 「查不到就报错」使问题在打包期暴露;README 说明需更新映射表;显式配置可临时绕过 |
| 映射表数据本身可能不准(同天发布不是双射) | 推导出的游戏版本可能偏一档 | 首版仅收录已实测确认的条目;文档记录每条的数据来源与验证方式;显式配置可覆盖 |
| 未知字段报错可能影响既有配置 | 若用户已有其它自定义 `packing` 键,会开始报错 | 现有 `packing` 仅 `mode`/`output` 两项,无历史包袱;报错信息给出可用键列表 |
| 图标为主观产物,难以自动校验「是否反映功能」 | 风格与语义要求只能人工评审 | spec 只把可机械校验的部分(位置、格式、尺寸、非占位图)作为硬性要求;语义与风格作为评审项 |
| 图标在 64×64 以下可能糊 | 商店列表等小尺寸场景辨识度下降 | 主体元素用大块像素,避免细线;验证时缩到 64×64 目视确认 |
