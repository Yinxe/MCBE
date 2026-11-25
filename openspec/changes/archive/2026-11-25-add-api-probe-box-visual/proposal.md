# 提案：api-probe 增加 3D 框选线框

## 为什么

`api-probe` 目前只能读单个方块坐标的容器。开发期核对区域类行为（比如"这个范围内到底有几个方块"、"这个 AABB 的边界在哪"）时，缺一个把坐标范围**看见**的手段。

参考 `世界建造者` 的做法：它的选区框完全用粒子画，不放置方块、不写世界、不需要还原。`api-probe` 是开发期工具，正需要这种零副作用的可视化。

## 做什么

新增一条命令 `/apitest:box <x1> <y1> <z1> <x2> <y2> <z2> [秒数]`，在两个方块角点之间画出：

- 6 个半透明面（内外各一遍，得到内外两层浓度差）
- 12 条棱线（绕轴转向相机的柱面 billboard，任何角度都等宽）
- 最小角的 XYZ 三色轴（红=X、绿=Y、蓝=Z）

粒子到时自灭，不做任何持久化。

## 为什么需要新增资源包

`api-probe` 原本只有行为包。粒子定义、1×1 白贴图、自定义材质都只能放在资源包里，因此新增 `resource_packs/api-probe/`。

这会让 `packing.mode: "auto"` 从单包切成 `mcaddon`，产物从 `release/api-probe-v0.0.1_bp.mcpack` 变为 `release/api-probe-v0.1.0.mcaddon`。行为包→资源包的依赖由打包工具自动补齐。

## 明确不做

- **不做不规则体素集合的合并外轮廓**。参考模组里那套（3×3 九宫格 UV + 邻接剔除）代码量约是整盒方案的两倍，等真有需求再加。
- **不做持久框选**。不做"跟着玩家走"或"重登恢复"，只在命令调用后存活指定秒数。
- **不引入任何玩法功能**。这仍然只是开发期探针的可视化手段。

## 影响面

- 新增 `resource_packs/api-probe/`（3 个粒子 + 1 个材质 + 1 张 1×1 白贴图 + 清单）
- 新增 `scripts/BoxGeometry.ts`（纯函数，可单测）、`scripts/BoxRenderer.ts`、`scripts/BoxCommand.ts`
- `package.json` 版本 `0.0.1` → `0.1.0`，补 `author` / `repository` / `packing.qq_group`
- `just.config.ts` 增加资源包拷贝
- `README.md` 补命令表与实现要点
- spec 里"初始版本 `0.0.1`"与"产物为 `_bp.mcpack`"两条需要随打包形态更新
