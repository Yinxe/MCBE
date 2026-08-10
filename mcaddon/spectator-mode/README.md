# 灵魂出窍 🎥

**灵魂出窍 · 旁观模式**

玩家用 `/sp:soul` 变身旁观者飞离真身，可在世界里自由观察；行动范围受"最大距离"限制，超出进入 5 秒容忍倒计时，耗尽自动回归本体。管理员用 `/sp:soul menu` 管理开关与最大距离。

---

## 玩法

1. 输入 `/sp:soul` 进入旁观模式（灵魂出窍），真身位置出现标记粒子。
2. 以旁观者身份自由飞行移动。
3. 头顶显示「灵魂出窍 + 距离」，距离越接近上限颜色由绿变红。
4. 超出最大距离 → 红色警告「超出！ N 秒后强制回归」；回到范围内恢复正常。
5. 5 秒容忍倒计时结束 → 强制传回真身，还原之前的维度/位置/游戏模式。
6. 随时输入 `/sp:soul` 手动回归本体。

> 📌 旁观模式下会以隐形、可穿透、不可交互的形式移动（Minecraft 原生观众模式）。

## 管理

| 命令 | 说明 |
|------|------|
| `/sp:soul` | 任意玩家：切换旁观 / 回归本体 |
| `/sp:soul menu` | 管理员（OP）：启用/禁用功能 · 配置最大移动距离（5~400m） |

> ⚠️ **极限模式**：本世界为极限模式时灵魂出窍自动禁用（游戏模式切换单向），入服会收到提示。

## 构建

```bash
pnpm install                    # 安装依赖
pnpm run build:spectator-mode   # TypeScript 编译
pnpm run test:core              # core 单测
pnpm run pack:spectator-mode    # 生成 旁观模式-v1.0.0.mcpack
```

打包产物位于 `mcaddon/spectator-mode/dist/packages/`。

## 项目结构

```
mcaddon/spectator-mode/
├── BP/SpectatorMode/      # 行为包
│   ├── manifest.json      # 包清单（脚本依赖 @minecraft/server + @minecraft/server-ui）
│   └── pack_icon.png      # 图标（仓库默认图，可替换）
├── scripts/
│   ├── main.ts            # 装配入口
│   ├── core/              # 纯逻辑（零 @minecraft 依赖，可单测）
│   │   ├── types.ts / config.ts / colors.ts / engine.ts / hud.ts
│   └── mc/                # 适配层（副作用）
│       ├── store.ts / particles.ts / controller.ts / commands.ts / menu.ts
├── tests/                 # core 单测（node:test）
├── just.config.ts         # 构建配置
├── AGENTS.md              # 架构/命令/约定
└── package.json           # 独立版本号
```

## 版本要求

- **Minecraft Bedrock** 1.21.0 或更高（`min_engine_version: [1,21,0]`）
- **Script API** @minecraft/server（workspace 收敛至 2.8.0）、@minecraft/server-ui

---

MIT License