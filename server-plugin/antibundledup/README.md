# 反收纳袋刷物 — Bundle Anti-Dupe

**纯数据行为包 · 无需脚本 · 无需作弊**

一个轻量 Minecraft Bedrock 服务器插件（行为包），将收纳袋改为可食用食物，从根源封堵收纳袋刷物漏洞。

> 纯 JSON 行为包，零脚本依赖，无需开启作弊，不影响原版玩法。

---

## 使用说明

1. 下载 `antibundledup-v{version}.mcpack`
2. 双击文件或用 Minecraft 打开导入
3. 将包应用到你的世界（设置 → 行为包）
4. 进游戏，收纳袋刷物路径全部失效 ✅

> 玩家右键收纳袋仍可打开 UI，仅刷物路径被堵死。

---

## 防刷物原理

收纳袋刷物漏洞的核心原因是：**收纳袋作为"容器物品"**，在某些操作（投掷、末影箱存取、漏斗提取等）下会导致内容物被复制。

本插件通过**覆盖原版物品定义**（非自定义物品），为全部 17 种收纳袋添加 `minecraft:food` 组件，使其变为可食用的食物：

- 本质是把收纳袋从**"容器"**变成了**"食物"**
- MCBE 不允许食物物品携带容器内容，旧版所有刷物路径因此失效
- 玩家右键仍可打开 UI，仅刷物路径被堵死

---

## 覆盖的收纳袋（17 种）

| 类型 | 物品 ID |
|------|---------|
| 普通收纳袋 | `minecraft:bundle` |
| 16 色收纳袋 | `minecraft:black_bundle` / `blue_bundle` / `brown_bundle` / `cyan_bundle` / `gray_bundle` / `green_bundle` / `light_blue_bundle` / `light_gray_bundle` / `lime_bundle` / `magenta_bundle` / `orange_bundle` / `pink_bundle` / `purple_bundle` / `red_bundle` / `white_bundle` / `yellow_bundle` |

---

## 物品覆盖组件

17 个物品定义文件同构，均保留原版 ID（纯覆盖行为），归入 `itemGroup.name.bundle` 分组：

```json
"minecraft:food": {
  "nutrition": 1,
  "saturation_modifier": 0.1,
  "can_always_eat": true
},
"minecraft:use_modifiers": {
  "use_duration": 1.6,
  "movement_modifier": 0.35
},
"minecraft:use_animation": "eat"
```

| 组件 | 作用 |
|------|------|
| `minecraft:food` | 使物品可食用，MCBE 不允许食物携带容器内容，封堵刷物 |
| `minecraft:use_animation: "eat"` | 吃动画，视觉反馈 |
| `can_always_eat: true` | 饱腹也可吃，保持手感 |

---

## 构建与打包

```bash
pnpm run build:antibundledup     # 同步版本号到 manifest（sync-version.mjs）
pnpm run pack:antibundledup      # 打包 BP 目录 → .mcpack
pnpm run clean                   # 清理构建产物
```

打包流程：

1. `pnpm run build` 通过 `sync-version.mjs` 将版本号同步到 `manifest.json`
2. 用 zip 打包 `BP/BundleAntiDupe/` 目录
3. 生成产物：`dist/packages/antibundledup-v{version}.mcpack`

---

## 项目结构

```
server-plugin/antibundledup/
├── BP/BundleAntiDupe/
│   ├── manifest.json            # 行为包 manifest（min_engine_version 1.21.40）
│   └── items/                   # 17 种收纳袋覆盖定义
│       ├── bundle.json          # 普通收纳袋
│       ├── black_bundle.json    # 黑色
│       ├── ...
│       └── yellow_bundle.json   # 黄色
├── scripts/
│   └── pack.mjs                 # 打包脚本
├── dist/packages/               # 打包产物
└── package.json                 # 版本 + 构建配置
```

---

## 发布

```bash
git tag antibundledup@<version>
git push origin antibundledup@<version>
```

---

## 依赖

| 包 | 版本 |
|---|------|
| @yinxe/toolkit | workspace |
| pnpm | 11.1.3 |

## 版本要求

- **Minecraft Bedrock** 1.21.40 或更高（`min_engine_version`）

---

MIT License
