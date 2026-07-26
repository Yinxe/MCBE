# Enchanter — 高级附魔

Minecraft Bedrock 高级附魔管理 Add-On，突破原版附魔等级上限。

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
├── main.ts              # 入口：命令注册、延迟启动
├── commands/
│   ├── index.ts         # registerAllCommands()
│   └── menu.ts          # /en:menu
├── enchanter/
│   ├── types.ts         # 类型定义
│   └── enchantManager.ts # 核心附魔读写逻辑 + 分析
└── ui/
    └── menu.ts          # 主菜单（分析 + 铭刻 / 超限）
```

---

## 命令列表

| 命令 | 描述 |
|------|------|
| `/en:menu` | 打开高级附魔菜单 |

---

## 核心功能

### 附魔铭刻 (Inscription)
在物品上增加一个全新的附魔词条。支持选择附魔类型和等级，不限制原版互斥规则（可以同时拥有锋利和亡灵杀手等）。

### 附魔超限 (Overlimit)
将物品上已有的附魔等级提升至突破原版上限，最高 X 级。每级提升需要消耗对应代价（MVP 阶段暂未实现）。

---

## 关键约定

### 命令
- 前缀 `en:`（如 `/en:menu`）
- 所有命令 `cheatsRequired: false` + `permissionLevel: Any`（保持成就可用）

### 成就兼容
- 依赖版本使用 stable 数组格式 `[2, 6, 0]`
- `metadata.product_type: "addon"`
- 不使用任何禁用成就的 API

### 消息着色
- `§a` 成功  `§c` 错误  `§e` 物品名  `§f` 数值  `§b` 标题

---

## 已知限制

- 需要 **Beta APIs** 实验性功能（创建世界时在「实验性游戏内容」中开启）
- 启用 Beta APIs 的**世界无法获得成就**
- 这是 Mojang 引擎层的限制，模组无法绕过
