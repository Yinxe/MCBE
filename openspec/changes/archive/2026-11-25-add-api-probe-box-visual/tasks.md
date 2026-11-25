# 任务：api-probe 3D 框选线框

## 1. 资源包

- [x] 1.1 新建 `resource_packs/api-probe/`，清单用新 UUID，`min_engine_version` 由打包工具从 `@minecraft/server 2.1.0` 推导
- [x] 1.2 生成 1×1 纯白 PNG（`textures/apitest/particle/white.png`），所有面片与棱线共用
- [x] 1.3 新增材质 `apitest_blend_cull`：从 `particles_blend` 去掉 `DisableCulling`，使背面剔除生效
- [x] 1.4 写面片子粒子 `apitest:box_face`（`direction_z` 钉在世界轴）
- [x] 1.5 写棱线子粒子 `apitest:box_edge`（`lookat_direction` 绕轴转向相机）
- [x] 1.6 写驱动粒子 `apitest:box`：自身不渲染，第 0 帧 emit 出 12 个面片 + 12 条棱线

## 2. 脚本

- [x] 2.1 `BoxGeometry.ts`：两角点 → 盒子中心/尺寸（`|Δ| + 1`），纯函数不依赖游戏 API
- [x] 2.2 `BoxRenderer.ts`：构造 Molang 变量表并单次 `spawnParticle`
- [x] 2.3 `BoxRenderer.ts`：单边超上限时拒绝绘制并给出原因
- [x] 2.4 `BoxCommand.ts`：注册 `/apitest:box`，六必填 + 一秒数可选，绘制推迟到安全 tick
- [x] 2.5 `main.ts` 挂上命令注册

## 3. 构建与文档

- [x] 3.1 `just.config.ts` 增加 `copyToResourcePacks` 与资源包文件监听
- [x] 3.2 `package.json` 版本 `0.0.1` → `0.1.0`，补 `author` / `repository` / `packing.qq_group`
- [x] 3.3 `README.md` 补命令表、框选章节与三条实现要点
- [x] 3.4 `npm run build` 与 `npm run lint` 通过
- [x] 3.5 `npm run pack` 产出 `release/api-probe-v0.1.0.mcaddon`，含行为包与资源包
- [x] 3.6 校验产物内行为包已自动声明对资源包的依赖

## 4. 游戏内验证（需实机）

- [ ] 4.1 `/apitest:box 100 64 -20 109 71 -11` 能看到完整线框
- [ ] 4.2 确认面片 `size` 是**全宽**而非半宽（若框只有一半大，把 `box_face` 的 `size` 改为 `v.width/2` 等）
- [ ] 4.3 确认棱线 `lookat_direction` 的 `size[0]` 对应棱线长度、`size[1]` 对应线宽（若线宽与长度对调，把 `box_edge` 的 `size` 数组两项互换）
- [ ] 4.4 从盒外与盒内分别观察，确认内外两层透明度都正常（背面剔除生效）
- [ ] 4.5 确认最小角的 X/Y/Z 三条棱线为红/绿/蓝
- [ ] 4.6 确认 10 秒后线框完全消失，无残留

## 5. 收尾

- [ ] 5.1 实机通过后按需修正 4.2 / 4.3 的常量，并同步 `README.md` 的实现要点
- [ ] 5.2 归档本 change
