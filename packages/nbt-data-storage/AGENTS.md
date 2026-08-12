# nbt-data-storage — 模块约定

MCBE 存储基石：区块锚定的全木桶阵列，按格存 ItemStack（完整 NBT），O(1) 槽位 ID 存取，动态扩容，跨模组共享。**工具库，不是完整模组**。

> 通用代码规范（命名/导入顺序/JSDoc/错误处理/Minecraft 特有模式/版本流程）见根 `CLAUDE.md`。
> 本文件只记本包独有的命令、架构、约定。

## 目录结构

```
packages/nbt-data-storage/
├── src/
│   ├── index.ts          # 公共入口（运行时；core 纯函数一并导出）
│   ├── core/             # 纯领域逻辑（**零 @minecraft 依赖**，可 node 单测）
│   │   ├── layout.ts     # RegionLayout：槽位 ID ↔ (x,y,z,槽内索引) 纯算术 O(1) 解码 / 容量 / 校验
│   │   ├── meta.ts       # RegionMeta v3：仅 barrelCount（已物化桶数）；v2 兼容归一（normalizeMeta）
│   │   ├── keys.ts       # 维度枚举(0/1/2) / 区域ID（2:0:-64）/ 解析
│   │   ├── record.ts     # 持久化区域记录序列化（layout+dimensionId+meta 合一；v2 洞池时代兼容读取）
│   │   ├── stats.ts      # RegionStats 只读统计（含 barrels/totalBarrels/used/freeSlots）
│   │   ├── transfer.ts   # 原子传输编排（TransferPort 注入，可 mock 单测）
│   │   ├── put.ts        # 存入编排（PutPort 注入：桶水位定位未满桶→桶内真值探测→物化→写入，有界重试）
│   │   └── index.ts
│   └── mc/               # MC 适配层（只做副作用/IO）
│       ├── ItemStorage.ts    # 注册表 + register/listRegions/getRegion/queryWorld/totalStats
│       ├── StoredRegion.ts   # 区域句柄：put/get/take/remove/transfer/stats（DP 读改写 + 世界真值兜底）
│       ├── BarrelRuntime.ts  # 方块物化 / 容器 IO / ticking area 常加载
│       ├── store.ts          # DP 直存（nds:regions 索引 + nds:item:{ID} 记录 + 按层桶水位）
│       ├── events.ts         # 存储事件（复用 toolkit EventSignal：stored/taken/removed）
│       └── commands.ts       # 可选 nds:regions / nds:stats 命令
└── tests/                # core 单测（node:test）
```

## 核心设计约定（新代码遵循）

- **core 无副作用**：core 只做纯计算（寻址/分配/统计/序列化），不触世界；mc 层做全部 IO 副作用。core 不得 import `@minecraft/*`（`tsconfig.test.json` 只编译 `src/core` + `tests`）。
- **以世界为真值**：物品实物在木桶槽位里，DP 元数据（桶水位/计数）只是软状态。`put` 写入前探测目标槽占用（真值），被外部占用则**丢弃候选改选下一候选**（有界重试 `MAX_ALLOC_RETRY=64`），绝不覆盖他人物品；元数据丢失自愈。
- **桶水位设计（v3，取代 v2 空洞池）**：**空槽不做任何登记**——分配时桶内探测容器真值。每层一条 DP 键（`nds:item:{区域ID}:usage:{层}`）存该层**已物化桶的占用计数数组**（每桶一个 0..27 数字，满层 256 个 ≈ 640B，**从根上规避 DP 单值 32KB 上限，无需分片**）。主记录 meta 仅 `{ v:3, barrelCount }`。分配（`put.allocateCandidate`）：从桶 0 线性找第一个 `usage[b] < usable` 的未满桶 → 桶内扫描 `usable` 个槽位探测真值找空槽 → 写入并计数 +1（占位即写，收窄 RMW 竞态窗口）；计数未满但探测全占用（计数失真/外部塞满）→ 计数修正为满跳过。取物（take/remove）清槽后计数 -1（`decrementUsage`，幂等）。**计数只做快速过滤，真值探测兜底**——计数漂移/外部干扰都不覆盖占用槽。
- **DP 读改写（RMW）**：`put`/`take`/`remove` 每次先读记录（+触碰的那一层桶水位）→ 变更 → 写回。跨模组共享同一区域时以世界真值消解竞态（同一 tick 内重复分配同槽的窗口极小，见 README）。
- **O(1) 纪律**：`get`/`take`/`remove` 只做纯算术解码 + 一次容器槽位访问，禁止扫描/枚举。`put` 分配 = 桶水位扫描（每层 ≤ 256 次内存比较，通常前几桶命中）+ 桶内最多 `usable` 次真值探测，有界（≤ maxLevels 层，常量级）。**空槽无需登记**：take 空槽（物品已丢失/外部取走）计数保持虚高，分配时桶内探测真值自然复用，巡检对齐。
- **先占位后写入**：`put` 在物化/写入前先写桶水位占位（收窄竞态窗口）。失败分流：**世界已占用** → 丢弃候选改选下一候选（不回收）；**物化/写入失败**（区块未就绪、新桶容器暂不可用）→ `decrementUsage` 回滚计数并返回 null，由调用方下个周期重试（不烧计数、不丢槽）。
- **区块安全**：所有方块/容器访问 try-catch；容器不可达返回失败而非抛错。消费模组须在**完整执行上下文**（命令回调/事件/system.run）内调用本库 API。
- **常加载（模组独立额度）**：注册/调整时经 `world.tickingAreaManager`（`TickingAreaManager`）挂载常加载——**每包固定 ticking 区块额度，独立于游戏命令限制**（不占命令预算）；`hasTickingArea` 本包去重（同名不重复创建）、`hasCapacity` 容量预检、`createTickingArea` 异步 fire-and-forget + 失败告警。**跨包语义**：API 无法修改/查询其他包或命令添加的区域——多模组共用同一存储区域时各包挂自己的常加载（各包额度独立、互不挤占）；这是"每包都能操作远方容器"的必要机制。失败/容量不足 → warn（读写降级为 `null`/`undefined`，不崩溃）。建议存储集中末地。
- **跨模组共享的寻址单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）即共享，跨区块各自独立。归块逻辑在 core（`chunkFromBlock`），单测覆盖四象限与边界点。
- **凭据取物（区域ID + slotId）**：区域唯一 ID = `维度枚举:区块X:区块Z`（如 `2:0:-64`，0=主世界 1=下界 2=末地，其余维度回退短名可逆）。`put` 成功返回 `{ regionId, slotId }`；`ItemStorage.get/take(ref)` 凭凭据 O(1) 取物，未注册时从 DP 记录**惰性采纳**区域句柄（跨模组可用）。
- **动态扩容**：不预生成阵列；`put` 分配到的新桶位置（该层 `usage.length` 处）才 `setBlockType`（幂等，上报 created → `meta.barrelCount` +1）。**层数默认 64（正式渠道固定）**，容量上限 = `64 × 256 × 27` = 442368 槽、满容量桶数 = `64 × 256` = 16384，满则拒绝（不够再注册新集群）。空桶常驻不回收（桶内空槽由探测复用）。
- **测试渠道（`registerTest`，仅供测试/演示）**：比 `register` 多接受 `slotPerBarrel`（每桶可分配槽数 0..27）与 `maxLevels`（层数 1..64），用于快速模拟满容量/见证扩容；创建的记录带 **`test: true` 特权标记**。**ID 语义恒定**：解码永远按 27 槽/桶（`BARREL_SLOTS` 常量，`slotIdToPosition` 不参数化），`slotPerBarrel` 只让分配跳过桶内超限槽位（桶内探测循环有界跳过）——已存物品的 ID 在任何配置下指向同一物理位置，不漂移不孤儿。`capacityOf` = 层数 × 256 × slotPerBarrel（可用容量；**0 = 容量 0 的瞬满测试布局**），`isValidSlotId` 越界判定用解码上限（层数 × 6912）。
- **测试区域特权（test:true）**：仅 `registerTest` 可创建/进入；正式 `register` 注册 test 区域 → `assertLayoutConsistent` 抛错拒绝（防正式模组数据混入可随时改参数的测试阵列）；测试渠道注册无标记区域（参数一致）→ 允许共享。
- **布局动态调整（`StoredRegion.resizeLayout`，仅 test 区域）**：层数（1..64，增大任意、减小需被裁层**无任何物化木桶**——空桶也占物理空间不能裁出常加载范围）与每桶槽数（0..27，任意调，缩小后已占用的超限槽保留可读只是不再分配）都可随时调整，不必换锚点重建——解码恒按 27 槽/桶，调整不影响任何已有 slotId。调整成功后**重扫全部已物化桶重建桶水位**（`rebuildUsage`：按新布局探测真值，`usage[b]` = 实际占用件数，超限槽不计入；一次性 O(物化桶×可用槽) 扫描，非热路径，符合"巡检例外"）。编排在 core（`resizeLayout(ResizePort)` / `rebuildUsage(RebuildPort)`，可 mock 单测），mc 层成功后同步句柄布局并重挂常加载范围。
- **布局一致性拒绝（防 ID 混用）**：`resolveRegistration` 对显式传入的 `slotPerBarrel`/`maxLevels` 与既有记录不一致时**抛错拒绝**（同区块同一批物理木桶不允许两套分配语义，否则同一 ID 会错读他人槽位）；参数一致（含默认 27/64）则正常共享。正式 `register` 不传布局参数 → 不校验，行为不变；`registerTest` 遇测试布局区块注册 → 提示更换锚点。**注册缓存路径同样校验**（`ItemStorage.registerWith` 缓存命中时也走 `assertLayoutConsistent`，防改参数后仍拿旧句柄继续写入）。
- **布局采纳（首个注册者定）**：注册决策走 core `resolveRegistration`（可 mock 单测）——已有记录采纳其维度/baseY/层数/每桶槽数（布局整体内嵌记录 JSON 持久化），后注册者传的高度被忽略；区域 ID 由维度枚举+区块决定（不含高度）。
- **存入编排在 core**：`putItem(PutPort)` 下沉到 core（可 mock 单测）——桶水位定位未满桶 → 桶内真值探测空槽 → 占位写水位 → 物化（如需要）→ 写入；世界占用则换候选（有界重试），物化/写入失败回滚计数返回 null。`StoredRegion` 只留薄接线（port + 事件触发）。
- **扩容与并发**：分配优先复用未满桶（计数 < usable），全部桶满才物化新桶；区域真满（全部层桶满）拒绝且**绝不建桶**。并发扩容撞同槽由世界真值检查兜底——后写入者改选下一槽，**绝不覆盖前者**（有 mock 单测）。
- **阵列巡检 + 修复（`StoredRegion.checkAndRepair`，自检维护）**：扫描全部**已物化桶**（桶水位长度范围内）的可用槽探测世界真值——**阵列坐标内的任何非木桶方块都是预期之外的干扰**（空气/普通方块/其它容器一律等同处理）→ `ensureBarrelForRepair` 直接重建覆盖（`restoreBarrel` 返回 `{ok, created}`，同桶多槽只计一次修复；容器内容随方块损坏已丢失无法找回，如实报告）。**桶级丢失判定**（v3 无逐槽空洞登记）：桶实际占用 < 计数 → 差异件数报丢失（桶损坏重建后全空 = barrel-destroyed / 外部取走差额 = taken-externally，按桶报告 count）；实际占用 > 计数（外部塞入/计数失真）→ 静默对齐不误报。区块未加载（unknown）跳过不误修（该桶本次不对齐）。巡检结束统一把桶水位**对齐真值**（丢失槽无需登记，分配探测自然复用）。**写保护（put 日常路径）**：`isSlotOccupied`/`writeItem`/`readItem`/`clearSlot` 对非木桶方块一律保守失败/返回空，`ensureBarrel` 对非空气/非木桶位置返回 `occupied`（put 跳过候选**绝不替换他人方块**）——巡检的覆盖是显式修复（`ensureBarrelForRepair`），与 put 路径互补。编排在 core `checkAndRepair(RepairPort, layout, onEvent?)`（可 mock 单测，tests/repair.test.ts 覆盖桶损坏/外部取走/外部塞入/unknown/空桶/整桶被挖）。**显式巡检例外**：O(物化桶×可用槽) 扫描，仅调用时执行，不违反热路径 O(1) 纪律。
- **原子传输**：`transferIn/transferOut` 走 core `transfer.ts` 编排（TransferPort 注入、可 mock 单测）——要么整体成功要么保持原状，物品不丢不重复；失败回滚 = 取回区域槽并尽力还原源槽。
- **原位覆写（`StoredRegion.overwrite`，安全）**：在**已有格子**上覆盖写入（slotId 不变），旧物品读出返回调用方（不丢）；与 put（分配新槽）/transferIn（原子搬移）互补。护栏：仅位置有实物（occupied）允许；空槽也允许（实时数据保存用，写入后桶水位计数 +1）；非木桶/未加载拒绝（请先巡检）。编排在 core `overwriteSlot(OverwritePort)`（可 mock 单测，tests/overwrite.test.ts 覆盖成功返旧物/空槽登记水位/异常位置/越界/写入失败）。成功触发 `ItemStorage.events.overwritten {oldTypeId,newTypeId}`。
- **自定义事件**：mc 层复用 `@yinxe/toolkit` 的 `EventSignal` 暴露 `ItemStorage.events`（stored/taken/removed/barrelCreated/barrelRestored/itemLost）；事件负载只用可序列化 string/number，不携带 MC 对象。巡检事件由 core `checkAndRepair` 的 `onEvent` 回调产生、mc 层桥接为 EventSignal。**itemLost 为桶级事件** `{regionId, level, barrelInLevel, count, kind}`（v3 无逐槽登记），消费方（如凭据索引）按桶范围清理自己的记录；`barrelRestored` 携带 `{slotId, level, barrelInLevel}`。core 不依赖 toolkit（保持零 `@minecraft`）。

## 持久化键约定

| 键                              | 内容                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `nds:regions`                   | 全局区域索引（JSON `string[]`，跨模组盘点）                                          |
| `nds:item:{区域ID}`             | 区域主记录 `{ v:2, dimensionId, layout, meta }`（meta v3 = 仅 barrelCount；v2 兼容读取） |
| `nds:item:{区域ID}:usage:{层}`  | 该层桶水位（JSON 已物化桶占用计数数组，每桶 0..27；满层 ≈ 640B，无需分片）           |

区域ID = `维度枚举:区块X:区块Z`（如 `2:0:-64`），即 DP 键后缀。预留 `nds:entity:` / `nds:structure:` 前缀给生物/结构模式。旧版 `...:pool:{层}`（v2 空洞池）键残留无害（软状态，不再读写）。

## 命令（可选安装）

| 命令                  | 说明                                  |
| --------------------- | ------------------------------------- |
| `/nds:regions`        | 列出全部存储区域 + 全库汇总           |
| `/nds:stats [区域ID]` | 指定区域详情（容量/已用/可用槽/桶进度） |

- 消费模组在 startup（Phase 3）调用 `installNdsCommands()`；**本上下文内幂等**。
- 多个模组各自打包本库并都调用它时，重复的 `registerCommand` 会被**捕获忽略**（命令由先注册者管理），不报错；其余模组直接使用 `ItemStorage` API。

## 测试

```bash
pnpm --filter nbt-data-storage run test   # tsc -p tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"
```

- core 纯逻辑（layout 寻址 / meta 分配回收 / record 序列化 / keys 维度枚举+区域ID / stats / transfer 原子传输）必须有单测覆盖；
- mc 适配层（物化/容器 IO/ticking area）靠游戏内冒烟（同 item-route 约定）。

## 构建与提交

- 本包是纯 TS 库（`main: src/index.ts`），无 just.config / 打包；由消费模组 esbuild 内联。
- 消费模组：`pnpm --filter <mod> add @yinxe/nbt-data-storage@workspace:*`，在 main.ts 中 `register()` + 可选 `installNdsCommands()`。
- 版本：`package.json#version`；commit message：`nbt-data-storage: <中文描述>`。
