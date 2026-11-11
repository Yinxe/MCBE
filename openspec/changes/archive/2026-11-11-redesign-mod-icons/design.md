# Design

## Context

动机见 `proposal.md` 的 Why；行为契约见本 change 的 5 份 delta spec。

1. **原有的 7 份生成器是同一份低阶像素放大的分叉实现**，代码重复且画面只有简陋色块，与 `mockplayer3` 真实引入的 24 张 256×256 UI 高清图标差距悬殊。
2. **纯程序算法绘制无法胜任复杂的体素艺术细节**：算法手绘多边形/网格缺乏 Minecraft 原生纹理材质（木纹、石质倒角、微光、粒子波纹等），因而改由生成式 AI 提供统一风格的高精雪碧图合集，由程序化切片管线完成工程级清理。
3. **只有 2 个模组需要 ActionForm 菜单图标**：`item-route`（已有资源包）与 `teleporter`（新建资源包）。
4. **共享工具包**：新建 workspace 包 `tools/icon-forge/`，存放离线源图、无依赖纯 Node PNG 编解码器与自动化切片分发逻辑。

## Goals / Non-Goals

**Goals:**

- 7 个模组的 `pack_icon.png` 达到参考图水准，全仓采用统一的 Minecraft 3D 体素拟物风格，且主体轮廓硬朗、细节丰富
- 切片与分发逻辑全仓集中到 `tools/icon-forge/`，实现源图资产受版本控制与全自动无缝切片导出
- 产出确定性可复现：基于受控源资产运行 `slice-all.js` 逐字节幂等输出
- 为 `item-route` 与 `teleporter` 的 ActionForm 界面接入与包图标同风格的 256×256 高精按钮图标，补齐 `teleporter` 资源包

**Non-Goals:**

- 不用手写硬编码色块代替高精拟物资产，而是通过生成式源资产切片与程序化清理相结合
- 不为不使用 ActionForm 的模组新增无收益的资源包
- 不引入第三方图像处理 C++ 原生库（如 sharp/canvas），保持纯 Node.js 内置标准库
- 不把图标生成接入每次构建循环，图标作为静态资源按需执行 `npm run generate:icon` 重生成

## Decisions

### 决策 1：基于生成式高精拟物雪碧图进行程序化切片与清理

**做法**：由生图模型按统一风格 Prompt 生成 7 行 5 列的 30 个高精体素拟物图标合集，纳入 `tools/icon-forge/assets/` 受控资产。通过 `tools/icon-forge/bin/slice-all.js` 自动化读取、计算真实行列投影区间，采用外部背景泛洪 + 最大连通分量过滤（Connected-Component Analysis），自动消解外围暗黑背景与邻接残渣，并等比缩放、居中填入 256×256 画布（留 10px 边距），直接导出规范 RGBA PNG。

**为什么推翻算法纯手绘 256×256**：纯算法手绘只能实现简单的矩形和低阶多边形堆叠，无法还原 Minecraft 原版方块的丰富木纹、石质倒角、发光光环与立体阴影；由生成模型提供高精素材，再由程序完成工程级像素清理与对齐，兼顾了顶级画质与全自动可维护性。

### 决策 2：工具集中管理至 `tools/icon-forge/`，删除分散的旧生成器

提取通用的纯 Node PNG 编解码器 `tools/icon-forge/src/png.js`（zlib + CRC32），批量入口 `bin/slice-all.js`。删除 7 份冗余的 `mods/*/tools/generate-pack-icon.js`，将各模组的 `generate:icon` 脚本统一重定向到 icon-forge。

### 决策 3：菜单图标为 `item-route` 与 `teleporter` 完整落地

`item-route` 资源包新增 13 张切片图标，`teleporter` 新建资源包并放入 11 张切片图标，所有 ActionForm 按钮均升级为 `buttonWithIcon()`。

### 决策 4：`teleporter` 升级为双包（.mcaddon）

为 `mods/teleporter` 新建 `resource_packs/teleporter/`，配置合规 `manifest.json` 与独立 UUID，在 `package.json` 的 `packing.mode: "auto"` 驱动下自动打包为包含 BP 与 RP 的 `.mcaddon`，使传送系统在游戏内具备完整的图文菜单体验。

## Risks / Trade-offs

- **[`teleporter` 新增资源包导致世界端需要手动启用资源包]** → 资源包仅补充 UI 贴图与包图标，不破坏世界内既有传送点数据；在 README 与打包发布说明中指引玩家同时勾选资源包。
- **[切片时可能误切邻近元素]** → 通过投影直方图精确探测物理间距，并强制只保留前景的最大连通分量，排除了任何邻接边缘残渣。
