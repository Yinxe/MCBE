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
│   │   ├── meta.ts       # RegionMeta：水印 + 按层空洞（holeLevels 索引 + 洞数），O(1) 分配/回收
│   │   ├── keys.ts       # 维度枚举(0/1/2) / 区域ID（2:0:-64）/ 解析
│   │   ├── record.ts     # 持久化区域记录序列化（layout+dimensionId+meta 合一）
│   │   ├── stats.ts      # RegionStats 只读统计（含 barrels/totalBarrels）
│   │   ├── transfer.ts   # 原子传输编排（TransferPort 注入，可 mock 单测）
│   │   ├── put.ts        # 存入编排（PutPort 注入：分配→占位→物化→占用检查→写入，有界重试）
│   │   └── index.ts
│   └── mc/               # MC 适配层（只做副作用/IO）
│       ├── ItemStorage.ts    # 注册表 + register/listRegions/getRegion/queryWorld/totalStats
│       ├── StoredRegion.ts   # 区域句柄：put/get/take/remove/transfer/stats（DP 读改写 + 世界真值兜底）
│       ├── BarrelRuntime.ts  # 方块物化 / 容器 IO / ticking area 常加载
│       ├── store.ts          # DP 直存（nds:regions 索引 + nds:item:{ID} 记录 + 按层空洞池）
│       ├── events.ts         # 存储事件（复用 toolkit EventSignal：stored/taken/removed）
│       └── commands.ts       # 可选 nds:regions / nds:stats 命令
└── tests/                # core 单测（node:test）
```

## 核心设计约定（新代码遵循）

- **core 无副作用**：core 只做纯计算（寻址/分配/统计/序列化），不触世界；mc 层做全部 IO 副作用。core 不得 import `@minecraft/*`（`tsconfig.test.json` 只编译 `src/core` + `tests`）。
- **以世界为真值**：物品实物在木桶槽位里，DP 元数据（水印/按层空洞池）只是软状态。`put` 写入前检查目标槽占用，被外部占用则**丢弃候选改选下一候选**（有界重试 `MAX_ALLOC_RETRY=64`），绝不覆盖他人物品；元数据丢失自愈。
- **空洞按层分键存储（DP 单值有界）**：空洞池每层一条 DP 键（`nds:item:{区域ID}:pool:{层}`），存 **level-local 索引（0..6911）**，不存全局 slotId——层数再多（如 64 层）单值也 ≤ 一层 6912 条、数字 ≤ 4 位，规避 DynamicProperty 单值上限。主记录 meta 只留 `nextFree` + `holeLevels`（有洞层号索引）+ `holeCount`（洞数），分配 O(1) 定位最低洞层、统计免加载全部层。**洞池降序存储约定**：`rebuildPools` 重建时按 local 降序落池（大在底），`allocateSlotId` pop 取**最小空槽**——调整参数后新 put 先填前面的空桶/空槽（对齐存储，连续利用率最高）；take 释放的单洞 push 末尾，pop 优先复用刚释放的槽（局部性）。
- **DP 读改写（RMW）**：`put`/`take`/`remove` 每次先读记录（+触碰的那一层池）→ 变更 → 写回。跨模组共享同一区域时以世界真值消解竞态（同一 tick 内重复分配同槽的窗口极小，见 README）。
- **O(1) 纪律**：`get`/`take`/`remove` 只做纯算术解码 + 一次容器槽位访问，禁止扫描/枚举。`put` 分配也是 O(1)（经 `holeLevels` 取最低洞层 pop，或推进水印）；层号扫描有界（≤ maxLevels，常量级）。**take 空槽回收**：take 发现槽位为空（物品已丢失/外部取走）也回收进空洞池（容量复用，避免占用虚高），`releaseSlotId` 幂等保护（重复回收忽略，防洞池重复项）。
- **先占位后写入**：`put` 在物化/写入前先写 DP 占位（收窄竞态窗口）。失败分流：**世界已占用** → 丢弃候选改选下一候选（不回收，避免"占用的槽进空洞池 → 无限重试"）；**物化/写入失败**（区块未就绪、新桶容器暂不可用）→ 槽位回归该层空洞池并返回 null，由调用方下个周期重试（不烧水印、不丢空槽）。
- **区块安全**：所有方块/容器访问 try-catch；容器不可达返回失败而非抛错。消费模组须在**完整执行上下文**（命令回调/事件/system.run）内调用本库 API。
- **常加载依赖作弊**：ticking area 是 OP 命令，世界需开启作弊；未开启时注册静默失败，读写降级为 `null`/`undefined`（不崩溃）。每个维度 ticking area 数量有上限，建议存储集中末地。
- **跨模组共享的寻址单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）即共享，跨区块各自独立。归块逻辑在 core（`chunkFromBlock`），单测覆盖四象限与边界点。
- **凭据取物（区域ID + slotId）**：区域唯一 ID = `维度枚举:区块X:区块Z`（如 `2:0:-64`，0=主世界 1=下界 2=末地，其余维度回退短名可逆）。`put` 成功返回 `{ regionId, slotId }`；`ItemStorage.get/take(ref)` 凭凭据 O(1) 取物，未注册时从 DP 记录**惰性采纳**区域句柄（跨模组可用）。
- **动态扩容**：不预生成阵列；`put` 分配到的桶不存在时才 `setBlockType`（幂等，上报 created → `meta.barrelCount` +1）。**层数默认 64（正式渠道固定）**，容量上限 = `64 × 256 × 27` = 442368 槽、满容量桶数 = `64 × 256` = 16384，满则拒绝（不够再注册新集群）。空桶常驻不回收（供空洞复用）。
- **测试渠道（`registerTest`，仅供测试/演示）**：比 `register` 多接受 `slotPerBarrel`（每桶可分配槽数 0..27）与 `maxLevels`（层数 1..64），用于快速模拟满容量/见证扩容；创建的记录带 **`test: true` 特权标记**。**ID 语义恒定**：解码永远按 27 槽/桶（`BARREL_SLOTS` 常量，`slotIdToPosition` 不参数化），`slotPerBarrel` 只让分配跳过桶内超限槽位（`allocateSlotId` 水印循环有界跳过）——已存物品的 ID 在任何配置下指向同一物理位置，不漂移不孤儿。`capacityOf` = 层数 × 256 × slotPerBarrel（可用容量；**0 = 容量 0 的瞬满测试布局**），`isValidSlotId` 越界判定用解码上限（层数 × 6912）。
- **测试区域特权（test:true）**：仅 `registerTest` 可创建/进入；正式 `register` 注册 test 区域 → `assertLayoutConsistent` 抛错拒绝（防正式模组数据混入可随时改参数的测试阵列）；测试渠道注册无标记区域（参数一致）→ 允许共享。
- **布局动态调整（`StoredRegion.resizeLayout`，仅 test 区域）**：层数（1..64，增大任意、减小需被裁层无已分配槽位/空洞）与每桶槽数（0..27，任意调，缩小后已占用的超限槽保留可读只是不再分配）都可随时调整，不必换锚点重建——解码恒按 27 槽/桶，调整不影响任何已有 slotId。调整成功后**重扫全部已分配槽位重建洞池**（`rebuildPools`：按新布局扫描 0..水印 的可用槽，空者入池、有物者不入，清除超限遗留洞，对齐世界真值；一次性 O(水印) 扫描，非热路径，符合"巡检例外"）。编排在 core（`resizeLayout(ResizePort)` / `rebuildPools(RebuildPort)`，可 mock 单测），mc 层成功后同步句柄布局并重挂常加载范围。
- **布局一致性拒绝（防 ID 混用）**：`resolveRegistration` 对显式传入的 `slotPerBarrel`/`maxLevels` 与既有记录不一致时**抛错拒绝**（同区块同一批物理木桶不允许两套分配语义，否则同一 ID 会错读他人槽位）；参数一致（含默认 27/64）则正常共享。正式 `register` 不传布局参数 → 不校验，行为不变；`registerTest` 遇测试布局区块注册 → 提示更换锚点。**注册缓存路径同样校验**（`ItemStorage.registerWith` 缓存命中时也走 `assertLayoutConsistent`，防改参数后仍拿旧句柄继续写入）。
- **布局采纳（首个注册者定）**：注册决策走 core `resolveRegistration`（可 mock 单测）——已有记录采纳其维度/baseY/层数/每桶槽数（布局整体内嵌记录 JSON 持久化），后注册者传的高度被忽略；区域 ID 由维度枚举+区块决定（不含高度）。
- **存入编排在 core**：`putItem(PutPort)` 下沉到 core（可 mock 单测）——先占位写 DP → 物化 → 世界占用检查 → 写入；世界占用则换候选（有界重试），物化/写入失败槽回归空洞池返回 null。`StoredRegion` 只留薄接线（port + 事件触发）。
- **扩容与并发**：分配优先复用空位（最低洞层 O(1)），无空位才推进水印扩容（触新桶首槽才物化建桶）；区域真满（无洞 + 水印触顶）拒绝且**绝不建桶**。并发扩容撞同槽由世界真值检查兜底——后写入者改选下一槽，**绝不覆盖前者**（有 mock 单测）。
- **阵列巡检 + 修复（`StoredRegion.checkAndRepair`，自检维护）**：扫描全部已分配槽位（0..水印 的可用槽）探测世界真值——**阵列坐标内的任何非木桶方块都是预期之外的干扰**（空气/普通方块/其它容器一律等同处理）→ `ensureBarrel` 直接重建覆盖（`restoreBarrel` 返回 `{ok, created}`，同桶多槽只计一次修复；容器内容随方块损坏已丢失无法找回，如实报告）。元数据占用但实物为空（外部取走/意外消失，非洞池登记）→ 判定丢失（无法修复，kind 区分 barrel-destroyed/taken-externally）。区块未加载（unknown）跳过不误修。巡检结束统一 `rebuildPools`：丢失槽回收为空洞，容量恢复可复用（unknown 槽保守视为占用**不回收**）。**写保护加固**：`isSlotOccupied`/`writeItem` 对非木桶方块一律保守失败/占用——put 永不写入非木桶位置（巡检的重建是显式修复，与之互补）。编排在 core `checkAndRepair(RepairPort, layout, onEvent?)`（可 mock 单测，tests/repair.test.ts 覆盖桶损坏/外部取走/非木桶一律覆盖/unknown/洞不误报/整桶被挖）。**显式巡检例外**：O(水印) 扫描，仅调用时执行，不违反热路径 O(1) 纪律。
- **原子传输**：`transferIn/transferOut` 走 core `transfer.ts` 编排（TransferPort 注入、可 mock 单测）——要么整体成功要么保持原状，物品不丢不重复；失败回滚 = 取回区域槽并尽力还原源槽。
- **自定义事件**：mc 层复用 `@yinxe/toolkit` 的 `EventSignal` 暴露 `ItemStorage.events`（stored/taken/removed/barrelCreated/barrelRestored/itemLost）；事件负载只用可序列化 string/number，不携带 MC 对象。巡检事件由 core `checkAndRepair` 的 `onEvent` 回调产生、mc 层桥接为 EventSignal（外部模组 `ItemStorage.events.itemLost.subscribe(...)` 即可订阅）。core 不依赖 toolkit（保持零 `@minecraft`）。

## 持久化键约定

| 键                            | 内容                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `nds:regions`                 | 全局区域索引（JSON `string[]`，跨模组盘点）                                      |
| `nds:item:{区域ID}`           | 区域主记录 `{ v:2, dimensionId, layout, meta }`（meta = 水印 + 洞层索引 + 洞数） |
| `nds:item:{区域ID}:pool:{层}` | 该层空洞池（JSON level-local 索引数组）                                          |

区域ID = `维度枚举:区块X:区块Z`（如 `2:0:-64`），即 DP 键后缀。预留 `nds:entity:` / `nds:structure:` 前缀给生物/结构模式。

## 命令（可选安装）

| 命令                  | 说明                                  |
| --------------------- | ------------------------------------- |
| `/nds:regions`        | 列出全部存储区域 + 全库汇总           |
| `/nds:stats [区域ID]` | 指定区域详情（容量/已用/水印/空洞数） |

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
