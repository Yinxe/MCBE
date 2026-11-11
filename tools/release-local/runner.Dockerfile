# act 用的本地 runner 镜像。
#
# 为什么自建：catthehacker/ubuntu:act-22.04 是 act 的常规选择，但它托管在 Docker Hub，
# 在本机网络下（TLS 中断 + 镜像源限速）拉不动，会卡在 "docker pull ... context canceled"。
# 改用本地已有的 node:24-bookworm-slim 作为底座，只补 workflow 真正用到的工具，
# 构建十几秒即可完成，且完全不依赖外部 registry。
#
# 构建：docker build -f tools/release-local/runner.Dockerfile -t mc-toolchain/act-runner:local .
FROM node:24-bookworm-slim

# git   —— checkout 与生成 Release Notes（git log / git tag）
# gh    —— gh release create
# zip   —— @minecraft/core-build-tasks 的 zipTask 依赖 zip 命令
# curl / ca-certificates —— actions/checkout 与 setup-node 的下载步骤
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl gh zip unzip \
 && rm -rf /var/lib/apt/lists/*

# act 用 --bind 把宿主机工作目录直接挂进容器，容器内 UID 与宿主机文件所有者不同，
# git 会以 "detected dubious ownership" 拒绝操作。放开所有目录（仅本地模拟镜像）。
# 线上 runner 是全新 checkout，不存在此问题。
RUN git config --system --add safe.directory '*'
