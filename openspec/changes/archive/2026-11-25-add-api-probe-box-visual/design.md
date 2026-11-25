# 设计：api-probe 的 3D 框选线框

## 核心机制：单次 spawnParticle 撑起整个盒子

一次 `spawnParticle("apitest:box", center, molang)` 就能画出完整的盒子，关键是**驱动粒子与子发射器分离**：

```
spawnParticle(apitest:box)          ← 脚本只调一次
  └─ 驱动粒子:自身 size=[0,0] 不渲染
       └─ timeline[0] → emit 事件
            └─ sequence 共 25 步:
                 第 0 步:把 v.* 暂存进 t.*
                 第 1~12 步:发 12 个 box_face(6 面 × 内外两遍)
                 第 13~24 步:发 12 个 box_edge(12 条棱线)
```

驱动粒子在第 0 帧就过期，子发射器各自按 `v.duration` 存活。所以**不需要逐帧驱动，也不需要清理定时器**。

## 三个必须踩对的点

### 1. `t.*` 不支持 struct

驱动粒子要在 `pre_effect_expression` 里读父级变量再转发给子发射器，中间的暂存只能用 `t.*`（`t` 在同一次 `sequence` 内共享）。而 Molang 的 `temp.` 变量**不支持 struct**（不能带 `.x`）。

因此所有输入变量必须是独立标量：

```ts
molang.setFloat("size_x", ...);   // ✅ 能进 t.*
molang.setVector3("size", ...);   // ❌ t.size.x 会断掉
```

这也是为什么没有用 `setVector3` / `setColorRGB` —— 它们生成的 `v.size.x` 形态在暂存环节会失效。

### 2. `pre_effect_expression` 里的 `v.*` 是子发射器的

```jsonc
"pre_effect_expression":
  "v.normal_x = 1;      // 写给【子发射器】的参数
   v.pos_x = t.half_x;" // 读【父级】必须走 t.*
```

这个作用域区别不写出来极易踩错：写成 `v.pos_x = v.half_x` 会变成子发射器自赋值。

### 3. 面片要画两遍

材质 `apitest_blend_cull` 从 `particles_blend` 里**去掉** `DisableCulling`：

```json
{ "apitest_blend_cull:particles_blend": { "-states": ["DisableCulling"] } }
```

于是背面剔除生效，同一面片画两遍即可：

| 遍 | 法线 | 透明度 | 可见位置 |
| --- | --- | --- | --- |
| 1 | 朝外 | 0.18 | 只在盒子外 |
| 2 | 朝内 | 0.06 | 只在盒子内 |

得到"从外面看 18% 灰、钻进去看 6% 灰"的效果，比开 `DisableCulling` 让两遍都可见更省。

## 面片与棱线的朝向

| 用途 | facing_camera_mode | 说明 |
| --- | --- | --- |
| 面片 | `direction_z` | 面片平面垂直于 direction → 钉在世界轴上 |
| 棱线 | `lookat_direction` | 绕 direction 轴转向相机 → 任何角度都等宽 |

棱线 `size = [length, thickness]`：`size[0]` 沿 direction 轴（棱线长度），`size[1]` 是绕轴转向后的线宽。

棱线整体外扩 `thickness / √2`（`t.ext_x` 等），避免与面片共面 z-fighting。

## 几何：角点是方块，不是点

```ts
size = max - min + 1;        // 两个方块之间包含两端
center = min + size / 2;
```

传 `x1=100, x2=109` 得到边长 10（框住 100..109 共 10 格），中心 `104.5`。若按 `max - min` 算会整体偏半个方块。

这部分放在 `BoxGeometry.ts`，不导入任何 `@minecraft/server` 类型，可在 node 里直接单测。

## 为什么不做不规则体素轮廓

参考模组里 `oraynum_*` 那一族用 3×3 九宫格 UV + 邻接剔除来描不规则方块集合的合并外轮廓。它的价值在于"一堆方块合并后只剩外表面"，但：

- 代码量约是整盒方案的两倍（需要 3D 光栅化遍历 + 六个方向的邻接判定）
- `api-probe` 目前没有"一组方块"这个输入，只有两个角点

等真有需求时再按同样的机制加，不影响现有结构。

## 版本与产物形态

新增资源包后 `packing.mode: "auto"` 从单包切成 `mcaddon`：

| | 之前 | 之后 |
| --- | --- | --- |
| 产物 | `api-probe-v0.0.1_bp.mcpack` | `api-probe-v0.1.0.mcaddon` |
| 包 | 行为包 | 行为包 + 资源包 |

行为包→资源包的依赖由 `synchronizePackVersions` 自动补齐，不用手写。
