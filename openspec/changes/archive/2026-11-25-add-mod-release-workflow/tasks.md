# Tasks

## 1. workflow 文件

- [x] 1.1 新建 `.github/workflows/release-mod.yml`：`name: Release Mod`；触发器只有 `workflow_dispatch`，输入 `mod`（required, string）与 `dry_run`（boolean, 默认 false）
- [x] 1.2 设 `permissions: contents: write`（`gh release create` 与 tag 推送需要），`concurrency: { group: release-${{ inputs.mod }}, cancel-in-progress: false }`
- [x] 1.3 单 job `release`（`runs-on: ubuntu-latest`），步骤顺序：`actions/checkout@v4`（`fetch-depth: 0`）→ `actions/setup-node@v4`（node 22 + npm cache）→ `npm ci`
- [x] 1.4 解析元数据步骤：用 `node -p` 从 `mods/${{ inputs.mod }}/package.json` 读 `name` / `version` / `productName` 写入 `$GITHUB_OUTPUT`；模组目录不存在则报错退出并指明该模组名不存在
- [x] 1.5 校验步骤：`productName` 非空（缺失则失败并指明缺该字段）；`git ls-remote --tags origin "refs/tags/<name>@<version>"` 命中则失败并指明 tag 已存在
- [x] 1.6 打包步骤：`npm run pack -w @mc-toolchain/${{ inputs.mod }}`（不单独调 build）
- [x] 1.7 资产收集步骤：按 `release/<name>-v<version>*.mcpack|*.mcaddon` 精确过滤成列表写入 `$GITHUB_OUTPUT`；为空则失败并指明未产出资产
- [x] 1.8 `dry_run` 分支：把资产清单、Release 标题 `<productName> <version>`、tag 名写入 `$GITHUB_STEP_SUMMARY` 后结束（不建 tag、不建 Release）
- [x] 1.9 发布步骤（`if: inputs.dry_run == false`）：`git log --no-merges --pretty='* %s' <prev>..HEAD` 生成 notes（`prev` 为 `git tag --list "<name>@*" --sort=-v:refname | head -1`，无则退化为 HEAD 单条）；`gh release create "<name>@<version>" --repo Yinxe/MCBE --title "<productName> <version>" --notes-file <file> --target "$GITHUB_SHA" <资产列表>`
- [x] 1.10 打印 `gh --version` 便于排查镜像/runner 差异

## 2. 本地模拟

- [x] 2.1 新增 `.actrc`：固定 runner 镜像并启用 `--bind` 与 `--pull=false`（bind 是核心，否则容器内 `release/` 产物不回到宿主机）。实测 `catthehacker/ubuntu:act-22.04` 在本机网络下拉不动，故镜像改为 `tools/release-local/runner.Dockerfile` 自建的 `mc-toolchain/act-runner:local`
- [x] 2.2 新增 `tools/release-local/run.sh`：环境自检（docker 运行中、`act` 在 PATH，缺失时提示 `go install github.com/nektos/act@latest`；本地 runner 镜像缺失则自动 build）→ 调 `act workflow_dispatch -W .github/workflows/release-mod.yml --input mod=<mod> --input dry_run=true`
- [x] 2.3 新增 `tools/release-local/check-assets.mjs`：断言 `release/` 下存在 `release/<name>-v<version>_bp.mcpack|_rp.mcpack|.mcaddon`，且不含 `temp/packs/` 内层件、不含其它模组产物；同时打印 Release 标题字符串供人工核对中文
- [x] 2.4 `run.sh` 增加 `--publish` 保护：真实发布路径要求显式 `--publish` **且** 环境有真实 `GITHUB_TOKEN`，否则拒绝执行并说明原因
- [x] 2.5 用代表样本本地跑通：`craftablerarities`（无 build 脚本的纯内容包）、`item-route`（单 `.mcaddon`）、`mockplayer3`（`_bp` + `_rp` + `.mcaddon` 三件套）

## 3. 文档

- [x] 3.1 根 `README.md` 增加「发版」章节：手动触发方式、`dry_run` 用途、版本先提交再触发、Release 标题中文而资产名英文的约定
- [x] 3.2 新增 `docs/research/github-actions-local-act.md`：记录 act 安装方式、镜像选择理由与首次拉取体积、`--bind` 对宿主机 `node_modules` 的影响、`GITHUB_TOKEN` 在本地如何被拦截、`release/` 产物核对结果
- [x] 3.3 `docs/research/README.md` 索引里补上新文档条目

## 4. 线上首次验证

- [x] 4.1 `git push mcbe master`（workflow 只有进入 `Yinxe/MCBE` 后才出现在 Actions 界面；`origin` 不存在，不能用它）
- [x] 4.2 线上以 `dry_run: true` 跑一个模组，核对 Step Summary 中的资产清单与标题
- [x] 4.3 线上真实发布一个低风险模组（如 `keepinventory`），核对 tag 名、标题、资产、notes 形态
- [x] 4.4 验证失败路径：重复发布同一版本应被 tag 占用检查拦下；输入不存在的模组名应快速失败
- [x] 4.5 回滚演练确认：`gh release delete <tag> --cleanup-tag` 后可正常以新 patch 版本重发
