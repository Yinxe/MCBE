# Design

## Context

`mods/keepinventory/tools/packaging.ts`(600 行)当前的包目录解析是「显式配置优先,否则探测」:

```ts
resolvePackDirectories(projectRoot, configuration)
  ├─ configuration.behaviorPacks ? resolveExplicitPackDirectory(...) : detectPackDirectory(...)
  └─ configuration.resourcePacks ? resolveExplicitPackDirectory(...) : detectPackDirectory(...)
```

`detectPackDirectory` 依赖 `collectCandidatePackDirectories`,后者从模组根目录向下扫两层,任何含 `manifest.json` 的目录都成为候选,再由 `detectPackType` 按清单判定类型。这条路径不关心顶层目录叫什么,所以 `BP/`、`RP/`、`behavior_packs/` 都能工作。

同时模组里还有四处硬编码 `BP`:

| 位置 | 内容 |
| --- | --- |
| `tsconfig.json:21` | `"baseUrl":"BP/"` |
| `just.config.ts:31` | `copyToBehaviorPacks: [\`./BP/${projectName}\`]` |
| `just.config.ts:50` | watch glob `"BP/**/*.{json,lang,tga,ogg,png}"` |
| `mods/keepinventory/README.md` | 目录结构树、图标路径、缩写/全名对照表 |

`mct` 一侧的约束来自实测(mct 0.21.0):

- `mct create` 的 `addonStarter` 与 `tsStarter` 模板都生成 `behavior_packs/` + `resource_packs/`;模板的 `tsconfig.json` 用 `"baseUrl":"behavior_packs/"`,`just.config.ts` 用 `./behavior_packs/${projectName}`。
- 脚手架生成的包目录名来自 `PROJECT_NAME`,其值是 `getSuggestedShortName(creator) + "_" + getSuggestedShortName(name)`,该函数去掉 `-`/`_`/空格后只保留大写字母并转小写,因此 `mc-toolchain` + `keepinventory` 得到 `mctoolch_keepinv`——有损且不等于包名。
- `mct add` 通过 `Project.ensureDefaultBehaviorPackFolder()` 决定写入位置:它先找项目里已注册的 `behaviorPackManifestJson` 条目并复用其父目录;找不到时才在 `behavior_packs/` 下新建 `effectiveShortName + "_bp"`(creator 兜底值为 `contoso`)。`effectiveShortName` 取 `.env`/项目数据里的 `shortName`,与包目录改名无关。

实测验证的三件事(决定了方案可行性):

1. 把 `behavior_packs/mctoolch_keepinv` 改名为 `behavior_packs/keepinventory` 并把 `.env` 的 `PROJECT_NAME` 同步后,`mct add -i . -o .` 正确写入 `behavior_packs/keepinventory/`。
2. 连续多次 `mct add -i . -o .` 稳定复用同一组包目录,不产生新目录。
3. `mct add` 不带 `-o`(默认输出到 `cwd/out`)会在 `<模组>/out/` 下新建 `contoso_<project>_bp`/`contoso_<project>_rp`,与既有包并存——这才是「重复包结构」的真实成因,而非改名。

另外实测发现 `mct add customSword` 会引入 PBR 文件并触发 `CHKMANIF135`(需声明 `pbr` capability)。对照组(不改名)同样触发,确认与本变更无关。

## Goals / Non-Goals

**Goals:**

- 包目录顶层名固定为 `behavior_packs` / `resource_packs`,与 `mct` 模板一致,使 `mct` 各命令无需转换即可作用于模组目录。
- 移除 `packing.behavior_packs` / `packing.resource_packs`,让包目录不再是可配置项。
- 把缩写目录的误用从「静默可用」变成「明确报错并给出改名指引」。
- 让 `mct` 在 monorepo 下的正确用法有据可查(尤其 `mct add` 必须带 `-o .`)。

**Non-Goals:**

- 不改包目录**内层**的目录名规则:仍为 `<name>`(既有 `mod-workspace` 需求),也不改包类型判定方式(仍以 `manifest.json` 为准)。
- 不封装 `mct` 命令、不写包装脚本、不自动执行改名。工具调用保持人工显式执行。
- 不处理 `mct add` 引入 PBR 文件导致的 `CHKMANIF135`,那是内容层面的独立问题。
- 不改 `packing.mode` / `packing.output` / `packing.minimum_engine_version` 的行为。

## Decisions

### D1 顶层目录名写成常量,不再作为配置

`packaging.ts` 引入两个常量 `BEHAVIOR_PACKS_DIRECTORY = "behavior_packs"` 与 `RESOURCE_PACKS_DIRECTORY = "resource_packs"`,`detectPackDirectory` 只在这两个目录下扫描。

**替代方案**:保留可配置但默认全名。否决原因:可配置就仍有两条路径,`mct` 只认全名,配置成别的值等于主动制造分叉,而本变更的目的正是消除这种分叉。

### D2 缩写检测放在探测之前,给出定向报错

`resolvePackDirectories` 在探测前先检查模组根下是否存在 `BP` / `RP` 目录。存在则直接报错:

```text
仅支持官方全名包目录 behavior_packs / resource_packs,
检测到 BP/。请把 BP/<name> 改名为 behavior_packs/<name>。
```

**替代方案**:当作不存在,让后续「未找到包」报错。否决原因:用户看到的是「没找到包」,会去查 `manifest.json` 或配置,而真实原因是目录名;定向报错把排查成本降到零。

**注意**:检测必须只针对顶层 `BP`/`RP` 字面目录名,不能泛化为「任何非全名目录」。包目录内层可以叫任意名(`mct` 生成的就是 `mctoolch_keepinv`),内层不参与顶层名校验。

### D3 删除两个配置字段,复用已有的未知字段检查

`SUPPORTED_PACKING_KEYS` 移除 `behavior_packs` 与 `resource_packs`。既有的 `validatePackingKeys` 会在字段出现时报错并列出支持的字段,因此不需要单独写废弃提示——报错文案会自然说明「该字段不受支持」并给出可用字段清单。

同时删除 `PackingConfiguration.behaviorPacks` / `resourcePacks` 与 `resolveExplicitPackDirectory`(只被这两条路径使用)。

**替代方案**:保留字段并报「已废弃」专用错误。否决原因:多一条只用于报错的代码路径,而通用未知字段报错已经覆盖语义;且 spec 里已有一条「包目录配置项已被移除」的场景来固定这个行为。

### D4 内层包目录继续按清单探测,不硬编码路径

`behavior_packs` 之下仍走 `collectCandidatePackDirectories` + `detectPackType`,而不是直接拼 `behavior_packs/<name>`。

理由:`mct create` 生成的子目录名是缩写(`mctoolch_keepinv`),若硬编码 `<name>` 会让脚手架产物直接无法打包,而这与「后续正常使用 mct」的目标冲突。探测 + 同类型歧义报错既接受脚手架的临时布局,也接受规范改名后的布局。

### D5 迁移模组目录时同步改四处引用

`mods/keepinventory` 的迁移是一个原子操作,四处必须同时改,否则 `tsc`/`lint`/`pack` 会因路径不存在而失败:

1. `git mv BP/keepinventory behavior_packs/keepinventory`
2. `tsconfig.json`:`"baseUrl":"BP/"` → `"baseUrl":"behavior_packs/"`
3. `just.config.ts`:`copyToBehaviorPacks` 与 watch glob 的 `BP/` → `behavior_packs/`
4. `mods/keepinventory/README.md`:目录树、图标路径、对照表
5. 新建 `mods/README.md`:仓库级 `mct` 用法与目录约定(不写进具体模组)

`.env` 的 `PROJECT_NAME` 已经是 `keepinventory`,与新包目录名一致,无需改。

### D6 `mct` 用法写进规范而非脚本

`mct` 的正确调用方式(`mct add -i . -o .`、脚手架后改名)记录为 `mct-toolchain-usage` 能力的需求,而不是写成 npm 脚本包装。

这些规则是**`mods/` 目录层面**的共性约定,不隶属于任何单个模组,因此落地为 `mods/README.md`;具体模组的 `README.md` 只保留与自身相关的要点并链接过去。单个模组换了(新增、删除、替换)时,仓库级规则无需搬移或复制。

**替代方案**:在 `package.json` 加 `mct:add` 脚本固化 `-o .`。否决原因:`mct add` 的参数包含模板 id 与内容名,包装后仍需透传,脚本收益小;而错误用法(`-o` 缺失)的代价是产生垃圾目录,属于一次就能记住的操作,文档 + spec 足够。

### D7 保留内层 `<name>` 的严格约定,接受脚手架后手工改名

包目录内层仍要求为 `<name>`,而不是放宽为「任意名」。虽然实测证明 `mct validate -i mods` 对缩写名同样正常,但 monorepo 下目录名与包名对齐可避免「看到目录名要反查是哪个模组」的认知成本。代价是每个新模组多两步(改目录名 + 同步 `.env`),由 `mod-workspace` 的需求与场景固定下来。

**替代方案**:内层名交给 `mct` 自生成(`mctoolch_keepinv_bp`),零手工步骤。否决原因:本项目的模组目录本身就是包名,内层再用另一套缩写名会让层级语义不一致;且 `pack-icon` 等既有需求已按 `<name>` 表述。

### D8 临时目录作为可选工作流,不作为主路径

当需要先看生成效果或要手工挑选时,允许在 `mods/` 之外的临时目录用 `mct create` + `mct add` 生成,再挑选内容移入目标模组。移入时只取内容文件,清单类文件按条目合并,不拷 `manifest.json` 与 `pack_icon.png`。

但**已确定要保留的内容优先直接生成到目标模组**:实测 `mct add -i . -o .` 写入既有包时 `manifest.json` 的 UUID 保持不变、`blocks.json` 与 `terrain_texture.json` 自动创建或合并。临时目录方案多一步 create、多一步挑文件、清单要手工合并,只在「先看再决定」时有价值。

**替代方案**:把临时目录流程定为唯一路径。否决原因:它比直接生成多一倍步骤,而直接生成已经能正确维护 UUID 与清单引用。

### D9 校验口径包含 `UNLINK`,不仅看 ERROR 计数

实测发现:只移入纹理与内容文件、忽略 `blocks.json` 与 `terrain_texture.json` 时,`mct validate` 仍报 **0 ERROR**,但 `UNLINK` 项给出「Texture does not have any items in this pack that are using this」警告。因此内容移入后的校验必须显式检查 `UNLINK`,否则会把「方块显示紫黑格」误判为成功。

## Risks / Trade-offs

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 破坏性变更 | 任何使用 `BP/` 或 `packing.behavior_packs` 的模组配置在 `pack` 时直接报错 | 当前仓库只有 `mods/keepinventory` 一个模组,已在本变更内一并迁移;报错文案给出改名指引 |
| 新模组需手工改名 | `mct create` 的包目录名是派生缩写,不符合 `<name>` 规范,每次都要改名 + 同步 `.env` | 已写入 `mod-workspace` 的需求与场景;`.env` 未同步的后果(打包取不到包)也写成场景 |
| 命名空间无法干净 | `mct add` 生成的内容标识符恒为 `contoso_<输出目录名>`,截断至 16 字符 | 规范要求移入后显式改为项目约定命名空间,并写成需求 |
| `validate` 会漏报纹理问题 | ERROR 计数不包含未链接资源,忽略清单时仍报 0 ERROR | 校验口径明确包含 `UNLINK`(D9) |
| monorepo 误用污染 | `mct add -i mods -o mods` 会把内容写进所有模组 | 规范明确禁止指向父目录,并写成需求场景 |
| 缩写检测可能误报 | 若某模组恰好有名为 `BP` 的非包目录(如文档目录) | 检测只在顶层且要求该目录存在时才报错;当前仓库无此情况 |
| 探测逻辑保留带来的复杂度 | 内层仍走探测而非硬编码,`collectCandidatePackDirectories` 未简化 | 这是为兼容 `mct` 脚手架产物的有意取舍(D4),且同类型歧义已有报错兜底 |
| `mct` 行为依赖实测结论 | 上述 `mct` 行为均基于 mct 0.21.0 实测,版本升级后可能变化 | 实测命令记录在 `docs/research/minecraft-creator-tools.md`,升级时可复验 |
