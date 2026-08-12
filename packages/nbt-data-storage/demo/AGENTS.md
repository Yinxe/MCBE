# nds-demo —— NBT 存储测试（nbt-data-storage 演示 addon）

`@yinxe/nbt-data-storage` 的游戏内演示/冒烟 addon：完整配置 UI（维度/锚点/底层 Y/开关/**测试参数**）、命令与 UI 双通道存取（完整 NBT）、批量勾选存取、本地凭据索引、扩容见证。

> 通用代码规范（命名/导入顺序/JSDoc/错误处理/Minecraft 特有模式/版本流程）见根 `AGENTS.md`。
> 存储库的设计约定（O(1) 寻址/世界真值/空洞按层分键/常加载/**测试渠道 registerTest**）见 `../AGENTS.md`。

## 目录结构

```
demo/
├── BP/NdsDemo/manifest.json  # 行为包（script 模块入口 scripts/main.js）
├── scripts/
│   ├── main.ts               # 入口：Phase 3 命令注册 + Phase 4 延迟初始化
│   ├── config.ts             # DemoConfig 模型 + ndsdemo:cfg DP 读写 + 配置 ModalForm（含测试参数滑块）
│   ├── storageService.ts     # 领域服务：registerTest 注册 / 凭据索引 ndsdemo:refs / 单件+批量存取 / 扩容见证
│   ├── ui.ts                 # 主菜单 + 分页勾选组件（批量存入/取出）+ 单件存取
│   ├── commands.ts           # nds-demo:* 命令
└── just.config.ts            # build/pack（manifest 版本同步 + esbuild 内联库）
```

## 命令（/nds-demo:*）

| 命令 | 说明 |
|------|------|
| `/nds-demo:ui` | 打开管理菜单（单件/批量存取、统计、配置） |
| `/nds-demo:config` | 打开完整配置 UI（启用开关/维度/锚点X,Z/底层Y/每桶槽数/层数） |
| `/nds-demo:store` | 存入手持物品（成功后清空手持槽；带扩容见证） |
| `/nds-demo:store-all` | 打开批量存入 UI（背包非空物品分页勾选 → 批量存入） |
| `/nds-demo:take <slotId>` | 按格子 ID 取出到背包（凭据取物 O(1)，跨模组可取；背包满自动放回） |
| `/nds-demo:overwrite <slotId>` | 手持物品**原位覆写**到指定格子（ItemStack → 格子，slotId 不变；空槽也允许——实时数据保存；旧物进背包/存回；异常位置拒绝） |
| `/nds-demo:take-all` | 打开批量取出 UI（当前区域凭据分页勾选 → 批量取出） |
| `/nds-demo:check` | **阵列自检 + 修复**：损坏木桶重建、丢失槽回收、洞池对齐（自检维护） |
| `/nds-demo:list` | 列出当前区域已存物品凭据 |
| `/nds-demo:stats` | 区域统计（含每桶槽数/层数/扩容进度）+ 世界全库汇总 |

命令注册走 startup + `customCommandRegistry`（toolkit `defineCommand` 封装：自动玩家校验、system.run 包装、参数按名解构）。`installNdsCommands()` 同时安装库自带的 `nds:regions` / `nds:stats` 管理命令（幂等）。

## 持久化键约定

| 键 | 内容 |
|------|------|
| `ndsdemo:cfg` | 演示配置 `{ enabled, dimension, anchorX, anchorZ, baseY, slotPerBarrel, maxLevels }`（默认末地 0,120,-1024 + 27 槽/64 层） |
| `ndsdemo:refs:p:{片}` | 本地凭据索引分片 `[{ regionId?, slotId, typeId, amount, storedAt }]`（每片 150 条，事件驱动同步，软状态；**带 regionId 并按当前区域过滤**；旧单键 `ndsdemo:refs` 兼容读取） |

存储本身（桶阵列 + 分配水印）用库的 `nds:item:{区域ID}` / `nds:item:{区域ID}:pool:{层}` / `nds:regions` 键，见 `../` 的键约定。

## 设计约定（新代码遵循）

- **薄适配**：命令/UI 只做转发与格式化，业务逻辑全部在 `storageService`（返回 `OpResult {ok, message}`，调用方统一 `§a/§c` 着色或 `colorOf`）。
- **防循环依赖**：`config.ts` 不 import `storageService`，应用动作经 `showConfigForm(player, { onApply })` 注入回调（ui/commands 接线 `storage.applyConfig(cfg, true)`）。`applyConfig` 返回 `string | null`（null=就绪/停用，字符串=失败原因，如布局冲突提示换锚点）。
- **测试注册渠道**：`applyConfig` 走 `ItemStorage.registerTest` 透传 `slotPerBarrel`/`maxLevels`（仅测试用途，正式模组请用 `register`）。**ID 语义恒定**：解码永远按 27 槽/桶，`slotPerBarrel` 只是每桶可分配槽数（分配跳过超限槽）——调整容量后旧物品的 ID 永不偏移；同区块布局参数不一致 → 注册抛错 → 提示更换锚点。
- **布局动态调整（三态决策）**：`applyConfig` 对目标区块（`ItemStorage.getRegion` 探测，无副作用）分三种处理——①参数完全一致 → 直接共享；②**测试区域（test:true）参数不一致** → `resizeLayout` 动态调层/调槽（层 1..64 扩缩、槽 0..27 任意，调整后自动重扫容器重建洞池），无需换锚点；③正式区域（无 test 标记）参数不一致 → 落注册 → 布局冲突拒绝 → 提示更换锚点。配置 UI 滑块 tooltip 已注明差异。
- **批量存入默认全选**：`showBatchStore` 的 toggle 全部 `defaultValue: true`——打开即全选，直接提交即存全部背包物品；取消勾选个别项再提交可排除。
- **阵列自检维护**：`/nds-demo:check`（主菜单「自检修复」按钮同入口）→ `StoredRegion.checkAndRepair`——木桶被挖/变空气 → 重建（内容随方块丢失无法找回，如实报告，`barrelRestored` 事件驱动凭据清理）；外部取走 → **桶级丢失报告**（第 N 层桶 M 丢失 X 件，水位对齐真值，容量恢复）；区块未加载跳过。巡检后桶水位与真值一致。
- **区域未初始化防护**：`applyConfig` **失败时保留上一个可用区域句柄**（只有显式停用才清空）；`ensureRegion` 在每次存取前惰性重试当前配置（解决"进世界过早操作/上次配置应用失败"导致的未初始化）。
- **凭据索引不扫描阵列**：`ndsdemo:refs` 只记本上下文见过的槽位（自己的 put + `ItemStorage.events` stored/taken/itemLost/removed 事件同步，按 regionId+slotId 幂等），UI 列表/`list` 命令来源于此——遵守库的 O(1) 纪律。**分片持久化**：凭据按每片 `REFS_PAGE_SIZE=150` 条分片存于 `ndsdemo:refs:p:{片}`（单条 DP 约 15KB < 32KB 上限，规避"存几百件就持久化失败"）；旧单键 `ndsdemo:refs` 兼容读取，写入即迁移。**丢失同步是必须的**：巡检确认丢失（itemLost 为**桶级事件** `{regionId, level, barrelInLevel, count, kind}`）→ `removeRefsInBarrel` 清该桶范围凭据；空槽 take（不触发 taken）→ 主动清凭据，否则 UI 残留"无法取出且已损坏"的记录。跨模组存入同一区域的物品也会经事件进入索引；切换锚点/布局后旧凭据按 regionId 过滤隐藏，切回原配置即恢复可见。
- **防丢物**：`takeToPlayer` 先 `take`（读出+清空+回收），再 `container.addItem` 给玩家；放不下的剩余部分 `put` 回区域并提示新槽位。批量取出一件失败不影响其他件（逐件独立）。
- **存储不复制**：存入在 `put` 成功返回凭据后才清空源槽（单件清手持、批量清对应背包槽）。
- **扩容见证**：存入前后对比 `stats().barrels`（meta.barrelCount，真正建桶才 +1），单件/批量汇报「新物化木桶 +N（x→y）」；菜单与 stats 显示桶进度百分比。
- **批量勾选 UI**：批量存入用**单页全量 ModalForm 开关**（背包 ≤36 格，无需分页，一次全选提交）；批量取出用分页 ModalForm（每页 `PAGE_SIZE=12` 个 toggle，凭据可达数百条防组件溢出），提交即处理本页勾选并自动弹下一页，可随时关闭；列表快照取自进入时的数据，已处理项重复点击会提示"槽位为空/没有物品"（幂等无害）。
- **无 node 单测**：demo 属 mc 适配/UI/交互层，按仓库约定靠游戏内冒烟验证（冒烟清单见下）。
- **需作弊开启**：区域注册自动挂 ticking area（OP 命令）；未开启时注册降级，`put`/`take` 可能返回 null/undefined（不崩溃）。

## 构建与提交

```bash
pnpm run build:nds-demo   # 根目录快捷（= pnpm --filter nds-demo run build）
pnpm run pack:nds-demo    # 产出 dist/packages/nds-demo-v<version>.mcpack
```

- 版本在 `package.json#version` 维护；构建自动同步 manifest，日常提交排除（`manifest.json`/`package.json` release-only）。
- commit message：`nds-demo@<新版本>: <中文描述>`；tag：`nds-demo@<版本>`。

## 游戏内冒烟清单

1. 部署 `.mcpack` 进游戏（世界需开启作弊）→ `/nds-demo:ui`，状态"启用"，区域 `2:0:-64`
2. `/nds-demo:config` 改锚点/维度保存 → 提示"已应用"；**改每桶槽数/层数**（如 1 槽 × 1 层 = 容量 256 格）→ 提示"已应用"，容量/桶数随配置变化
3. 手持附魔/自定义名物品 `/nds-demo:store` → 提示 `#0 ...` + 扩容见证「新物化木桶 +1（0→1）」；`/nds-demo:list` 出现凭据
4. `/nds-demo:store-all` → 背包物品**单页全量开关勾选** → 批量存入，消息含「已存入 N 件；扩容见证：新物化木桶 +N」
5. 1 槽/桶 × 1 层下反复批量存入 → 256 格堆满后提示「区域已满，剩余 N 件未存入」；`/nds-demo:stats` 显示已用 256/256、桶 256/256
6. `/nds-demo:take-all` → 凭据分页勾选 → 批量取出；`list` 中对应凭据消失
7. 同区块改布局（把 27 槽改成 1 槽重新保存）→ 提示「该区块已被布局…占用，测试区域请更换锚点」；换锚点后旧凭据隐藏、切回原配置恢复可见
8. 背包塞满后取出 → 提示「放回存储（新槽位 #N）」，物品不丢
9. 末地锚点区块上方可见木桶按使用逐个物化（1 槽/桶时每次存入都长一个新桶）