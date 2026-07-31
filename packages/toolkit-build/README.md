# @yinxe/toolkit-build

构建配置共享包 — `@yinxe/toolkit` 的构建子包，为各 addon 的 `just.config.ts` 提供统一的 esbuild bundle 任务配置、BP/RP 拷贝配置与 manifest 版本同步工具。

## 基本信息

| 项 | 值 |
|----|----|
| 版本 | 0.1.0（`private: true`，不发布到 npm） |
| main / types | `src/index.ts` |
| dependencies | `@types/node`（`*`） |

## 公共 API

### `src/build-config.ts` — 任务配置

为 `@minecraft/core-build-tasks` 生成统一的任务参数。

- **`bundleOptions(projectDir, entryPoint, externals?)`** → `BundleParams`
  - 生成 esbuild bundle 任务配置
  - 入口：`<projectDir>/<entryPoint>`
  - 产物：`dist/scripts/main.js`
  - sourcemap 输出到 `dist/debug`
  - 默认不压缩空白（`minifyWhitespace: false`）
- **`copyOptions(projectDir, projectName, opts?)`** → `CopyParams`
  - 生成拷贝任务配置：BP → `./BP/<projectName>`、脚本 → `./dist/scripts`
  - `hasRp` 为 `true`（默认）时追加 `./RP/<projectName>`（rpDir 默认 `RP`）
  - `opts` 可覆盖 `bpDir` / `rpDir` / `hasRp`
- **类型**：`BundleParams` / `CopyParams` / `CopyOptions`

### `src/version.ts` — 版本同步

- **`syncManifestVersion(projectDir, opts?)`** → `void`
  - 读取 `package.json` 的 `version`，同步到 `BP/*/manifest.json` 与 `RP/*/manifest.json`
  - 同步内容：`header.version`、`modules` / `dependencies` 中的数组版本
  - `formatName` 可选回调：修改显示名（`header.name`）
  - `onManifest` 可选回调：写入前修改 manifest 内容
- **类型**：`SyncManifestOptions` = `{ formatName?, onManifest? }`

### `bin/sync-version.mjs` — CLI（Node 脚本）

- 用法：`node sync-version.mjs [project-dir]`（省略时默认当前目录）
- 读取 `package.json` 的 `mcbe` 配置定位 manifest：
  - 新格式：`{ packName, bp }` 或 `{ packName, bp, rp }`
  - 旧格式：`{ bpDir }`
- 同步版本号 + 显示名（`<packName> v<ver>`），完成后输出 `✓` 提示

## 使用场景

各 addon 的 `just.config.ts` 中：

```typescript
import { bundleOptions, copyOptions } from "@yinxe/toolkit-build";
```

build 任务链：`sync-version` → `typescript` → `bundle`。
