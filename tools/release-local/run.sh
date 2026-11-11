#!/usr/bin/env bash
# 本地模拟模组发版：用 nektos/act 在 Docker 里跑线上同一份 workflow。
#
# 用法（在仓库根执行，或从任意目录调用本脚本）：
#   tools/release-local/run.sh <模组目录名>              # 试运行：完整构建打包，不发布
#   tools/release-local/run.sh <模组目录名> --publish    # 真实发布（需 GITHUB_TOKEN，会写真实仓库）
#
# 试运行默认走 dry_run=true：容器内完成 npm ci → 构建 → 打包 → 资产收集，
# 并把资产清单、Release 标题、tag 写进 Step Summary 后结束，不创建 tag 与 Release。
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repository_root"

mod=""
publish=false
for argument in "$@"; do
  case "$argument" in
    --publish) publish=true ;;
    -h | --help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "未知选项：$argument（可用：--publish、--help）" >&2
      exit 2
      ;;
    *)
      if [ -n "$mod" ]; then
        echo "一次只能模拟一个模组，已收到：$mod 与 $argument" >&2
        exit 2
      fi
      mod="$argument"
      ;;
  esac
done

if [ -z "$mod" ]; then
  echo "用法：tools/release-local/run.sh <模组目录名> [--publish]" >&2
  echo "可选模组：$(ls mods | grep -v '^README.md$' | tr '\n' ' ')" >&2
  exit 2
fi

# ---- 环境自检 ----
runner_image="mc-toolchain/act-runner:local"

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker，act 需要 Docker 才能运行容器。" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker 未运行（docker info 失败），请先启动 Docker。" >&2
  exit 1
fi
if ! command -v act >/dev/null 2>&1; then
  echo "未找到 act，请先安装：" >&2
  echo "  go install github.com/nektos/act@latest   # 产物在 \$(go env GOPATH)/bin/act" >&2
  echo "  并确保 \$(go env GOPATH)/bin 在 PATH 中。" >&2
  exit 1
fi

# 本地 runner 镜像：act 不会自动构建它，首次使用前需手动 build 一次
if ! docker image inspect "$runner_image" >/dev/null 2>&1; then
  echo "未找到本地 runner 镜像 $runner_image，正在构建（首次约十几秒）..." >&2
  docker build -f tools/release-local/runner.Dockerfile -t "$runner_image" . >/dev/null
fi
if [ ! -f mods/"$mod"/package.json ]; then
  echo "模组名 $mod 不存在：未找到 mods/$mod/package.json" >&2
  exit 1
fi

dry_run=true
act_arguments=(workflow_dispatch
  -W .github/workflows/release-mod.yml
  --input "mod=$mod"
  --input "dry_run=true"
  -P "ubuntu-latest=$runner_image"
  --pull=false
  --bind
  --rm)

if [ "$publish" = true ]; then
  # 真实发布路径默认拦截：必须显式 --publish，且必须提供真实凭据。
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "拒绝执行真实发布：未提供 GITHUB_TOKEN。" >&2
    echo "本地模拟默认只做试运行。若确实要向真实仓库发布，请：" >&2
    echo "  GITHUB_TOKEN=\$(gh auth token) tools/release-local/run.sh $mod --publish" >&2
    exit 1
  fi
  dry_run=false
  act_arguments=(workflow_dispatch
    -W .github/workflows/release-mod.yml
    --input "mod=$mod"
    --input "dry_run=false"
    --secret "GITHUB_TOKEN=${GITHUB_TOKEN}"
    -P "ubuntu-latest=$runner_image"
    --pull=false
    --bind
    --rm)
  echo "警告：本次会向真实仓库创建 tag 与 Release（$mod）。" >&2
fi

echo "== 本地模拟 $mod（dry_run=$dry_run）=="
# runner 镜像、--pull=false 与 --bind 在命令行显式给出（不依赖 .actrc，从任意目录调用也一致）
act "${act_arguments[@]}"

# ---- 产物核对 ----
node tools/release-local/check-assets.mjs "$mod"
