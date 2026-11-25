# Proposal

## Why

模组产物目前只能本地 `npm run pack` 后在仓库根 `release/` 里取,Release 则靠手工 `gh release create` 上传。一次发版要人工串起「patch 版本 → 打包 → 建 tag → 建 Release → 上传资产 → 写中文标题」六步,步骤全凭记忆,标题与资产命名的一致性也靠人守。

历史 tag(45 个)与全部历史 Release 都在 `Yinxe/MCBE`,但该仓库当前**没有任何 workflow 文件**——早期那份 `release.yml` 已随仓库从 `mcaddon/<name>/` 结构重构为 `mods/<name>/` 而消失。现在需要把发版重新固化成一条可执行、可在本地复现验证的流水线。

## What Changes

- 新增 `.github/workflows/release-mod.yml`:手动 `workflow_dispatch` 触发,输入模组名,自动完成「构建 → 打包 → 建 tag → 发布 Release 到 `Yinxe/MCBE`」。
- 版本不作为输入,一律读 `mods/<mod>/package.json#version`——与 `mod-workspace` 已确立的「npm 版本号是模组版本唯一来源」保持一致,避免输入版本与包内版本分叉。
- Release 标题用中文显示名 `<productName> <version>`(如 `模拟玩家III 3.0.33`),资产文件名保持打包产物原名 `<name>-v<version>_bp.mcpack` / `<name>-v<version>.mcaddon`(英文)。
- 新增 `dry_run` 输入:完整跑构建与打包、列出将要上传的资产,但不建 tag、不建 Release。这是本地验证的主要通道。
- 新增本地模拟:`.actrc` + `tools/release-local/` 脚本,用 `act` 在 Docker 里跑同一份 workflow,推送前必须本地跑通。
- 文档:根 `README.md` 增加发版章节;`docs/research/` 增加 act 本地模拟的实测记录(镜像选择、`GITHUB_TOKEN` 处理、`release/` 产出核对)。

**不做的事**:不恢复「push tag 触发」,不引入 pnpm(仓库实际是 npm workspaces + `package-lock.json`),不自动 patch 版本(版本提升仍由人决定并先提交),不改动打包逻辑本身。

## Capabilities

### New Capabilities

- `mod-release`: 模组 Release 流水线的发布契约——手动触发、版本取自 `package.json`、Release 标题中文而资产文件名英文、发布目标仓库固定、以及本地可用 act 完整复现并验证。

### Modified Capabilities

无。`addon-packaging` 约定的打包行为不变,流水线只消费它已有的 `pack` 产出;`mod-workspace` 的版本单一来源约定被沿用而非修改。

## Impact

- 新增文件:`.github/workflows/release-mod.yml`、`.actrc`、`tools/release-local/`(本地模拟入口与校验脚本)。
- 修改文件:根 `README.md`(发版章节)、`docs/research/README.md` 索引、新增 `docs/research/github-actions-local-act.md`。
- 外部系统:
  - `Yinxe/MCBE`(发布目标,默认分支 `master`,当前用户具 admin 权限,当前无任何 workflow)。
  - `Yinxe/mc-toolchain`(`origin`)**不存在**,无法作为 Actions 宿主;因此 workflow 必须随代码推到 `mcbe` 远程才会生效。
  - 本地 Docker 29.7.2 与 `gh` 2.46.0 已就绪;`act` 未安装,需 `go install github.com/nektos/act@latest`(本地 `go` 1.27.3 可用)。
- 前置条件(非本变更实现):本地 `HEAD` 领先 `mcbe/master` 多个提交,workflow 生效前需先把代码推到 `Yinxe/MCBE`。
- 依赖:`npm ci` + `npm run pack -w @mc-toolchain/<mod>`,不新增运行时依赖。
- 不在本次范围:版本号自动提升与 changelog 生成、`tools/` 下 npm 包的发布(仍按 `package-distribution` 本地手动)、历史 Release 的资产重命名。
