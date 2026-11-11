# Proposal

## Why

七个模组的 `pack_icon.png` 全部是脚手架阶段的临时产物：统一 128×128、体积 500–1320 字节，画面是「32×32 逻辑像素 → 4 倍最近邻放大」的简陋色块。而 `mockplayer3` 在迁移时引入了 24 张 256×256 的 AI 生成 UI 图标，其画质明显更高，导致同一套模组在游戏里的视觉水准参差不齐。

实测参考图的真实结构后，差距的根源不是分辨率，而是**绘制方式**：

| 测量项 | 现有 `pack_icon` | `mockplayer3` UI 图标 |
|---|---|---|
| 尺寸 | 128×128 | 256×256 |
| 颜色数 | 十余种（每模组一份手写色板） | 9667–19716 种 |
| 逻辑网格 | 32×32，每格 4px 单色 | 32×32，每格 8px **且格内有渐变** |
| 边缘峰间距 | — | 7–8px 为主（`8px×9`、`7px×8`） |
| 半透明像素 | 0 | **0**（硬边、无抗锯齿） |
| 格内明暗 | 无 | 有（亚格子高光 + 大尺度光照） |

即：参考图同样是 32×32 造型，但**在 256 分辨率下把每一格内部也画出明暗层次**，所以既保持像素画的硬边轮廓，又有接近插画的体积感。现有 `pack_icon` 缺的正是这一层。

`pack-icon` 规格当前只约束「128×128、RGBA、像素画、不得用占位图」，既没约束像素粒度，也没约束格内明暗，因此现状在规格上合规、观感上不可接受。本次把全部模组图标重绘到参考图水准，并把「风格参照物」与可验证的判据写进规格。

## What Changes

- 为 7 个模组重绘 `pack_icon.png`，共 **9 个文件**（`item-route` 与 `mockplayer3` 各有行为包与资源包两份）。
- 图标分辨率 128×128 → **256×256**，**BREAKING**（相对现行 `pack-icon` 规格的 128×128 硬性约束）。
- **绘制方式**：以统一的 Minecraft 3D 体素拟物风格（Minecraft Blocky Voxel Art）为基准，外框为圆角正方形深色厚描边徽章，中心为 3D 立体方块拟物物件，经统一切片裁切、外部黑色背景泛洪剥离、最大连通分量过滤与 256×256 居中缩放产出。
- **共享工具包**：新建 workspace 包 `tools/icon-forge/`，集中管理源资产（`assets/minecraft-icon-sprites.png`）、无依赖 PNG 编解码器（`src/png.js`）与全自动批量切片分发入口（`bin/slice-all.js`）。废弃并删除原各模组目录下分散重复的 7 份旧版 `tools/generate-pack-icon.js`，各模组 `package.json` 的 `generate:icon` 脚本统一调用 icon-forge 入口。
- 为 `item-route` 与 `teleporter` 的 ActionForm 菜单补充图标资源（`textures/ui/<模组>/`），风格与 `mockplayer3` 现有 24 张一致。**仅为这两个模组**——实测其余 4 个模组不用 ActionForm（`auto-refill` 用 `ModalFormData`、`spectator-mode` 用 `ModalFormBuilder`、`craftablerarities` 与 `keepinventory` 无任何表单 UI），因此**不新建资源包**。
- 修改 `pack-icon` 规格：尺寸改 256×256；风格条款改为引用 `mockplayer3` UI 图标为对标物，并把「格内允许柔和渐变、轮廓必须硬边、alpha 必须二值」写成可验证判据。

## Capabilities

### New Capabilities

- `mod-icon-art`: 全仓模组图标的视觉规范与产出方式——尺寸与格式、逻辑造型网格、格内明暗与光照处理、轮廓与 alpha 规则、语义表达、风格对标物、以及可复现的程序化产出流程。

### Modified Capabilities

- `pack-icon`: 图标尺寸由 128×128 改为 256×256；风格条款由「有限色板 + 硬边像素块、禁止抗锯齿渐变」改为「32×32 造型网格 + 格内柔和明暗、轮廓硬边、alpha 二值」，并指定 `mockplayer3` UI 图标为风格基准。
- `mockplayer3`: 该规格中「包图标 MUST 为 128×128」的表述需同步为 256×256，避免与新图标规范冲突。
- `item-route`: 其 ActionForm 菜单按钮由纯文本改为带图标，需在规格中登记菜单图标的资源路径约定。
- `teleporter`: 同上。

## Impact

**图标文件（9 个，全部重写）**

- `mods/auto-refill/behavior_packs/auto-refill/pack_icon.png`
- `mods/craftablerarities/behavior_packs/craftablerarities/pack_icon.png`
- `mods/item-route/behavior_packs/item-route/pack_icon.png`
- `mods/item-route/resource_packs/item-route/pack_icon.png`
- `mods/keepinventory/behavior_packs/keepinventory/pack_icon.png`
- `mods/mockplayer3/behavior_packs/mockplayer3/pack_icon.png`
- `mods/mockplayer3/resource_packs/mockplayer3/pack_icon.png`
- `mods/spectator-mode/behavior_packs/spectator-mode/pack_icon.png`
- `mods/teleporter/behavior_packs/teleporter/pack_icon.png`

**新增工具**

- `tools/icon-forge/`：数据描述（每图标一份）+ 共享渲染器（纯 Node、无第三方依赖、自带 PNG 编码）+ 批量生成入口。确定性产出：同一份数据重复运行得到逐字节相同的 PNG。

**删除**

- 7 份 `mods/*/tools/generate-pack-icon.js`（合计 1336 行），其构图数据迁入 `tools/icon-forge/icons/`，渲染逻辑收归一处。

**新增菜单图标资源（2 个模组）**

- `mods/item-route/resource_packs/item-route/textures/ui/item-route/`（资源包已存在，仅加纹理目录）
- `mods/teleporter/resource_packs/teleporter/`（**需新建资源包**：`manifest.json` + `textures/ui/teleporter/`）

**规格**

- `openspec/specs/pack-icon/spec.md`：尺寸与风格条款改写。
- `openspec/specs/mockplayer3/spec.md`：包图标尺寸表述同步。
- `openspec/specs/item-route/spec.md`、`openspec/specs/teleporter/spec.md`：登记菜单图标约定。

**风险与取舍**

- **`teleporter` 新增资源包**：会改变其打包产物形态（`.mcpack` → `.mcaddon`）并新增两个包 UUID。若判定收益不足，可只做 `item-route`（资源包已存在，零风险）；这一点需在 `design.md` 中给出结论而非默认执行。
- **256×256 的实际收益**：游戏内包列表缩略图远小于 128，尺寸提升在该处**不产生可感知差异**；收益在分发平台、文件管理器预览与图标本身的细节层次。规格改动需说明这一点，避免被理解为「尺寸越大越好看」。
- **无尺寸校验**：已确认 `packages/mod-packaging/src` 内不存在 `pack_icon` 或 `128` 相关校验，尺寸变更不会破坏打包流程。
- **参考图源不在仓库**：`mockplayer3` 的 24 张图标来自一张 1254×1254 雪碧图切片，源图未入库（仅记录 sha256）。本次不依赖该源图，仅以其为风格基准。
