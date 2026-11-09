# Package Distribution Specification

## Purpose

约定已发布包的分发契约：包可从 npm 公开安装，安装后库入口、CLI 可执行文件与 pi 扩展/skill 三者均可用，且发布产物只含运行所需文件、发布前自动校验类型与测试。

## Requirements

### Requirement: 可从 npm 公开安装

包 SHALL 以公开可访问的 npm 包发布，使用方在任意项目中执行 `npm install` 后即可使用，无需克隆仓库、无需在目标项目内构建。

#### Scenario: 安装后可导入库

- **WHEN** 在空项目中安装该包并导入其包入口
- **THEN** 可获得创建函数与 `McwikiSearch` 对象，且无需本地构建步骤

#### Scenario: 安装后可执行 CLI

- **WHEN** 在空项目中安装该包并运行其 CLI 命令
- **THEN** 命令可执行并输出查询结果，无需额外构建或配置

#### Scenario: 安装后 pi 可加载

- **WHEN** 以 `pi install` 从 npm 安装该包
- **THEN** pi 加载到 `mcwiki` 工具与该包随附的 skill

### Requirement: 发布产物只含运行所需文件

发布 tarball SHALL 包含库构建产物、CLI 构建产物、pi 扩展入口、skill 与许可证；MUST NOT 包含测试文件、测试夹具或开发期配置。

#### Scenario: 产物不含测试文件

- **WHEN** 检查发布 tarball 的文件清单
- **THEN** 不存在任何测试文件或测试夹具

#### Scenario: 产物含 pi 扩展入口

- **WHEN** 检查发布 tarball 的文件清单
- **THEN** 存在包清单中声明的 pi 扩展入口文件与 skill 目录

#### Scenario: 产物含许可证

- **WHEN** 检查发布 tarball 的文件清单
- **THEN** 存在许可证文件，且其许可类型与包清单声明一致

### Requirement: 发布前自动校验

发布 SHALL 在打包前自动执行类型检查、测试与构建；任一步失败时 MUST NOT 发布。

#### Scenario: 测试失败阻止发布

- **WHEN** 存在失败的测试并触发发布
- **THEN** 发布中止且未向 registry 上传任何版本

#### Scenario: 构建产物与源码一致

- **WHEN** 触发发布
- **THEN** tarball 中的构建产物由当前源码重新构建产生，而非仓库中的既有残留

### Requirement: 包元数据可追溯且公开

包清单 SHALL 声明源码仓库地址、许可证与公开访问策略；MUST NOT 标记为私有包。

#### Scenario: 元数据完整

- **WHEN** 读取已发布包的清单元数据
- **THEN** 仓库地址、许可证与公开访问策略均已声明

#### Scenario: 私有标记阻止发布

- **WHEN** 包清单仍标记为私有
- **THEN** 发布被拒绝，不会产生公开版本

### Requirement: 安装方式可查

包文档 SHALL 说明库、CLI 与 pi 三种安装方式，并标注支持的运行时版本要求。

#### Scenario: 三种安装方式可查

- **WHEN** 阅读包文档的安装章节
- **THEN** 可分别找到库、CLI 与 pi 的安装方式及运行时版本要求
