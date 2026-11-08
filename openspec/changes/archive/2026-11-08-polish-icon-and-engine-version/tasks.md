# Tasks

## 1. 配置与映射表

- [x] 1.1 在 `tools/packaging.ts` 中定义 `minimum_engine_version` 配置字段的类型与解析,并纳入 `resolvePackingConfiguration()` 的返回结构
- [x] 1.2 为 `resolvePackingConfiguration()` 增加未知 `packing` 键校验:出现不受支持的键时报错并列出该键与可用键列表
- [x] 1.3 在 `tools/packaging.ts` 中以常量数组维护「`@minecraft/server` 版本 → 最低游戏版本」映射表,按 API 版本降序,首版覆盖 `1.11.0`(1.21.0)至 `2.11.0`(1.26.60),数据取自 `docs/research/minecraft-server-api-versions.md`
- [x] 1.4 实现依赖版本规范化(去 `^`/`~`/`>=` 前缀、取三段数字、带后缀时取前三段并告警)与按数值逐段比较的映射查找,取「不超过依赖版本的最大 API 版本」对应档位
- [x] 1.5 实现最低游戏版本解析:`packing.minimum_engine_version` 优先;缺省时按 `@minecraft/server` 依赖推导并在日志说明来源;两者都不可用时抛错指明原因与解决方式

## 2. 清单写入

- [x] 2.1 扩展 `synchronizePackVersions()`,把解析出的最低游戏版本写入每个包 `manifest.json` 的 `header.min_engine_version`,覆盖原有值
- [x] 2.2 确认 `just.config.ts` 的 `pack` 链路无需改动即可生效(最低版本写入并入既有 `synchronizePackVersions` 步骤),必要时仅调整日志输出

## 3. 图标

- [x] 3.1 设计像素画构图:墓碑(死亡)+ 完整背包/物品组(保留)+ 闭合轮廓或托举感(未散落),色板控制在 8–12 色,避免与「掉落」混淆的散落形态
- [x] 3.2 生成 128×128 RGBA PNG 并替换 `mods/keepinventory/BP/keepinventory/pack_icon.png`
- [x] 3.3 用文件头解析验证格式为 PNG、尺寸 128×128、色彩类型为 RGBA,并缩到 64×64 目视确认主体仍可辨识

## 4. 文档同步

- [x] 4.1 在 `mods/keepinventory/README.md` 的 `packing` 配置表中补上 `minimum_engine_version`,说明其默认值由 `@minecraft/server` 依赖推导、以及映射表需要随依赖升级维护
- [x] 4.2 在 `docs/research/minecraft-server-api-versions.md` 中记录映射表已成为打包工具的一部分,并说明维护方式与验证命令

## 5. 验证

- [x] 5.1 `tsc --noEmit` 与 `npm run lint` 均通过
- [x] 5.2 `npm run pack` 在无 `minimum_engine_version` 配置时成功,产出的 `manifest.json` 中 `header.min_engine_version` 为 `[1, 21, 90]`
- [x] 5.3 显式配置 `packing.minimum_engine_version: [1, 21, 80]` 时,产出清单中该值为 `[1, 21, 80]`,验证显式优先
- [x] 5.4 临时把 `@minecraft/server` 依赖改为映射表未收录的版本且不配置该字段,确认 `pack` 报错并指明该依赖版本(验证后还原)
- [x] 5.5 临时把 `packing` 中某字段改成拼写错误,确认 `pack` 报错指明未知字段(验证后还原)
- [x] 5.6 `mct validate` 通过(0 ERROR),含 `CPACKICON001` 与 `MINENGINEVER001` 检查项
- [x] 5.7 `openspec validate polish-icon-and-engine-version --strict` 通过
