# 用 act 在本地跑 GitHub Actions

记录在 `mc-toolchain` 里用 [nektos/act](https://github.com/nektos/act) 本地模拟 `Release Mod` workflow 的实测过程,重点是**踩到的坑与最终可用的配置**,以便日后升级工具链时能快速重新确认。

设计取舍的理由在 `openspec/changes/add-mod-release-workflow/design.md` 的决策 7。

## 环境基线

| 项 | 值 |
| --- | --- |
| `act` | 0.2.97(`go install github.com/nektos/act@latest`) |
| Go | 1.27.3 |
| Docker | 29.7.2 |
| 宿主机 Node.js | v24.21.0 |
| runner 镜像内 Node.js | v22.23.4(由 `actions/setup-node@v4` 现装) |
| 系统日期 | 2026-11-11 |

`act` 用 Go 安装,产物在 `$(go env GOPATH)/bin/act`,该目录通常不在 `PATH` 里,需要自己加。

## 结论速览

```bash
# 1. 一次性:构建本地 runner 镜像(十几秒)
docker build -f tools/release-local/runner.Dockerfile -t mc-toolchain/act-runner:local .

# 2. 跑试运行(完整构建 + 打包 + 资产核对,不发布)
tools/release-local/run.sh mockplayer3
```

`run.sh` 内部就是一条 `act` 命令,等价于:

```bash
act workflow_dispatch \
  -W .github/workflows/release-mod.yml \
  --input mod=mockplayer3 --input dry_run=true \
  -P ubuntu-latest=mc-toolchain/act-runner:local \
  --pull=false --bind --rm
```

## 坑一:runner 镜像拉不下来

act 的常规选择是 `catthehacker/ubuntu:act-22.04`,它预置了 `git` / `node` / `gh` 等工具,本来最省事。实测在本机网络下**完全拉不动**:

```text
$ curl https://registry-1.docker.io/v2/
curl: (35) TLS connect error: error:0A000126:SSL routines::unexpected eof while reading
```

`/etc/docker/daemon.json` 里配了三个镜像源,表现如下:

| 镜像源 | `GET /v2/` | 拉 `catthehacker/ubuntu:act-22.04` |
| --- | --- | --- |
| `docker.1panel.live` | 403 | 403 |
| `hub.1panel.dev` | 200 | 有响应但 layer 下载数十分钟无进展 |
| `docker.1ms.run` | 401 | 未继续尝试 |

act 侧的表现是这一句,很容易被误读成 workflow 有问题:

```text
[Release Mod/发布 x] 🐳 docker pull image=catthehacker/ubuntu:act-22.04 ...
[Release Mod/发布 x] context canceled
[Release Mod/发布 x] ❌ Failure - Set up job
```

对照实验:同一时刻 `docker pull busybox:latest` 成功。说明不是 Docker 整体不可用,而是这个较大的多 layer 镜像在受限网络下拿不下来。

**解决**:底座改用本地**已有**的 `node:24-bookworm-slim`,只补 workflow 真正用到的工具,完全不依赖外部 registry:

```dockerfile
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl gh zip unzip \
 && rm -rf /var/lib/apt/lists/*
```

各工具的用途:`git` 用于 checkout 与生成 Release Notes(`git log` / `git tag`);`gh` 用于 `gh release create`;`zip` 是 `@minecraft/core-build-tasks` 的 `zipTask` 的硬依赖;`curl` / `ca-certificates` 供 `actions/checkout` 与 `setup-node` 下载使用。

镜像里 `gh` 是 Debian 打包版 **2.23.0**,比线上 runner 旧。`gh release create --target` 在该版本已存在,且本地试运行根本不调它,故不影响结论;真实发布仍由线上 runner 承担。

## 坑二:act 对 `-P` 镜像强制 pull

指定自建镜像后仍会失败:

```text
Error response from daemon: unknown: failed to resolve reference
"docker.io/mc-toolchain/act-runner:local": unexpected status from HEAD request to
https://docker.1panel.live/v2/mc-toolchain/act-runner/manifests/local?ns=docker.io: 403 Forbidden
```

原因:act 默认对 `-P` 给出的镜像执行 `docker pull`(日志里的 `forcePull=true`),而本地镜像在远程 registry 里不存在。

**解决**:加 `--pull=false`。

## 坑三:不加 `--bind` 就看不到产物

act 默认把工作目录**复制**进容器,容器内 `npm run pack` 写到 `release/` 的文件留在容器里,容器销毁后宿主机什么都没有——本地验证的核心目的(核对资产命名)就落空了。

**解决**:加 `--bind` 挂载工作目录。副作用是容器内 `npm ci` 会按锁文件重装宿主机的 `node_modules`,属可接受(结果与锁文件一致),但本地模拟后建议在宿主机再 `npm ci` 一次。

## 实测结果

三个代表样本均通过(`dry_run=true`),覆盖了三种产物形态:

| 模组 | 产物形态 | 耗时 | 结果 |
| --- | --- | --- | --- |
| `craftablerarities` | 纯内容包,无 `build` 脚本,单 `_bp.mcpack` | 打包 0.23s | ✅ |
| `item-route` | 行为包 + 资源包,单 `.mcaddon` | 打包 ~2s | ✅ |
| `mockplayer3` | 行为包 + 资源包,单 `.mcaddon` | 打包 10.1s | ✅ |

`mockplayer3` 的 Step Summary 输出(证明标题中文、资产名英文):

```text
- tag：`mockplayer3@3.0.33`
- Release 标题：`模拟玩家III 3.0.33`
- 发布目标：`Yinxe/MCBE`
- 资产（保持英文原名）：
release/mockplayer3-v3.0.33.mcaddon
```

`release/` 下同时存在其它 6 个模组的历史产物,资产收集步骤按 `<name>-v<version>` 精确匹配,未混入——这条在 `check-assets.mjs` 里也有断言。

## 已知边界

- **本地只验证到「资产已产出、命名与标题符合约定」**。`permissions`、`concurrency`、表达式求值、`gh release create` 的真实行为只有线上 runner 才能确认,故首次线上验证应先跑 `dry_run=true`。
- **`--bind` 会改写宿主机 `node_modules`**,见上。
- **tag 占用检查在本地会降级为警告**:`git ls-remote --tags origin` 需要访问远程,本地 act 环境无凭据时失败,workflow 里对此只 `::warning::` 而不中断,否则试运行跑不通。
