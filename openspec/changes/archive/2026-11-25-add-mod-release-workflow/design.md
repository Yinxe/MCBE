# Design

动机与范围见 `proposal.md`；发布契约见 `specs/mod-release/spec.md`。本文件只记录技术选择。

## Context

现状事实（探索确认，均影响方案）：

- 仓库是 **npm workspaces**（根 `package.json` 的 `workspaces: ["mods/*","packages/*","tools/*"]`），锁文件是 `package-lock.json`；`pnpm-workspace.yaml` 无对应 `pnpm-lock.yaml`，属残留，不作为包管理器。
- `origin` 指向 `git@github.com:Yinxe/mc-toolchain.git`，**该仓库不存在**（`gh` 返回 404）；`mcbe` 指向 `git@github.com:Yinxe/MCBE.git`，存在、当前用户具 admin、默认分支 `master`、45 个历史 tag 与全部历史 Release 都在这里。因此 workflow 必须住在 `MCBE`，也只能在 `MCBE` 的 Actions 上运行。
- `MCBE` 当前**无任何 workflow**：早期的 `.github/workflows/release.yml` 属于 `mcaddon/<name>/` 时代，随仓库重构为 `mods/<name>/` 后已不在任何分支上。
- 7 个模组的 `package.json` 均已声明 `productName`、`packing.mode: auto`、`packing.output: ../../release/`；`scripts.pack` 全部存在；仅 `craftablerarities` 无 `scripts.build`（纯内容包），其 `just.config.ts` 的 `pack` 已不包含 build 任务。
- `pack` 任务内部串了 `clean-build → build → synchronizePackVersions → 打包`，所以流水线**只需调用一次 `npm run pack -w @mc-toolchain/<mod>`**，不必单独调 build。
- `release/` 在 `.gitignore` 中，CI 全新 checkout 时为空；本地因历史打包会残留其它模组的产物。
- 本地：Docker 29.7.2、`gh` 2.46.0、`go` 1.27.3 就绪；**`act` 未安装**。

## Goals / Non-Goals

**Goals:**

- 一条命令级别的发版路径：手动触发 → 自动构建打包 → 建 tag → 发 Release，无需人工上传。
- 本地能用**同一份** workflow 文件跑通，且能核对「资产名英文、标题中文」。
- 试运行与真实发布共用同一套构建步骤，只有最后一步不同，避免「试运行通过、真实发布炸」。

**Non-Goals:**

- 不实现自动 patch 版本、不生成 changelog、不做多模组批量发布。
- 不引入 pnpm、不恢复 push tag 触发、不改 `@mc-toolchain/mod-packaging` 的打包逻辑。
- 不把 `tools/mcwiki-search` 的 npm 发布接进这条流水线（那是 `package-distribution` 的本地手动流程）。
- 不为 act 单独维护一份「本地版 workflow」——本地与线上必须同一文件。

## Decisions

### 决策 1：workflow 放在本仓库 `.github/workflows/release-mod.yml`，发布目标固定 `Yinxe/MCBE`

因为代码最终推送的远程就是 `mcbe`（`Yinxe/MCBE`），workflow 文件随代码进入该仓库后即可在该仓库 Actions 上运行；`origin`（`Yinxe/mc-toolchain`）不存在，不能作为宿主。

显式传 `--repo Yinxe/MCBE`（而不是依赖上下文推断）：一旦将来新增别的远程或 workflow 被复用到别的仓库，发布目标不会静默漂移；同时让本地 act 里的 `gh` 调用在缺凭据时**明确失败**而不是打到假想的仓库。

*备选*：把 workflow 放在独立发布仓库 → 否决，需要跨仓库取源码与凭据，且产物版本与源码提交脱钩。

### 决策 2：单 job、单次 `npm run pack`，版本只从 `package.json` 读

```
jobs.release
  ├─ checkout (fetch-depth: 0)      # 需要历史做 notes 与 tag 判断
  ├─ setup-node 22 + npm cache
  ├─ npm ci                          # 锁文件锁定
  ├─ 解析模组元数据 (name / version / productName) → $GITHUB_OUTPUT
  ├─ 校验：模组存在、productName 非空、tag 未被占用
  ├─ npm run pack -w @mc-toolchain/<mod>
  ├─ 收集 release/<name>-v<version>* 并校验非空
  ├─ dry_run ? 打印资产清单到 Step Summary 并结束
  └─ gh release create <name>@<version> --repo Yinxe/MCBE --title "<productName> <version>" ...
```

单 job 的理由：act 对多 job + `needs` 的支持虽可用，但单 job 让本地调试的日志是一段连续输出，且这条流水线本身没有可并行的独立单元。

`build` 不单独调用：`just.config.ts` 的 `pack` 已经串了 build，单独再调会重复编译，且 `craftablerarities` 根本没有 build 脚本。

*备选*：拆成 build / publish 两个 job 用 artifact 传递 → 否决，多一次 artifact 上传下载，对 2MB 级产物没有收益。

### 决策 3：`dry_run` 用布尔输入，且放在**最后一步**分叉

试运行与真实发布共享全部前置步骤（安装、构建、打包、资产收集、命名校验），只有 `gh release create` 这一步被 `if:` 跳过。这样「试运行通过」对真实发布有实际预测力；若把 dry_run 放在前面短路，试运行就退化成「能编译」而已。

### 决策 4：标题取 `productName`，资产名不重命名

`gh release create --title "<productName> <version>"`，资产用文件原名（`gh release create` 直接用产物路径上传，不做 rename）。

历史 Release 已是这个形态（`模拟玩家III 3.0.32` + 资产 `mockplayer3-v3.0.32.mcaddon`），沿用即可保持玩家侧观感一致。刻意**不**用 `--name`/重命名参数：中文文件名在 zip/下载链路里会带来编码问题，历史提交记录里有一串 `fix(ci): 中文文件名需 LC_ALL=C.UTF-8` 之类的修补，不值得重走。

### 决策 5：tag 用 `gh release create --target <sha>` 隐式创建，先查占用

不在 workflow 里 `git tag && git push`，而是让 `gh release create` 在目标提交上创建 tag：一步完成、失败即整体失败，不会留下「tag 已推但 Release 没建」的半成品状态。

创建前用 `git ls-remote --tags origin "refs/tags/<name>@<version>"` 判占用，命中则失败退出——`gh release create` 遇到已存在 tag 的行为依版本而异，显式判断更可控，也满足 spec 里「不覆盖既有 tag」的场景。

### 决策 6：Release Notes 只列「本模组与共享包」的提交标题，且基准 tag 必须是 HEAD 祖先

```bash
# 基准：从新到旧找第一个「HEAD 可达」的同名 tag
previous_tag=""
while IFS= read -r c; do
  git merge-base --is-ancestor "$c" HEAD 2>/dev/null && { previous_tag="$c"; break; }
done < <(git tag --list "${NAME}@*" --sort=-v:refname)

paths=("mods/${MOD}" "packages/")
[ -n "$previous_tag" ] \
  && git log --no-merges --pretty='* %s' "${previous_tag}..HEAD" -- "${paths[@]}" \
  || git log --no-merges --pretty='* %s' -3 -- "${paths[@]}"
```

**两个约束缺一不可，这是实测踩出来的**：首次真实发布（`keepinventory` 0.0.2/0.0.3）把**整仓 32 条历史提交**写进了 Release Notes，原因有两个叠加：

1. **基准 tag 不可达**。仓库历史被重写过，`keepinventory@1.0.0`、`mockplayer3@3.0.32` 等全部历史 tag 都指向重写前的旧提交，`git merge-base HEAD <tag>` 无共同祖先。此时 `tag..HEAD` 不是「两个版本之间的差异」而是「整条历史」，于是列出全部提交。故必须用 `git merge-base --is-ancestor` 过滤掉不可达的 tag。
2. **没做路径过滤**。即使基准可达，`tag..HEAD` 仍会带上其它模组与纯文档的提交。故限定 `mods/<mod>` 与 `packages/`（共享包改动会影响所有模组的行为，必须列）。

因为历史 tag 全部不可达，**当前实际效果是退化为「本模组与共享包最近 3 条提交」**——与历史 Release 的 1–2 条形态相符。一旦将来产生第一个可达 tag，自动切换为区间差异。

不列全仓历史也是产品判断：Release Notes 面向玩家，玩家只关心这个模组改了什么。

**手写优先**：`notes` 为可选输入，填了就直接作为正文（`source=manual`），不填才走上面的自动生成（`source=auto`）。理由：发版人比提交记录更清楚「玩家该知道什么」，而自动生成只能看到提交标题；试运行会把最终正文与来源一起打进 Step Summary，方便发前核对。

### 决策 7：本地模拟用 `act` + `--bind`，包一层 `tools/release-local` 入口

`act workflow_dispatch -W .github/workflows/release-mod.yml --input mod=<mod> --input dry_run=true`

必须用 `--bind`（默认是 copy 模式）：否则容器内 `release/` 的产物不会回到宿主机，本地就无从核对资产命名，而这正是本地验证的核心目的。

**runner 镜像改为自建**（实施时修正）：原计划用 `catthehacker/ubuntu:act-22.04`，但实测在本机网络下拉不动——`registry-1.docker.io` 报 `TLS connect error: unexpected eof while reading`，镜像源 `docker.1panel.live` 返回 403、`hub.1panel.dev` 虽返回 200 但 layer 下载数十分钟无进展，act 侧表现为 `docker pull ... context canceled`。改为 `tools/release-local/runner.Dockerfile`：底座取本地已有的 `node:24-bookworm-slim`，只装 `git` / `gh` / `zip` / `curl` / `ca-certificates`，构建十几秒且不依赖任何外部 registry。

同时需 `--pull=false`：act 默认对 `-P` 指定的镜像强制执行 `docker pull`，自建镜像会因此报 `failed to resolve reference ... 403 Forbidden`。

`tools/release-local/run.sh` 做四件事：环境自检（docker 在跑、`act` 存在、否则给 `go install github.com/nektos/act@latest` 提示；本地 runner 镜像不存在则自动 build）→ 调 act → 跑产物命名断言 → 打印 Release 标题供人工核对。它不复制 workflow 逻辑，只编排与校验。

真实发布路径在本地默认拦截：脚本要求显式 `--publish` **且** 环境里有真实 `GITHUB_TOKEN`，否则拒绝执行，避免误发到真实仓库（对应 spec 的「本地发布路径被拦截」场景）。

*备选*：用 `nektos/act` 的 `--dryrun` 参数 → 否决，它只打印要跑什么，不真正执行构建，达不到「验证产物」的目的。

### 决策 8：`concurrency` 按模组分组

`concurrency: { group: release-<mod>, cancel-in-progress: false }`：同模组连点两次不会并发发同一版本；不同模组互不阻塞。

## Risks / Trade-offs

- **[act `--bind` 会改写宿主机 `node_modules`]**：容器内 `npm ci` 与宿主共用目录，跑完本地 `node_modules` 被按锁文件重装 → 可接受（结果与锁文件一致）；文档明说，且本地验证后建议 `npm ci` 复核一次。
- **[`catthehacker/ubuntu:act-22.04` 拉不动，改自建镜像]**：已发生。Docker Hub TLS 中断、镜像源 403/限速 → 改为基于本地 `node:24-bookworm-slim` 自建，代价是镜像里只有 workflow 用到的工具，若将来步骤新增依赖（如 `jq`）需同步改 `runner.Dockerfile`。
- **[自建镜像的 `gh` 是 Debian 打包版 2.23.0，比线上 runner 旧]**：`gh release create --target` 在 2.23 已存在，本地试运行也不调它；真实发布仍由线上 runner 承担。
- **[镜像内 `gh` 版本未知，`gh release create --target` 参数行为可能差异]**：→ 本地只跑 dry_run（不调 `gh release create`），真实发布路径由线上 runner（`gh` 预装且版本新）承担；任务里加一步「确认 `gh --version` 并打印」便于排查。
- **[`--bind` 下本地残留的其它模组产物会污染资产收集]**：→ 资产收集按 `release/<name>-v<version>*` 精确过滤，不按目录全量取。
- **[workflow 只有推送到 `Yinxe/MCBE` 后才生效，本地无法验证 Actions 语义]**：→ act 覆盖了步骤语义；剩余风险（`permissions`、`concurrency`、表达式求值）在首次真实运行时确认，任务里保留「首次发布用 dry_run 跑一遍线上」的步骤。
- **[中文标题在 `gh release create --title` 传递时的编码]**：→ 标题走 `--title` 参数、资产名保持 ASCII，历史上中文文件名才是问题源；任务里加一步本地 act 打印实际标题字符串核对。
- **[`git log` 生成 notes 依赖 `fetch-depth: 0`]**：→ checkout 显式 `fetch-depth: 0`；漏了会退化成单条，属降级而非失败。
- **[历史 tag 全部指向重写前的不可达提交]**：→ 基准 tag 用 `--is-ancestor` 过滤，不可达则退化为最近 3 条；已在首次发布时因缺此过滤而把 32 条历史写进 Release，属已修复的真实事故。

## Migration Plan

1. 落 workflow 与本地模拟脚本，本地 `release-local --dry-run` 跑通 7 个模组中的代表样本（含无 build 的 `craftablerarities` 与 `.mcaddon` 形态的 `item-route`）。
2. 推送代码到 `Yinxe/MCBE`（`git push mcbe master`）——workflow 在此之后才出现在 Actions 界面。
3. 首次线上验证用 `dry_run: true` 跑一个模组，确认资产清单与标题输出正确。
4. 首次真实发布选一个低风险模组（如 `keepinventory`）。
5. 回滚：若发布有误，删除该 Release 与 tag（`gh release delete --cleanup-tag`），修代码后以**新的 patch 版本**重发；不尝试复用已发布的 tag。
