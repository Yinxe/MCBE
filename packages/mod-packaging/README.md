# @mc-toolchain/mod-packaging

Minecraft Bedrock 行为包 / 资源包的共享打包逻辑：同步清单版本、推导最低游戏版本、探测包目录，并按 `packing.mode` 产出 `.mcpack` / `.mcaddon`。

模组不再各自维护一份打包脚本，只在 `just.config.ts` 里导入本包编排任务。

## 目录结构

```
packages/mod-packaging/
├── src/
│   ├── types.ts          # 打包相关类型与常量（无逻辑）
│   ├── versions.ts       # 版本解析 + 「脚本 API 版本 → 最低游戏版本」映射（纯逻辑）
│   ├── metadata.ts       # 清单显示名与描述的拼接（纯逻辑）
│   ├── configuration.ts  # package.json#packing 读取与校验（纯逻辑 + 读文件）
│   ├── discovery.ts      # 包目录探测与包类型判定（文件系统）
│   ├── packs.ts          # 清单元信息/版本同步 + 产物生成（依赖 zipTask）
│   └── index.ts          # 对外入口
├── tests/                # node --test 单测
├── tsconfig.json         # 类型检查
└── tsconfig.test.json    # 测试编译（输出到 .test-build/）
```

## 在模组中使用

`package.json` 加上依赖后，`just.config.ts` 只保留任务编排：

```ts
import { createPackagesByMode, synchronizePackVersions } from "@mc-toolchain/mod-packaging";

task("sync-versions", () => synchronizePackVersions(__dirname));
task("pack", series("build", "sync-versions", createPackagesByMode(__dirname)));
```

模组自身的 `package.json` 是包名、版本与清单元信息的唯一来源：

```jsonc
{
  "name": "@mc-toolchain/auto-refill",
  "version": "2.2.0",
  "productName": "自动替换",
  "description": "自动替换主手消耗物品 · 无需作弊 · 保留成就",
  "author": { "name": "Yinx", "email": "1423716216@qq.com", "url": "https://github.com/Yinxe/" },
  "repository": { "url": "https://github.com/Yinxe/MCBE" },
  "packing": {
    "mode": "auto",
    "output": "../../release/",
    "qq_group": "632178498"
  }
}
```

`output` 是相对**模组根目录**解析的（内部用 `path.resolve(projectRoot, output)`）。本仓的模组都位于 `mods/<name>/`，所以 `../../release/` 指向仓库根的 `release/`——这是本仓「全部模组产物集中一处」的约定，详见 [`mods/README.md`](../../mods/README.md)。

### `packing` 字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `auto` | `auto` / `mcpack` / `mcaddon`；`auto` 按探测到的包数量决定 |
| `output` | `dist/packages` | 产物输出目录（相对模组根目录）；本仓模组均显式覆盖为 `../../release/` |
| `minimum_engine_version` | 由 `@minecraft/server` 依赖推导 | 形如 `[1, 21, 90]` 的三段非负整数 |
| `qq_group` | 无 | 玩家 QQ 群号（字符串），写入清单描述的 `QQ群：` 行 |

出现未知字段会直接报错，避免拼写错误被静默当成「未配置」。

默认值 `dist/packages` 是相对模组根目录的通用语义，本库**不**假设调用方位于某个仓库的 `mods/` 下。因此「产物集中到仓库根」不属于库行为，而是各模组在 `packing.output` 中的显式约定。

### 包目录约定

- 行为包放 `behavior_packs/<name>/`，资源包放 `resource_packs/<name>/`。
- 顶层使用缩写 `BP` / `RP` 会报错并提示改名。
- 包类型以各包 `manifest.json` 的 `modules[].type` 为准：含 `data` / `script` 为行为包，含 `resources` 为资源包。
- 同一类型下探测到多个包目录时报歧义错误，不猜测。

### 最低游戏版本

显式配置 `packing.minimum_engine_version` 时直接使用；缺省时由 `@minecraft/server` 依赖版本在映射表中推导。

映射表按「同批发布」推断，官方不提供机器可读数据。**依赖版本超出表中已覆盖区间时报错，不钳到最高档**——静默沿用旧值会产出 `min_engine_version` 偏低的行为包，问题只在低版本客户端加载后暴露。遇到这种情况，要么显式配置该字段，要么把新版本补进 `src/versions.ts`。

### 清单元信息由 `package.json` 派生

`synchronizePackVersions` 在压缩之前把显示名与描述写进每个包（行为包与资源包）的 `manifest.json`，覆盖清单中原有的值。**不要手工编辑清单的 `header.name` / `header.description`**，下次打包会覆盖。

字段来源：

| 清单字段 | 来源 | 缺失时 |
| --- | --- | --- |
| `header.name` | `<productName> v<version>` | 报错中止，不回落模组名 |
| `header.description` 首行 | `description` | 报错中止 |
| 描述 `作者：` 行 | `author`（字符串整体作为作者名，或对象的 `name`） | 省略整行 |
| 描述 `邮箱：` 行 | `author.email`（仅对象形式） | 省略整行 |
| 描述 `主页：` 行 | `author.url`（仅对象形式） | 省略整行 |
| 描述 `QQ群：` 行 | `packing.qq_group` | 省略整行 |
| 描述 `仓库：` 行 | `repository`（字符串，或对象的 `url`） | 省略整行 |

描述行顺序固定为：简介 → 作者 → 邮箱 → 主页 → QQ群 → 仓库。缺失的字段整行省略，不会留下空行，也不会写入「未配置」之类的占位文本。

完整示例（上节 `package.json` 对应的输出）：

```text
自动替换主手消耗物品 · 无需作弊 · 保留成就
作者：Yinx
邮箱：1423716216@qq.com
主页：https://github.com/Yinxe/
QQ群：632178498
仓库：https://github.com/Yinxe/MCBE
```

**颜色符号**：`§` 颜色与样式符号原样保留，不做转义、剥离或截断。

**仓库地址规范化**：`repository` 会被规整为可读的 https 形式——去掉 `git+` 前缀、把 `git@<host>:<path>` 形式的 SSH 地址改写为 `https://<host>/<path>`、去掉 `.git` 后缀与尾部斜杠。因此 `git@github.com:Yinxe/MCBE.git`、`git+https://github.com/Yinxe/MCBE.git` 与 `https://github.com/Yinxe/MCBE` 都产出 `https://github.com/Yinxe/MCBE`。不匹配这些形式的输入原样输出，不报错也不猜测。

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # 编译并运行单测
```

`packs.ts` 依赖 `@minecraft/core-build-tasks` 的 `zipTask`，以 `peerDependencies` 声明，由消费方（模组）提供；本包 `devDependencies` 中另装一份用于自测。
