# SpectatorMode — 灵魂出窍

灵魂出窍：玩家变身旁观者飞离真身移动，可用 `/sp:soul` 切换回本体；管理员可通过 `/sp:soul menu` 启用/禁用功能并配置最大移动距离。超出距离进入 5 秒容忍倒计时，耗尽强制回归。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
pnpm --filter spectator-mode run build      # TypeScript 编译 → esbuild
pnpm --filter spectator-mode run pack       # 构建 → 打包 .mcpack（旁观模式-v{version}.mcpack）
pnpm --filter spectator-mode run lint       # ESLint + prettier
pnpm --filter spectator-mode run test:core  # core 单测（tsc -p tsconfig.test.json + node --test）
pnpm --filter spectator-mode run clean      # 清理
```

根目录快捷命令：`pnpm run build:spectator-mode` / `pnpm run pack:spectator-mode`。

---

## 命令

| 命令 | 权限 | 说明 |
|------|------|------|
| `/sp:soul` | 任意 | 切换旁观/回归本体（进入记录锚点，回归还原维度/位置/游戏模式） |
| `/sp:soul menu` | 管理员（OP） | 管理表单：启用/禁用功能 · 最大移动距离滑动条（5~400m，步进 1）· **连线粒子开关**（默认关） |

> 只注册一条命令 `/sp:soul`，`menu` 为其可选子命令（`/sp:soul menu`）。
> 脚本 API 的 `CustomCommand.name` 要求命名空间，故统一用 `sp:*` 形式。

> ⚠️ **极限模式禁用**：`world.isHardcore` 为 true 时进入旁观被直接拒绝（游戏模式切换单向，
> 切到旁观无法切回），并在玩家入服时发送提示警告。

## 架构

```
scripts/
├── main.ts                 # 装配：事件（join/leave）+ 命令注册（Phase 3）+ Phase 4 启动
├── core/                   # 纯逻辑层（零 @minecraft 依赖，可 node 单测）
│   ├── types.ts            # SpConfig / SoulAnchor / Vec3
│   ├── config.ts           # 默认值 / clamp 校验 / 动态属性键
│   ├── engine.ts           # SoulEngine 状态机：范围内 ↔ 容忍倒计时 → 强制回归
│   ├── colors.ts           # 距离比例 → § 颜色码（绿→黄→金→红）
│   └── hud.ts              # actionBar 文案（含颜色码与容忍倒计时）
├── mc/                     # 适配层（Minecraft 副作用）
│   ├── store.ts            # 世界 DP 全局配置 + 玩家 DP 锚点 JSON
│   ├── particles.ts        # 真身标记 + 灵魂锁链连线粒子（含可换特效常量）
│   ├── controller.ts       # 组合 core 状态机与 mc 副作用：进出场/tick 循环/强制回归
│   ├── playerUtil.ts       # 玩家对象防御过滤（兼容假人模组）
│   ├── commands.ts         # /sp:soul 注册（menu 子命令）与权限
│   └── menu.ts             # 管理表单
└── tests/                  # core 单测（node:test）
```

## 核心设计

- **进入旁观**：记录真身锚点（维度/位置/原游戏模式）→ 写玩家 DP `sp:soul` → 真身粒子标记 → `setGameMode(Spectator)`。
- **距离监控**：每 100ms（2 tick）推进一次，距离 = 与锚点 3D 直线距离；跨维度按 Infinity 超限处理。
- **容忍区**：距离 > 最大距离 → 5 秒容忍倒计时；期间回到范围内即取消；耗尽触发强制回归。
- **HUD（actionBar）**：`灵魂出窍 · <绿→黄→金→红>距离m / 上限m`；容忍区 `深红距离m 超出！ Ns 后强制回归`。
- **回归**：清 HUD/锚点 → 传送回锚点维度/位置 → 还原游戏模式（失败兜底生存）→ 标记粒子 → 提示。
- **持久化与恢复**：配置存世界 DP（`sp:enabled` / `sp:maxDist`，全局）；**灵魂锚点只存玩家 DP**（`sp:soul` JSON，玩家相关信息不落世界）。玩家以灵魂状态离线则锚点随世界存档保留，重连 `playerJoin` 自动**恢复灵魂出窍会话**（保持旁观，不回归本体；可随时 `/sp:soul` 手动回归）。**自愈**：每 tick 兜底——已是旁观者 + 有锚点 + 无会话 → 自动重建会话；`/sp:soul` 在"已是旁观者 + 有锚点"时直接回归本体（任意情况下都有逃逸口）。极限模式下无法恢复旁观 → 退化为回归本体。
- **假人防御**：所有 `world.getPlayers()` 结果经 `mc/playerUtil.ts` 过滤（对象/属性 undefined、属性访问抛错的一律剔除；不依赖 tag，兼容第三方假人模组）。
- **极限禁用**：`world.isHardcore` 为 true 时拒绝进入旁观（模式切换单向），入服即向玩家发警告。
- **禁用功能**：管理员关闭开关时，所有在场灵魂强制回归。

**粒子特效**（`scripts/mc/particles.ts` 常量可换）：连线复刻嘎吱受击本体↔心连接 = **双向扫掠动画**——真身(心)→灵魂(嘎吱) 琥珀色、灵魂→真身 灰色，两股逆向粒子流沿线段流动（自己算沿线坐标/相位，方向与数量完全可控；`creaking_heart_trail` 原粒轨迹由引擎驱动、方向不可靠，仅作 `SOUL_LINK_MODE="creaking"` 实验开关）。**连线粒子默认关**（管理员 `/sp:soul menu` 的"连线粒子"开关控制，世界 DP `sp:showLink`）。灵魂体光环 `trial_omen_single`；真身持续标记 `raid_omen_ambient`（进出瞬间大爆发）。真身端区块未加载时自动跳过真身侧粒子（各自 try-catch 隔离，不影响灵魂光环）。

---

## 依赖

| 包 | 版本 |
|---|------|
| @minecraft/server | workspace 收敛 2.8.0（pnpm overrides） |
| @minecraft/server-ui | workspace 收敛（表单依赖） |
| @yinxe/toolkit | workspace 同步（defineCommand / canManage / ModalFormBuilder） |
| @minecraft/core-build-tasks | 5.5.0 |