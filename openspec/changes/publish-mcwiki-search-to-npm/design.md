# Design

## Context

见 `proposal.md` — Why。设计相关的事实：

- 包位于 monorepo 的 `tools/mcwiki-search`，用 npm workspaces（`["mods/*","tools/*"]`）管理；根包是 `private: true` 且不发布。
- 包入口 `exports` 与 `bin` 都指向 `dist/`，而根 `.gitignore` 忽略 `dist/`。因此 **`dist/` 不在版本控制内**，任何从干净检出出发的发布都必须在打包时现场构建。
- `files` 已精确列出 `dist`、`skills`、`src/pi`、`src/cli`、`src/core` 并排除 `src/**/*.test.ts` 与 `src/core/fixtures`；`pi.extensions` 指向 `./src/pi/extension.ts`（TypeScript 源码，由 pi 的 jiti 加载器直接执行），所以 `src/` 必须随包发布。
- 当前无 git remote，`Yinxe/mc-toolchain` 尚未创建；`npm whoami` 为 `yinxe`，是 `@mc-toolchain` scope 的 owner。

## Goals / Non-Goals

**Goals:**

- 从干净检出执行两条命令即可完成发布（校验 + 上传），无需手工构建或手工检查 `dist/`。
- 发布产物内容可预测：运行所需文件齐全，测试与夹具不进入 tarball。
- 包元数据（仓库、许可证、公开访问）在首次发布时即完整，避免后续补发。

**Non-Goals:**

- 自动化版本号提升与 changelog 生成（交由人工决定语义化版本）。
- CI/CD 发布流水线（明确要求本地手动发布）。
- 发布 `mods/keepinventory`。
- 多包批量发布或 workspace 发布编排。

## Decisions

### 决策 1：用 `prepublishOnly` 而非 `prepare` 承担构建

`prepare` 会在**每次 `npm install`** 时运行（包括使用者安装本包时，以及本仓库 `npm install` 时），对消费者是多余开销，且在消费者环境缺少 devDependencies 时会失败。`prepublishOnly` 只在 `npm publish`（含 `--dry-run`）前运行，正是需要的时机。

因此：`prepublishOnly` = `typecheck` + `test` + `build`，顺序执行，任一步非零退出即中止发布。

*替代方案*：`prepare`（消费者侧副作用，弃）；在发布脚本里手写 `tsc && npm publish`（把校验散落在命令行历史里，弃）。

### 决策 2：`dist/` 保持被 git 忽略，由 `prepublishOnly` 现场重建

把 `dist/` 提交进仓库能省掉构建步骤，但会引入「提交的产物与源码不一致」这类静默漂移，且 `.gitignore` 已在多个包中统一忽略构建产物。保持忽略 + 发布前重建，能保证 tarball 里的产物一定来自当前源码。

*权衡*：发布耗时增加一次构建（约数秒）。可接受。

### 决策 3：`npm publish --dry-run` 作为独立脚本，且是发布前的强制关卡

`publish:dry` 输出将被上传的文件清单与体积，用来在真正上传前确认 `files` 规则没有意外包含或遗漏。因为 `prepublishOnly` 同样会在 `--dry-run` 时触发，这条命令同时验证了校验链本身可跑通。

`publish:npm` 直接调用 `npm publish`；因 `publishConfig.access: public` 已声明，无需在命令行重复 `--access public`。

### 决策 4：`publishConfig.access` 而非命令行 `--access`

带 scope 的包默认按 restricted 发布。把 `access: public` 写进 `publishConfig`，使「这条命令就是唯一入口」——无论谁在何时执行 `npm publish`，公开性都由清单保证，而不依赖是否记得加参数。

### 决策 5：`LICENSE` 放在包目录内

npm 只会自动包含包根目录的 `LICENSE`。放仓库根不会进入 tarball。故在 `tools/mcwiki-search/LICENSE` 新增 MIT 许可证，版权人 `Yinx`，与 `package.json` 的 `license: MIT` 一致。

### 决策 6：`repository.directory` 指向 `tools/mcwiki-search`

仓库是多包 monorepo，只写 `repository.url` 会让 npm 页面的「Repository」链接指向仓库根。加上 `directory` 字段后，npm 与编辑器可直接定位到子包。同时补 `bugs` 与 `homepage`，避免 npm 页面出现缺失区块。

### 决策 7：先建 GitHub 仓库并推送，再首次发布

`repository` 字段指向的地址必须真实存在，否则 npm 页面的仓库链接 404。当前仓库无 remote，故 tasks 中把「创建 `Yinxe/mc-toolchain` 并推送」排在首次发布之前。发布本身不依赖 CI，建仓只是为了让元数据可追溯。

## Risks / Trade-offs

- **[`dist/` 被 git 忽略，若忘记构建会发布空入口]** → `prepublishOnly` 强制先 `build`，且 `publish:dry` 的清单会显示 `dist` 文件数与体积；两者叠加可拦截。
- **[`prepublishOnly` 让 `--dry-run` 也跑完整测试，预演变慢]** → 有意为之：预演若跳过校验就失去意义。测试当前约 3 秒，可接受。
- **[`src/` 随包发布（因 pi 扩展需 TS 源码），包体积略大]** → 已用 `files` 排除测试与夹具；当前 tarball 约 58 kB，可接受。若后续想瘦身，可改为发布编译后的扩展并让 `pi.extensions` 指向 `dist`，但需先确认 pi 加载 `.js` 扩展无碍。
- **[首次发布后版本号不可撤回]** → npm 不允许重发同版本号（`npm unpublish` 有 72 小时与严格限制）。故 tasks 把首次发布放在最后，且先跑 `publish:dry`。
- **[`@mc-toolchain` scope 归属依赖当前账号]** → 已实测 `yinxe` 是该 scope owner；若未来转移 ownership，发布需换账号或换 scope。
- **[本地手动发布无审计记录]** → 明确接受（用户要求不用 CI）。发布者需自行确认工作区干净、版本号已提升。

## Migration Plan

1. 建 GitHub 仓库 `Yinxe/mc-toolchain`，添加 remote 并推送当前提交。
2. 补齐包元数据（去 `private`、加 `repository`/`bugs`/`homepage`/`publishConfig`/脚本）与 `LICENSE`。
3. 更新文档（包 README 安装章节、根 README 发布章节）。
4. `npm run publish:dry` 检查清单与体积。
5. `npm run publish:npm` 首次发布 `0.1.0`。
6. 在**空目录**中验证：`npm install` 后导入库、执行 `npx` CLI、`pi install` 加载工具与 skill。

**回滚**：发布不可逆（72 小时后不可 unpublish）。若发布内容有误，正确做法是**立即提升 patch 版本并重新发布**，而非尝试 unpublish。文档或元数据错误同样以新版本修正。

## Open Questions

无。会改变 spec、方案或任务拆分的未知项已在设计阶段解决。
