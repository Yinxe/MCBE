# Spec Delta

## Purpose

约定模组 Release 的发布契约：一次手动触发即可从仓库源码产出与 `package.json` 版本自洽的安装包并发布到固定的 GitHub 仓库，Release 面向玩家的标题用中文、资产文件名保持英文，且整条流水线能在本地以相同 workflow 文件完整复现验证。

## ADDED Requirements

### Requirement: 发布由手动触发且每次只发布一个模组

流水线 MUST 只由手动触发（`workflow_dispatch`），输入为模组名；MUST NOT 由推送 tag 或推送分支自动触发。一次运行 MUST 只构建并发布输入指定的单个模组，MUST NOT 顺带发布其它模组。

#### Scenario: 手动指定模组名触发

- **WHEN** 在 Actions 界面手动触发流水线并输入模组名 `mockplayer3`
- **THEN** 运行只处理 `mockplayer3`,不构建也不发布其它模组

#### Scenario: 推送 tag 不触发发布

- **WHEN** 仓库收到 `git push` 的 tag(例如 `mockplayer3@3.0.34`)
- **THEN** 流水线不被触发,不产生任何 Release

#### Scenario: 未知模组名立即失败

- **WHEN** 手动触发时输入的模组名在 `mods/` 下不存在
- **THEN** 运行在构建前失败并指明该模组名不存在,不产生 tag 与 Release

### Requirement: 版本号取自模组清单而非触发输入

发布使用的版本号 MUST 从 `mods/<mod>/package.json#version` 读取；触发输入 MUST NOT 携带版本号。流水线 MUST NOT 自行修改该版本号，版本提升由人在触发前提交。

#### Scenario: 版本来自 package.json

- **WHEN** `mods/mockplayer3/package.json#version` 为 `3.0.33` 时触发发布
- **THEN** tag 为 `mockplayer3@3.0.33`,资产名与清单版本均为 `3.0.33`

#### Scenario: 触发时无可输入版本号

- **WHEN** 查看该 workflow 的手动触发输入项
- **THEN** 只有模组名与是否试运行等选项,不存在版本号输入项

### Requirement: Release 标题用中文、资产文件名用英文

Release 的标题 MUST 为 `<productName> <version>`(`productName` 取自 `mods/<mod>/package.json#productName`,中文);上传的资产 MUST 保持打包产物的原名 `<name>-v<version>_bp.mcpack` / `<name>-v<version>_rp.mcpack` / `<name>-v<version>.mcaddon`(英文),MUST NOT 重命名为中文。

#### Scenario: 中文标题与英文资产名并存

- **WHEN** 发布 `mockplayer3` 3.0.33 且其 `productName` 为 `模拟玩家III`
- **THEN** Release 标题为 `模拟玩家III 3.0.33`,资产名为 `mockplayer3-v3.0.33.mcaddon`

#### Scenario: productName 缺失时中止

- **WHEN** 目标模组的 `package.json` 未声明 `productName`
- **THEN** 运行失败并指明缺少该字段,不创建标题不完整的 Release

### Requirement: 发布目标仓库固定且与代码宿主一致

流水线 MUST 把 tag 与 Release 发布到 `Yinxe/MCBE`;该仓库 MUST 同时是 workflow 文件的宿主，使流水线运行在该仓库自身的 Actions 上。tag 名 MUST 为 `<name>@<version>`,与仓库已有的历史 tag 形式一致。

#### Scenario: 发布落在 MCBE

- **WHEN** 流水线成功完成一次发布
- **THEN** 在 `Yinxe/MCBE` 的 Releases 中可见该版本,且同名 tag 指向被发布的提交

#### Scenario: 同名 tag 已存在

- **WHEN** 目标 tag(例如 `mockplayer3@3.0.33`)已存在于仓库
- **THEN** 运行失败并指明该 tag 已存在,不覆盖既有 tag,也不改动既有 Release 的资产

### Requirement: 资产只包含打包产物

上传到 Release 的资产 MUST 只来自模组打包产物目录中本次构建生成的 `.mcpack` / `.mcaddon` 文件；MUST NOT 上传中间产物(如 `temp/packs/` 下的内层 `.mcpack`)、构建中间目录或仓库源码。MUST NOT 上传其它模组的产物。

#### Scenario: 只上传本次模组的最终产物

- **WHEN** 发布 `item-route` 且其产物为单个 `item-route-v0.1.21.mcaddon`
- **THEN** Release 中只有一个资产 `item-route-v0.1.21.mcaddon`,不含内层 `_bp.mcpack` / `_rp.mcpack`

#### Scenario: 产物缺失时失败

- **WHEN** 构建与打包完成后在产物目录找不到该模组的任何 `.mcpack` / `.mcaddon`
- **THEN** 运行失败并指明未产出资产,不创建空 Release

### Requirement: 支持只验证不发布的试运行

流水线 MUST 提供试运行选项：启用时 MUST 完整执行依赖安装、构建与打包，并列出将被上传的资产；MUST NOT 创建 tag、MUST NOT 创建或修改 Release。

#### Scenario: 试运行不产生发布

- **WHEN** 以试运行选项触发 `mockplayer3` 的发布
- **THEN** 构建与打包正常完成并输出资产清单,仓库中不新增 tag、Releases 无变化

#### Scenario: 试运行暴露构建失败

- **WHEN** 以试运行选项触发且构建失败
- **THEN** 运行失败并保留失败步骤的日志,不进入发布步骤

### Requirement: Release Notes 只包含本模组的改动

Release 正文 MUST 只列出与本次发布模组相关的提交，MUST NOT 列出整个仓库的历史提交。基准 tag MUST 为 `HEAD` 的祖先；无可达基准 tag 时 MUST 退化为少量最近提交。

#### Scenario: 历史 tag 指向不可达提交

- **WHEN** 目标模组存在同名历史 tag，但它指向的提交不是 `HEAD` 的祖先（仓库历史被重写过）
- **THEN** 该 tag 不被选为基准，Release 正文只含本模组与共享包最近的少量提交，不含全仓历史

#### Scenario: 存在可达的上一个同名 tag

- **WHEN** 目标模组存在指向 `HEAD` 祖先的上一个同名 tag
- **THEN** Release 正文列出该 tag 到 `HEAD` 之间改动本模组或其共享包的提交，不含其它模组的提交

### Requirement: 流水线可在本地以同一份 workflow 复现

仓库 MUST 提供本地模拟入口，使开发者能在推送前用同一份 workflow 文件在本机容器中跑完整流程并核对产物；本地模拟 MUST 覆盖试运行与真实发布两条路径，且 MUST 能在不接触真实 GitHub 仓库的前提下验证到「资产已产出、命名与标题符合约定」这一步。

#### Scenario: 本地试运行跑通

- **WHEN** 开发者按仓库文档执行本地模拟的试运行命令并指定某模组
- **THEN** 本地容器内完成安装、构建、打包并输出与线上一致的资产清单,全程不访问 GitHub 发布接口

#### Scenario: 本地发布路径被拦截而非真发

- **WHEN** 开发者执行本地模拟的发布路径而未提供真实凭据
- **THEN** 发布步骤明确失败或按文档被拦截,不会向真实仓库写入 tag 或 Release

#### Scenario: 本地核对资产命名与标题

- **WHEN** 本地模拟完成后检查输出
- **THEN** 可看到资产文件名与 Release 标题的取值,并能据此确认英文资产名与中文标题符合约定
