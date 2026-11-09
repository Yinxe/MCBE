# Proposal

## Why

打包只同步版本号与最低游戏版本,而 `manifest.json` 的 `header.name`(游戏内包列表显示名)与 `header.description` 全靠手工维护:五个模组的 `name` 风格不一(`自动替换`、`§l§e《合成配方扩展》 v1.0.1`、`灵魂出窍`),`description` 里的作者/邮箱/主页/QQ群/仓库信息逐模组手写且已出现缺失(如 `keepinventory` 完全没有作者信息)。这违反仓库既定的「`package.json` 是唯一来源」原则,改一次元信息要手工改多个清单,且游戏内看到的版本号可能与 `package.json#version` 不一致。

## What Changes

- 打包在压缩前把 `package.json` 的元信息同步进每个包 `manifest.json`:
  - `header.name` ← `productName` + `" v"` + `package.json#version`(如 `自动替换 v2.2.0`)
  - `header.description` ← `description` 首行,其后逐行追加作者、邮箱、主页、QQ群、仓库
- 新增 `package.json` 元信息来源:`author`(name/email/url)、`repository.url`、`packing.qq_group`
- 新增 `packing.qq_group` 配置字段(纳入 `SUPPORTED_PACKING_KEYS` 白名单校验)
- 元信息缺失时的处理分级:`productName`、`description` 缺失即报错中止;`author`、`repository`、`packing.qq_group` 缺失时对应行整行省略
- `repository.url` 从 git SSH/`git+https` 形式规范化为 `https://github.com/<owner>/<repo>` 可读形式
- **BREAKING**(对模组维护者):`header.name` / `header.description` 不再可手工维护,由打包覆盖;五个模组的 `package.json` 需补齐 `author`、`repository`、`packing.qq_group`,并删除清单中手工维护的这两项

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `addon-packaging`:新增「打包同步清单显示名与描述」需求,要求 `pack` 把 `package.json` 派生的 `header.name` / `header.description` 写入所有包清单,并规定拼接顺序、缺失降级与颜色符号保留
- `mod-workspace`:新增「模组元信息在 `package.json` 单一维护」需求,规定 `author` / `repository` / `packing.qq_group` 是清单元信息的唯一来源

## Impact

- `packages/mod-packaging/src/types.ts`:`PackageJson` 增加 `productName`、`author`、`repository`;`SUPPORTED_PACKING_KEYS` 增加 `qq_group`
- `packages/mod-packaging/src/packs.ts`:`synchronizePackVersions` 扩展为同时写 `header.name` / `header.description`
- 新增纯逻辑模块承载「显示名与描述拼接 + 仓库 URL 规范化」,便于脱离构建环境单测
- `packages/mod-packaging/tests/`:新增拼接与规范化用例
- 五个模组的 `mods/*/package.json`:补齐 `author`、`repository`、`packing.qq_group`
- 五个模组的 `mods/*/behavior_packs/*/manifest.json`:手工维护的 `header.name` / `header.description` 由打包改写
- `packages/mod-packaging/README.md`、`mods/README.md`:补元信息声明约定与产物效果说明
- 不涉及游戏内运行时行为,不新增依赖
