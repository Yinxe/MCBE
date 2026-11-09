# Mct Toolchain Usage Specification

## Purpose

约束本项目在 monorepo 布局下如何调用 `mct`(Minecraft Creator Tools),使 `mct` 生成的内容能落到既有的包目录中,而不会产生与主包并存的重复包结构,也不会破坏已发布的 UUID 与清单引用。

## Requirements

### Requirement: 内容生成必须限定到单个模组目录

`mct add` MUST 在目标模组的目录内执行,并同时指定 `-i .` 与 `-o .`。MUST NOT 把 `-i` 或 `-o` 指向 monorepo 的 `mods/` 父目录:该用法会把生成内容同时写入父目录下的所有模组。

#### Scenario: 正确调用写入既有包目录

- **WHEN** 在 `mods/keepinventory` 目录内执行 `mct add basicUnitCubeBlock tb -i . -o .`
- **THEN** 生成的文件写入 `behavior_packs/<name>/` 与 `resource_packs/<name>/`,不新建 `contoso_*` 目录

#### Scenario: 省略 -o 产生重复包

- **WHEN** 在模组目录只执行 `mct add <template> <name> -i .`
- **THEN** 工具在 `<模组目录>/out/` 下新建 `contoso_<project>_bp` 与 `contoso_<project>_rp`,与既有包并存

#### Scenario: 指向父目录污染所有模组

- **WHEN** 在 monorepo 根执行 `mct add <template> <name> -i mods -o mods`
- **THEN** 生成内容被写入 `mods/` 下的每一个模组,而不是某一个模组

#### Scenario: 多次 add 复用同一包目录

- **WHEN** 连续多次以 `-i . -o .` 执行 `mct add`
- **THEN** 每次内容都追加进同一组 `behavior_packs/<name>` 与 `resource_packs/<name>`,清单文件按条目合并而非覆盖

### Requirement: `mct add` 不修改包清单的标识字段

`mct add` 直接写入既有包目录时,MUST 保持该包 `manifest.json` 的 `header.uuid`、`modules[].uuid` 与资源包对行为包的依赖 `uuid` 不变;内容生成 MUST 只新增或按条目合并内容与清单类文件。因此 MUST NOT 用其它项目(含临时脚手架项目)的 `manifest.json` 或 `pack_icon.png` 覆盖目标模组的同名文件。

#### Scenario: UUID 在 add 后保持不变

- **WHEN** 对已有包执行 `mct add -i . -o .` 前后对比 `manifest.json`
- **THEN** `header.uuid` 与资源包依赖的 `uuid` 均未改变,仅内容文件与清单条目增加

#### Scenario: 清单文件按条目合并

- **WHEN** 连续 `add` 两个方块后检查 `blocks.json` 与 `terrain_texture.json`
- **THEN** 两个方块的条目同时存在,先前的条目未被覆盖

#### Scenario: 不得覆盖图标与清单

- **WHEN** 从临时脚手架项目挑选文件移入目标模组
- **THEN** 跳过临时项目的 `manifest.json` 与 `pack_icon.png`,只取内容文件

#### Scenario: 只有行为包的模组会产生空模块伪资源包

- **WHEN** 在 `modules` 只含 `script`、没有资源包的模组上执行 `mct add -i . -o .`
- **THEN** 行为包内容写入 `behavior_packs/<name>/`,同时新建 `resource_packs/contoso_<目录名>/`
- **AND** 该伪包的 `manifest.json` 的 `modules` 为 `[]`,不满足打包对「包类型可由清单判定」的要求
- **AND** 清理该目录(或改名并补 `resources` 模块)后打包恢复正常

### Requirement: 生成内容的命名空间需显式修正

`mct` 生成的内容标识符使用 `contoso_<输出目录名>` 形式的命名空间(目录名截断至 16 字符),该前缀 MUST NOT 作为最终命名空间保留。移入内容后 MUST 把标识符统一改为项目约定的命名空间。

#### Scenario: 命名空间由输出目录名派生

- **WHEN** 在名为 `keepinventory` 的目录执行 `mct add -i . -o .`
- **THEN** 生成内容的标识符为 `contoso_keepinve:<name>`,而非 `keepinventory:<name>`

#### Scenario: 移入后统一命名空间

- **WHEN** 生成内容已写入包目录
- **THEN** 其 `description.identifier`、`blocks.json` 的键以及 `terrain_texture.json` 中的相关引用使用项目约定的命名空间

### Requirement: 校验须检查未链接纹理警告

`mct validate` 的 ERROR 计数不包含未链接资源,仅检查 ERROR 数量 MUST NOT 作为内容移入成功的判据。校验 MUST 同时检查 `UNLINK` 项,确认没有「纹理未被本包任何内容使用」的警告。

#### Scenario: 忽略清单导致纹理成孤儿

- **WHEN** 只移入纹理与内容文件而忽略 `blocks.json` 与 `terrain_texture.json`
- **THEN** `mct validate` 仍报告 0 ERROR,但 `UNLINK` 项给出「Texture does not have any items in this pack that are using this」警告

#### Scenario: 清单完整时无未链接警告

- **WHEN** 内容文件与其清单映射(`blocks.json`、`terrain_texture.json`)一并就位
- **THEN** `UNLINK` 项不出现未链接纹理警告

### Requirement: 临时目录生成内容后挑选移入

当内容需要先查看生成效果、或模板产物需要手工挑选时,MAY 在独立临时目录用 `mct create` + `mct add` 生成,再把内容移入目标模组。移入时 MUST 只取内容文件(定义文件、纹理、模型、语言文件),MUST 按条目合并清单类文件(`blocks.json`、`terrain_texture.json` 等),MUST NOT 拷贝临时项目的 `manifest.json` 与 `pack_icon.png`。临时目录 MUST NOT 位于 `mods/` 下,避免被批量校验与打包扫描到。

#### Scenario: 临时目录位置在 mods 之外

- **WHEN** 为某个模组在临时目录生成内容
- **THEN** 该临时目录不在 `mods/` 之下,`mct validate -i mods` 不会把它当作一个模组

#### Scenario: 只取内容文件并合并清单

- **WHEN** 从临时项目把某个方块移入目标模组
- **THEN** 拷贝方块定义与纹理文件,并把清单条目合并进目标模组已有的 `blocks.json` 与 `terrain_texture.json`,而非整体覆盖

#### Scenario: 直接生成到已有包更省步骤

- **WHEN** 已确定要保留该内容,且目标模组布局已符合规范
- **THEN** 优先直接在模组目录用 `mct add -i . -o .` 生成,清单会自动创建或合并、UUID 保持不变,无需临时目录

### Requirement: `mct` 只读命令可直接作用于模组目录

`mct` 的校验类命令 MUST 通过在单个模组目录指定 `-i .` 使用;需要一次校验 monorepo 下全部模组时,MUST 以 `-i mods` 指向模组集合目录,使每个模组各自产出一份报告。MUST NOT 在仓库根直接运行不带 `-i` 的校验:该用法会把整个仓库当作单个项目。这些命令 MUST NOT 改变模组的包目录布局。

#### Scenario: 单模组校验

- **WHEN** 在模组目录执行 `mct validate -i .`
- **THEN** 校验只针对该模组的 `behavior_packs/<name>` 与 `resource_packs/<name>` 运行

#### Scenario: 批量校验各自产出报告

- **WHEN** 在仓库根执行 `mct validate -i mods`
- **THEN** `mods/` 下每个模组各自产出一份报告文件,互不合并

#### Scenario: 仓库根运行会把整仓当单项目

- **WHEN** 在仓库根执行不带 `-i` 的 `mct validate`
- **THEN** 整个仓库被当作一个项目处理,只产出一份合并报告

#### Scenario: 校验报告不纳入版本管理

- **WHEN** 执行校验且未指定 `-o`
- **THEN** 报告写入 `<模组目录>/out/` 或仓库根 `out/`,该目录属于构建产物,由 `.gitignore` 排除
