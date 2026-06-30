# MockPlayer

Minecraft Bedrock 模拟玩家（假人）Add-On。基于 `@minecraft/server` Script API + `spawnSimulatedPlayer`，提供完整的假人创建、管理、行为控制和数据持久化功能。

## 功能

- **创建模拟玩家** — 在当前位置或指定坐标生成假人（`/mp:create`）
- **在线/离线管理** — 上线（重新生成）、下线（保存状态并断开）（`/mp:online` `/mp:offline`）
- **传送** — TPHERE（假人传送到玩家）、TPA（玩家传送到假人）（`/mp:tphere` `/mp:tp`）
- **移动** — 假人自动寻路到目标位置（`/mp:move`）
- **自动行为** — 通过标签系统控制：自动挖掘、自动攻击、自动跳跃、自动放置
- **体态控制** — 控制模式让假人跟随玩家的位置和朝向
- **潜行** — 切换假人潜行状态（`/mp:sneak`）
- **装备管理** — 交换主手/副手/全部装备、一键卸甲
- **标签系统** — 灵活的行为标签，支持共存标签与互斥标签分组
- **物品回收** — 回收假人的全部物品和经验到玩家背包
- **数据持久化** — 世界重启后自动恢复假人记录、背包、装备和经验
- **交互操作** — 手持木棍打开 UI 菜单、点击假人打开操作面板
- **批量在线管理** — 图形界面批量切换假人在线状态

## 命令

所有命令以 `mp:` 为前缀：

| 命令 | 描述 |
|---|---|
| `/mp:create [name] [location] [dimension]` | 创建模拟玩家 |
| `/mp:list` | 列出所有假人 |
| `/mp:online <name>` | 假人上线 |
| `/mp:offline <name>` | 假人下线 |
| `/mp:kill <name>` | 杀死假人 |
| `/mp:tp <name>` | 传送到假人 |
| `/mp:tphere <name>` | 假人传送到身边 |
| `/mp:move <name> <location>` | 假人移动到目标位置 |
| `/mp:control <name>` | 切换控制模式 |
| `/mp:sneak <name>` | 切换潜行状态 |
| `/mp:tag <name> <add\|remove\|list> [tag]` | 管理标签 |
| `/mp:tags` | 列出所有可用标签 |
| `/mp:respawn <name>` | 假人重生 |
| `/mp:setRespawn <name>` | 设置重生点 |
| `/mp:delete <name>` | 删除假人（可回收物品） |
| `/mp:reclaim <name>` | 回收假人物品和经验 |
| `/mp:data <name>` | 查看假人详细数据 |
| `/mp:menu` | 打开主菜单 |

## 标签系统

### 共存标签（可同时拥有多个）
| 标签 | 效果 |
|---|---|
| `bot` | 假人标识（默认） |
| `respawn` | 自动重生（默认） |
| `autoJump` | 自动跳跃 |

### 互斥标签（同一时间只能一个生效）
| 标签 | 效果 |
|---|---|
| `idle` | 无状态（默认） |
| `autoMine` | 自动挖掘前方的方块 |
| `autoPlace` | 持续放置模式 |
| `autoAttack` | 自动攻击 |
| `control` | 体态控制模式（跟随玩家） |

## UI 交互

- 手持 **木棍** 右键/使用 → 打开主菜单
- **站立** + 点击假人 → 打开操作面板
- **潜行** + 点击假人 → 打开标签管理

## 安装

1. 下载 `.mcaddon` 发行包
2. 双击导入 Minecraft
3. 在行为包和资源包中启用 MockPlayer
4. 进入世界，使用 `/mp:create` 创建假人

### 需求

- Minecraft Bedrock 1.26.0+
- 世界开启「测试版 API」或「Beta APIs」
- 需要作弊权限

## 开发

### 前置
- Node.js 18+
- 安装依赖后执行 `npm install`
- 确保 `.env` 文件包含 `PROJECT_NAME` 配置

### 构建
```bash
just-scripts build        # 构建（tsc → esbuild）
just-scripts local-deploy # 开发：watch 模式自动构建并部署
just-scripts mcaddon      # 打 .mcaddon 发行包
just-scripts lint         # ESLint 检查
```

### 架构
```
scripts/
├── main.ts               # 入口：命令注册、持久化恢复、事件监听
├── commands/             # 每条命令独立文件
├── features/             # 核心业务逻辑
│   ├── types.ts          # 类型与常量
│   ├── operations.ts     # 核心操作
│   ├── persistence.ts    # 全局状态 + DynamicProperty 持久化
│   ├── behavior.ts       # 标签行为引擎（轮询模式）
│   ├── tags.ts           # 标签系统
│   └── utils.ts          # 工具函数
├── events/               # 事件处理（entityDie/playerSpawn/Join/Leave 等）
└── ui/                   # ModalFormData UI
```

### 依赖版本
| 包 | 版本 |
|---|---|
| `@minecraft/server` | 2.6.0 |
| `@minecraft/server-ui` | 2.0.0 |
| `@minecraft/server-gametest` | 1.0.0-beta |
| `@minecraft/math` | 2.2.7 |
| `@minecraft/vanilla-data` | 1.26.20 |

## 许可证

MIT
