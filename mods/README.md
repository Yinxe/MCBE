# mods

本目录存放 Minecraft Bedrock 附加内容模组。每个子目录是一个**独立的 `mct`(Minecraft Creator Tools)项目**,同时是仓库的一个 npm workspace 成员,各自拥有 `behavior_packs/`、`resource_packs/`、`.env` 与构建配置。

本文件规定的是**本目录内所有模组共同遵守的规则**;单个模组的打包配置、脚本行为等细节见各自的 `README.md`。

## 模组清单

| 模组 | 说明 |
| --- | --- |
| `auto-refill` | 自动替换：主手消耗品用完/挖坏/触发图腾后自动换补同类 |
| `keepinventory` | 死亡不掉落：玩家死亡时保留背包物品 |
| `craftablerarities` | 合成配方扩展：79 个工作台配方合成稀有物品与隐藏方块 |
| `spectator-mode` | 灵魂出窍：飞离真身侦查，超出距离容忍 5 秒后自动回归 |
| `teleporter` | 传送：传送点、死亡点、玩家间传送请求；无需作弊、保留成就 |

## 模组不再自带打包实现

打包逻辑全部在 [`@mc-toolchain/mod-packaging`](../packages/mod-packaging/README.md)，模组目录内**不再有** `tools/packaging.ts` 之类的实现文件。模组的 `just.config.ts` 只需导入并组装任务：

```ts
import { createPackagesByMode, synchronizePackVersions } from "@mc-toolchain/mod-packaging";

task("synchronizePackVersions", () => synchronizePackVersions(__dirname));
task("pack", series("clean-build", "build", "synchronizePackVersions", createPackagesByMode(__dirname)));
```

需要改打包行为（产物命名、包目录探测、最低版本推导）时，改 `packages/mod-packaging` 一处即可，所有模组同时生效。**不要**在单个模组里重写这些逻辑。

### 产物统一写入仓库根 `release/`

全部模组的产物集中在仓库根的 [`release/`](../release/) 目录，不在模组目录内留存。每个模组的 `package.json` MUST 显式声明：

```jsonc
{
  "packing": {
    "mode": "auto",
    "output": "../../release/"
  }
}
```

`output` 是**相对模组根目录**的路径，`mods/<name>/` 到仓库根正好两层，所以写 `../../release/`。打包库 `@mc-toolchain/mod-packaging` 的默认值仍是 `dist/packages`（相对模组根）——它不假设调用方位于本仓的 `mods/` 下，集中输出由各模组的显式配置保证。

`release/` 已在根 `.gitignore` 中忽略，产物不入库。安装包时统一从 `release/` 取，文件名形如 `<name>-v<version>_bp.mcpack`。

包目录探测、版本同步与 `packing` 字段的含义见 `packages/mod-packaging/README.md`。

## 模组通用共享代码

跨模组复用的通用能力都在 [`@mc-toolchain/mod-common`](../packages/mod-common/README.md)：

- 运行时：`§` 文本样式码、跨行为包 HUD 总线（逐玩家优先级仲裁）。
- 界面：模态/动作/消息表单构建器、受限上下文的安全执行助手、消息提示。

模组通过 `dependencies` / `devDependencies` 中的 `"@mc-toolchain/mod-common": "*"` 引用，源码由 esbuild 直接内联进产物，不在游戏内产生额外模块加载。

命令回调运行在受限上下文，传送、打开界面、写存档都必须推迟到安全 tick —— 这个推迟统一由 `@mc-toolchain/mod-common` 的 `runSafe` / `runSafeDetached` 承担，不要在模组内手写 `system.run`。机制说明见 [`docs/research/read-only-context.md`](../docs/research/read-only-context.md)。

这个包以 TS 源码直出，因此**模组的 `tsconfig.json` 必须使用 `target: es6` 或更高**；降到 `es5` 会导致共享包源码编译失败。

## 目录布局约定

每个模组的包目录固定为:

| 包     | 目录                     |
| ------ | ------------------------ |
| 行为包 | `behavior_packs/<name>/` |
| 资源包 | `resource_packs/<name>/` |

两条约束:

1. **顶层目录名只用官方全名** `behavior_packs` / `resource_packs`,不用 `BP` / `RP`。
   原因是 `mct` 的两个官方模板(`addonStarter` / `tsStarter`)都生成全名目录,模板的 `tsconfig.json` 用 `"baseUrl":"behavior_packs/"`;用缩写会让本仓库的布局与 `mct` 的预期分叉。打包工具在模组根目录检测到 `BP` / `RP` 时会直接报错并提示改名。
2. **内层包目录名等于 `<name>`**,即 `package.json#name` 去掉 npm scope 的部分(`@mc-toolchain/keepinventory` → `keepinventory`)。这是本项目自己的约定,`mct` 本身不要求。

包的类型仍以 `manifest.json` 的 `modules[].type` 为准,不依赖目录名:含 `data` / `script` 判为行为包,含 `resources` 判为资源包。

## 使用 `mct`

### 校验

```bash
cd mods/keepinventory
mct validate -i .        # 只校验当前模组

cd ../..
mct validate -i mods     # 逐个校验 mods/ 下每个模组,各自产出一份报告
```

**不要在仓库根直接跑不带 `-i` 的 `mct validate`**:它会把整个仓库当作单个项目,只产出一份合并报告。报告写入 `out/`(已 gitignore)。

校验判据不能只看 ERROR 计数:`mct validate` 的 ERROR 计数**不包含未链接纹理**。若清单映射缺失,仍会报 0 ERROR,但 `UNLINK` 项会提示「Texture does not have any items in this pack that are using this」。需同时检查 `UNLINK`。

### 新增内容

```bash
cd mods/keepinventory
mct add basicUnitCubeBlock my_block -i . -o .
```

`-i` 与 `-o` 必须同时指向**当前模组目录**:

| 调用                          | 结果                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `-i . -o .`                   | ✅ 写入 `behavior_packs/<name>/`,清单按条目合并,`manifest.json` 的 UUID 不变 |
| `-i .`(省略 `-o`)             | ❌ 在 `out/` 下新建 `contoso_*_bp` / `contoso_*_rp`,与既有包并存             |
| `-i mods -o mods`(指向父目录) | ❌ 内容被写进 `mods/` 下的**所有模组**                                       |

生成内容的命名空间恒为 `contoso_<输出目录名>`(如 `contoso_keepinve:`),需手工改为项目约定的命名空间。

### 只有行为包的模组需清理伪资源包

若模组只有行为包(`manifest.json` 的 `modules` 不含 `resources`),`mct add` 找不到已注册的资源包,会新建一个 `resource_packs/contoso_<目录名>/`:

```text
resource_packs/contoso_keepinve/
├── manifest.json        # 注意:modules 为空数组
├── blocks.json
├── texts/en_US.lang
└── textures/...
```

该 `manifest.json` 的 `modules` 是 `[]`,既不含 `data`/`script` 也不含 `resources`,因此打包会直接失败:

```text
Error: 无法从清单判定包类型:resource_packs/contoso_keepinve/manifest.json
       (modules[].type 为 [],既不含 data/script 也不含 resources)
```

处理方式二选一:

```bash
# 方式一:丢弃资源(纯脚本模组不需要这些内容)
rm -rf resource_packs

# 方式二:保留资源,改名为正式资源包并补上 resources 模块
mv resource_packs/contoso_keepinve resource_packs/<name>
# 然后手工把 manifest.json 的 modules 改为:
# [{ "description": "Resources", "type": "resources", "uuid": "<新生成>", "version": [1, 0, 0] }]
```

处理后打包恢复:方式一产出 `_bp.mcpack`,方式二产出 `.mcaddon`。这是 `mct` 的固有行为(模组本身有完整资源包时不会发生),不是本项目打包工具的问题。

## 新建模组

```bash
mct create <name> tsStarter mc-toolchain -o mods/<name>
```

`mct` 会把包目录命名为从 creator 与 name 派生的缩写(形如 `mctoolch_keepinv_bp`),不等于包名。生成后需手工对齐:

```bash
cd mods/<name>
mv behavior_packs/mctoolch_* behavior_packs/<name>
mv resource_packs/mctoolch_* resource_packs/<name>
sed -i 's/^PROJECT_NAME=.*/PROJECT_NAME="<name>"/' .env
```

`.env` 的 `PROJECT_NAME` 必须与包目录名一致,否则 `just.config.ts` 中 `./behavior_packs/${projectName}` 会指向不存在的目录,打包取不到包。改名后 `mct` 的各命令仍正常作用于改名后的目录。

派生规则与实测样例见 [`docs/research/minecraft-creator-tools.md`](../docs/research/minecraft-creator-tools.md)。

## 先看效果再决定时

若需要先查看生成效果或手工挑选内容,可在 `mods/` **之外**建临时项目生成,再挑选内容移入:

```bash
mct create scratch tsStarter mc-toolchain -o /tmp/scratch -y
cd /tmp/scratch && mct add basicUnitCubeBlock probe -i . -o .
```

移入时只取内容文件(定义文件、纹理、模型、语言文件),清单类文件(`blocks.json`、`terrain_texture.json`)按条目合并,并跳过临时项目的 `manifest.json` 与 `pack_icon.png`。临时目录不得放在 `mods/` 下,否则会被批量校验扫到。

已确定要保留的内容,优先直接在模组目录用 `mct add -i . -o .` 生成,无需绕临时目录。
