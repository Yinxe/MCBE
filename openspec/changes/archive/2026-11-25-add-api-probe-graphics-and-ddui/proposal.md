# Proposal: 接入 server-graphics 探针与 DDUI 面板

## Why

api-probe 目前只覆盖了 `@minecraft/debug-utilities` 一个模块。仓库里还有三个模块从未被探过，其中 `@minecraft/server-graphics` 最值得优先：

**一、`server-graphics` 是唯一能运行时改渲染的 API，且完全没被验证过。**

它提供 4 个类（`BiomeAtmospherics` / `BiomeColorGrading` / `BiomeLighting` / `BiomeWater`）共 112 个方法，能按生物群系或按玩家改天空色、调色、光照、水参数。`@minecraft/server` 完全没有这类能力，资源包只能给静态值。

但它有一个别处没见过的设计：**关键帧表**。

```ts
setSkyHorizonColor(color: Record<number, RGB> | RGB): void
// { 0.0: 正午色, 0.25: 日落后, 0.5: 午夜色, 0.75: 日出色 }
```

这是唯一能让颜色随时间连续变化的 API。资源包做不到，`@minecraft/server` 没有。

**二、它有个别处没有的陷阱：写入成功 ≠ 渲染生效，连引擎都不会报错。**

文档 45 处提到 Vibrant Visuals（鲜艳视觉），而它要求客户端图形模式为 `Deferred`。非 Deferred 时：

- setter 不抛错
- 读回值正确
- **画面完全不变**

这比 `debug-utilities` 的「写入 ≠ 渲染」更极端——后者至少画面可能变，前者可能永远不变而无人知晓。所以探针的第一件事必须是报告 `Player.graphicsMode`。

**三、12 条命令靠手敲太累。**

已有 12 条探针命令，每条都要完整敲一遍。DDUI（`@minecraft/server-ui` 2.1.0 起）的 `CustomForm` 点按钮后**表单不关闭**，正好适合「连续点多个探针」。这能把 12 条命令变成一个面板。

## What Changes

**依赖与版本**

- `min_engine_version` 从 `[1,21,100]` 抬到 `[1,21,130]`（`server-graphics` 最早出现于此）
- `@minecraft/server` 2.1.0 → **2.4.0**
- `@minecraft/server-ui` 2.0.0 → **2.1.0**（DDUI 起点）
- `@minecraft/debug-utilities` `1.21.100-stable` → **`1.21.130-stable`**
- 新增 `@minecraft/server-graphics` **1.0.0**
- 版本号 `0.3.1` → `0.3.2`

**新增代码**

- `scripts/GraphicsProbeMath.ts`（纯函数）：关键帧排序、单值/关键帧判定、时间点翻译、`vibrantVisualsVerdict()`、set/reset 结果翻译
- `scripts/GraphicsProbe.ts`：6 组探针 + 复位命令
- `scripts/ProbePanel.ts`：DDUI 面板，`openForms` 登记表 + `closePanel()` + `showProbePanel()`
- `tests/GraphicsProbeMath.test.mjs`：14 项断言

**新增命令**

- `/apitest:graphics [reset]` — 6 组 graphics 探针；`reset=1` 只做复位
- `/apitest:panel` — DDUI 面板，把 8 个动作做成按钮

**修复升级带来的破坏性变更**

- `DebugShape.location` 在 1.21.130 起变为 **readonly**，`DebugMotionProbe.ts` 的 `box.location = moved` 改为 `box.setLocation(moved)`

**其它**

- `just.config.ts` 的 `external` 与 `tsconfig.json` 的 `paths` 加入 `@minecraft/server-graphics`
- README 补两条命令、更新依赖清单、写明两个新警告（最低版本、Vibrant Visuals 前提）

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `api-probe`：新增「渲染类模块的探针须先报告渲染前提」「探针须覆盖关键帧与单值两种参数形态」「探针入口须提供统一面板」三项要求。

## Impact

- **破坏性**：`min_engine_version` 抬到 1.21.130，1.21.100~129 客户端无法加载。api-probe 是开发期探针，可接受；README 指明低版本请用 `v0.3.1`。
- **新增运行时依赖**：`@minecraft/server-graphics`（稳定版 1.0.0，非 beta）。
- **`debug-utilities` 升级**：`location` 变只读是唯一破坏性变更，已修；新增 `addShape(shape, dimension?)` 与 `DebugShape.dimension` 属新增能力，未使用。
- **测试数**：42 → 55。
- **不影响**：打包流水线、产物名规则、既有 12 条命令的签名。
