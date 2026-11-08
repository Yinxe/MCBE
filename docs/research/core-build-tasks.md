# `@minecraft/core-build-tasks` 5.5.0 调研

`mct create` 生成的 TypeScript 项目就是基于这个包 + `just-scripts` 的。理解它的导出与实现,是决定「复用哪些任务、自己写哪些任务」的前提。

## 1. 导出清单

```js
DEFAULT_CLEAN_DIRECTORIES
MinecraftProduct
STANDARD_CLEAN_PATHS
apiExtractorTask
bundleTask
cleanCollateralTask
cleanTask
copyFiles
copyTask
coreLint
getGameDeploymentRootPaths
getOrThrowFromProcess
getTargetWorldPath
mcaddonTask
postProcessOutputFiles
publishReleaseTask
setupEnvironment
updateWorldTask
vitestTask
watchTask
zipTask
```

> 该包 `exports` 未开放 `./package.json`,所以不能用 `require("@minecraft/core-build-tasks/package.json")` 读版本(会 `ERR_PACKAGE_PATH_NOT_EXPORTED`)。版本从 `package.json` 的 `devDependencies` 或 `npm ls` 读取。

## 2. 关键任务实现

### `zipTask(outputFile, zipContents)`

签名是 `zipTask(outputFile: string, zipContents: { contents: string[]; targetPath?: string }[])`,底层用 `zip-lib`。

两个必须注意的行为:

1. **`contents` 里的路径是「被加入的目录/文件」,不是压缩包内的路径前缀。** 目录内容会落在压缩包**根目录**,需要指定包内子路径时用 `targetPath`。
   - 例:把 `behavior_packs/<name>` 加入 → `manifest.json` 在压缩包根目录(这是 Bedrock 要求的结构)。
   - 例:把 `dist/scripts` 加入时用 `{ contents: [...], targetPath: "scripts" }` → 得到 `scripts/main.js`。
2. **返回的 `TaskFunction` 会忽略传入的回调,直接返回 `Promise`。**

   这是踩过的坑:`TaskFunction` 的类型签名是 `(done: TaskCallback) => ReturnType<AsyncTask>`,看上去应该 `zipTask(...)(done => ...)`,但实际实现是 `async function zip(){...}`,即**传入的 `done` 永远不会被调用**。

   后果:`await zipTask(file, contents)()` 会永远不 settle,`just` 报 `Other tasks that did not complete: [pack]`。

   正确写法是同时兼容两条完成路径:

   ```ts
   function runZipTask(outputFile, zipContents): Promise<void> {
     return new Promise<void>((resolve, reject) => {
       const zip = zipTask(outputFile, zipContents);
       const completion = zip(() => resolve());
       if (completion && typeof completion.then === "function") {
         completion.then(() => resolve(), reject);
         return;
       }
       resolve();
     });
   }
   ```

### `mcaddonTask(params)`

```ts
mcaddonTask({ copyToBehaviorPacks, copyToScripts, copyToResourcePacks?, outputFile })
```

它内部注册三个任务并串起来:`packBP` + `packRP`(并行)→ `packMcaddon`。

产物命名规律(从 `outputFile` 推导):

| 产物 | 命名 |
| --- | --- |
| 行为包 | `<outputFile 去扩展名>_bp.mcpack` |
| 资源包 | `<outputFile 去扩展名>_rp.mcpack` |
| 合并包 | `<outputFile>` 本身 |

实测缺点(相对自研打包):

- 文件名**不带版本号**,多版本无法在输出目录并存
- 无法只产出 `.mcpack`
- **没有资源包时会产出一个空的 `_rp.mcpack`**(`packRP` 仍会用空 `contents` 执行)
- 无法按 `manifest.json` 判定包类型,只能靠传入的目录列表

### `bundleTask(options)`

用 esbuild 打包,`format: "esm"`。真正影响产物的是:

- `minifyWhitespace`
- `sourcemap`(以及 `outputSourcemapPath`)
- `external`(如 `["@minecraft/server"]`,避免把游戏模块打进来)
- `dropLabels`

### `cleanTask(dirs)`

删除指定目录。注意模板的 `clean-local` 用的是 `DEFAULT_CLEAN_DIRECTORIES`,其中**包含 `dist`**——这会连 `dist/packages` 里的历史产物一起删掉。自研 `pack` 因此改用只清中间产物的目录列表(`temp`、`lib`、`dist/scripts`、`dist/debug`)。

### `coreLint(prettierFiles, fix)`

返回一个 series:`verify-lint` → `eslint` → 条件执行 `prettier`。

- `eslint` 实际执行 `npx eslint . --config "<config 路径>" [--fix]`,即**扫描整个项目**,不是只扫 `files` 参数里的 glob
- `prettier` 实际执行 `npx prettier --check <prettierFiles...>`,**只检查传入的 glob**
- 因此「lint 覆盖面」由两个地方分别决定:`eslint.config.mjs` 的 `files` 字段 与 `coreLint()` 的第一个参数

> 该任务依赖 `npx` 现场解析 `eslint` / `prettier`,所以这两个包必须能被解析到(见 [lint-and-prettier.md](./lint-and-prettier.md))。

### `copyTask` / `local-deploy`

`copyTask` 是把包复制到**本机游戏部署目录**(`development_behavior_packs/...`),依赖 `.env` 的 `MINECRAFT_PRODUCT` 等变量。它与「产出分发包」无关,自研打包不依赖它。

## 3. `--production` 是否有效

**无效。** 全库搜索 `production` 只有一处与任务参数无关的日志文案(`apiExtractorTask` 里的 `localBuild ? "local" : "production"`)。模板的 `just.config.ts` 也从未读取 `argv().production`。

实测详见 [packaging-naming-and-modes.md](./packaging-naming-and-modes.md)。

## 4. 可复现的验证方式

```bash
# 导出清单
node -e 'console.log(Object.keys(require("@minecraft/core-build-tasks")).join("\n"))'

# 确认 zipTask 忽略回调(观察是否 hang / 报 did not complete)
# 在 just.config.ts 里写: task("probe", () => zipTask("/tmp/probe.mcpack", [{contents:["./behavior_packs/x"]}])())

# 确认 --production 无消费者
grep -rn "production" node_modules/@minecraft/core-build-tasks/lib/index.js
```
