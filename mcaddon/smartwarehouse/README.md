# SmartWarehouse

Minecraft Bedrock Edition 智能仓库管理 Addon。基于 Script API 实现自动分拣、容器整理、仓库统计等功能。

> ⚠️ **测试版本** — 可能存在未发现的 bug，使用前请备份世界。

---

## 功能

### 仓库管理
- **创建仓库** — 交互式选区，手持木锄对空右键打开主菜单，或直接输入 `/sw:create` 命令划定仓库区域
- **调整区域** — 设置页随时修改仓库边界，支持缩放
- **删除仓库** — 设置页一键删除
- **边界光幕** — 开启后显示仓库 12 条棱的粒子线框，便于定位
- **多仓库支持** — 不同维度、不同区域可同时管理多个独立仓库

### 分拣系统
- **自动分拣** — 物品从 input 容器流入，按角色自动分配到 normal / misc / bulk 容器
- **优先级**：同类容器优先 → 空容器优先 → 大宗 → 杂项
- **家族白名单** — 仓库设置中勾选需要自动分拣的 51 个物品家族，未勾选的不会移动
- **轮询调度** — 多个 input 容器间负载均衡，轮流处理
- **区块加载预检** — 仓库区块未加载时静默跳过，避免错误
- **索引自愈** — 自动维护物品类型索引，无需手动刷新
- **区域感知** — 玩家 16 格外自动暂停调度，附近无玩家时仓库休眠

### 容器整理
- **SlotOrganizer** — 按物品 ID 排序合并，支持指定槽位范围
- **智能混乱度检测** — 相邻逆序对算法 + 堆叠优化率双重评估
- **自动整理** — 分拣后自动触发，阈值可调（0=每次整理 ~ 100=永不）
- **背包整理** — `/sw:organize` 一键整理玩家背包（快捷栏除外）
- **合箱/拆箱** — 数据继承（角色、启用状态、配置自动保留）

### 仓库统计
- **容器概况** — 设置页顶部显示各角色容器数量概览
- **容器详情** — 木锄点击箱子查看方块类型、槽位、物品数、种类、混乱度、最后更新时间

### 物品分类
- **51 个家族** — 全部 1431 个可分类物品按用途/来源划入互斥家族
- **分拣白名单** — 仓库设置中勾选需要自动分拣的家族，未勾选的不会移动
- **友好的掉落物/敌对掉落物** — 严格按掉落来源区分
- 附：完整分类列表见 [`docs/item-family-guide.md`](docs/item-family-guide.md)

### 其他
- 所有命令无需作弊即可使用（管理命令需 op 标签）
- 容器级写锁，防止整理与分拣冲突
- 生命周期监控 — 基于玩家接近度惰性激活/停用仓库

---

## 容器角色

| 角色 | 说明 |
|------|------|
| **input** | 输入容器，玩家存入待分拣物品，分拣引擎从此取物 |
| **normal** | 主存储，物品按家族归类存入最匹配的 normal 容器 |
| **misc** | 杂项容器，分类无法匹配的物品最终流向此处 |
| **bulk** | 大宗容器，同种物品大量存储时优先使用（含潜影盒自动拆填） |

漏斗默认自动识别为 **input** 角色，容器的角色和启用状态在 UI 中实时切换。

---

## 命令

| 命令 | 描述 | 权限 |
|------|------|------|
| `/sw:create <名称> <x1> <y1> <z1> <x2> <y2> <z2>` | 创建仓库 | op |
| `/sw:resize <名称> <x1> <y1> <z1> <x2> <y2> <z2>` | 调整仓库区域 | op |
| `/sw:rescan <名称>` | 重新扫描仓库容器 | op |
| `/sw:delete <名称>` | 删除仓库 | op |
| `/sw:organize` | 整理玩家背包 | 所有人 |

---

## 快速开始

1. 将行为包（`SmartWarehouse_BP.mcpack`）和资源包（`SmartWarehouse_RP.mcpack`）导入 Minecraft
2. 在世界设置中启用行为包和资源包
3. 手持木锄对空右键打开主菜单
4. 给自己添加 op 标签以使用管理命令：
   ```
   /tag @s add op
   ```
5. 创建仓库开始使用

### 权限说明

- **管理命令**（create / resize / rescan / delete）：需要 op 标签
- **公共命令**（organize）：所有玩家可用
- **木锄交互**：非管理员只读查看容器信息，管理员可修改

---

## 构建与开发

### 环境要求
- Node.js ≥ 18
- npm ≥ 9

### 构建步骤

```bash
npm install
npx tsc
```

编译产物输出到 `lib/` 目录，需手动部署到行为包的 `scripts/` 目录。

### 一键打包（.mcaddon）

```bash
npm run mcaddon
```

输出文件位于 `dist/packages/`。

### 维护工具

| 工具 | 说明 |
|------|------|
| `tools/generateItemFamilies.mjs` | 重新生成物品家族分类（修改 `tools/generateItemFamilies.mjs` 中的 `ALL.*` 后需运行） |
| `tools/annotateFamilies.mjs` | 为 `ItemFamilies.ts` 注入中文注释（从 `scripts/data/name-maps/` 查询译名） |

修改流程：编辑生成器 → `node generateItemFamilies.mjs` → `node annotateFamilies.mjs` → `npx tsc`

---

## 项目结构

```
BP/                   行为包（manifest.json + scripts 编译产物）
RP/                   资源包（manifest.json + 纹理/声音）
scripts/              TypeScript 源码
  main.ts             入口文件（初始化依赖、注册事件和命令）
  types.ts            集中式类型定义
  commands/           命令路由层
  data/               数据文件（物品家族分类、中文名映射）
    ItemFamilies.ts   51 家族 / 1431 物品
    name-maps/        中文译名映射表
  interaction/        工具交互（木锄右键/方块事件处理）
  runtime/            运行时缓存层（内存索引、惰性重建）
  sorting/            分拣引擎和调度器
  storage/            持久化层（Minecraft Dynamic Property）
  ui/                 玩家交互界面（ActionForm / ModalForm）
  util/               工具函数（日志、坐标、JSON、权限）
  warehouse/          核心业务逻辑（仓库 CRUD、容器扫描）
tools/                维护工具
  generateItemFamilies.mjs  物品家族生成器
  annotateFamilies.mjs      中文注释注入器
docs/
  item-family-guide.md      物品分类完整列表
  routing-flow.md           分拣路由流程说明
```

---

## 技术栈

- **语言**：TypeScript（ES6 target, strict 模式）
- **运行时**：Minecraft Bedrock Script API（`@minecraft/server` ^2.6.0）
- **UI**：`@minecraft/server-ui`（ActionForm / ModalForm）
- **构建**：TypeScript 编译器 + just-scripts
- **代码规范**：Prettier + ESLint（`eslint-plugin-minecraft-linting`）
- **文档**：`docs/` 目录包含架构文档、分类指南等

---

## 许可证

MIT
