# @yinxe/mc — MCBE Addon Monorepo

> Minecraft Bedrock Edition Addon 模组集合

## 目录规范

```
mc/
├── mcaddon/                # MCBE Addon 项目
│   └── <name>/
│       ├── BP/<Project>/   # 行为包（manifest.json）
│       ├── RP/<Project>/   # 资源包（配置选）
│       ├── scripts/        # TypeScript 源码
│       ├── tests/          # 测试（配置选）
│       ├── tools/          # 工具（配置选）
│       ├── package.json
│       ├── just.config.ts
│       └── tsconfig.json
├── packages/               # 共享库和工具包
│   └── toolkit/            # @yinxe/toolkit — 共享构建工具
├── apps/                   # 其他应用
├── pnpm-workspace.yaml
└── package.json
```

## 包含的模组

| 模组 | 目录 | 版本标签 |
|------|------|---------|
| MockPlayer | `mcaddon/mock-player/` | `mock-player@1.0.0`, `mock-player@1.0.6` |
| CraftableRarities | `mcaddon/craftablerarities/` | `craftablerarities@1.0.1` |
| KeepINventory | `mcaddon/keepinventory/` | `keepinventory@1.0.0`, `keepinventory@2.0.0` |
| SmartWarehouse | `mcaddon/smartwarehouse/` | `smartwarehouse@0.0.7` ~ `@0.0.55-beta` |

## 要求

- **Node.js** >= 20
- **pnpm** >= 11.1.3

## 常用命令

```bash
# 安装依赖
pnpm install

# 构建单个模组
pnpm run build:mock-player
pnpm run build:craftablerarities    # 打包 .mcpack
pnpm run build:keepinventory
pnpm run build:smartwarehouse

# 构建全部
pnpm run build

# 清理
pnpm run clean

# 同步版本（package.json → BP/RP manifest.json）
pnpm run sync-version

# 发布模组
git tag mock-player@1.1.0
git push --tags
```

## 共享工具包

`packages/toolkit/`（`@yinxe/toolkit`）提供：

- `syncManifestVersion()` — 将 package.json 版本同步到 BP/RP manifest
- `bundleOptions()` — 生成 esbuild 打包配置
- `copyOptions()` — 生成行为包/资源包复制配置

## 许可

ISC
