# Design

## Context

见 `proposal.md` — Why。设计只处理三件约束:

1. **上游工程体系与本仓库冲突**。上游用 `BP/Teleporter` 缩写目录、外部 pnpm workspace 包 `@yinxe/toolkit`、自带 `just-scripts mcpack` 打包入口、以及一份自相矛盾的清单。本仓库要求 `behavior_packs/` 全名目录、打包逻辑只存在于 `@mc-toolchain/packaging`、版本号唯一来源为 `package.json`。
2. **界面层归属未定**。`packages/shared` 的 README 把三种表单构建器列为「等第二个消费方再抽」。传送模组是第二个消费方,`auto-refill` 已经在直接使用原生 `ModalFormData`。
3. **API 可用性有硬门槛**。传送点需要 `Dimension.getBiome`(群系检测)。实测 `@minecraft/server` 的类型声明:该方法在 `2.0.0`/`2.1.0`/`2.2.0` 中**不存在**,自 `2.3.0` 起出现;`customCommandRegistry` 自 `2.1.0` 起出现;`Player.playerPermissionLevel` 自 `2.1.0` 起出现;`ItemLockMode`、`keepOnDeath`、`getLore`/`setLore`、`itemUse`/`playerInteractWithBlock` 前置事件、`playerSpawn.initialSpawn`、`entityDie.deadEntity` 在 `2.0.0` 起即存在。

## Goals / Non-Goals

**Goals:**

- 迁移后行为与上游 v0.0.6 对等:16 条 `/tpa:*` 命令、7 组界面、信物、死亡点、TPA 超时语义全部保留。
- 表单封装在仓库内只有一份实现,且落在 `packages/` 而不是模组目录里。
- 领域逻辑(排序、裁剪、请求簿、映射)可在无游戏运行时的情况下被 `node --test` 覆盖。
- 清单、`package.json`、打包配置三处版本与最低游戏版本自洽。

**Non-Goals:**

- 不改变上游的交互设计(不新增权限门、不把玩家传送改成需要对方同意)。
- 不把 `HudManager` 或样式码搬进新包,也不重构 `packages/shared` 已有实现。
- 不为 `auto-refill` 改造它的 `AdminMenu`:本次只提供可用的共享界面包,是否切换由后续独立改动决定。
- 不做存档格式迁移工具:上游 DynamicProperty 的键与结构原样沿用,已有世界的数据继续可读。

## Decisions

### D1: 界面层新建 `packages/ui`,而不是塞进 `packages/shared`

新建 `@mc-toolchain/ui`,承载三种表单构建器、安全上下文执行助手与界面消息助手。

**理由**:`packages/shared` 的定位是「跨包运行时仲裁」,其 `HudManager` 依赖 `/scriptevent yinxe:hud` 这条**不可改的跨包协议**;表单构建器与协议无关,只是 API 封装。把两者混在一个包里会让「协议不可改」的约束意外覆盖到表单代码,也会让只想用 HUD 的模组被迫带上 `@minecraft/server-ui` 依赖。分成两个包后,依赖边界与职责边界一一对应。

**备选**:把表单构建器加进 `packages/shared`。否决理由:需要同时改 `shared-runtime` 规格、`packages/shared/README.md` 的「刻意不包含」一节,且会让 `shared` 的对等依赖从「仅 `@minecraft/server`」扩到「加 `server-ui`」,扩大所有消费方的依赖面。

**备选**:不加包,各模组直接用原生 API。否决理由:`auto-refill` 已经在写 `response.formValues` 的下标解构,传送模组有 7 组界面、字段数不一,下标解构在两个模组里会各自漂移。

### D2: `@minecraft/server` 定 `2.3.0`,`minimum_engine_version` 显式 `[1,21,120]`

**理由**:群系检测是上游既有功能,且 `biomeInfo` 会写进传送点记录、参与列表展示与分类推荐。丢掉它会让既有世界里的传送点全部显示「未知」,属于行为退化。`getBiome` 自 `2.3.0` 起存在,对应游戏 `1.21.120`,与上游清单的 `min_engine_version [1,21,120]` 恰好一致,因此**门槛不收紧**。

显式写 `minimum_engine_version` 而不依赖推导,是因为推导值会随依赖版本静默漂移;显式声明把门槛钉在配置里。

**备选**:降到 `2.1.0` / `[1,21,100]` 并放弃群系检测。否决理由:既有世界的传送点群系信息不可读,且创建时的「根据群系自动推荐分类」失效。

**备选**:`2.1.0` + 运行时特性侦测(`if (typeof dimension.getBiome === "function")`)。否决理由:`2.1.0` 的类型声明里根本没有 `getBiome`,要写这段侦测必须 `as any` 绕过类型系统;而代价只是把门槛从 1.21.100 抬到 1.21.120,换不来真实覆盖面。

**注意**:`dependencies[].version` 是手写常量,`packages/packaging` **不会**同步它。`package.json#dependencies["@minecraft/server"]`、清单 `dependencies[].version`、`packing.minimum_engine_version` 三者必须同时改。

### D3: 保留上游包与模块 UUID,版本继承 `0.0.6`

`manifest.json` 的 `header.uuid`、两个 `modules[].uuid` 原样沿用;`package.json#version` 与清单版本为 `0.0.6`(由 `synchronizePackVersions` 派生为 `[0,0,6]`)。

**理由**:UUID 是行为包在玩家世界中的身份。换 UUID 会让已安装上游版本的世界把新产物当成另一个包,而不是升级。版本号按 `mod-workspace`「迁移模组保留原版本号」不重置为 `0.0.1`。

**备选**:重新生成 UUID。否决理由:只在需要与上游彻底割裂时才必要,本次是迁移而非另起。

### D4: 按「是否接触 `@minecraft` API」分 `core` / `mc` 两层,沿用仓库已有先例

目录按**依赖方向**划分,而不是按「命令 / 事件 / 界面」划分:

```
scripts/
  core/                      纯逻辑,零 @minecraft 依赖,可 node 单测
    types.ts                 传送点、死亡点、玩家数据、请求、配置的类型
    config.ts                默认值、DynamicProperty 键名、上限、载荷归一化
    waypoints.ts             传送点增删改、重名与上限校验、排序
    deathPoints.ts           死亡点记录、上限裁剪、排序
    requests.ts              TPA 请求簿:按目标覆盖、超时、惰性清理
    naming.ts                群系与维度中文映射、位置格式化
    token.ts                 信物的名称/描述常量与识别判定
  mc/                        适配层,唯一接触 @minecraft 的地方
    store.ts                 动态属性读写
    detection.ts             getBiome 检测、管理员判定
    teleport.ts              传送执行与结果反馈
    token.ts                 信物的物品创建与发放
    commands.ts              16 条命令的注册与玩家来源守卫
    events.ts                死亡、重生、物品使用三类订阅
    ui/                      本模组的 7 个屏幕
      menu.ts  warps.ts  publicWarps.ts  deathpoints.ts
      playerTeleport.ts  admin.ts  teleportRequest.ts
  main.ts                    组合根:startup 一次性注册命令与事件
```

依赖方向单向:`mc/` 可以 import `core/`;`core/` MUST NOT import `mc/` 或任何 `@minecraft/*` 模块。

**理由**:

1. `mods/spectator-mode` 已用 `scripts/core/`(纯逻辑)+ `scripts/mc/`(适配层)+ `main.ts`(组合根)这套划分,`tests/tsconfig.json` 的 `include` 直接写 `../scripts/core/**/*.ts`。本仓库内两套分层并存会让新模组各自为政,而 `core` / `mc` 把「可单测边界」直接编码进目录名,比 `domain` 这类自造词更不易误判。
2. 按「命令 / 事件 / 界面」切会让同一件事被劈到两处:16 条命令的实体逻辑极薄(解包参数 → 调适配层或纯逻辑 → 返回结果),独立成 `commands/` 目录后,它和 `events/` 都只是在做「注册与订阅」这一件适配层的事。
3. 上游把同一功能的两半散在不同目录(`commands/tpa.ts` 224 行同时含请求簿与命令注册,`ui/warps.ts` 280 行同时含表单与 CRUD 调用,`teleporter/detection.ts` 把群系映射表与 `getBiome` 调用混在一起)。按依赖方向切之后,请求簿与映射表自动落到 `core/`,单测才可能不依赖游戏运行时。

**命名消歧**:`packages/ui` 是跨模组共享的表单封装(见 D1);`scripts/mc/ui/` 是本模组的 7 个屏幕,只在本模组内可见。两者不是同一层,也不互相 import。

**保留的是上游的文件职责,不是目录形状**:`commands/tpa.ts` 的请求簿 → `core/requests.ts`,`teleporter/detection.ts` 的映射表 → `core/naming.ts`,`teleporter/token.ts` 的识别判定 → `core/token.ts`(物品创建留在 `mc/token.ts`)。

**备选**:按上游 `commands/` / `events/` / `ui/` / `domain/` 平移。否决理由:与 `spectator-mode` 已有的 `core` / `mc` 分叉,读者要同时记住两套分层;且 `commands/` 与 `events/` 目录内几乎全是注册样板,真正的逻辑仍要靠 `domain/` 承担,四层里有两层是空的。

**备选**:原样平移不拆分。否决理由:上游零单测,迁移是唯一一次能低成本补测的时机;且请求簿是超时与覆盖语义的唯一持有者,没有测试等于没有回归保护。

**执行时序不在目录树里**:目录只表达了 import 方向,不表达「回调何时执行」。哪一层负责把回调搬进安全上下文由 D11 单独规定 —— 这是本次迁移最容易漏的一类约束,因为它不在任何文件路径上体现。

### D5: TPA 请求簿保持「按目标玩家 ID 键、每目标一条」

`pendingRequests: Map<目标玩家ID, TeleportRequest>`,新请求覆盖旧请求并通知旧请求方,60 秒后由 `system.runTimeout` 清理,读取时再做一次惰性过期清理。

**理由**:这是上游既有语义,已被玩家熟悉(收到通知「你的请求已被 X 的新请求覆盖」)。改成「每目标多条队列」会改变可观察行为,不属于迁移。

**代价**:请求簿是内存态,世界重载即清空。这与上游一致,且 60 秒时限使持久化没有价值。

### D6: 持久化沿用上游 DynamicProperty 键与结构

键保持 `teleporter:player:<playerId>`、`teleporter:players`、`teleporter:config`;载荷结构保持上游的 JSON 形状(`waypoints` / `deathPoints` / 配置两字段)。

**理由**:既有世界的玩家数据必须继续可读。键名带 `teleporter:` 前缀,与上游一致即可。

**已知缺陷(保持现状,记入 Open Questions)**:`teleporter:players` 索引只增不减——`deletePlayerData` 没有调用方,索引会累积已失效的玩家 ID,公共传送点枚举因此会做无效遍历。

### D7: 群系映射与维度名称做成纯映射表

`BIOME_NAMES`(60+ 条,含主世界/下界/末地)与维度名称映射独立成模块,导出纯函数:输入维度标识或群系标识,输出中文名;未知标识回落为去掉命名空间的原标识。

**理由**:映射表是纯数据 + 纯函数,最容易被单测覆盖,也最容易被后续补条目。上游把映射表放在 `detection.ts` 里与 `getBiome` 调用混在一起,导致无法单测。

### D8: 图标重绘为 128×128

`mods/teleporter/tools/generate-pack-icon.js` 按 `keepinventory` / `auto-refill` 的既有做法:32×32 逻辑像素 → 4 倍最近邻放大到 128×128 RGBA PNG。构图表达「位置锚点 + 传送箭头」,单一主体,不用文字传达语义。

**理由**:`pack-icon` 规格要求 128×128 与像素画风格,且要求不使用占位图。上游是 256×256,直接缩放是非整数比例重采样,会破坏硬边。

### D9: 玩家传送界面保留「把对方拉过来」

**理由**:这是上游既有能力,迁移不裁剪。但它是本模组唯一一处「无需对方同意即可移动他人」的路径,与 `/tpa` 的请求-接受语义不一致,且没有权限门。

**缓解**:在模组 README 明确标注该路径的语义;后续如要收紧,只需在该界面加一次确认对话框或加管理员开关,不影响其它功能(记入 Open Questions)。

### D10: 测试接入 `node --test`,与 `auto-refill` 同构

`tests/tsconfig.json` 的 `include` 为显式列表:只含 `../scripts/core/**/*.ts` 与 `tests/**/*.ts`,`outDir` 为 `../.test-build`,rootDir 为 `..`;`npm test -w @mc-toolchain/teleporter` 运行 `tsc -p tests/tsconfig.json && node --test`。`packages/ui` 同样接入,覆盖表单取值解析。

**理由**:与 `spectator-mode` / `auto-refill` 同构(`node --test`,不引入新框架),且把「哪些模块允许被单测」写成显式清单 —— `mc/` 的适配层不参与测试编译,想给它写单测会直接编译失败,从而挡住把 `@minecraft` 依赖漏进 `core/` 的改动。

**代价**:`core/` 里每个模块都必须是纯函数或纯数据结构,涉及 `Player` / `ItemStack` / `DynamicProperty` 的操作一律推给 `mc/`。个别功能(如信物发放)因此被拆成「判定(纯)」与「执行(适配)」两半,调用方要串起来看。

### D11: 安全上下文推迟由 `packages/ui` 唯一承担,不在模组内手写

所有从命令回调与 `beforeEvents` 回调进入的受限操作,MUST 经 `packages/ui` 的安全上下文执行助手进入安全上下文。`scripts/mc/commands.ts` 的 16 条回调体只做参数解包与鉴权,不在回调内手写 `system.run`。

**理由**:

1. 这是引擎级硬约束,不是风格选择。判据已沉淀到 `docs/research/read-only-context.md`:`@minecraft/server@2.1.0` 共 341 个受限成员(268 个方法标注 `can't be called in read-only mode`、73 个属性标注 `can't be edited in read-only mode`)。其中 `Entity.teleport`、`Player.setGameMode`、`Container.addItem`、`ScreenDisplay.setTitle` 均受限,而 `sendMessage`、`setDynamicProperty` 不受限 —— 因此判据是「声明是否被标注」,不是「是否属于写操作」。
2. 上游 teleporter 的 16 条命令**全部**经 `@yinxe/toolkit` 的 `defineCommand`,而它内部用 `runSafeAsync`(即 `system.run`)包住回调。也就是说上游**从未**在命令回调里直接调用受限 API,推迟契约一直由外部封装静默提供。本次重写要拆掉这个外部依赖,就必须在仓库内找到新的承担点。
3. 不在 `packages/ui` 里再抽一个 `defineCommand` 等价物:仓库内已有 `auto-refill` 与 `spectator-mode` 两处手写 `registry.registerCommand` + `system.run`,`packages/shared/README.md` 的「等第二个消费方再抽」原则在此不适用 —— 已有两套实现,再引入第三套只会增加并存形态。本次只把**执行助手**共享化,命令注册的样板各模组自留。

**与上游的差异**:

| 契约 | 上游 `defineCommand` | 迁移后 |
| --- | --- | --- |
| 自动推迟 | `runSafeAsync` 包住回调 | `packages/ui` 执行助手 |
| 玩家来源校验 | 回调前校验 `origin.sourceEntity` | `scripts/mc/commands.ts` 的守卫(显式,便于返回带原因的失败) |
| 参数按名解包 | 由 `mandatoryParameters` / `optionalParameters` 生成 | 同(保留) |
| 回调异常处理 | **无** —— `runSafeAsync` 返回的 Promise 被丢弃,回调抛错变成 unhandled rejection 静默消失 | 执行助手捕获并上报 |

**不要双层包裹**:上游 `commands/back.ts` 在 `defineCommand` 回调内又套了一层 `system.run`,造成额外 tick 延迟且无任何效果。重写时回调体内不再手动包裹。

**备选**:在 `scripts/mc/` 里写一个本地命令注册助手。否决理由:两个模组各自手写一次,与 `packages/ui` 的执行助手职责重叠,且推迟契约会被拆成三份实现。

**备选**:不推迟,依赖「命令回调其实可写」的假设。否决理由:已实测 `@minecraft/server@2.1.0` 的声明标注,`teleport` 在只读上下文会抛错;这个假设会把 16 条命令里的 9 条变成「返回成功但什么都没发生」。

## Risks / Trade-offs

- **[表单取值解析依赖版本启发式]** 上游用「取值个数等于字段个数」判断非输入元素是否占用下标。若某个 Bedrock 版本出现第三种排布,解析会错位 → 用两种排布的单测锁住当前已知行为;`packages/ui` 的解析函数独立可测,修正时不必碰界面代码。
- **[共享界面包被两个模组共用]** 一处改动同时影响 `teleporter` 与未来的消费方 → `packages/ui` 自带单测;`auto-refill` 暂不切换到共享包,避免本次改动同时动两个模组的行为。
- **[`teleporter:players` 索引只增不减]** 长期运行后公共传送点枚举遍历失效 ID → 迁移保持现状(改动存档语义超出迁移范围);在 Open Questions 记录收紧路径:枚举时校验玩家数据是否存在并回收。
- **[玩家传送可无同意移动他人]** 见 D9 → README 标注语义;后续可加确认或管理员开关。
- **[门槛抬到 1.21.120]** 1.21.100–1.21.119 的客户端无法加载 → 与上游清单同值,不构成对既有玩家的收紧;在 README 记录最低版本。
- **[命令名使用 `tpa:` 命名空间]** 与上游一致,但 `tpa` 只对应 `/tpa` 系列,菜单/管理员命令也挤在该命名空间下,语义略窄 → 保持上游命令名以免玩家重新学习;命名空间不参与跨包协议,后续可评估。
- **[上游清单 `min_engine_version` 与 `dependencies` 不自洽]** 迁移后由 `pack` 写入 `min_engine_version`、由人工维护 `dependencies[].version`,两者仍需人工保持一致 → 在 `tasks.md` 的验证步骤中显式比对这三处值。
- **[拆掉外部 `defineCommand` 后推迟契约失守]** 命令回调直接调用受限 API 会报 `cannot be called in read-only mode`,表现为「命令返回成功但什么都没发生」→ 由 D11 把推迟职责固定到 `packages/ui` 执行助手;`tasks.md` 组 6 逐条验证「界面真的打开 / 传送真的发生」,并验证回调体内无手动 `system.run`。
- **[执行助手吞掉回调异常]** 若助手不捕获错误,回调抛错会成为 unhandled rejection 静默消失,表现为「点了没反应」→ 执行助手 MUST 捕获并上报;单测覆盖同步抛错与 Promise 拒绝两条路径。
- **[过度包裹]** 把不受限的 `sendMessage` / `setDynamicProperty` 也推迟,会增加一层 tick 延迟且无收益 → 判据写入 `docs/research/read-only-context.md` 与 `shared-ui` 规格,以声明标注为准;上游 `back.ts` 的双层包裹不搬。

## Migration Plan

1. **抽出共享界面包**:新建 `packages/ui`,把外部 `@yinxe/toolkit` 的 `ui/` 模块(`ActionFormBuilder` / `ModalFormBuilder` / `MessageFormBuilder` / `runSafe` / 消息助手)按本仓库约定重写;`target: es6` 自检;补取值解析单测。
2. **建模组骨架**:`mods/teleporter` 按 `auto-refill` 同构创建 `package.json`、`just.config.ts`、`tsconfig.json`、`tests/tsconfig.json`、`eslint.config.mjs`、`.env`(`PROJECT_NAME="teleporter"`)。
3. **搬纯逻辑层 `scripts/core/`**:类型、配置归一化、传送点、死亡点、请求簿、命名映射、信物判定 —— 数据形状与 DynamicProperty 键名保持上游,并同时补 `tests/` 单测(此步即可让 `npm test` 跑起来,不必等适配层)。
4. **搬适配层 `scripts/mc/`**:`store`(动态属性读写)、`detection`(群系检测与管理员判定)、`teleport`(传送执行与反馈)、`token`(物品创建与发放)。此步完成后 `core/` 的单测仍须全绿,证明适配层没有把 `@minecraft` 依赖反向渗进 `core/`。
5. **搬界面层 `scripts/mc/ui/`**:7 个屏幕改用 `@mc-toolchain/ui`,调用面保持上游形状。
6. **搬命令、事件与组合根**:`scripts/mc/commands.ts`(16 条命令 + 玩家来源守卫,回调体只做解包与鉴权,受限操作经 `@mc-toolchain/ui` 执行助手推迟)、`scripts/mc/events.ts`(死亡/重生/物品使用三类订阅)、`scripts/main.ts`(startup 一次性注册)。此步完成后必须逐条实测「界面真的打开 / 传送真的发生」,而不是只看命令返回值。
7. **清单与打包**:`behavior_packs/teleporter/manifest.json` 保留上游 UUID,版本 `[0,0,6]`,`dependencies` 含 `@minecraft/server [2,3,0]` 与 `@minecraft/server-ui [2,0,0]`,`metadata.product_type: "addon"`;`packing: { mode: "auto", output: "dist/packages", minimum_engine_version: [1,21,120] }`。
8. **图标**:`tools/generate-pack-icon.js` 生成 128×128 `pack_icon.png`。
9. **文档**:根 `README.md` 模组表与 `packages/` 说明、`mods/README.md` 共享包引用说明、`packages/shared/README.md` 的「刻意不包含」指向新包、`mods/teleporter/README.md` 记录功能/命令/最低版本/已知取舍与 `core` / `mc` 分层。`docs/research/read-only-context.md` 已在本变更内新增(见 Impact),此处只需在 `docs/research/README.md` 索引登记它。
10. **验证**:`tsc --noEmit`、`lint`、`pack`(检查产物文件名、包内清单、版本字段、`min_engine_version`)、`mct validate -i .`、`node --test`、`openspec validate add-teleporter-mod --strict`。

**回滚**:改动集中在新增目录(`packages/ui`、`mods/teleporter`)与四处文档。回滚即删除这两个目录、撤销三处文档改动、从根 `README.md` 模组表移除 `teleporter`。上游仓库与其它模组不受影响。

## Open Questions

- `auto-refill` 是否切换到 `@mc-toolchain/ui`(它的 `AdminMenu` 现在直接用原生 `ModalFormData` 并按下标解构):不影响本次规格与任务,可在独立改动中评估。
- `teleporter:players` 索引的失效 ID 回收:需要决定「枚举时惰性回收」还是「引入定期清理」,两者都涉及存档写入时机,留待有实际膨胀证据时再定。
- 玩家传送的「把对方拉过来」是否需要权限门或确认对话框:属于交互设计取舍,当前保持上游行为。
