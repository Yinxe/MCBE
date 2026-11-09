# `mct`(Minecraft Creator Tools)0.21.0 调研

## 1. 命令面

`mct --version` → `0.21.0`。`mct help` 列出的命令分组:

| 分组 | 命令 |
| --- | --- |
| 项目 | `create`、`add`、`fix`、`setup`、`set`(CLI 中暂时禁用)、`deploy`、`export` |
| 校验 | `validate`、`aggregatereports`、`search` |
| 内容 | `view`、`edit`、`autotest` |
| 世界 | `world`、`ensureworld` |
| 渲染 | `render`、`buildstructure` |
| 服务器 | (BDS 相关) |

本文档只涉及 `create`、`setup`、`validate` 三个。

## 2. `mct create`

```text
mct create [name] [template] [creator] [description] [flags]
```

关键 flag:

| flag | 作用 |
| --- | --- |
| `-o, --output-folder <path>` | 输出目录,默认 `当前目录/out` |
| `-y, --yes` | 非交互,自动接受默认值(CI 用) |
| `-i, --input-folder <path>` | 输入目录 |
| `--if, --input-file <path>` | 输入 `.mcworld` / `.mctemplate` / `.mcpack` / `.mcaddon` / zip |
| `--single` | 配合 `-i`,强制把该目录当作单个项目处理 |
| `--isolated` / `--offline` | 不从网络加载 vanilla 资源;`--offline` 适合 CI |
| `--bp, --base-path <path>` | 只改包目录前缀,**不改生成内容的命名空间** |
| `--psw` | 使用 PowerShell 脚本(Windows) |

模板有 `addonStarter` 与 `tsStarter` 两种。

**没有 `--creator` / `-c` flag**:creator 只能作为**第三个位置参数**传入,写成 flag 会报 unknown option。

**实测结论**:`mct create <name> tsStarter ... -o mods/keepinventory -y` 生成的是一个基于 `@minecraft/core-build-tasks` + `just-scripts` 的 TypeScript 项目,而不是手写构建脚本的项目。

网络不可用时会告警并回退到内置版本数据(本次实测即出现「无法获取 bedrock-samples version.json,使用内置 1.26.60」)。

## 3. 模板生成的项目结构

`tsStarter` 生成的关键文件:

```text
<project>/
├── .env                     # PROJECT_NAME 等
├── .prettierrc.json
├── eslint.config.mjs
├── just.config.ts           # 构建/打包任务定义
├── package.json
├── tsconfig.json
├── scripts/main.ts          # 脚本入口(默认带一个 tick 示例)
├── behavior_packs/<name>/   # manifest.json + pack_icon.png
└── resource_packs/<name>/   # manifest.json + pack_icon.png
```

`package.json` 的 `devDependencies` 只有:`@minecraft/core-build-tasks`、`eslint-plugin-minecraft-linting`、`source-map`、`ts-node`、`typescript`。

模板自带的 `scripts`:

```text
lint, build, build:production, clean, local-deploy,
mcaddon, mcaddon:production,
enablemcloopback, enablemcpreviewloopback
```

> `mcaddon` / `mcaddon:production` 的真实行为见 [packaging-naming-and-modes.md](./packaging-naming-and-modes.md)。

## 4. `mct` 对模板文件的所有权(重要)

这是决定「能否安全改造模板」的关键问题。查 `mct` 内部实现(`lib/app/ProjectStandard.js` 等):

- `ProjectStandard.ensureIsStandard()` 会:
  - 把 `just.config.ts` 覆盖为 `JustConfig.getDefaultContent()`
  - 重置 `eslint.config.mjs`
  - 对 `package.json` 的 `devDependencies` / `dependencies` / `overrides` / `scripts` 做**白名单校验**,出现白名单外的 script 名或自定义顶层键时整体重置为默认
- 但它的**唯一调用方**是 `ProjectUtilities.processNewProject()`,即「新建/导入项目」流程。

**实测结论**:`mct setup` 与 `mct validate` 都不会触发重置。给项目加自定义 `pack` 脚本、自定义 `packing` 顶层键、改写 `just.config.ts` 后,执行:

```bash
mct setup -i mods/keepinventory
mct validate -i mods/keepinventory
```

自定义脚本、自定义顶层键、`just.config.ts` 的标记内容均**保留**。

**风险边界**:只有「把已有目录重新当作新项目导入」(如再次 `mct create` 指向该目录)才会重置。恢复方式写在 `mods/keepinventory/README.md`。

## 5. `mct validate`

```bash
mct validate -i mods/keepinventory
```

实测行为:

- 输出大量 `TESTSUCCESS` 行,`exit 0` 且无 `ERROR` 即视为通过。
- 会额外产生 `RECOMMENDATION` 与 `WARNING`,不阻断:
  - `RECOMMENDATION [PATHLENGTH104] File path contains non-lowercase letters: /README.md`
  - 网络相关的 `WARN`(离线时)
- **判定包类型时依据 `manifest.json`,不看目录名**。把 `behavior_packs/<name>` 改名为 `BP/<name>`、`resource_packs/<name>` 改名为 `RP/<name>` 后,validate 仍全部通过,并报告 `info.capabilities = ["behaviorPack","resourcePack"]`、`behaviorPackManifestCount = 1`、`resourcePackManifestCount = 1`。
  注意:这是 `mct` 自身的宽容度,**本项目的打包工具不继承它**——`pack` 只认官方全名目录,遇到 `BP/` / `RP/` 会报错(见 `mods/keepinventory/tools/packaging.ts` 的 `assertNoLegacyPackDirectories`)。
- `mct validate -i <folder>` 会在目录下创建 `out/`(副作用,需加进 `.gitignore`)。
- **`UNLINK` 项不计入 ERROR 计数**。只移入纹理与内容文件、忽略 `blocks.json` 与 `terrain_texture.json` 时,`errorCount` 仍为 `0`,但 `UNLINK` 给出「Texture does not have any items in this pack that are using this」警告。只看 ERROR 数会把「方块显示紫黑格」误判为成功。

### 测试配置不能放在模组根目录

`mct validate` 会把模组根目录下所有 `.json` 文件当作包内容检查,只靠**文件名基名**识别哪些属于工程配置。实测:模组根目录下的 `tsconfig.test.json` 会触发:

```text
[ERROR] ERROR: [UNKJSON101] (/tsconfig.test.json) Unknown JSON file found
```

原因是 `mct` 的白名单只认 `package.json` / `tsconfig.json` / `package-lock.json` 与 `*.config.*`,**不认 `tsconfig.test.json`**(基名是 `tsconfig.test` 而非 `tsconfig`)。从 `cli/index.mjs` 可查到它的排除正则:

```js
REMOVE_EXCLUDED_PATTERNS = [
  /(?:^|\/)\./,              // dotfiles
  /(?:^|\/)package\.json$/i,
  /(?:^|\/)package-lock\.json$/i,
  /(?:^|\/)tsconfig\.json$/i,
  /\.config\./i,             // vite.config.ts、jest.config.js
  /(?:^|\/)\.env/i,
];
```

**解决办法:把测试用的 tsconfig 放进子目录**(如 `tests/tsconfig.json`),并用 `-p tests/tsconfig.json` 调用。这样它的路径不再是模组根层的 `.json`,不会被扫成包内容。

验证方式:

```bash
cd mods/auto-refill
npx mct validate -i . 2>&1 | grep UNKJSON     # 期望:UNKJSON001 ... completed successfully
```

另一个可行的绕法是在校验时排除该项(`mct validate main UNKJSON -i .`),但这会掩盖其它真正的未知 JSON,不推荐。

### monorepo 下的批量校验

| 调用 | 行为 |
| --- | --- |
| `mct validate -i mods` | 逐个模组各产出一份报告(`mods/` 下每个模组一个 `.mcr.json`) |
| `mct validate -i mods/<name> --single` | 只处理该模组 |
| `mct validate`(仓库根,不带 `-i`) | 把整仓库当**单个项目**,只产出一份合并报告 |

### `out/` 报告目录的结构

`mct validate` 的 `-o, --output-folder` 默认值为「当前工作目录 + `out`」,每次运行写三个文件:

| 文件 | 内容 |
| --- | --- |
| `<name>.csv` | 逐项结果,列为 `Test,TestId,Type,Item,Message,Data,Path` |
| `<name>.mcr.json` | 结构化报告,顶层键为 `info` / `items` / `generatorName` / `suite` / `generatorVersion` |
| `<name>.report.html` | 人读报告 |

实测样例:`mods/keepinventory`(纯脚本行为包)产出 130 个 `items` 条目,`generatorName` 为 `"Minecraft Creator Tools"`、`generatorVersion` 为 `"0.21.0"`、`info.capabilities` 为 `["behaviorPack","scripting"]`。条目数随包内容变化,不要把它当作固定值。

因此 `out/` 的落点取决于**执行位置**:在仓库根跑得到 `./out/`,在模组目录跑得到 `mods/<name>/out/`。两处报告内容会随文件变化而不同(行数与体积相关的检查项会变),不能混用。该目录已由 `.gitignore` 的 `out/` 行覆盖。

## 6. `mct add` 的落点与命名

### 6.1 落点由 `-o` 决定

| 调用 | 落点 |
| --- | --- |
| `mct add <template> <name> -i . -o .` | 写入当前项目的既有包目录;清单按条目合并,`manifest.json` 的 UUID **不变** |
| `mct add <template> <name> -i .`(省略 `-o`) | 在 `<cwd>/out/` 下新建 `contoso_<project>_bp` / `contoso_<project>_rp`,与既有包并存 |
| `mct add <template> <name> -i mods -o mods` | 内容被写进 `mods/` 下的**每一个模组** |

源码路径:`AddCommand.js` → `ContentWriter.writeGeneratedContent()` → `project.ensureDefaultBehaviorPackFolder()`(`Project.js:3785`)。该方法先找项目里已注册的 `behaviorPackManifestJson` 条目并复用其父目录,找不到才在 `behavior_packs/` 下新建 `effectiveShortName + "_bp"`。

模板选择的两个限制:

- `mct add --list-types` 的输出分两段:`Categories:` 下 7 个类别(`entity` / `block` / `item` / `spawnLootRecipes` / `worldGen` / `visuals` / `singleFiles`),`Gallery templates (214):` 下 214 个可直接用作 `<template>` 参数的模板 id。类别本身不是模板 id,不能直接传给 `mct add`。
- `entity` 类型**必须交互式选择模板**:`mct add entity <name> --yes` 报 `entity type add requires interactive template selection; --yes is incompatible. Use a specific gallery template id instead`。CI 中只能用具体模板 id。

### 6.2 包目录名是派生缩写,不是包名

```text
包目录名 = makeNameFolderSafe( getSuggestedShortName(creator) + "_" + getSuggestedShortName(name) ) + "_bp"
```

`getSuggestedShortName`(`ProjectUtilities.js:988`):去掉 `-` / `_` / 空格等,然后**只保留大写字母**并转小写;大写字母不足 2 个时取前 8 字符小写。
`makeNameFolderSafe`(`MinecraftUtilities.js`):转小写后截断至 16 字符。

实测样例:

| creator | name | 包目录名 |
| --- | --- | --- |
| `mc-toolchain` | `keepinventory` | `mctoolch_keepinv_bp` |
| `K` | `KEEPINVENTORY` | `k_keepinventory_bp` |
| `_` | `KEEPINVENTORY` | `_keepinventory_bp` |

下划线分隔符与 `_bp` 后缀都是强制拼接的,因此 `mct create` 无法产出 `<name>` 形式的目录名,只能事后改名。改名后 `mct` 各命令仍正常作用(已实测),但需同步 `.env` 的 `PROJECT_NAME`。

### 6.3 生成内容的命名空间恒为 `contoso_<输出目录名>`

| 执行位置 | 生成的标识符 |
| --- | --- |
| `-o .`(目录名 `keepinventory`) | `contoso_keepinve:<name>` |
| `-o mod` | `contoso_mod:<name>` |

`contoso` 是 `effectiveCreator` 的兜底值(`Project.js:1136`)。`--bp` 只影响包目录前缀,不影响命名空间。因此无法得到干净的 `<name>:` 命名空间,移入后需显式改正。

### 6.4 `mct add` 不修改清单标识字段

对已有包执行 `mct add -i . -o .` 前后对比 `manifest.json`:`header.uuid`、`modules[].uuid`、资源包依赖的 `uuid` 均未改变。新增内容为 `blocks/*.json`、`blocks.json`、`terrain_texture.json`、`textures/**`、`texts/**`;连续两次 `add` 后 `blocks.json` 中两个条目并存。

因此从临时脚手架项目移入内容时,**不得拷贝临时项目的 `manifest.json` 与 `pack_icon.png`**,否则会覆盖目标模组的 UUID 与已设计的图标。

### 6.5 无资源包的模组会被创建空模块伪资源包

若目标模组只有行为包(`manifest.json` 的 `modules` 只含 `script`),`mct add -i . -o .` 在写入行为包内容的同时,会新建一个 `resource_packs/contoso_<输出目录名>/`:

```text
resource_packs/contoso_keepinve/
├── manifest.json        # modules 为 []
├── blocks.json
├── texts/en_US.lang
└── textures/...
```

该 `manifest.json` 的 `modules` 为 `[]`(既无 `data`/`script` 也无 `resources`)。后果不是「目录名不规范」而是**打包直接失败**:

```text
Error: 无法从清单判定包类型:resource_packs/contoso_keepinve/manifest.json
       (modules[].type 为 [],既不含 data/script 也不含 resources)
```

对照实验确认这是 `mct` 的固有行为:在本身有完整资源包的临时脚手架项目里执行同样的 `mct add`,生成的 `manifest.json` 的 `modules` 为 `[{"type":"resources"}]`,不会出现空数组。

处理方式:`rm -rf resource_packs`(纯脚本模组)或改名为 `resource_packs/<name>` 并手工补上 `resources` 模块。

### 6.6 验证伪资源包的产生与修复

```bash
cd /tmp && rm -rf emptypro && mkdir emptypro && cd emptypro
mct create keepinventory tsStarter mc-toolchain -o mod -y
cd mod
# 删掉资源包,模拟「只有行为包」的模组
rm -rf resource_packs
mct add basicUnitCubeBlock probe -i . -o . -y
ls -d resource_packs/*                          # resource_packs/contoso_keepinve
node -e 'console.log(JSON.stringify(require("./resource_packs/contoso_keepinve/manifest.json").modules))'
# 输出 []
```

## 7. 可复现的验证方式

```bash
mct --version
mct help create
# 在临时目录建项目,观察生成结构与 package.json
mct create probe tsStarter someone "probe" -o /tmp/mct-probe -y
cat /tmp/mct-probe/package.json
# 验证 setup/validate 不重置自定义内容
# 1) 在目标项目里加一个自定义 script 与自定义顶层键
# 2) mct setup -i <project> && mct validate -i <project>
# 3) 重新读取 package.json 与 just.config.ts,确认自定义内容仍在
```

### 验证包目录命名派生规则

```bash
cd /tmp && rm -rf nsprobe && mkdir nsprobe && cd nsprobe
mct create keepinventory tsStarter mc-toolchain -o mod -y
ls mod/behavior_packs/            # mctoolch_keepinv
cat mod/.env                      # PROJECT_NAME="mctoolch_keepinv"
```

### 验证改名后 `mct add` 仍复用既有包且 UUID 不变

```bash
cd /tmp/nsprobe/mod
mv behavior_packs/mctoolch_keepinv behavior_packs/keepinventory
mv resource_packs/mctoolch_keepinv resource_packs/keepinventory
sed -i 's/PROJECT_NAME="mctoolch_keepinv"/PROJECT_NAME="keepinventory"/' .env
cp behavior_packs/keepinventory/manifest.json /tmp/before.json
mct add basicUnitCubeBlock tb -i . -o . -y
diff /tmp/before.json behavior_packs/keepinventory/manifest.json   # 无差异
ls behavior_packs/keepinventory/blocks/                            # tb.json
```

### 验证命名空间来源

```bash
# 输出目录名决定命名空间,而非 create 的 name/creator 参数
mct create keepinventory tsStarter mc-toolchain -o /tmp/nsprobe/t2 -y
cd /tmp/nsprobe/t2 && mct add basicUnitCubeBlock nb -i . -o . -y
node -e 'const b=require("./behavior_packs/contoso_t2_bp/blocks/nb.json");
console.log(b["minecraft:block"].description.identifier)'   # contoso_t2:nb
```

### 验证 `UNLINK` 不计入 ERROR 计数

```bash
cd /tmp/nsprobe/mod
# 只拷内容文件,故意忽略 blocks.json 与 terrain_texture.json
mct validate -i . -o /tmp/nsprobe/rep
grep -c ERROR /tmp/nsprobe/rep/*.csv        # 0
grep UNLINK /tmp/nsprobe/rep/*.csv          # 出现未链接纹理警告
```

### 验证 monorepo 下 `mct add` 的落点

```bash
cd /tmp && rm -rf monopro && mkdir monopro && cd monopro
mct create modA tsStarter mc-toolchain -o mods/modA -y
mct create modB tsStarter mc-toolchain -o mods/modB -y
mct add basicUnitCubeBlock stray -i mods -o mods -y
find mods -name "stray.json"     # 两个模组下都出现
```

### 验证 `out/` 报告目录的结构与落点

```bash
cd /tmp/nsprobe/mod
mct validate -i .          # 报告写入 ./out/
ls out/                    # <name>.csv、<name>.mcr.json、<name>.report.html

# 报告元数据
node -e 'const r=require("./out/keepinventory.mcr.json");
console.log(r.generatorName, r.generatorVersion, JSON.stringify(r.info.capabilities), r.items.length)'
# Minecraft Creator Tools 0.21.0 ["behaviorPack","scripting"] 130

# CSV 列头
head -1 out/*.csv          # Test,TestId,Type,Item,Message,Data,Path

# 落点随执行位置变化
cd /tmp/nsprobe && mct validate -i mod    # 报告写入 /tmp/nsprobe/out/
```

### 验证 `mct create` 没有 `--creator` flag

```bash
mct create probe tsStarter -c someone -o /tmp/probe2 -y   # 报 unknown option
mct create probe tsStarter someone -o /tmp/probe2 -y      # creator 只能作位置参数
```

### 验证 `mct add entity` 无法非交互

```bash
cd /tmp/nsprobe/mod
mct add entity my_entity -i . -o . --yes
# entity type add requires interactive template selection; --yes is incompatible.
# Use a specific gallery template id instead.

mct add --list-types | head -12   # Categories: 7 个类别;Gallery templates (214): 214 个模板 id
mct add --list-types | grep -c '^  [a-zA-Z_-]* — '   # 数模板条目
```
