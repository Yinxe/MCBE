# Proposal

## Why

`keepinventory` 的行为包图标仍是 `mct create` 模板自带的占位图(128×128 的空白「2」),看不出模组是做什么的,分发给玩家时缺乏辨识度。

同时,`manifest.json` 的 `header.min_engine_version`(`[1, 21, 90]`)目前是手工硬编码的,与 `package.json` 里 `@minecraft/server` 的依赖版本(`2.0.0`)各写一处、互不校验。两者一旦不同步,就会得到「声明支持某版本但实际调用了更高版本 API」的行为包——这类错误在加载前无法发现,只在低版本客户端上运行时报错。打包工具链已经负责同步 `version`,却没有覆盖这个同样影响兼容性声明的字段。

## What Changes

- **重绘行为包图标**:替换 `BP/keepinventory/pack_icon.png` 为像素风格图标,画面表达「玩家死亡后背包物品仍保留」,与模组功能直接相关;保持 128×128 PNG(RGBA)以符合 Bedrock 图标约定与 `mct validate` 的 `CPACKICON001` 检查。
- **打包配置新增最低游戏版本字段**:`package.json#packing` 增加显式配置项 `minimum_engine_version`(三段数字数组)。
- **默认值由依赖版本推导**:该字段缺省时,`pack` 依据 `@minecraft/server` 的依赖版本,通过内置映射表推导出对应的最低游戏版本,而不是静默留空或硬编码。
- **打包时写入清单**:`pack` 把解析结果写入各包 `manifest.json` 的 `header.min_engine_version`,使该声明与 `@minecraft/server` 依赖版本保持同源。
- **无法解析时报错中止**:显式配置格式非法、或依赖版本不在映射表中且无显式配置时,`pack` 报错并指明原因,不产出产物。

## Capabilities

### New Capabilities

- `pack-icon`: 行为包图标资源的约定——图标文件的位置与命名、格式与尺寸要求,以及图标内容必须反映模组功能。使「模组外观」成为可校验的约定,而不是靠个人习惯。

### Modified Capabilities

- `addon-packaging`: 打包配置新增 `minimum_engine_version` 字段及其「显式配置优先、缺省按依赖版本推导」的解析规则;`pack` 负责把结果写入各包清单的最低游戏版本声明,并在无法解析时报错中止。

## Impact

- **代码**:`mods/keepinventory/tools/packaging.ts`(新增配置字段、推导逻辑、清单写入)、`mods/keepinventory/just.config.ts`(把最低版本同步接入 `pack` 流程)。
- **资源**:`mods/keepinventory/BP/keepinventory/pack_icon.png` 被替换。
- **配置**:`mods/keepinventory/package.json` 的 `packing` 块新增可选字段;默认值行为改变(此前 `min_engine_version` 完全由手工维护)。
- **依赖**:不新增运行时依赖。映射表以代码内的静态数据形式存在。
- **兼容性**:`keepinventory` 的 `min_engine_version` 仍为 `[1, 21, 90]`,对最终用户无可感知变化;变化在于该值从此由打包流程保证与 `@minecraft/server` 依赖一致。
- **文档**:`mods/keepinventory/README.md` 的 `packing` 配置表需要补上新字段。
- **风险**:映射表是静态维护的数据,`@minecraft/server` 出现新版本时需要更新;无法解析时报错而非猜测,把风险暴露在打包阶段而不是用户运行时。
