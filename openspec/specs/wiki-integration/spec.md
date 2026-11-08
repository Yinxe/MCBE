# Wiki Integration Specification

## Purpose

把 Minecraft Wiki 查询能力交付给三类消费者——库调用方、命令行用户与 pi agent——并为每个面约定稳定、一致的外部契约。

## Requirements

### Requirement: 共享核心与统一结果形状

库、CLI 与 pi 工具 SHALL 基于同一核心实现，并对同一查询返回同一结果形状，使结果可在各面之间互换。

#### Scenario: 同一查询形状一致

- **WHEN** 对同一查询分别调用库与 CLI 的 JSON 输出
- **THEN** 两者返回等价的字段结构

### Requirement: 库导出

包 SHALL 导出可编程入口（`McwikiSearch` 对象与创建函数）；其核心 SHALL 仅依赖标准 `fetch`，不依赖 Node 专有 API，以便在任意支持 `fetch` 的运行时中使用。

#### Scenario: 在无 Node 专有 API 的运行时使用

- **WHEN** 程序导入该包并只提供标准 `fetch`
- **THEN** 完成一次查询而不触发 Node 专有 API

### Requirement: CLI 子命令契约

包 SHALL 提供可执行命令 `mcwiki-search`，包含 `search`、`sections`、`page`、`suggest` 四个子命令，其参数语义与库选项一致。

#### Scenario: 搜索子命令

- **WHEN** 运行 `mcwiki-search search <查询>`
- **THEN** 输出匹配词条列表

### Requirement: CLI 非交互输出与退出码

CLI SHALL 在非 TTY（管道、agent 调用）下输出 JSON，在 TTY 下输出人类可读文本；失败时 SHALL 使用非零退出码并把诊断信息写入 stderr。

#### Scenario: 非 TTY 输出 JSON

- **WHEN** 命令输出被重定向而非 TTY
- **THEN** stdout 为 JSON

#### Scenario: 失败返回非零退出码

- **WHEN** 命令因词条不存在而失败
- **THEN** 退出码非零且 stderr 含可操作提示

### Requirement: pi 工具注册

包 SHALL 作为 pi 扩展注册名为 `mcwiki` 的工具，接受 `action`（`search`、`sections`、`page`、`suggest`）及相关参数，并返回结构化 `details` 供 agent 使用。

#### Scenario: 通过工具读取正文

- **WHEN** agent 调用 `mcwiki` 且 `action` 为 `page`
- **THEN** 返回该词条正文与结构化 `details`

### Requirement: 随包 skill

包 SHALL 提供一个 skill，说明何时使用该能力以及「先搜索、再按节读取」的省 token 用法。

#### Scenario: skill 可被发现

- **WHEN** agent 环境加载该包
- **THEN** 该 skill 以其名称与描述可被发现

### Requirement: 跨面配置一致

语言与超时等配置项 SHALL 在库选项、CLI 选项与 pi 工具参数之间保持一致的语义与默认值。

#### Scenario: 语言一致

- **WHEN** 在 CLI 与库中分别指定语言为 `en`
- **THEN** 两者均请求英文站
