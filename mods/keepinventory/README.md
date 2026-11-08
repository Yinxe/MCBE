# 死亡不掉落(keepinventory)

Minecraft Bedrock 行为包:玩家死亡后保留物品栏与经验。

- 不开启世界作弊,也不引入实验性功能
- 只改动 `keepInventory` 一个游戏规则
- 兼容 Minecraft 1.21.90 及以上
- 包内标识为附加内容(`metadata.product_type: "addon"`)

## 兼容性与成就

| Minecraft 版本    | 死亡不掉落生效 | 成就       |
| ----------------- | -------------- | ---------- |
| 1.21.90 – 1.26.40 | 是             | 可获得     |
| 1.26.50 及以上    | 是             | 被平台禁用 |

> **已知平台限制(MCPE-242529)**
>
> 自 Minecraft 1.26.50 起,装载任何**侧载(非 Marketplace)**行为包的世界都会禁用成就。
> 这是平台的既有行为,与本模组的实现无关;`metadata.product_type: "addon"` 自 1.26.50 起也不再豁免。
> 在 1.26.50 及以后的版本上,本模组仍能正常实现死亡不掉落,但该世界的成就会保持锁定。

本模组不开启作弊,因此在平台允许外部行为包的版本(Minecraft < 1.26.50)上,启用后成就仍可正常解锁。

## 安装

1. 构建产物(见下文[开发](#开发)),得到行为包。
2. 把行为包导入游戏:
   - 直接双击 `.mcpack` 文件导入,或
   - 把行为包目录复制到 `development_behavior_packs/` 目录。
3. 在世界设置的「行为包」页启用「死亡不掉落」。
4. **无需**开启「世界作弊」;保持关闭即可。

## 使用

装载行为包后无需任何操作:模组在世界加载完成后把 `keepInventory` 游戏规则设为开启。
`keepInventory` 是世界级规则,与具体玩家无关,因此只在世界加载后设置一次。

模组只写 `keepInventory` 一个游戏规则,不会影响 `commandBlocksEnabled` 等其它规则,也不会改变世界原有的作弊开关。

## 目录结构

```text
mods/keepinventory/
├── behavior_packs/keepinventory/  # 行为包:manifest.json、pack_icon.png
├── scripts/main.ts            # 脚本入口(编译打包为包内 scripts/main.js)
├── tools/packaging.ts         # 自定义打包逻辑(版本与最低游戏版本同步)
├── tools/generate-pack-icon.js # 图标生成脚本(像素画 → 128×128 PNG)
├── dist/                      # 构建与打包产物(gitignore)
├── just.config.ts             # 构建/打包任务定义
├── package.json               # 包名、版本与打包配置(唯一版本来源)
└── .env                       # PROJECT_NAME 等本地环境变量
```

## 开发

在仓库根目录执行(依赖 npm workspace):

```bash
npm install                                     # 安装工作区依赖
npm run build -w @mc-toolchain/keepinventory    # 类型检查并产出 dist/scripts/main.js
npm run local-deploy -w @mc-toolchain/keepinventory  # 监听改动并同步到本地开发包目录
```

### 行为包图标

`behavior_packs/keepinventory/pack_icon.png` 是 128×128 RGBA 像素画图标,画面表达「玩家死亡(墓碑)但背包物品仍在(带绿色保护光晕的背包)」。

图标是**静态资源**,不在构建期生成,直接随包打包。需要调整构图时改脚本后重新生成:

```bash
npm run generate:icon -w @mc-toolchain/keepinventory
```

脚本为 `tools/generate-pack-icon.js`:以 32×32 逻辑像素绘制,再按 4 倍最近邻放大到 128×128(保持硬边像素风),直接写 PNG 字节,不依赖任何图像库。

校验行为包结构:

```bash
mct validate -i mods/keepinventory
```

### 使用 `mct` 工具

本仓库是 monorepo,每个 `mods/<name>` 是独立的 `mct` 项目,各自有自己的 `behavior_packs/`、`resource_packs/`、`.env` 与构建配置。

#### 校验

```bash
cd mods/keepinventory
mct validate -i .        # 只校验当前模组

cd ../..
mct validate -i mods     # 逐个校验 mods/ 下每个模组,各自产出一份报告
```

**不要在仓库根直接跑不带 `-i` 的 `mct validate`**:它会把整个仓库当作单个项目,只产出一份合并报告。报告写入 `out/`(已 gitignore)。

#### 新增内容

```bash
cd mods/keepinventory
mct add basicUnitCubeBlock my_block -i . -o .
```

`-i` 与 `-o` 必须同时指向**当前模组目录**:

| 调用                          | 结果                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `-i . -o .`                   | ✅ 写入 `behavior_packs/keepinventory/`,清单按条目合并,`manifest.json` 的 UUID 不变 |
| `-i .`(省略 `-o`)             | ❌ 在 `out/` 下新建 `contoso_*_bp` / `contoso_*_rp`,与既有包并存                    |
| `-i mods -o mods`(指向父目录) | ❌ 内容被写进 `mods/` 下的**所有模组**                                              |

两点需要注意:

- 生成内容的命名空间恒为 `contoso_<输出目录名>`(如 `contoso_keepinve:`),需手工改为项目约定的命名空间。
- `mct validate` 的 ERROR 计数**不包含未链接纹理**:若清单映射缺失,仍会报 0 ERROR,但 `UNLINK` 项会提示纹理未被引用。校验时需同时看 `UNLINK`。

#### 只有行为包的模组需清理伪资源包

本模组只有行为包(`manifest.json` 的 `modules` 只有 `script`,没有 `resources`)。在这种模组上执行 `mct add` 时,`mct` 找不到已注册的资源包,会新建一个 `resource_packs/contoso_<目录名>/`:

```text
resource_packs/contoso_keepinve/
├── manifest.json        # 注意:modules 为空数组
├── blocks.json
├── texts/en_US.lang
└── textures/...
```

它生成的 `manifest.json` 的 `modules` 是 `[]`,既不含 `data`/`script` 也不含 `resources`,因此 `pack` 会直接失败:

```text
Error: 无法从清单判定包类型:resource_packs/contoso_keepinve/manifest.json
       (modules[].type 为 [],既不含 data/script 也不含 resources)
```

处理方式二选一:

```bash
# 方式一:丢弃资源(纯脚本模组不需要这些内容)
rm -rf resource_packs

# 方式二:保留资源,改名为正式资源包并补上 resources 模块
mv resource_packs/contoso_keepinve resource_packs/keepinventory
# 然后手工把 manifest.json 的 modules 改为:
# [{ "description": "Resources", "type": "resources", "uuid": "<新生成>", "version": [1, 0, 0] }]
```

处理后 `pack` 恢复:方式一产出 `_bp.mcpack`,方式二产出 `.mcaddon`。这是 `mct` 的固有行为(模组有完整资源包时不会发生),不是本项目打包工具的问题。

#### 新建模组

```bash
mct create <name> tsStarter mc-toolchain -o mods/<name>
```

`mct` 会把包目录命名为 `PROJECT_NAME` 的派生缩写(形如 `mctoolch_keepinv_bp`),不等于包名。生成后需手工对齐:

```bash
cd mods/<name>
mv behavior_packs/mctoolch_* behavior_packs/<name>
mv resource_packs/mctoolch_* resource_packs/<name>
sed -i 's/^PROJECT_NAME=.*/PROJECT_NAME="<name>"/' .env
```

`.env` 的 `PROJECT_NAME` 必须与包目录名一致,否则 `just.config.ts` 中 `./behavior_packs/${projectName}` 会指向不存在的目录,打包取不到包。改名后 `mct` 的各命令仍正常作用于改名后的目录。

#### 先看效果再决定时

若需要先查看生成效果或手工挑选内容,可在 `mods/` **之外**建临时项目生成,再挑选内容移入:

```bash
mct create scratch tsStarter mc-toolchain -o /tmp/scratch -y
cd /tmp/scratch && mct add basicUnitCubeBlock probe -i . -o .
```

移入时只取内容文件(定义文件、纹理、模型、语言文件),清单类文件(`blocks.json`、`terrain_texture.json`)按条目合并,并跳过临时项目的 `manifest.json` 与 `pack_icon.png`。临时目录不得放在 `mods/` 下,否则会被批量校验扫到。

已确定要保留的内容,优先直接在模组目录用 `mct add -i . -o .` 生成,无需绕临时目录。

## 打包

```bash
npm run pack -w @mc-toolchain/keepinventory
```

只有一个 `pack` 入口,产物形态由 `package.json` 的 `packing.mode` 决定,产物默认写入 `dist/packages/`。

### `packing` 配置

`package.json` 中的 `packing` 块整体可选,每个字段都有默认值:

| 字段                     | 默认值                              | 说明                                   |
| ------------------------ | ----------------------------------- | -------------------------------------- |
| `mode`                   | `"auto"`                            | 产物形态:`auto` / `mcpack` / `mcaddon` |
| `output`                 | `"dist/packages"`                   | 产物输出目录(相对模组根目录)           |
| `minimum_engine_version` | 由 `@minecraft/server` 依赖版本推导 | 最低游戏版本,形如 `[1, 21, 90]`        |

包目录不可配置:行为包固定为 `behavior_packs/<name>`,资源包固定为 `resource_packs/<name>`。

### `mode` 与产物形态

| `mode`       | 探测到 1 个包                 | 探测到 2 个包                       |
| ------------ | ----------------------------- | ----------------------------------- |
| `auto`(默认) | `<name>-v<version>_bp.mcpack` | `<name>-v<version>.mcaddon`         |
| `mcpack`     | 该包的 `.mcpack`              | `_bp.mcpack` 与 `_rp.mcpack` 各一个 |
| `mcaddon`    | 报错(提示改用 `mcpack`)       | `<name>-v<version>.mcaddon`         |

产物文件名统一为 `<name>-v<version>.<ext>`,其中 `<name>` 取自 `package.json#name` 的最后一段(如 `@mc-toolchain/keepinventory` → `keepinventory`),`<version>` 取自 `package.json#version`,所以 `0.0.1` 会产出 `keepinventory-v0.0.1_bp.mcpack`。

探测不到任何包时任何 `mode` 都报错。产物文件名带版本号,因此多个版本可并存于输出目录。

### 目录约定与包类型判定

包目录的顶层目录名固定为官方全名,**不提供缩写写法**:

| 包     | 目录                     |
| ------ | ------------------------ |
| 行为包 | `behavior_packs/<name>/` |
| 资源包 | `resource_packs/<name>/` |

这样固定的原因是为了与 `mct`(Minecraft Creator Tools)的布局一致:它的两个官方模板(`addonStarter` / `tsStarter`)都生成 `behavior_packs/` 与 `resource_packs/`,模板的 `tsconfig.json` 用 `"baseUrl":"behavior_packs/"`。使用 `BP/` / `RP/` 会让本项目的布局与 `mct` 的预期分叉,因此打包会在检测到这两个目录时直接报错并提示改名。

**包的类型仍以 `manifest.json` 为准**,不依赖目录名:`modules[].type` 含 `data` / `script` 判为行为包,含 `resources` 判为资源包。

打包在 `behavior_packs/` 与 `resource_packs/` 之下探测含 `manifest.json` 的包目录。同一类型命中多个包时报歧义错误,需只保留一个包目录。

### 版本同步

`pack` 在压缩前把 `package.json#version` 写成 `[major, minor, patch]` 写入包内所有 `manifest.json`(`header.version`、`modules[].version` 与资源包对行为包的依赖 `version`),因此 `package.json` 是版本的唯一来源。版本号无法解析为三段数字时打包中止。

### 最低游戏版本

`pack` 同时把最低游戏版本写入各包 `manifest.json` 的 `header.min_engine_version`,与 `@minecraft/server` 依赖版本保持同源:

1. 若配置了 `packing.minimum_engine_version`(如 `[1, 21, 90]`),直接采用该值。
2. 否则依据 `package.json` 中 `@minecraft/server` 的依赖版本,查 `tools/packaging.ts` 内的映射表推导,并在日志中说明来源。
3. 两者都不可用时**报错中止**,不猜测、不回落到固定值。

选「报错」而非「回落到某个默认值」,是因为 `min_engine_version` 写错只会在低版本客户端加载后才暴露,属于用户侧故障;打包期报错能立刻定位。

> **维护提示**:Minecraft 官方不提供「脚本 API 版本 → 游戏版本」的机器可读映射(脚本 API 包、`mct` 数据目录、`bedrock-samples` 的 `version.json` 都不含对方版本),因此映射表是 `tools/packaging.ts` 中手工维护的静态数据。
> `@minecraft/server` 升级到新版本后,需把对应档位补进 `SCRIPT_API_VERSION_MAPPINGS`,否则打包会报「不在版本映射表中」。
> 数据来源与逐条验证方式见 `docs/research/minecraft-server-api-versions.md`。

### 产物内容

`.mcpack` 把包内容置于压缩包根目录(不套一层目录),行为包同时包含构建产物 `scripts/main.js`;产物不含 `.ts` 源文件与 `.map` 调试文件。

### 与模板自带 `mcaddon` 脚本的关系

模板保留了两个官方脚本,本模组的 `pack` 与它们互不干扰:

| 脚本                         | 实际行为                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run mcaddon`            | `clean-local` → `build` → `mcaddonTask`,产出 `dist/packages/<name>_bp.mcpack` 与 `<name>.mcaddon`(无资源包时会夹带一个空的 `_rp.mcpack`) |
| `npm run mcaddon:production` | 与 `mcaddon` **完全相同**                                                                                                                |

`mcaddon:production` 的 `--production` 在本模板里没有任何实际作用:模板的 `just.config.ts` 从未读取 `argv().production`,`@minecraft/core-build-tasks` 5.5.0 也没有任何代码消费该标志(已实测:两者产物的解压内容逐字节一致,仅 zip 内时间戳不同)。真正控制产物形态的是 `bundleTask` 的 `minifyWhitespace` / `sourcemap` 等显式参数,而模板已把它们写死。

两个官方脚本的产物名不带版本号,无法多版本并存,也不支持只出 `.mcpack`;因此日常打包请用 `pack`。

> **注意:重新导入项目会重置自定义打包配置**
>
> `mct` 把本模组当作「新项目」导入时(`mct create` / 导入流程),会把 `just.config.ts` 重置为模板默认内容,并按白名单裁剪 `package.json`(自定义 `pack` 脚本与 `packing` 顶层键都在白名单外)。
> 此时需重新加回:①`package.json` 的 `"pack": "just-scripts pack"` 与 `packing` 块;②`just.config.ts` 末尾的自定义打包任务。
> `tools/packaging.ts` 不在重置范围内,无需恢复。日常的 `mct validate` / `mct setup` 不会触发重置。

## 兼容性实现说明

行为包的下限为 Minecraft 1.21.90(`@minecraft/server` 2.0.0),因为实现依赖该版本首次提供的 `world.afterEvents.worldLoad`:

- `behavior_packs/keepinventory/manifest.json` 的 `min_engine_version` 为 `[1, 21, 90]`
- 脚本模块依赖为 `@minecraft/server` `[2, 0, 0]`
- 只使用 `@minecraft/server` 2.0.0 起可用的 API

实现上订阅 `world.afterEvents.worldLoad`,在回调中再包一层 `system.run` 把写入推迟到下一个 tick,以避开世界加载当帧可能存在的只读窗口。
