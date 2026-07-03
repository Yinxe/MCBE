# SmartWarehouse

Minecraft Bedrock Edition 智能仓库管理 Addon。基于 Script API 实现自动分拣、容器整理、仓库统计等功能。

> ⚠️ **测试版本** — 可能存在未发现的 bug，使用前请备份世界。

---

## 功能

### 仓库管理
- **创建仓库** — 交互式选区，木锄点两个对角点即可划定仓库区域
- **调整区域** — 随时修改仓库边界，支持缩放
- **删除仓库** — 设置页一键删除
- **边界光幕** — 开启后显示仓库 12 条棱的粒子线框

### 分拣系统
- **自动分拣** — 物品从 input 容器流入，按角色分配到 normal / misc / bulk 容器
- **优先级**：同类容器 → 空容器 → 大宗 → 杂项
- **索引自愈** — 自动维护物品类型索引，无需手动刷新

### 容器整理
- **SlotOrganizer** — 按物品 ID 排序合并，支持指定槽位范围
- **智能混乱度检测** — 相邻逆序对算法 + 堆叠优化率
- **自动整理** — 分拣后自动触发，阈值可调（0=每次整理 ~ 100=永不）
- **背包整理** — `/sw:organize` 一键整理背包（快捷栏除外）

### 仓库统计
- **容器概况** — 设置页顶部显示各角色容器数量
- **容器详情** — 木锄点击箱子查看方块类型、槽位、物品数、种类、混乱度

### 物品分类
- **51 个家族** — 全部 1431 个可分类物品按用途/来源划入互斥家族
- **分拣白名单** — 仓库设置中勾选需要自动分拣的家族，未勾选的不会移动
- **友好的掉落物/敌对掉落物** — 严格按掉落来源区分
- 附：完整分类列表见 [`docs/item-family-guide.md`](docs/item-family-guide.md)

### 其他
- 所有命令无需作弊即可使用（管理命令需 op 标签）
- 合箱/拆箱数据继承（角色/启用状态保留）
- 容器级写锁，防止整理与分拣冲突
- 玩家 16 格外自动暂停调度，节省性能

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

1. 将此行为包（`SmartWarehouse_BP.mcpack`）和资源包（`SmartWarehouse_RP.mcpack`）导入 Minecraft
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

## 构建

```bash
npm install
npx tsc
```

编译产物输出到 `lib/` 目录，需手动部署到行为包的 `scripts/` 目录。

## 维护工具

| 工具 | 说明 |
|------|------|
| `tools/generateItemFamilies.mjs` | 重新生成物品家族分类（修改 `tools/generateItemFamilies.mjs` 中的 `ALL.*` 后需运行） |
| `tools/annotateFamilies.mjs` | 为 `ItemFamilies.ts` 注入中文注释（从 `scripts/data/name-maps/` 查询译名） |

修改流程：编辑生成器 → `node generateItemFamilies.mjs` → `node annotateFamilies.mjs` → `npx tsc`

---

## 技术栈

- **语言**：TypeScript
- **运行时**：Minecraft Bedrock Script API (`@minecraft/server` ^2.6.0)
- **构建**：TypeScript 编译器
- **文档**：`docs/` 目录包含架构文档、分类指南等

---

## 许可证

MIT
