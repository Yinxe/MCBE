# Design

## Context

现状见 proposal.md「Why」。影响本设计的技术事实:

- `packages/mod-packaging/src/packs.ts` 的 `synchronizePackVersions(projectRoot)` 已经是「从 `package.json` 派生字段并一次读改写所有清单」的唯一位置:它已写 `header.version`、`modules[].version`、`header.min_engine_version` 与资源包对行为包的依赖版本。元信息同步必须落在同一处,避免两个任务分别对同一批清单读改写。
- `packages/mod-packaging/src/types.ts` 的 `PackageJson` 只声明 `name`/`version`/`packing`/`dependencies`;`SUPPORTED_PACKING_KEYS` 白名单为 `["mode", "output", "minimum_engine_version"]`,`validatePackingKeys` 对白名单外字段报错。
- 该包的设计约定:纯逻辑(字符串处理、查表)集中在 `versions.ts` / `configuration.ts` / `discovery.ts`,只有 `packs.ts` 依赖 `@minecraft/core-build-tasks`;纯逻辑自带 `node --test` 单测(`tests/*.test.ts` → `.test-build`)。
- 五个模组的 `package.json` 已有 `productName` 与 `description`,但都没有 `author`、`repository`、`packing.qq_group`。

## Goals / Non-Goals

**Goals:**

- 元信息拼接逻辑为纯函数,可脱离游戏与构建环境单测
- 一次读改写覆盖所有派生字段,失败即中止,不留半写状态
- 五个模组打包后清单的 `name` / `description` 由 `package.json` 唯一决定

**Non-Goals:**

- 不改变 `header.uuid`、`modules[]`、`dependencies[]` 的既有处理
- 不引入新的第三方依赖(不引 semver、不引 URL 解析库)
- 不做清单字段的双向同步(不从 `manifest.json` 反推 `package.json`)
- 不改变产物文件名规则与压缩包结构

## Decisions

### 1. 拼接逻辑放在新的纯逻辑模块 `src/metadata.ts`

新增 `packages/mod-packaging/src/metadata.ts`,导出两个纯函数:

- `resolvePackDisplayName(packageJson): string` → `"<productName> v<version>"`
- `resolvePackDescription(packageJson): string` → 多行描述文本

由 `packs.ts` 在 `synchronizePackVersions` 中调用,结果写入清单。

**为什么不塞进 `versions.ts`**:该文件职责是版本解析与查表,元信息拼接与版本无关,混入会让文件名与职责不符(项目约定字段/命名用完整单词、避免歧义)。**为什么不塞进 `configuration.ts`**:该文件职责是读取与校验配置,产物是 `PackingConfiguration`;而显示名/描述是派生输出而非配置项,且需要 `version`(不在 `PackingConfiguration` 中)。

### 2. 描述拼接用行数组 + 缺失即跳过,而不是模板字符串拼接

实现为「把每行 push 进数组,最后 `join("\n")`」:缺失字段直接不 push,天然不会留下空行或多余换行。若用模板字符串,缺失分支需要在字符串里判断是否补 `\n`,容易出现尾随换行。

固定顺序:简介 → 作者 → 邮箱 → 主页 → QQ群 → 仓库。顺序固定使不同模组的清单描述在游戏内呈现一致,也便于测试断言。

### 3. 分级缺失处理:必需字段报错,可选字段省略

- `productName`、`description` 缺失或空字符串 → 抛错中止。理由与现有 `parseVersion` 一致:静默回落会让产物带上错误显示名,只在游戏内才暴露,属于用户侧故障。
- `author`、`author.email`、`author.url`、`packing.qq_group`、`repository` 缺失 → 整行省略。理由:这些是可选联系信息,不是所有模组都提供;报错会让新增模组必须凑齐全部字段才能打包。

**替代方案**:全部字段必需 → 拒绝,新增模组门槛过高;全部可选含 `productName` → 拒绝,显示名缺失时无合理回落值(回落模组名会得到 `auto-refill v2.2.0` 这种英文技术名)。

### 4. `author` 同时接受字符串与对象,`repository` 同样

npm 规范允许 `author: "Yinx <a@b.c> (https://x)"` 与 `repository: "github:Yinxe/MCBE"` 等简写。为降低改造风险,只实现最小解析:

- `author` 为字符串 → 整体当作作者名
- `author` 为对象 → 读 `name` / `email` / `url`
- `repository` 为字符串 → 当作 URL 处理
- `repository` 为对象 → 读 `url`

**不实现** npm 的 `"Name <email> (url)"` 单字符串拆分:本仓五个模组都用对象形式,拆分逻辑没有实际使用者,却要引入正则与边界处理。若将来需要,可在 `metadata.ts` 内加分支,不影响对外契约。

### 5. 仓库 URL 规范化用定点字符串替换,不用 `new URL()`

规范化目标:`git@github.com:Yinxe/MCBE.git`、`git+https://github.com/Yinxe/MCBE.git`、`https://github.com/Yinxe/MCBE` 三种输入都产出 `https://github.com/Yinxe/MCBE`。

实现顺序:去 `git+` 前缀 → 若匹配 `git@<host>:<path>` 改写为 `https://<host>/<path>` → 去尾部 `.git` → 去尾部 `/`。

**为什么不用 `new URL()`**:`git@github.com:Yinxe/MCBE.git` 不是合法 URL(`git@github.com` 会被当成 scheme),`new URL()` 直接抛错,仍需前置改写。定点替换更短且行为可预测。代价是只覆盖 `host:path` 形式的 SSH 地址;`ssh://git@host/path` 形式不处理(本仓不用),此时原样输出而不是报错。

### 6. `packing.qq_group` 加入 `SUPPORTED_PACKING_KEYS`

QQ 群号不是 npm 标准字段,放 `packing` 块可复用现有的未知字段校验。类型定为 `string`(群号可能带前导零或非数字内容,不做数值校验)。

**替代方案**:放 `package.json` 顶层自定义字段 → 拒绝,顶层字段名更容易与 npm 生态冲突;放单独的 `metadata` 文件 → 拒绝,增加一个来源文件,违反「`package.json` 单一来源」。

### 7. 元信息与版本在同一次读改写中写入

在 `synchronizePackVersions` 内,行为包与资源包各自的 `manifest` 对象上连续赋值 `header.name`、`header.description`、`header.version`、`header.min_engine_version`、`modules[].version`、`dependencies[].version`,然后一次 `writePackManifest`。理由:两个任务分别读改写同一批清单会产生中间态,且 `pack` 任务链中任一任务失败会留下部分字段已改、部分未改的清单。

### 8. 五个模组的联系信息统一填仓库级值

`author` 统一为 `{ name: "Yinx", email: "1423716216@qq.com", url: "https://github.com/Yinxe/" }`,`repository` 统一指向 `https://github.com/Yinxe/MCBE`,`packing.qq_group` 统一为 `"632178498"`(取自 `auto-refill` 与 `teleporter` 现有清单描述中的既有信息)。理由:这五个模组同属一个作者的同一批发布物,现有清单里出现的联系信息就是这一组值。

`craftablerarities` 与 `keepinventory` 现有清单没有联系信息,本次一并补齐,使其与其它模组一致——这正是本变更要消除的不一致。

### 9. 清单中手工维护的 `header.name` / `header.description` 不预先删除

改造时直接重新打包即可,打包会覆盖这两个字段。不手工编辑清单的好处:改造前的清单仍能反映改造前的状态,若打包失败可直接看到差异来源。

但 `craftablerarities` 的 `header.name` 现有装饰 `§l§e《合成配方扩展》 v1.0.1` 会在改造后变为 `合成配方扩展 v1.0.1`(装饰与手写版本号同时丢失)。这是本变更的预期效果,已在 proposal 中标为 BREAKING。

## Risks / Trade-offs

- [颜色符号在游戏内被错误解析] → 写入前不做任何转义或剥离;`§` 后必须跟一个格式码字符,拼接模板中「作者：」「仓库：」等固定前缀本身不含 `§`,不会与用户文本中的 `§` 相邻而错位。单测覆盖含 `§` 的输入。
- [`productName` 缺失导致所有模组打包失败] → 五个模组的 `package.json` 已全部声明 `productName`(本次调研确认),风险仅影响将来的新模组;错误信息中明确给出字段名与期望格式。
- [手工编辑清单的习惯被打断] → `mods/README.md` 与 `packages/mod-packaging/README.md` 明确写出「这两个字段由打包覆盖,不要手工改」,并在 `mod-workspace` 规格中固化。
- [仓库 URL 规范化只覆盖 `host:path` 形式] → 不匹配的输入原样输出(不报错、不猜测),保证不会产生比原值更差的地址;本仓五个模组统一用 https 形式,实际不受影响。
- [显示名带版本号后,包列表中出现重复的版本信息] → 游戏内包列表本就同时展示名称与版本,名称带版本是为便于在多版本共存时区分来源;若不希望带版本,可在后续变更中把 `resolvePackDisplayName` 改为只用 `productName`(纯逻辑单点改动)。

## Migration Plan

1. 先落地 `packages/mod-packaging` 的类型、纯逻辑模块与 `synchronizePackVersions` 扩展,并跑通该包单测与 `typecheck`
2. 再补五个模组的 `package.json` 元信息字段
3. 逐个模组执行 `npm run pack -w @mc-toolchain/<mod-name>`,检查 `release/` 产物内清单的 `header.name` / `header.description`
4. 回滚:还原 `packages/mod-packaging/src/*` 与五个 `package.json` 即可;清单中的这两个字段会在下次打包时被重新覆盖,无需手工恢复
