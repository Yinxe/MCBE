# SpectatorMode — 旁观模式

旁观模式 · 项目脚手架（业务逻辑待实现，等 spec 确认后填充）。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
pnpm --filter spectator-mode run build   # TypeScript 编译 → esbuild
pnpm --filter spectator-mode run pack    # 构建 → 打包 .mcpack（旁观模式-v{version}.mcpack）
pnpm --filter spectator-mode run lint    # ESLint
pnpm --filter spectator-mode run clean   # 清理
```

根目录快捷命令：`pnpm run build:spectator-mode` / `pnpm run pack:spectator-mode`。

若需 server-ui / toolkit 等依赖，直接在 `package.json` 的 `dependencies` 中按需补充。

---

## 架构

```
scripts/
└── main.ts              # 入口（当前为占位 stub，无业务逻辑）
```

> 待定：旁观模式的功能架构（观察其他玩家 / 视角切换 / 无敌隐形 / 交互屏蔽等），spec 确认后补齐本段。

---

## 依赖

| 包 | 版本 |
|---|------|
| @minecraft/server | workspace 收敛 2.8.0（pnpm overrides） |
| @minecraft/core-build-tasks | 5.5.0 |