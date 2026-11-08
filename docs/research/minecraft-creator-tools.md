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

模板有 `addonStarter` 与 `tsStarter` 两种。

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
- `mct validate -i <folder>` 会在目录下创建 `out/`(副作用,需加进 `.gitignore`)。

## 6. 可复现的验证方式

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
