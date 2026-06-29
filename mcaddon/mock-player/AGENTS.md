# AGENTS.md — MockPlayer

Minecraft Bedrock 模拟玩家（假人）Add-On，TypeScript + Minecraft Script API。

---

## 开发命令

所有构建均通过 `just-scripts`（非 npm scripts），项目名定义在 `.env` 中：

```bash
just-scripts build          # sync-version → tsc → esbuild bundle
just-scripts local-deploy   # watch 模式，监听到文件变更后自动 clean → build → 部署
just-scripts mcaddon        # 打 .mcaddon 发行包
just-scripts lint           # ESLint 检查
just-scripts clean          # 清理 lib/ dist/
```

构建流程：`sync-version`（版本同步 BP/RP → package.json）→ `typescript`（tsc）→ `bundle`（esbuild）。`local-deploy` = `watch(scripts/**/*.ts, BP/**/*.{json,lang,tga,ogg,png}, RP/**/*.{json,lang,tga,ogg,png})` → `clean → build → package`。

esbuild 入口 `scripts/main.ts`，产物 `dist/scripts/main.js`。外部模块 `@minecraft/server`、`@minecraft/server-ui`、`@minecraft/server-gametest` 在 `just.config.ts` 的 `bundleTaskOptions.external` 中声明。

---

## 架构

```
scripts/
├── main.ts          # 入口：命令注册、worldLoad 持久化恢复、事件监听、交互
├── commands/        # 每条命令独立文件，统一在 index.ts 中用 registerAllCommands 注册
├── features/
│   ├── types.ts     # 核心类型 BotRecord / PositionState / TagDef 和常量
│   ├── operations.ts# 所有核心业务逻辑（create/online/offline/delete/kill/tp/move/control/sneak/setTags）
│   ├── events.ts    # entityDie / playerSpawn / playerJoin / playerLeave 事件处理
│   ├── behavior.ts  # 标签行为引擎（自动挖掘/攻击/跳跃/体态控制），轮询模式
│   ├── persistence.ts# 全局 botRegistry + 动态属性持久化（save/load/remove BotRecord）
│   ├── tags.ts      # 标签定义（共存组 / 互斥组）、标签解析、实体标签同步
│   └── utils.ts     # 坐标转换、格式化、状态捕获、坐标解析
└── ui/              # ModalFormData UI (v2 API，options 对象语法)
    ├── create.ts
    ├── menu.ts
    ├── move.ts
    ├── online.ts
    └── tags.ts
```

- `BP/MockPlayer/` — 行为包（manifest.json + pack_icon.png）
- `RP/MockPlayer/` — 资源包（manifest.json + pack_icon.png）
- main.ts 是唯一入口，通过 `system.beforeEvents.startup` 注册命令，`world.afterEvents.worldLoad` 恢复数据。

---

## 关键约定

### 代码风格
- 中文注释，中文文件头注释（每条命令/模块的功能说明）
- 严格 TypeScript，禁止 `any`（但事件回调中用 `any` 是现有模式）
- 所有参数、方法返回类型必须显式声明
- 提交必须经用户同意（不可自动 commit）

### Minecraft 消息着色
```ts
§a = 绿色（成功消息）   §c = 红色（错误）     §e = 黄色（假人名）
§7 = 灰色（辅助信息）   §b = 青色（状态变更）  §f = 白色（坐标数字）
§8 = 深灰（维度）
```

### 命令
- 所有命令前缀 `mp:`（如 `/mp:create`, `/mp:list`, `/mp:control`）
- 自定义命令在 `system.beforeEvents.startup` 中注册，使用 `event.customCommandRegistry.registerCommand`
- 命令回调运行在 restricted-execution mode ——调用受限 API（如 form.show()、spawnSimulatedPlayer）需用 `system.run()` 包装

### 标签系统
- 共存标签：`mockplayer:tag:bot` / `respawn` / `autoJump`
- 互斥标签：`idle` / `autoMine` / `autoPlace` / `autoAttack` / `control`（同一时间只能一个生效）
- 新假人默认标签：`bot` + `respawn` + `idle`
- 标签解析支持 value/label/短名/忽略大小写

### 持久化
- 通过 `world.setDynamicProperty` 存储每个假人的 `BotRecord` JSON
- Key 格式：`mockplayer:players:<name>`，value 上限约 32KB
- `world.getDynamicPropertyIds()` 枚举所有 key，前缀过滤加载
- Entity 的 `addTag` 不持久化，重新上线时从 `BotRecord.tags` 恢复

---

## 踩坑记录

所有已知的 Minecraft API 坑点集中在 `BLACKLIST.md`，处理模拟玩家相关问题（spawnSimulatedPlayer 无视坐标、lookAtLocation 枚举、death/respawn 事件顺序、beforeEvents 权限限制、UI v2 options 语法等）前务必查阅。

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

---

## tsconfig 关键项

- `target: es6`, `module: ES2020`, `moduleResolution: Node`
- `strict: true`, `noImplicitAny: true`, `skipLibCheck: true`
- `rootDir: .`, `baseUrl: behavior_packs/`, `outDir: lib/`
- 只编译 `scripts/**/*`，排除 `lib/` `dist/` `node_modules/`

---

## 编辑器/调试

- VS Code 推荐插件：Blockception（Minecraft 开发）、Minecraft Debugger
- 格式化：Prettier（trailingComma: es5, tabWidth: 2, semi, singleQuote: false, printWidth: 120）
- 格式化保存时自动执行
