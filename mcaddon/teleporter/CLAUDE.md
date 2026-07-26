# Teleporter — 传送

Minecraft Bedrock 传送管理 Add-On，TPA/TPHERE、传送点、死亡传送。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
just-scripts build              # sync-version → tsc → esbuild bundle
just-scripts mcpack             # 打 .mcpack 发行包
just-scripts local-deploy       # watch 模式
just-scripts lint               # ESLint
just-scripts clean              # 清理
```

---

## 架构

```
scripts/
├── main.ts          # 入口：命令注册、事件订阅、延迟启动
├── commands/        # 每条命令独立文件（index.ts 统一注册）
│   ├── index.ts     # registerAllCommands() 桶文件
│   ├── menu.ts      # /tpa:menu
│   ├── warp.ts      # /tpa:warp /tpa:setwarp /tpa:delwarp /tpa:warps
│   ├── back.ts      # /tpa:back
│   ├── deathpoints.ts  # /tpa:deathpoints
│   ├── tpa.ts       # /tpa:tpa /tpa:tpaccept /tpa:tpadeny /tpa:tphere
│   ├── public.ts    # /tpa:public /tpa:publiclist
│   └── admin.ts     # /tpa:admin /tpa:config
├── events/          # 事件订阅
│   ├── index.ts     # registerAllEvents()
│   ├── death.ts     # entityDie → 记录死亡点
│   └── spawn.ts     # playerSpawn → 死亡传送对话框
├── teleporter/      # 核心业务逻辑
│   ├── types.ts     # 所有类型/接口定义
│   ├── config.ts    # ModConfig 读写
│   ├── persistence.ts # DynamicProperty 玩家数据读写
│   ├── adminManager.ts # 管理员判断（tag=op / 原生 OP）
│   ├── teleportManager.ts # 安全传送执行
│   ├── waypointManager.ts # 传送点 CRUD + 公共查询
│   ├── deathManager.ts # 死亡记录管理
│   └── detection.ts # 群系检测 + 结构识别（村庄/古城/堡垒等）
└── ui/              # ActionForm/ModalForm UI
    ├── menu.ts      # 主菜单
    ├── warps.ts     # 传送点列表（分页/排序/操作）
    ├── publicWarps.ts # 公共传送点列表
    ├── deathpoints.ts # 死亡点列表
    ├── playerTeleport.ts # 玩家传送菜单
    └── admin.ts     # 管理配置页
```

---

## 命令列表

| 命令 | 描述 | 参数 |
|------|------|------|
| `/tpa:menu` | 打开传送管理菜单 | 无 |
| `/tpa:warp <名称>` | 传送到指定传送点 | name |
| `/tpa:setwarp <名称>` | 在当前位创建传送点 | name |
| `/tpa:delwarp <名称>` | 删除传送点 | name |
| `/tpa:warps` | 列表所有传送点 | 无 |
| `/tpa:back` | 传送到最近死亡点 | 无 |
| `/tpa:deathpoints` | 查看死亡点列表 | 无 |
| `/tpa:tpa <玩家>` | 请求传送到玩家身边 | player |
| `/tpa:tphere <玩家>` | 请求玩家传送到自己 | player |
| `/tpa:tpaccept` | 接受传送请求 | 无 |
| `/tpa:tpadeny` | 拒绝传送请求 | 无 |
| `/tpa:public <名称>` | 切换公共传送点 | name |
| `/tpa:publiclist` | 查看公共传送点 | 无 |
| `/tpa:admin` | 管理设置（OP） | 无 |
| `/tpa:config` | 查看配置（OP） | 无 |

---

## 关键约定

### 消息着色
```
§a = 绿色（成功）   §c = 红色（错误）     §e = 黄色（玩家名/传送点名）
§7 = 灰色（辅助）   §b = 青色（标题）      §f = 白色（坐标/数值）
```

### 命令
- 前缀 `tpa:`（如 `/tpa:warp`, `/tpa:back`）
- 所有命令 `cheatsRequired: false` + `permissionLevel: Any`（保持成就可用）
- 在 `system.beforeEvents.startup` 注册

### 持久化
- `world.setDynamicProperty` 存储玩家数据
- Key 格式: `teleporter:player:<playerId>` → PlayerData JSON
- Key 格式: `teleporter:config` → ModConfig JSON
- Key 格式: `teleporter:players` → 玩家 ID 索引数组

### 管理员
- 同时支持原生 OP 和 `tag=op` 标签两种方式
- 见 `adminManager.ts`

### 传送点排序
- 置顶 → 传送次数（降序）
- 公共传送点同样按次数排序

### 智能检测
- 新建传送点时自动使用 `Dimension.getBiome()` 检测群系名称
- 同时通过方块检测识别附近结构（村庄/古城/下界堡垒/堡垒残骸/末地城/沙漠神殿/海底神殿/林地府邸/要塞）
- 检测结果自动填入名称/分类/备注，详见 `detection.ts`
- 群系映射表覆盖 60+ 种 Minecraft 生物群系，均映射为中文名

---

## 依赖版本

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.6.0 |
| @minecraft/server-ui | 2.0.0 |
| @yinxe/toolkit | workspace:* |
| @minecraft/core-build-tasks | 5.5.0 |

### 成就兼容
- 所有命令 `cheatsRequired: false` + `permissionLevel: Any`
- 使用 Script API `player.teleport()` 而非 `/teleport` 命令
- 模组本身 **不会禁用成就**

### 消息格式
- 传送成功: `§a已传送到 §e{名称} §7（§7{维度} §f{坐标}§7）`
- 传送失败: `§c传送失败，{原因}`
- 空状态: `§7{提示信息}`
