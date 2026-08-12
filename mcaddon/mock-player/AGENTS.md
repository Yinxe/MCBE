# MockPlayer — 模拟玩家

Minecraft Bedrock 模拟玩家（假人）Add-On，TypeScript + Minecraft Script API。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
# 构建
just-scripts build              # sync-version → tsc → esbuild bundle
just-scripts mcaddon            # 打 .mcaddon 发行包
just-scripts local-deploy       # watch 模式
just-scripts lint               # ESLint
just-scripts clean              # 清理

# core 单测（node:test + node:assert/strict）
pnpm run test:core   # tsc -p tsconfig.test.json → node --test .test-build/tests
```

---

## 架构（六边形分层，对齐 item-route）

```
scripts/
├── main.ts          # 4-Phase DI 组合根（只装配，不含业务）
├── core/            # 领域层：零 @minecraft 依赖，可 node 单测
│   ├── model/       # Types.ts — BotRecord/SerializedItemStack/常量（Vec3/Vec2 本地化）
│   ├── events/      # EventSignal（零依赖信号）+ DomainEvents（raidStarted/raidVictory）
│   ├── tags/        # BotTags — 标签定义/分组/四级解析（resolveTag）
│   ├── coords/      # Coordinate（容错坐标解析）+ Direction（旋转→方向）
│   ├── xp/          # XpMath — MC 经验公式
│   ├── format/      # Format（维度/罗马数字）+ EnchantZh（附魔中英映射）
│   ├── items/       # ItemRules（装备槽）/ ToolRules（工具识别/耐久/槽位搜索）
│   │                # MainhandPolicy（主手策略）/ TridentRules（三叉戟扫描）
│   ├── storage/     # BotStore / IntervalScheduler 端口 + InMemory 替身
│   ├── service/     # BotRegistry（注册表生命周期+恢复标记）/ ReclaimPlanner / RaidRules
│   └── index.ts     # barrel
├── mc/              # 适配层：只做 mcapi 副作用（IO/视觉/通知）
│   ├── bootstrap/   # context.ts — botStore/botRegistry 运行时单例（组合根装配）
│   ├── adapters/    # McBotStore（DP 持久化）/ McItemCodec（序列化）/ PlayerGateway
│   │                # EntityTags / PoseGateway / McIntervalScheduler / EquipmentSlots
│   ├── features/    # 业务用例：决策调 core，副作用留本地（behavior/spawn/reclaim/raidMode…）
│   ├── commands/    # mp:* 命令（薄壳）
│   ├── events/      # 世界事件订阅（薄壳）
│   ├── ui/          # toolkit 表单（纯展示）
│   └── format.ts    # 带色文本格式化（§ 色码）
└── tests/           # node:test 单测（只测 core；mc 层靠游戏内冒烟）
    ├── helpers/     # factories（构造 BotRecord/物品）
    └── *.test.ts    # model/tags/coords/xp/items/services/storage/events/format
```

### 依赖纪律（core 层强约束）

- **core 零 `@minecraft/*`、零 `@yinxe/toolkit` 导入**（grep 校验 + tsconfig.test.json 单独编译进 node 测试双重兜底）
- core 类型本地化：`Vector3/Vector2` → `Vec3/Vec2` 数值接口；`EquipmentSlot` 枚举 → 字符串槽名（mc 边界经 `adapters/EquipmentSlots` 转换）
- 领域事件负载只用可序列化 string/number，不携带 mc 对象
- 端口（`BotStore`/`IntervalScheduler`）定义 + InMemory 实现在 core，mc 层实现同接口；core 服务构造注入端口，不自行 new 外部依赖

### 测试纪律

- core 纯逻辑必须有单测（node:test，`pnpm run test:core`）
- mc 适配/UI/交互层改动靠游戏内冒烟（不进 node 测试）

---

## 关键约定

### 消息着色
```
§a = 绿色（成功）   §c = 红色（错误）     §e = 黄色（假人名）
§7 = 灰色（辅助）   §b = 青色（状态变更）  §f = 白色（坐标）
```

### 命令
- 前缀 `mp:`（如 `/mp:create`, `/mp:list`）
- 在 `system.beforeEvents.startup` 注册
- 受限 API 用 `system.run()` 包装

### 标签系统
- 共存标签：`bot` / `respawn` / `autoJump`
- 互斥标签：`idle` / `autoMine` / `autoPlace` / `autoAttack` / `control` / `autoUse` / `vaultMode`
- 独立开关标签：`raidMode`
- 新假人默认：`bot` + `respawn` + `idle`

### 持久化（McBotStore 实现 BotStore 端口）
- `world.setDynamicProperty` 存储 `BotRecord` JSON
- Key 格式:
  - `mockplayer:players:<name>` — BotRecord（单条，32KB 上限内）
  - `mockplayer:players:<name>:inv:<N>` — 背包第 N 格（每格独立 key）
  - `mockplayer:players:<name>:equip:<X>` — 装备槽（head/chest/legs/feet/offhand）
- Entity `addTag` 不持久化，从 `BotRecord.tags` 恢复
- 恢复标记（BotRegistry.restoredBots）：防 spawnSimulatedPlayer 空背包覆盖持久化数据

### 刷物防护（死亡物品策略，`core/service/InventoryLifecycle`）
- 假人死亡时以**世界游戏规则为准**（`world.gameRules.keepInventory`，不依赖 entityDie 时实体背包的运行时状态）：
  - `keepInventory=false`（死亡掉落）→ 引擎掉落物是物品离开假人的**唯一副本**，持久化背包/装备**显式清空**（`botStore.removeInventory`）——无论 entityDie 回调时实体背包是否已被引擎清空（时序差异），都不会出现"掉落 + 重连恢复"双份
  - `keepInventory=true`（死亡不掉落）→ 物品继续属于假人，保存当前背包，重生/重连不丢物
- entityDie 中**先置 `record.death=true` 再处理物品**：关闭 100tick 周期保存的竞态窗口（behavior 引擎跳过死亡假人）
- 决策函数 `decideDeathInventoryPolicy(keepInventory)` 为 core 纯函数；物品守恒由 `tests/inventory-lifecycle.test.ts` 模拟测试锁定（4 组合：keepInventory × 引擎时序 + 重复击杀序列）

### 运行时单例
- `mc/bootstrap/context.ts` 导出 `botStore` / `botRegistry` / `configStore` 单例（mc 层共享，等价旧 persistence.ts 的模块级 botRegistry）
- core 测试不经过 context：自行 `new BotRegistry(new InMemoryBotStore())`

---

## 玩家隔离与权限

### 主人（ownerName）
- `BotRecord.ownerName` = 创建者玩家名（玩家重连实体 ID 会变但 name 稳定，**只存 name 不存 ID**）
- 存量假人无 ownerName = 无主，仅管理员可管理；无主假人不参与下线联动/认主/配额
- 假人面板显示主人；改名（rename）不影响 ownerName

### 管理员判定（`mc/commands/auth.ts`）
- `isAdmin(player)` = OP（toolkit `canManage`）**或** 配置名单 `config.admins` 内玩家
- `canManageBot(player, record)` = isAdmin 或 record.ownerName === player.name
- 权限应用：假人面板入口（ui/bot.ts）、在线管理 toggle（ui/online.ts）、全部修改类命令（delete/kill/control/sneak/tag add-remove/setrespawn/tp/tphere/move/offline/online/reclaim/follow/trident/recover）；只读命令（list/data/tags list）不限

### 配额（`core/service/QuotaRules` + `McConfigStore`）
- 全局配置单键 DP `mockplayer:config`：`{ defaultQuota: 5, quotas: {玩家: 数}, admins: [] }`
- 每玩家配额 = `quotas[name] ?? defaultQuota`；0 = 禁止创建；**管理员（OP 或名单）豁免配额**
- 配额按主人名下现存记录数（含离线）统计；删除/回收释放名额
- 管理员菜单：`/mp:admin` 或主菜单"⚙ 管理员菜单"（仅 isAdmin 可见）

### 下线联动
- 真实玩家 playerLeave → 该 ownerName 名下全部在线假人 `offlineBot` 安全下线（events/playerLeave.ts）
- 假人 playerLeave 走原假人路径（registry 命中），不受联动影响

---

## 投掷物双任认主（三叉戟/箭）

### tag 约定（`core/items/TridentClaimRules`）
- `mp:owner:<name>` — 第一任主人（实际投掷者，玩家或假人皆可）
- `mp:owner2:<name>` — 第二任主人（仅假人，可被后续假人覆盖复写）
- **不兼容旧格式 `mp:trid:<name>`**（旧三叉戟 tag 失效，不做迁移）
- 覆盖投掷物 typeId：`minecraft:thrown_trident` + `minecraft:arrow`（arrow 含药水箭，API 无法细分）

### 双认主机制（`mc/features/tridentTracker.ts`）
1. **投掷即标记**：entitySpawn 时以投射物 owner（投掷者）打第一任 tag（假人投掷 → 第一任即该假人）
2. **fallback 认主**：entityLoad 时按优先级认主——**第二任在线 > 第一任在线**（`resolveClaimOwner` 纯函数）；都离线不动等上线夺回
3. **上线夺回**：假人上线（playerJoin/playerSpawn）→ `rebindBotTridents` 扫第一/第二任含自己的三叉戟重设 owner

### 认主 UI（ui/tridentClaim.ts，面板"三叉戟认主"按钮）
- 扫描假人 100 半径（当前维度）内三叉戟，过滤**自家**（第一/第二任 ∈ 家族集合 = 主人名 ∪ 主人名下假人名）
- 附魔/耐久展示经 `EntityItemComponent.itemStack`；**组件缺失直接跳过该条**（不显示"未知"）
- **聚集概率**（`core/coords/Cluster.ts`）：邻居密度归一化（半径 15 判定），扎堆概率大；列表按概率降序（百分比展示）
- 批量 toggle 勾选 → 认主 = 写/覆盖第二任 tag + 重设 proj.owner

---

## 踩坑记录

见 `BLACKLIST.md`（处理 spawnSimulatedPlayer、lookAtLocation、death/respawn 事件顺序、beforeEvents 权限限制等坑点）。

---

## 依赖版本

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.6.0（根 overrides 收敛 2.8.0） |
| @minecraft/server-ui | 2.0.0 |
| @minecraft/server-gametest | 1.0.0-beta.1.26.0-stable |
| @minecraft/math | 2.2.7 |
| @minecraft/vanilla-data | 1.26.20 |
| @minecraft/core-build-tasks | 5.5.0 |