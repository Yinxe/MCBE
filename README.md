# @yinxe/mc — MCBE Addon Monorepo

> Minecraft Bedrock Edition Addon 模组集合

## 目录规范

```
mc/
├── mcaddon/                # MCBE Addon 项目（TypeScript + 构建脚本）
│   └── <name>/
│       ├── BP/<Project>/   # 行为包（manifest.json）
│       ├── RP/<Project>/   # 资源包（可选）
│       ├── scripts/        # TypeScript 源码
│       ├── tests/          # 测试（可选）
│       ├── package.json
│       ├── just.config.ts
│       └── tsconfig.json
├── server-plugin/          # 服务端插件（纯 JSON / 轻量 BP）
│   └── <name>/
│       ├── BP/<Project>/   # 行为包
│       ├── scripts/        # 打包脚本（可选）
│       └── package.json
├── packages/               # 共享库和工具包
│   └── toolkit/            # @yinxe/toolkit — 共享构建工具
├── pnpm-workspace.yaml
└── package.json
```

## 包含的模组

| 模组 | 目录 | 最新 tag |
|------|------|---------|
| MockPlayer | `mcaddon/mock-player/` | `mock-player@1.0.9` |
| CraftableRarities | `mcaddon/craftablerarities/` | `craftablerarities@1.0.1` |
| KeepINventory | `mcaddon/keepinventory/` | `keepinventory@2.0.0` |
| SmartWarehouse | `mcaddon/smartwarehouse/` | `smartwarehouse@0.0.59` |
| 反收纳袋刷物 | `server-plugin/antibundledup/` | `antibundledup@1.0.0` |

## 要求

- **Node.js** >= 20
- **pnpm** >= 11.1.3

## 常用命令

```bash
# 安装依赖
pnpm install

# 构建（TypeScript 编译 + esbuild 打包，仅 mcaddon 项目需要）
pnpm run build                   # 全部
pnpm run build:mock-player
pnpm run build:keepinventory
pnpm run build:smartwarehouse

# 同步版本并打包
pnpm run pack                    # 全部打包
pnpm run pack:mock-player
pnpm run pack:keepinventory
pnpm run pack:craftablerarities
pnpm run pack:smartwarehouse
pnpm run pack:antibundledup      # server-plugin 打包（无需 build 阶段）

# 清理
pnpm run clean

# 同步版本（package.json → BP/RP manifest.json）
pnpm run sync-version

# 发布模组（自动触发 CI 构建发布）
git tag <name>@<version>
git push --tags
```

## 共享工具包

`packages/toolkit/`（`@yinxe/toolkit`）提供：

- `syncManifestVersion()` — 将 package.json 版本同步到 BP/RP manifest
- `bundleOptions()` — 生成 esbuild 打包配置
- `copyOptions()` — 生成行为包/资源包复制配置

## 许可

ISC
