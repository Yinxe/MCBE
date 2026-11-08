# Lint 与 Prettier 链路

## 1. 链路结构

`just.config.ts` 里一行:

```ts
task("lint", coreLint(["scripts/**/*.ts", "tools/**/*.ts"], argv().fix));
```

`coreLint(prettierFiles, fix)` 展开成一个 series:

```text
verify-lint  →  eslint  →  (条件)prettier
```

| 子任务 | 实际命令 | 覆盖面由谁决定 |
| --- | --- | --- |
| `eslint` | `npx eslint . --config "<eslint.config.mjs>" [--fix]` | **扫整个项目**,由 `eslint.config.mjs` 的 `files` 字段决定实际检查哪些文件 |
| `prettier` | `npx prettier --check <传入的 glob...>` | **只看 `coreLint()` 的第一个参数** |

所以「lint 覆盖范围」由**两个地方分别控制**,改一个不够:

1. `eslint.config.mjs` 的 `files` 数组
2. `just.config.ts` 里 `coreLint([...])` 的 glob

## 2. 官方模板自带的一个缺陷

`tsStarter` 模板的 `eslint.config.mjs` 顶部:

```js
import tsParser from "@typescript-eslint/parser";
import ts from "@typescript-eslint/eslint-plugin";
```

但模板 `package.json` 的 `devDependencies` 只有:

```json
{
  "@minecraft/core-build-tasks": "5.5.0",
  "eslint-plugin-minecraft-linting": "2.0.10",
  "source-map": "0.7.4",
  "ts-node": "10.9.1",
  "typescript": "5.5.4"
}
```

**两个 `@typescript-eslint/*` 包都没声明**,`prettier` 也没声明。于是 `npm run lint` 在全新生成的项目里就会失败(已在 `/tmp` 用 `mct create` 新建项目复现,不是本项目的配置问题)。

## 3. 修复方式(实际采用)

补齐缺失的 devDependencies,保持模板原有的配置风格不变:

```json
{
  "@typescript-eslint/eslint-plugin": "8.72.1",
  "@typescript-eslint/parser": "8.72.1",
  "prettier": "3.9.10"
}
```

同时把覆盖面扩到 `tools/`:

- `eslint.config.mjs`:`files: ["scripts/**/*.ts", "tools/**/*.ts"]`
- `just.config.ts`:`coreLint(["scripts/**/*.ts", "tools/**/*.ts"], ...)`

> 这是对官方模板的**有意偏离**。另一种做法是「不引入 `@typescript-eslint`,改用 `eslint-plugin-minecraft-linting` 自带的能力」,但那要重写 `eslint.config.mjs`,与「尽量保持模板原貌」的取向冲突,故未采用。

## 4. `tsconfig.json` 的坑:`tools/` 默认不被类型检查

模板的 `include` 只有 `scripts/**/*`,新加的 `tools/packaging.ts` **从未被 `tsc` 检查过**,错误只有到运行时才暴露。

修复:`tsconfig.json` 的 `include` 加入 `tools/**/*`。

连带两个类型错误:

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `TS1192` | `import fs from "fs"` 在 `esModuleInterop: false` 下无默认导出 | 改 `import * as fs from "fs"` |
| `TS1259` | `import path from "path"` 同理 | 改 `import * as path from "path"` |

## 5. Prettier 的实际行为

- `prettier --check` 只报告不修改;带 `argv().fix` 时才会 `--write`
- 首次对新文件跑 `--check` 大概率失败,需要先 `npx prettier --write <files>`
- 本项目对 `tools/packaging.ts` 执行过一次 `--write` 后即通过

## 6. 可复现的验证方式

```bash
cd mods/keepinventory

# 1) 复现模板缺陷:在全新项目里跑 lint 会失败
mct create probe tsStarter someone "probe" -o /tmp/mct-probe -y
cd /tmp/mct-probe && npm install && npm run lint   # 观察 @typescript-eslint 解析失败

# 2) 本项目应为通过
cd mods/keepinventory && npm run lint               # exit 0

# 3) 确认 tools/ 真的被类型检查(故意写个类型错误,tsc 应报错)
npx tsc --noEmit -p tsconfig.json

# 4) 单独跑 prettier
npx prettier --check "tools/**/*.ts"
```
