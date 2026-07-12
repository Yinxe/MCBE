# 反收纳袋刷物 — Bundle Anti-Dupe

将收纳袋改为可食用食物，防止收纳袋刷物漏洞。

> 通用规范请参考根目录 `CLAUDE.md`。

---

## 原理

收纳袋刷物漏洞的核心原因是：**收纳袋作为容器物品**，在某些操作（投掷、末影箱存取、漏斗提取等）下会导致内容物被复制。

本模组通过**覆盖所有 17 种收纳袋的物品定义**，在每个收纳袋上添加 `minecraft:food` 组件，使其变为可食用的食物。MCBE 不允许食物物品包含容器内容，因此刷物漏洞被彻底封堵。

> 本质上是把收纳袋从"容器"变成了"食物"，玩家右键仍然可以打开 UI，但因为 `food` 组件的存在，旧版刷物路径全部失效。

---

## 文件结构

```
server-plugin/antibundledup/
├── BP/BundleAntiDupe/
│   ├── manifest.json            # 行为包 manifest
│   └── items/                   # 17 种收纳袋覆盖定义
│       ├── bundle.json          # 普通收纳袋
│       ├── black_bundle.json    # 黑色
│       ├── blue_bundle.json     # 蓝色
│       ├── brown_bundle.json    # 棕色
│       ├── cyan_bundle.json     # 青色
│       ├── gray_bundle.json     # 灰色
│       ├── green_bundle.json    # 绿色
│       ├── light_blue_bundle.json
│       ├── light_gray_bundle.json
│       ├── lime_bundle.json     # 黄绿色
│       ├── magenta_bundle.json  # 品红色
│       ├── orange_bundle.json
│       ├── pink_bundle.json
│       ├── purple_bundle.json   # 紫色
│       ├── red_bundle.json
│       ├── white_bundle.json    # 白色
│       └── yellow_bundle.json   # 黄色
├── scripts/
│   └── pack.mjs                 # 打包脚本
└── package.json                 # 版本 + 构建配置
```

---

## 开发命令

```bash
pnpm run build:antibundledup     # 同步版本号到 manifest
pnpm run pack:antibundledup      # 打包 BP → .mcpack
pnpm run clean                   # 全部清理
```

---

## 打包

```bash
pnpm run pack:antibundledup
```

产物路径：`server-plugin/antibundledup/dist/packages/antibundledup-v{version}.mcpack`

---

## 发布

打 tag 自动触发 CI 构建发布：

```bash
git tag antibundledup@<version>
git push origin antibundledup@<version>
```

---

## 自定义物品覆盖说明

每个 item JSON 使用 `minecraft:bundle` 等原版 identifier，通过 `minecraft:food` 组件覆盖原版收纳袋行为：

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
| `minecraft:food` | 使物品可食用，禁止容器行为 |
| `minecraft:use_animation: "eat"` | 吃动画，视觉反馈 |
| `can_always_eat: true` | 饱腹也可吃，保持手感 |

---

## 依赖

| 包 | 版本 |
|---|------|
| @yinxe/toolkit | workspace |
| pnpm | 11.1.3 |
