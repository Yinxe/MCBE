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
```

---

## 架构

```
scripts/
├── main.ts          # 入口：命令注册、持久化恢复、事件监听
├── commands/        # 每条命令独立文件
├── features/
│   ├── types.ts     # BotRecord / PositionState / TagDef 等核心类型
│   ├── operations.ts# 所有核心业务逻辑
│   ├── events.ts    # entityDie / playerSpawn / playerJoin / playerLeave
│   ├── behavior.ts  # 标签行为引擎（轮询）
│   ├── persistence.ts# 动态属性持久化
│   ├── tags.ts      # 标签定义/解析/同步
│   └── utils.ts     # 坐标转换、格式化
└── ui/              # ModalFormData UI
```

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
- 互斥标签：`idle` / `autoMine` / `autoPlace` / `autoAttack` / `control`
- 新假人默认：`bot` + `respawn` + `idle`

### 持久化
- `world.setDynamicProperty` 存储 `BotRecord` JSON
- Key 格式: `mockplayer:players:<name>`
- Entity `addTag` 不持久化，从 `BotRecord.tags` 恢复

---

## 踩坑记录

见 `BLACKLIST.md`（处理 spawnSimulatedPlayer、lookAtLocation、death/respawn 事件顺序、beforeEvents 权限限制等坑点）。

---

## 依赖版本

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.6.0 |
| @minecraft/server-ui | 2.0.0 |
| @minecraft/server-gametest | 1.0.0-beta.1.26.0-stable |
| @minecraft/math | 2.2.7 |
| @minecraft/vanilla-data | 1.26.20 |
| @minecraft/core-build-tasks | 5.5.0 |
