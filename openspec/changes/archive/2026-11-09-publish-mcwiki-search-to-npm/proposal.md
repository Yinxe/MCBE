# Proposal

## Why

`@mc-toolchain/mcwiki-search` 目前只能在 monorepo 内经相对路径使用：包标记为 `private: true`，没有发布脚本、仓库元数据与许可证文件，`dist/` 又被 `.gitignore` 忽略。因此仓库外的人与 agent 无法通过 `npm install` / `npx` / `pi install` 获得该能力，只能克隆仓库并手工构建。

把它发布到 npm 后，三个使用面（库、CLI、pi 工具）都能以标准方式被外部消费，这正是该包「供其他程序与 agent 使用」的设计目的。

## What Changes

- 从 `tools/mcwiki-search/package.json` 移除 `private: true`，补齐 `repository`（`Yinxe/mc-toolchain`，目录 `tools/mcwiki-search`）、`publishConfig.access: public` 与 `bugs`/`homepage`。
- 新增发布脚本：`prepublishOnly` 串起 `typecheck` + `test` + `build`，保证 tarball 内的 `dist/` 与源码一致（`dist/` 不纳入版本控制）。
- 新增 `npm run publish:dry`（`npm publish --dry-run`）与 `npm run publish:npm`（`npm publish`），把发布动作收敛为固定的两条命令。
- 补 `LICENSE` 文件（MIT，版权人 `Yinx`），与 `package.json` 已声明的 `license: MIT` 对齐。
- 在包 README 增加「安装」章节：库、CLI（`npx`）、pi（`pi install`）三种安装方式与版本要求。
- 在根 README 记录发布流程与前置条件（npm 登录、`@mc-toolchain` scope 归属）。
- 建立 GitHub 仓库 `Yinxe/mc-toolchain` 并推送（当前仓库无 remote，且该仓库尚不存在），使 `repository` 字段指向真实地址。

**发布方式为本地手动执行**，不引入 GitHub Actions 或任何 CI 自动发布。

## Capabilities

### New Capabilities

- `package-distribution`: 已发布包的可分发契约——包可被 `npm install` 安装，安装后库入口、CLI 可执行文件与 pi 扩展/skill 三者均可用；发布产物只含运行所需文件，且发布前自动校验类型与测试。

### Modified Capabilities

无。`wiki-integration` 约定的是三个使用面的运行时行为，本次不改变其任何需求。

## Impact

- 修改文件：`tools/mcwiki-search/package.json`（移除 `private`，新增 `repository` / `bugs` / `homepage` / `publishConfig` / 发布脚本）。
- 新增文件：`tools/mcwiki-search/LICENSE`、仓库根 `README.md`（当前不存在）。
- 修改文件：`tools/mcwiki-search/README.md`（新增「安装」章节）。
- 依赖与工具：不新增运行时依赖；`npm` 为唯一发布工具。
- 既有事实：`@mc-toolchain` scope 在 npm 上已存在且当前用户 `yinxe` 为其 owner；`@mc-toolchain/mcwiki-search` 名称未被占用。
- 外部系统：npm registry（`https://registry.npmjs.org/`）与 GitHub 仓库 `Yinxe/mc-toolchain`（需新建）。
- 不在本次范围：GitHub Actions / CI 自动发布；`mods/keepinventory` 的发布（它是 Bedrock 模组，不是 npm 包）；版本号策略与 changelog 自动生成。
