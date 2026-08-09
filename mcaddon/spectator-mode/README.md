# 旁观模式 🎥

**旁观模式 · 项目脚手架**

MCBE 旁观模式行为包。当前仅为项目骨架，业务逻辑待实现。

> ⚠️ 当前 `scripts/main.ts` 为占位 stub，加载时会输出一条调试日志证明包已生效，无任何业务行为。

---

## 构建

```bash
pnpm install                 # 安装依赖
pnpm run build:spectator-mode  # TypeScript 编译
pnpm run pack:spectator-mode   # 生成 旁观模式-v1.0.0.mcpack
```

输出文件位于 `mcaddon/spectator-mode/dist/packages/`。

---

## 项目结构

```
mcaddon/spectator-mode/
├── BP/SpectatorMode/      # 行为包
│   ├── manifest.json      # 包清单
│   └── pack_icon.png      # 图标（复用仓库默认图，可替换）
├── scripts/
│   └── main.ts            # 脚本源码（占位 stub）
├── just.config.ts         # 构建配置
├── AGENTS.md              # 模组架构/命令/约定
└── package.json           # 独立版本号
```

---

## 版本要求

- **Minecraft Bedrock** 1.21.0 或更高（`min_engine_version: [1,21,0]`）
- **Script API** @minecraft/server（workspace 收敛至 2.8.0）

---

MIT License
