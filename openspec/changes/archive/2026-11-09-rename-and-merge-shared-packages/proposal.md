# Proposal

## Why

`packages/` 下的共享包命名已出现两个问题:

1. **`@mc-toolchain/packaging` 名字过泛**,与仓库里同名的 `tools/`、`mods/` 概念混淆,也没说明它只服务模组打包。
2. **`@mc-toolchain/shared` 与 `@mc-toolchain/ui` 是同一类东西被人为拆成两个包**:两者都是「与具体模组无关的模组通用工具/函数封装」,都只以官方 Script API 为对等依赖,但拆开后有两个 `package.json`、两套 tsconfig、两份 README、两条「刻意不包含」的边界声明,而边界本身还要靠文档维护;合并后消费方只需记一个包名。

现在只有 `auto-refill`、`spectator-mode`、`teleporter` 三个运行时消费方,改名成本最低,越往后拖越贵。

## What Changes

- **重命名打包共享包**:`@mc-toolchain/packaging` → `@mc-toolchain/mod-packaging`,目录 `packages/packaging/` → `packages/mod-packaging/`。
- **合并运行时/界面共享包**:`@mc-toolchain/shared` + `@mc-toolchain/ui` → 新包 `@mc-toolchain/mod-common`,目录 `packages/shared/` 与 `packages/ui/` 合并为 `packages/mod-common/`(两个旧目录删除)。
  - 合并后的导出面 = 原两包导出面的并集(文本样式码、HUD 仲裁、三类表单构建器、安全上下文执行助手、界面消息助手),统一从 `packages/mod-common/src/index.ts` 出口。
  - 对等依赖取并集:`@minecraft/server`、`@minecraft/server-ui`。
  - 合并后的包不再保留「界面与 HUD 仲裁必须分属两个包」的约束——同一包内并存。
- **更新所有引用点**:5 个模组的 `package.json` 依赖、`just.config.ts` 导入、模组源码导入(`mods/auto-refill`、`mods/spectator-mode`、`mods/teleporter`);根 `README.md`、`mods/README.md`、各模组与各包的 README;重新生成 `package-lock.json`。
- **BREAKING(仅仓库内部)**:两个旧包名不再存在,不提供兼容别名;`packages/` 下的包均为 `private`、不发布 npm,无外部消费方。
- 不改变任何产物的可观察行为:打包产物命名与内容、模组的游戏内表现、HUD `/scriptevent yinxe:hud` 跨包协定均不变。
- 不改写历史记录:已归档的 `openspec/changes/archive/**` 与进行中的 `add-spectator-mode-mod`、`add-teleporter-mod` 的规划文档保留原包名。

## Capabilities

### New Capabilities

- `mod-common`: 合并后的内部共享包 `@mc-toolchain/mod-common` 的定位与契约——位于 `packages/mod-common/`、私有、以 workspace 依赖被模组引用、只以官方 Script API 为对等依赖,并统一承载文本样式码、HUD 逐玩家优先级仲裁(含跨包声明心跳与决胜)、三类表单封装、受限上下文安全执行助手与界面消息助手。

### Modified Capabilities

- `shared-packaging`: 共享打包包的包名由 `@mc-toolchain/packaging` 改为 `@mc-toolchain/mod-packaging`、位置由 `packages/packaging/` 改为 `packages/mod-packaging/`;契约与行为不变。
- `addon-packaging`: 「打包入口唯一」要求中引用的共享打包包名同步改为 `@mc-toolchain/mod-packaging`。
- `shared-runtime`: 该能力承载的共享运行时包被合并进 `@mc-toolchain/mod-common`,能力内的全部要求移除并迁移至 `mod-common`;原 `packages/shared/` 目录不再存在。

## Impact

- **代码/配置**:`packages/{packaging,shared,ui}` → `packages/{mod-packaging,mod-common}`;`mods/auto-refill`、`mods/spectator-mode`、`mods/teleporter` 的源码与配置;`mods/craftablerarities`、`mods/keepinventory` 的打包依赖;`package-lock.json`。
- **文档**:根 `README.md`、`mods/README.md`、`mods/*/README.md`、`packages/*/README.md`、`docs/research/read-only-context.md`。
- **规格**:新增 `mod-common`;修改 `shared-packaging`、`addon-packaging`;移除 `shared-runtime` 的全部要求。
- **规格同步的既存依赖**:`ui` 的能力规格 `shared-ui` 目前只存在于**已完成但尚未归档**的 `add-teleporter-mod`(`openspec/changes/add-teleporter-mod/specs/shared-ui/spec.md`),不在 `openspec/specs/`。本变更不引用该尚未存在的能力;实施时须先归档 `add-teleporter-mod`,再删除它带入主规格的、已被 `mod-common` 取代的 `shared-ui` 能力(见 design 的 Risks 与 tasks)。
- **不受影响**:`tools/mcwiki-search`、`mods/` 的游戏内产物行为、`mct` 工具链用法。
