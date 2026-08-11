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
│   │   ├── meta.ts       # RegionMeta：nextFree 水印 + freePool 空洞池，O(1) 分配/回收
│   │   ├── keys.ts       # 维度短名 / 区域键（the_end:0:-64）/ 解析
│   │   ├── record.ts     # 持久化区域记录序列化（layout+dimensionId+meta 合一）
│   │   ├── stats.ts      # RegionStats 只读统计（纯函数）
│   │   └── index.ts
│   └── mc/               # MC 适配层（只做副作用/IO）
│       ├── ItemStorage.ts    # 注册表 + register/listRegions/getRegion/queryWorld/totalStats
│       ├── StoredRegion.ts   # 区域句柄：put/get/take/remove/stats（DP 读改写 + 世界真值兜底）
│       ├── BarrelRuntime.ts  # 方块物化 / 容器 IO / ticking area 常加载
│       ├── store.ts          # DP 直存（nds:regions 索引 + nds:item:{key} 记录）
│       └── commands.ts       # 可选 nds:regions / nds:stats 命令
└── tests/                # core 单测（node:test）
```

## 核心设计约定（新代码遵循）

- **core 无副作用**：core 只做纯计算（寻址/分配/统计/序列化），不触世界；mc 层做全部 IO 副作用。core 不得 import `@minecraft/*`（`tsconfig.test.json` 只编译 `src/core` + `tests`）。
- **以世界为真值**：物品实物在木桶槽位里，DP 元数据（水印/空洞池）只是软状态。`put` 写入前检查目标槽占用，被外部占用则**丢弃候选改选下一候选**（有界重试 `MAX_ALLOC_RETRY=64`），绝不覆盖他人物品；元数据丢失自愈。
- **DP 读改写（RMW）**：`put`/`take`/`remove` 每次先读记录 → 变更 → 写回。跨模组共享同一区域时以世界真值消解竞态（同一 tick 内重复分配同槽的窗口极小，见 README）。
- **O(1) 纪律**：`get`/`take`/`remove` 只做纯算术解码 + 一次容器槽位访问，禁止扫描/枚举。`put` 分配也是 O(1)（pop 空洞或推进水印）。
- **先占位后写入**：`put` 在物化/写入前先写 DP 占位（收窄竞态窗口）。失败分流：**世界已占用** → 丢弃候选改选下一候选（不回收，避免"占用的槽进 freePool → 无限重试"）；**物化/写入失败**（区块未就绪、新桶容器暂不可用）→ 槽位回归空闲池并返回 null，由调用方下个周期重试（不烧水印、不丢空槽）。
- **区块安全**：所有方块/容器访问 try-catch；容器不可达返回失败而非抛错。消费模组须在**完整执行上下文**（命令回调/事件/system.run）内调用本库 API。
- **常加载依赖作弊**：ticking area 是 OP 命令，世界需开启作弊；未开启时注册静默失败，读写降级为 `null`/`undefined`（不崩溃）。每个维度 ticking area 数量有上限，建议存储集中末地。
- **跨模组共享的寻址单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）即共享，跨区块各自独立。归块逻辑在 core（`chunkFromBlock`），单测覆盖四象限与边界点。
- **动态扩容**：不预生成阵列；`put` 分配到的桶不存在时才 `setBlockType`（幂等）。容量上限 = `maxLevels × 256 × 27`，满则拒绝。

## 持久化键约定

| 键                  | 内容                                          |
| ------------------- | --------------------------------------------- |
| `nds:regions`       | 全局区域索引（JSON `string[]`，跨模组盘点）   |
| `nds:item:{区域键}` | 区域记录 `{ v:1, dimensionId, layout, meta }` |

区域键 = `维度短名:区块X:区块Z`（如 `the_end:0:-64`），即 DP 键后缀。预留 `nds:entity:` / `nds:structure:` 前缀给生物/结构模式。

## 命令（可选安装）

| 命令                  | 说明                                  |
| --------------------- | ------------------------------------- |
| `/nds:regions`        | 列出全部存储区域 + 全库汇总           |
| `/nds:stats [区域键]` | 指定区域详情（容量/已用/水印/空洞数） |

- 消费模组在 startup（Phase 3）调用 `installNdsCommands()`；**本上下文内幂等**。
- 多个模组各自打包本库并都调用它时，重复的 `registerCommand` 会被**捕获忽略**（命令由先注册者管理），不报错；其余模组直接使用 `ItemStorage` API。

## 测试

```bash
pnpm --filter nbt-data-storage run test   # tsc -p tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"
```

- core 纯逻辑（layout 寻址 / meta 分配回收 / record 序列化 / keys / stats）必须有单测覆盖；
- mc 适配层（物化/容器 IO/ticking area）靠游戏内冒烟（同 item-route 约定）。

## 构建与提交

- 本包是纯 TS 库（`main: src/index.ts`），无 just.config / 打包；由消费模组 esbuild 内联。
- 消费模组：`pnpm --filter <mod> add @yinxe/nbt-data-storage@workspace:*`，在 main.ts 中 `register()` + 可选 `installNdsCommands()`。
- 版本：`package.json#version`；commit message：`nbt-data-storage: <中文描述>`。
