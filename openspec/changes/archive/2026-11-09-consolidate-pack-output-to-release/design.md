# Design

## Context

现状见 `proposal.md - Why`。设计相关的既有约束:

- `packages/mod-packaging/src/packs.ts` 用 `path.resolve(projectRoot, configuration.output)` 解析输出目录,`projectRoot` 是模组目录(即 `__dirname`)。因此 `packing.output` 是**相对模组根**的路径,要写到仓库根就必须是 `../../release/`。
- `packages/mod-packaging/src/types.ts` 的 `DEFAULT_OUTPUT_DIRECTORY = "dist/packages"`,由 `resolvePackingConfigurationFrom` 在缺省时回落。
- 根 `.gitignore` 已有 `dist/` 规则,该规则对任意层级生效,已覆盖 `mods/<name>/dist/`。
- 5 个模组的 `just.config.ts` 都通过 `createPackagesByMode(__dirname)` 打包,没有任何模组自写输出路径逻辑。
- `auto-refill` 的 `packing.output` 是 `../../dist/packages`,是唯一一个已指向仓库根的模组,但目录名与本变更要用的不同。

## Goals / Non-Goals

**Goals:**

- 全部模组产物落在仓库根单一日录 `release/`,一条 `ls release/` 即可看清可装包清单。
- 迁移后每个模组的 `npm run pack` 行为除输出位置外完全不变:产物文件名、压缩包内容、`manifest.json` 版本与最低游戏版本写入都不受影响。
- 打包库 `@mc-toolchain/mod-packaging` 的源码零改动。

**Non-Goals:**

- 不新增根级一键打包脚本(用户明确不需要),打包仍是逐模组 `npm run pack`。
- 不改变 `DEFAULT_OUTPUT_DIRECTORY`,也不让打包库识别「仓库根」概念。
- 不改变产物命名规则、`packing.mode` 语义、包目录约定。
- 不做产物的版本保留策略(旧版本是否清理),`release/` 里各版本按文件名并存。

## Decisions

### D1: 由各模组显式声明 `packing.output`,不改打包库默认值

每个模组的 `package.json` 写 `"packing": { "output": "../../release/" }`(保留各自已有的 `mode` 与 `minimum_engine_version`)。

**理由**:`mod-packaging` 是可独立测试的库,它的默认值 `dist/packages` 描述的是「相对模组根的输出目录」这一通用语义。把默认值改成 `../../release` 会让库隐含「调用方一定位于 `<repo>/mods/<name>/` 这一层」的布局假设,任何在别的层级或仓库外复用该库的场景都会得到越界路径。产物集中是**本仓的约定**,应由本仓的模组配置表达。

**备选**:把 `DEFAULT_OUTPUT_DIRECTORY` 改成 `../../release`,各模组删掉 `output` 字段。否决理由:如上,库会获得一个不该有的仓库布局假设,且需要同步修改 `addon-packaging` 主 spec 的「零配置即可打包」场景(默认输出目录 `dist/packages`),把一次配置迁移扩散成一次库语义变更。代价是新增模组要记得写 `output`,由 `mods/README.md` 的约定与新增模组的任务清单兜住。

### D2: 目录名用 `release/`,不用 `dist/`

仓库根新增 `release/`,不复用根 `dist/`。

**理由**:模组内已有 `dist/` 且它承载**构建中间产物**(`dist/scripts`、`dist/debug`),是 `clean-build` 的清理目标;把可发布包也放进同名目录会让「哪些是中间产物、哪些是要分发的包」在同一名字下混在一起。`release/` 明确表达「可发布的成品」。用户已指定该名称。

**备选**:根 `dist/packages/`(与 `auto-refill` 现状一致)。否决理由:与构建中间产物同名,且 `auto-refill` 的现状只是历史巧合而非约定。

### D3: 相对路径写 `../../release/`,不做路径解析增强

`packing.output` 保持纯字符串,写成 `../../release/`。

**理由**:`path.resolve` 已经能正确解析 `..` 段,打包库无需改动。加上「相对仓库根」这类新语义会引入新的配置字段与校验,超出本变更范围。

**代价**:`../../` 依赖「模组位于 `mods/<name>/`,即仓库根下两层」这一事实。若将来模组目录整体加深一层,5 个 `package.json` 都要改。这是可接受的显式耦合——它至少是写在配置里的、可见的。

### D4: `auto-refill` 一并迁到 `release/`

把 `auto-refill` 的 `"output": "../../dist/packages"` 改为 `"../../release/"`。

**理由**:本变更的目标是「所有模组产物都集中到同一处」。保留一个写到 `../../dist/packages` 的例外,等于把「仓库内有两种产物位置」这个当前问题原样留下。迁移后 5 个模组的 `packing.output` 完全一致,便于审查「有没有漏改」。

### D5: 旧产物目录直接删除,不做归档

删除 `mods/<name>/dist/packages/` 下已有的 5 个 `.mcpack`。

**理由**:这些文件从未入库(`.gitignore` 已忽略 `dist/`),重新打包即可再生;留着会让「旧位置还有包」继续误导安装。不做备份或移入 `release/`,因为迁入会让 `release/` 里出现无法追溯来源的旧构建。

## Risks / Trade-offs

- **[新模组忘记写 `output`,产物又回到模组内]** → 在 `mods/README.md` 的打包小节与「新增模组」检查清单中把 `"output": "../../release/"` 写成必备项;本变更同时更新 `packages/mod-packaging/README.md` 的示例配置,使照抄模板的人自然带上该字段。
- **[`../../` 层级假设失效]** → 已记入 D3 的代价。若将来调整 `mods/` 布局,受影响的是 5 个 `package.json` 的一行字段,搜索 `"../../release/"` 即可全部定位。
- **[旧包仍在模组目录,用户装到过时版本]** → 迁移任务包含删除 `mods/*/dist/packages/`,并在完成后逐个确认目录不存在。
- **[`release/` 未加入 `.gitignore` 导致产物误提交]** → 迁移任务把 `release/` 加入 `.gitignore`,并以 `git status` 确认打包后无新增待提交文件。
- **[CI 或脚本依赖旧路径]** → 已核查仓库内无脚本引用 `mods/*/dist/packages`;仅文档示例提到该路径,一并更新。
- **[`release/` 内旧版本堆积]** → 本变更不做清理策略,文件名含版本号使各版本并存不覆盖;是否清理留给后续变更。

## Migration Plan

1. 在根 `.gitignore` 的「构建与打包产物」段加入 `release/`。
2. 依次修改 5 个模组的 `package.json`,把 `packing.output` 设为 `"../../release/"`(保留 `mode` 与 `minimum_engine_version` 原值)。
3. 删除 5 个模组下的 `dist/packages/` 目录。
4. 同步文档:`mods/README.md`、`packages/mod-packaging/README.md`、各模组 `README.md` 中的产物路径示例。
5. 逐模组执行 `npm run pack`,确认 `release/` 下出现 5 个产物且模组内无 `dist/packages/`。
6. 用 `git status` 确认 `release/` 未出现在待提交列表。

**回滚**:把 5 个 `packing.output` 改回 `dist/packages`(或删除该字段走默认值),从 `.gitignore` 移除 `release/`,删除 `release/` 目录。无数据迁移,无不可逆步骤。

## Open Questions

无。用户已确认三项前置决策:目录名 `release/`、由各模组显式配置(方案 A)、不新增根级一键打包脚本。
