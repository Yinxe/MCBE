# 打包:命名、模式与包类型判定

本文记录自研打包逻辑(`mods/keepinventory/tools/packaging.ts`)在调研阶段确认的事实。

## 1. 产物命名:`<name>-v<version>.<ext>`

| 产物 | 命名 |
| --- | --- |
| 行为包 | `<name>-v<version>_bp.mcpack` |
| 资源包 | `<name>-v<version>_rp.mcpack` |
| 合并包 | `<name>-v<version>.mcaddon` |

- `<name>` 取 `package.json#name` 的**最后一段**(`@mc-toolchain/keepinventory` → `keepinventory`)
- `<version>` 取 `package.json#version`,要求三段数字;带 `-beta.1` 之类后缀时取前三段并告警
- `v` 前缀是刻意加的,使「名称」与「版本」在文件名里一眼可分

实测:`version = 0.0.1` → `keepinventory-v0.0.1_bp.mcpack`,`.mcaddon` 内层也是 `keepinventory-v0.0.1_bp.mcpack` / `_rp.mcpack`。

> 命名约定上,**产物文件名后缀 `_bp.mcpack` / `_rp.mcpack` 保留缩写**。这是 `@minecraft/core-build-tasks` 与 Bedrock 附加内容生态的既有约定,改成全名反而与官方工具及社区产物不一致。代码内的类型名、配置字段名、函数名一律用全词(`behaviorPack` / `resourcePack` / `output` / `version`)。

## 2. `mode` 语义

`package.json#packing.mode` 支持 `auto`(默认)/ `mcpack` / `mcaddon`:

| `mode` | 探测到 1 个包 | 探测到 2 个包 |
| --- | --- | --- |
| `auto` | 该包的 `.mcpack` | `.mcaddon` |
| `mcpack` | 该包的 `.mcpack` | 两个 `.mcpack` |
| `mcaddon` | **报错**(提示改用 `mcpack`) | 单个 `.mcaddon` |

探测到 0 个包时任何 `mode` 都报错。

`.mcaddon` 模式下,两个 `.mcpack` 先在 `temp/packs/` 里生成,再合并进 `.mcaddon`,然后删掉中间目录,保证输出目录里只留 `.mcaddon`。

## 3. 包类型判定:必须依据 `manifest.json`

**不能靠目录名判定是行为包还是资源包。** 判定依据是 `manifest.json#modules[].type`:

| `modules[].type` | 判定 |
| --- | --- |
| `data` | 行为包 |
| `script` | 行为包 |
| `resources` | 资源包 |

实测:把只有 `type: "resources"` 模块的包放进 `BP/` 目录,打包仍正确产出 `_rp.mcpack`(而不是按目录名当行为包)。这是该设计的核心验证点。

目录名(`BP` / `RP`、`behavior_packs` / `resource_packs`)只作为**探测线索**,不参与类型判定。无法判定或有歧义时报错,而不是猜。

## 4. 目录约定 `BP/<name>` / `RP/<name>`

- `mct validate` 不依赖目录名,改名为 `BP/` / `RP/` 后仍通过,并正确统计 `behaviorPackManifestCount` / `resourcePackManifestCount`
- 因此可以用更短、更直观的 `BP` / `RP` 作为目录名

`packing` 配置里的 `behavior_packs` / `resource_packs` 字段同时接受缩写与全名写法,两者等价。

## 5. `mcaddon` 与 `mcaddon:production`:实测无区别

这是被明确问过的问题,做了逐字节对比:

| 脚本 | 产物 | 大小 |
| --- | --- | --- |
| `npm run mcaddon` | `keepinventory_bp.mcpack` + `keepinventory.mcaddon` | 3933 B / 3946 B |
| `npm run mcaddon:production` | 同名同内容 | 3933 B / 3947 B |

- 文件 md5 不同
- 但**解压后内容逐字节一致**,差异只来自 zip 内时间戳
- `grep -rn "production"` 在 `@minecraft/core-build-tasks` 全库只有一处无关日志文案;模板 `just.config.ts` 从未读 `argv().production`

**结论:`mcaddon:production` 是空壳脚本**,`--production` 在本模板中没有任何消费者。真正影响产物的是 `bundleTask` 的 `minifyWhitespace` / `sourcemap`,模板已写死。

因此本项目不为 `--production` 设计分支,只保留唯一入口 `pack`。

## 6. 版本同步

`pack` 会把 `package.json#version` 写进各包 `manifest.json`:

- `header.version`
- 每个 `modules[].version`
- 依赖本包的其它包的 `dependencies[].version`

实测:`0.0.1` 与 `0.0.2` 可并存于 `dist/packages/`,且包内 `manifest.json` 的版本分别是 `[0,0,1]` 与 `[0,0,2]`。

> 注意:`pack` 会**写回** `manifest.json`。若 `manifest.json` 里手写的版本与 `package.json` 不一致,打包后会被 `package.json` 覆盖。

## 7. 可复现的验证方式

```bash
cd mods/keepinventory

# 1) 单包 → 只出 mcpack
npm run pack
ls dist/packages/            # keepinventory-v0.0.1_bp.mcpack

# 2) 临时加一个资源包 → 出 mcaddon
mkdir -p RP/keepinventory     # 放一个 modules[].type = "resources" 的 manifest.json
npm run pack
ls dist/packages/            # ..._bp.mcpack + keepinventory-v0.0.1.mcaddon
unzip -Z1 dist/packages/keepinventory-v0.0.1.mcaddon

# 3) 验证类型判定不看目录名
#    把只有 resources 模块的包放进 BP/ → 应产出 _rp.mcpack

# 4) 验证 --production 无区别
npm run mcaddon && md5sum dist/packages/*
rm -rf dist/packages && npm run mcaddon:production && md5sum dist/packages/*
# 解压两份产物后 diff -r,内容应完全一致
```
