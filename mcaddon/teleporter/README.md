# 传送 Teleporter

Minecraft Bedrock 传送管理模组（行为包，无资源包）。提供传送点（warp）、玩家间传送请求（TPA / TPHERE）、死亡传送（back）、公共传送点、传送信物、群系自动检测等完整传送功能。

| 项目 | 信息 |
|------|------|
| 包名 | teleporter |
| 版本 | 0.0.6 |
| 显示名 | 传送 |
| 产物 | teleporter-v0.0.6.mcpack（仅 BP） |
| 最低引擎版本 | 1.21.120 |
| 依赖 | @minecraft/server 2.6.0、@minecraft/server-ui 2.0.0 |

## 特性

- **传送点（warp）**：创建 / 删除 / 传送 / 置顶 / 公开切换，支持传送计数排序与群系自动识别
- **玩家间传送（TPA / TPHERE）**：传送请求带 UI 确认，60 秒超时自动清理，支持跨维度传送
- **死亡传送（back）**：自动记录死亡点（最多 10 条），可一键返回或列表选择
- **公共传送点**：可公开分享自己的传送点（受配置开关限制），分页浏览
- **传送信物**：首次进服自动发放，手持右键打开传送菜单（不可合成、不可交易）
- **群系自动检测**：新建传送点时自动识别 60+ 生物群系并填入中文名与分类
- **不禁用成就**：所有传送通过 Script API `player.teleport()` 执行（不使用 `/teleport` 命令），全部命令 `cheatsRequired: false` + `permissionLevel: Any`

## 命令列表

所有命令前缀为 `tpa:`，共 16 条，全部无需作弊权限。

| 命令 | 参数 | 描述 |
|------|------|------|
| `/tpa:menu` | 无 | 打开传送管理菜单 |
| `/tpa:warp` | `[name]` | 传送到指定传送点；不带名称打开选择界面 |
| `/tpa:setwarp` | `<name>` | 在当前位创建传送点（自动检测群系） |
| `/tpa:delwarp` | `<name>` | 删除指定传送点 |
| `/tpa:warps` | 无 | 打开传送点选择界面 |
| `/tpa:back` | 无 | 传送到最近的死亡点 |
| `/tpa:deathpoints` | 无 | 查看并传送至死亡点 |
| `/tpa:tpa` | `<player>` | 请求传送到指定玩家身边 |
| `/tpa:tphere` | `<player>` | 请求指定玩家传送到自己身边 |
| `/tpa:tpaccept` | 无 | 接受传送请求 |
| `/tpa:tpadeny` | 无 | 拒绝传送请求 |
| `/tpa:public` | `<name>` | 切换传送点是否公开（受配置开关限制） |
| `/tpa:publiclist` | 无 | 查看所有公共传送点 |
| `/tpa:token` | 无 | 获得传送信物（右键打开传送菜单） |
| `/tpa:admin` | 无 | 管理配置界面（需 OP 或 tag=op） |
| `/tpa:config` | 无 | 查看当前模组配置（需 OP 或 tag=op） |

## 核心机制

### 传送执行

所有传送通过 `player.teleport(loc, { dimension })` 执行，使用 try-catch 包裹并返回布尔值。不使用 `/teleport` 命令，**不会禁用成就**。

### 传送点

- 支持 CRUD 操作，可置顶、切换公开、记录传送次数
- 排序规则：**置顶优先 → 传送次数降序**
- 同名传送点拒绝创建；坐标向下取整存储
- 分类：家 / 资源点 / 生电 / 遗迹 / 群系 / 其他

### 死亡点

- 监听 `entityDie` 事件（仅玩家）自动记录死亡位置
- 最多保留 10 条，超出时移除最旧记录
- `/tpa:back` 传送至最新死亡点；死亡时弹出重生对话框显示死亡位置 / 时间 / 距离

### TPA 请求

- 内存 Map 按目标玩家 ID 存储请求，60 秒超时自动清理
- 新请求覆盖旧请求，并通知原请求方
- 跨维度传送自动处理
- TPA 请求不持久化，重启后清空

### 传送信物

- 物品：`minecraft:paper`（纸）
- `nameTag`：「传送信物」，`lore`：「右键打开传送菜单」
- 属性：`keepOnDeath: true` + `lockMode: inventory`
- 通过 `beforeEvents.itemUse` / `playerInteractWithBlock` 拦截右键打开主菜单
- 首次进服自动发放；背包满时忽略，可用 `/tpa:token` 再次获取
- 防止信物被合成 / 交易

### 群系检测

- 使用 `dimension.getBiome()` 自动识别所在群系
- 映射表覆盖 60+ 生物群系 → 中文名（主世界 / 下界 / 末地全覆盖）

### 管理员判定

原生 OP 权限 或 玩家带 `op` 标签，满足其一即为管理员（用于 `/tpa:admin`、`/tpa:config` 及主菜单管理入口）。

## 数据持久化

使用世界 DynamicProperty 存储，键格式如下：

| Key | 内容 |
|-----|------|
| `teleporter:player:<playerId>` | PlayerData JSON：`{ waypoints, deathPoints }` |
| `teleporter:players` | 有数据玩家的 ID 索引数组 |
| `teleporter:config` | ModConfig JSON：`{ maxWaypointsPerPlayer=30, publicWaypointEnabled=true }` |

## UI 菜单

- **主菜单**：传送 / 管理传送点 / 新建 / 公共 / 死亡 / 玩家传送（管理员另有设置入口）
- **传送点选择器**：显示 ★置顶、群系、维度、坐标、传送次数
- **传送点管理表单**：编辑传送点信息
- **公共传送点列表**：分页浏览，每页 8 条
- **死亡点列表**：分页浏览，每页 8 条，显示相对时间
- **TPA 请求 UI**：✓ 接受 / ✗ 拒绝
- **管理设置**：单人最大传送点数 slider（10-100，步进 5）、启用公共传送点 toggle
- **死亡重生对话框**：显示死亡位置 / 时间 / 距离

## 开发

```bash
pnpm run build:teleporter   # 编译（TypeScript → esbuild）
pnpm run pack:teleporter    # 打包（BP → .mcpack）
```

详细架构与规范见 [CLAUDE.md](./CLAUDE.md)。

## 版本历史

| 版本 | 说明 |
|------|------|
| v0.0.3 | 初始版本 |
| v0.0.4 | 修复 beforeEvents 上下文中 ActionForm.show() 包 system.run() |
| v0.0.5 | 修复公共传送点开关未隐藏已有公开点；优化信息展示格式 |
| v0.0.6 | 新增 TPA 请求 UI；防止信物被合成/交易 |
